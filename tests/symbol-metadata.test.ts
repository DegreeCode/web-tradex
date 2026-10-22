import test from "node:test";
import assert from "node:assert/strict";
import {
  SYMBOL_METADATA_CACHE_KEY,
  clearSymbolMetadataCache,
  adoptSymbolMetadataCache,
  ensureSymbolMetadataCache,
  isMarketSymbol,
  readSymbolMetadataCache,
  parseStoredSymbolMetadataCache,
  runSymbolMetadataSync,
  withTagList,
  writeSymbolMetadataCache,
} from "../src/lib/symbol-metadata";
import type { MarketSymbol } from "../src/lib/types";

const listed = {
  symbol: "ABC",
  name: "ABC Corp",
  description: "",
  tags: null,
  state: "TRADING",
  total_supply: "1000",
  circulating_supply: "900",
  locked_supply: "100",
  listing_sequence: 1,
  listed_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
  halt_reason: null,
  halted_at: null,
  halted_until: null,
  version: "1",
} as unknown as MarketSymbol;

test("a listing response without tags gets an empty tag list", () => {
  const symbol = withTagList(listed);
  assert.deepEqual(symbol.tags, []);
  assert.ok(isMarketSymbol(symbol));
});

test("metadata sync preserves newer edits and listings received while its batch is loading", async (t) => {
  clearSymbolMetadataCache();
  t.after(clearSymbolMetadataCache);
  const symbol = withTagList(listed);
  const cache = { schema_version: 3 as const, symbols: [symbol], next_since_version: "1", saved_at: 1 };
  writeSymbolMetadataCache(cache);
  let release!: (response: Response) => void;
  let started!: () => void;
  const batchStarted = new Promise<void>((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", (url: string) => {
    if (url.includes("/changes")) return Promise.resolve(Response.json({ data: {
      changes: [{ symbol: symbol.symbol, version: "2", deleted: false }],
      has_more: false, next_since_version: "2",
    } }));
    started();
    return new Promise<Response>((resolve) => { release = resolve; });
  });
  const pending = runSymbolMetadataSync(cache);
  await batchStarted;
  const edited = { ...symbol, name: "Newer name", version: "3" };
  const newListing = { ...symbol, symbol: "NEW.M", version: "4" };
  writeSymbolMetadataCache({ ...cache, symbols: [edited, newListing] });
  release(Response.json({ data: [{ ...symbol, name: "Older name", version: "2" }] }));
  const result = await pending;
  assert.deepEqual(result.symbols, [edited, newListing]);
  assert.equal(result.next_since_version, "2");
  assert.equal(readSymbolMetadataCache(), result);
});

test("bootstrap waiting keeps one timer and retries immediately when another tab releases its lock", async (t) => {
  clearSymbolMetadataCache();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  const lockKey = `${SYMBOL_METADATA_CACHE_KEY}:bootstrap-lock`;
  storage.set(lockKey, JSON.stringify({ token: "other-tab", expires_at: Date.now() + 120_000 }));
  const events = new EventTarget();
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: (timer: number) => timers.delete(timer),
  } });
  t.after(() => {
    clearSymbolMetadataCache();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  t.mock.method(globalThis, "fetch", async (url: string) => url.includes("/changes")
    ? Response.json({ data: { changes: [], has_more: false, next_since_version: "1" } })
    : Response.json({ data: [withTagList(listed)], page: { has_more: false, next_cursor: null } }));
  const pending = ensureSymbolMetadataCache();
  const notify = () => events.dispatchEvent(Object.assign(new Event("storage"), { key: lockKey }));
  for (let index = 0; index < 5; index++) notify();
  assert.equal(timers.size, 1);
  storage.delete(lockKey);
  notify();
  assert.equal(timers.size, 0);
  const result = await pending;
  assert.equal(result.symbols.length, 1);
  assert.equal(timers.size, 0);
});

test("no-change sync advances freshness without serializing, writing or reparsing metadata", async (t) => {
  clearSymbolMetadataCache();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  let writes = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { writes++; storage.set(key, value); },
    removeItem: (key: string) => storage.delete(key),
  } } });
  t.after(() => {
    clearSymbolMetadataCache();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const cache = { schema_version: 3 as const, symbols: [withTagList(listed)], next_since_version: "1", saved_at: 1 };
  writeSymbolMetadataCache(cache);
  writes = 0;
  let serializations = 0;
  const stringify = JSON.stringify;
  t.mock.method(JSON, "stringify", (value: unknown, ...args: unknown[]) => {
    if (value && typeof value === "object" && "schema_version" in value) serializations++;
    return stringify(value, ...args as []);
  });
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: { changes: [], has_more: false, next_since_version: "1" } }));
  const next = await runSymbolMetadataSync(cache);
  assert.equal(next.symbols, cache.symbols);
  assert.ok(next.saved_at > cache.saved_at);
  assert.equal(writes, 0);
  assert.equal(serializations, 0);
  assert.equal(readSymbolMetadataCache(), next);
});


test("duplicate cross-tab revisions skip the full JSON parse and validation", (t) => {
  clearSymbolMetadataCache();
  t.after(clearSymbolMetadataCache);
  const cache = { schema_version: 3 as const, symbols: [withTagList(listed)], next_since_version: "1", saved_at: 1 };
  writeSymbolMetadataCache(cache);
  const raw = JSON.stringify({ revision: "other-tab-1", ...cache });
  const first = parseStoredSymbolMetadataCache(raw);
  assert.ok(first);
  adoptSymbolMetadataCache(first);
  let parses = 0;
  const parse = JSON.parse;
  t.mock.method(JSON, "parse", (value: string) => { parses++; return parse(value); });
  assert.equal(parseStoredSymbolMetadataCache(raw), first);
  assert.equal(parseStoredSymbolMetadataCache(JSON.stringify({ revision: "other-tab-1", ...cache, saved_at: 99 })), first);
  assert.equal(parses, 0);
  const changed = parseStoredSymbolMetadataCache(JSON.stringify({ revision: "other-tab-2", ...cache, next_since_version: "2" }));
  assert.equal(changed!.next_since_version, "2");
  assert.equal(parses, 1);
});
