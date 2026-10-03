import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { loadDisclosurePage, reconcileDisclosures } from "../src/lib/hooks";
import { applySymbolMetadataCache, cacheSymbolMetadata } from "../src/lib/market-cache";
import type { Disclosure, MarketSymbol } from "../src/lib/types";

const row = (id: string, minute: number, symbol = "AAA.M", type = "SYMBOL_HALTED"): Disclosure => ({
  disclosure_id: id, occurred_at: new Date(minute * 60_000).toISOString(), symbol, type, payload: {},
});
const page = (data: Disclosure[], cursor: string | null = null) => ({ data, page: { has_more: !!cursor, next_cursor: cursor } });
const metadata = (sequence: number, minute: number): MarketSymbol => ({
  symbol: "AAA.M", name: "AAA", description: "", tags: [], state: "TRADING",
  total_supply: "1", circulating_supply: "1", locked_supply: "0",
  listing_sequence: sequence, listed_at: new Date(minute * 60_000).toISOString(),
  updated_at: new Date(minute * 60_000).toISOString(), version: String(sequence),
  halt_reason: null, halted_at: null, halted_until: null,
});

test("public disclosures update matching caches, deduplicate snapshots and preserve history cursors", () => {
  const client = new QueryClient();
  const key = ["disclosures", "AAA.M", "all", 10];
  const older = page([row("old", 1)]);
  client.setQueryData(key, { pages: [page([row("initial", 3)], "older"), older], pageParams: [null, "older"] });
  const other = ["disclosures", "BBB.M", "all", 10];
  const filtered = ["disclosures", "AAA.M", "SYMBOL_RESUMED", 10];
  for (const k of [other, filtered]) client.setQueryData(k, { pages: [page([])], pageParams: [null] });
  const events = [row("new", 4), row("old", 1), row("other", 5, "BBB.M"), row("resumed", 6, "AAA.M", "SYMBOL_RESUMED")];
  reconcileDisclosures(client, events);
  reconcileDisclosures(client, events);
  const result = client.getQueryData<{ pages: ReturnType<typeof page>[]; pageParams: unknown[] }>(key)!;
  assert.deepEqual(result.pages[0].data.map(r => r.disclosure_id), ["resumed", "new", "initial"]);
  assert.deepEqual(result.pages[0].page, { has_more: true, next_cursor: "older" });
  assert.equal(result.pages[1], older);
  assert.deepEqual(result.pageParams, [null, "older"]);
  for (const [k, expected] of [[other, ["other"]], [filtered, ["resumed"]]] as const) {
    const value = client.getQueryData<{ pages: ReturnType<typeof page>[] }>(k)!;
    assert.deepEqual(value.pages[0].data.map(r => r.disclosure_id), expected);
  }
  assert.equal(client.getQueryState(key)?.isInvalidated, false);
  client.clear();
});

test("global market events without disclosure IDs do not create list entries", () => {
  const client = new QueryClient();
  reconcileDisclosures(client, [{ type: "GLOBAL_MARKET_HALTED", symbol: "", payload: {} } as Disclosure]);
  assert.deepEqual(client.getQueryData(["public-disclosures"]), []);
  client.clear();
});

test("relisting clears previous disclosures and cursors, including replayed socket snapshots", () => {
  const client = new QueryClient();
  cacheSymbolMetadata(client, metadata(1, 0));
  const key = ["disclosures", "AAA.M", "all", 10];
  const original = row("delisted", 3, "AAA.M", "DELISTED");
  const other = row("other", 2, "BBB.M");
  client.setQueryData(key, {
    pages: [page([original], "old-cursor"), page([row("old-trade", 1)])],
    pageParams: [null, "old-cursor"],
  });
  reconcileDisclosures(client, [original, other]);
  cacheSymbolMetadata(client, metadata(2, 4));
  const result = client.getQueryData<{ pages: ReturnType<typeof page>[]; pageParams: unknown[] }>(key)!;
  assert.deepEqual(result.pages, [page([])]);
  assert.deepEqual(result.pageParams, [null]);
  assert.deepEqual(client.getQueryData<Disclosure[]>(["public-disclosures"])?.map(r => r.disclosure_id), ["other"]);
  reconcileDisclosures(client, [original, row("current", 5)]);
  assert.deepEqual(client.getQueryData<{ pages: ReturnType<typeof page>[] }>(key)?.pages[0].data.map(r => r.disclosure_id), ["current"]);
  assert.deepEqual(client.getQueryData<Disclosure[]>(["public-disclosures"])?.map(r => r.disclosure_id), ["current", "other"]);
  assert.equal(client.getQueryState(key)?.isInvalidated, true);
  client.clear();
});

test("initial metadata sync removes old global rows but preserves current and unrelated disclosures", () => {
  const client = new QueryClient();
  const key = ["disclosures", "all", "all", 10];
  const rows = [row("current", 5), row("old", 3), row("other", 2, "BBB.M")];
  client.setQueryData(key, { pages: [page(rows, "cursor")], pageParams: [null] });
  reconcileDisclosures(client, rows);
  const cache = { schema_version: 3 as const, symbols: [metadata(2, 4)], next_since_version: "2", saved_at: Date.now() };
  applySymbolMetadataCache(client, cache);
  const result = client.getQueryData<{ pages: ReturnType<typeof page>[] }>(key)!;
  assert.deepEqual(result.pages[0].data.map(r => r.disclosure_id), ["current", "other"]);
  assert.deepEqual(result.pages[0].page, { has_more: false, next_cursor: null });
  assert.deepEqual(client.getQueryData<Disclosure[]>(["public-disclosures"])?.map(r => r.disclosure_id), ["current", "other"]);
  // Ordinary metadata updates in the same listing leave pagination intact.
  applySymbolMetadataCache(client, { ...cache, symbols: [{ ...metadata(2, 4), name: "Renamed" }] });
  assert.equal(client.getQueryData(key), result);
  client.clear();
});

test("empty REST pages do not fall back to cached disclosures, while live arrivals during the request survive", async (t) => {
  const client = new QueryClient();
  reconcileDisclosures(client, [row("previous", 3)]);
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(page([]))));
  assert.deepEqual(await loadDisclosurePage(client, { symbol: "AAA.M", limit: 10 }), page([]));
  fetch.mock.mockImplementation(async () => {
    reconcileDisclosures(client, [row("arrived", 5)]);
    return new Response(JSON.stringify(page([])));
  });
  const result = await loadDisclosurePage(client, { symbol: "AAA.M", limit: 10 });
  assert.deepEqual(result.data.map(r => r.disclosure_id), ["arrived"]);
  client.clear();
});

test("socket snapshots replace the live cache without losing paginated history for an unchanged listing", () => {
  const client = new QueryClient();
  const key = ["disclosures", "AAA.M", "all", 10];
  const history = { pages: [page([row("history", 1)], "cursor")], pageParams: [null] };
  client.setQueryData(key, history);
  reconcileDisclosures(client, [row("stale-snapshot", 2)]);
  reconcileDisclosures(client, [], true);
  assert.deepEqual(client.getQueryData(["public-disclosures"]), []);
  assert.deepEqual(client.getQueryData<typeof history>(key)?.pages[0].page, history.pages[0].page);
  assert.ok(client.getQueryData<typeof history>(key)?.pages[0].data.some(r => r.disclosure_id === "history"));
  client.clear();
});

test("relisting cancels a pending REST read before it can restore the previous listing", async (t) => {
  const client = new QueryClient();
  cacheSymbolMetadata(client, metadata(1, 0));
  const key = ["disclosures", "AAA.M", "all", 10];
  client.setQueryData(key, { pages: [page([row("old", 3)])], pageParams: [null] });
  let release!: (response: Response) => void;
  let requested!: () => void;
  let signal: AbortSignal | undefined;
  t.after(() => {
    release?.(new Response(JSON.stringify(page([]))));
    client.clear();
  });
  const started = new Promise<void>(resolve => { requested = resolve; });
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    signal = options.signal ?? undefined;
    requested();
    return new Promise<Response>(resolve => { release = resolve; });
  });
  const pending = client.fetchInfiniteQuery({
    queryKey: key,
    queryFn: ({ signal }) => loadDisclosurePage(client, { symbol: "AAA.M", limit: 10, signal }),
    initialPageParam: null,
    getNextPageParam: () => null,
  });
  await started;
  cacheSymbolMetadata(client, metadata(2, 4));
  await pending;
  assert.equal(signal?.aborted, true);
  release(new Response(JSON.stringify(page([row("old", 3)], "old-cursor"))));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(client.getQueryData(key), { pages: [page([])], pageParams: [null] });
  client.clear();
});
