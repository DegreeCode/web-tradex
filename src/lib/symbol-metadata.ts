/**
 * Public symbol metadata, persisted in localStorage and shared across tabs.
 * One tab bootstraps the full list under a storage lock; afterwards every tab
 * applies incremental changes from the server's version watermark.
 */
import { apiData, apiPage, buildQuery } from "./api";
import type { MarketSymbol, Page } from "./types";

const MARKET_PAGE_SIZE = 200;

export const SYMBOL_METADATA_CACHE_KEY = "tradex:public-symbol-metadata:v1";
const SYMBOL_METADATA_LOCK_KEY = `${SYMBOL_METADATA_CACHE_KEY}:bootstrap-lock`;
// icon_url was added to the public symbol DTO;
// reject the older local cache once so the new metadata is authoritative.
const SYMBOL_METADATA_SCHEMA_VERSION = 3;
export const SYMBOL_METADATA_SYNC_MS = 60_000;
const SYMBOL_BATCH_LIMIT = 200;
const SYMBOL_BOOTSTRAP_LOCK_MS = 120_000;

export interface SymbolMetadataCache {
  schema_version: typeof SYMBOL_METADATA_SCHEMA_VERSION;
  symbols: MarketSymbol[];
  next_since_version: string;
  saved_at: number;
}

interface SymbolChange {
  symbol: string;
  version: string;
  deleted: boolean;
}

interface SymbolChanges {
  changes: SymbolChange[];
  has_more: boolean;
  next_since_version: string;
}

interface SymbolBootstrapLock {
  token: string;
  expires_at: number;
}

let memorySymbolMetadataCache: SymbolMetadataCache | null = null;
let symbolMetadataBootstrapPromise: Promise<SymbolMetadataCache> | null = null;
let symbolMetadataInitialValidationDone = false;
let symbolMetadataSyncPromise: Promise<SymbolMetadataCache> | null = null;

export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const collected: T[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  while (true) {
    const paginationQuery = buildQuery({ limit: MARKET_PAGE_SIZE, cursor });
    const page: Page<T> = await apiPage<T>(
      `${path}${paginationQuery ? (path.includes("?") ? `&${paginationQuery.slice(1)}` : paginationQuery) : ""}`,
    );
    collected.push(...page.data);
    if (!page.page.has_more || !page.page.next_cursor) break;
    if (seenCursors.has(page.page.next_cursor)) {
      throw new Error("Repeated market pagination cursor");
    }
    seenCursors.add(page.page.next_cursor);
    cursor = page.page.next_cursor;
  }
  return collected;
}

// The listing create response encodes an empty tag list as null.
export function withTagList(symbol: MarketSymbol): MarketSymbol {
  return Array.isArray(symbol.tags) ? symbol : { ...symbol, tags: [] };
}

export function isMarketSymbol(value: unknown): value is MarketSymbol {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.symbol === "string" &&
    row.symbol.length > 0 &&
    (row.manager_user_id === undefined || typeof row.manager_user_id === "string") &&
    typeof row.name === "string" &&
    typeof row.description === "string" &&
    Array.isArray(row.tags) &&
    row.tags.every((tag) => typeof tag === "string") &&
    (row.state === "TRADING" ||
      row.state === "HALTED" ||
      row.state === "DELIST_PENDING" ||
      row.state === "DELISTED") &&
    typeof row.total_supply === "string" &&
    typeof row.circulating_supply === "string" &&
    typeof row.locked_supply === "string" &&
    (row.curve_floor_price === undefined ||
      row.curve_floor_price === null ||
      typeof row.curve_floor_price === "string") &&
    (row.curve_ceiling_price === undefined ||
      row.curve_ceiling_price === null ||
      typeof row.curve_ceiling_price === "string") &&
    typeof row.listing_sequence === "number" &&
    Number.isFinite(row.listing_sequence) &&
    typeof row.listed_at === "string" &&
    typeof row.updated_at === "string" &&
    (row.halt_reason === null || typeof row.halt_reason === "string") &&
    (row.halted_at === null || typeof row.halted_at === "string") &&
    (row.halted_until === null || typeof row.halted_until === "string") &&
    typeof row.version === "string"
  );
}

export function parseSymbolMetadataCache(value: unknown): SymbolMetadataCache | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    row.schema_version !== SYMBOL_METADATA_SCHEMA_VERSION ||
    !Array.isArray(row.symbols) ||
    !row.symbols.every(isMarketSymbol) ||
    new Set(row.symbols.map((symbol) => symbol.symbol)).size !== row.symbols.length ||
    typeof row.next_since_version !== "string" ||
    row.next_since_version.length === 0 ||
    typeof row.saved_at !== "number" ||
    !Number.isFinite(row.saved_at)
  ) {
    return null;
  }
  return {
    schema_version: SYMBOL_METADATA_SCHEMA_VERSION,
    symbols: row.symbols,
    next_since_version: row.next_since_version,
    saved_at: row.saved_at,
  };
}

export function readSymbolMetadataCache(): SymbolMetadataCache | null {
  if (memorySymbolMetadataCache) return memorySymbolMetadataCache;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SYMBOL_METADATA_CACHE_KEY);
    if (!raw) return null;
    const parsed = parseSymbolMetadataCache(JSON.parse(raw));
    if (parsed) {
      memorySymbolMetadataCache = parsed;
      return parsed;
    }
    window.localStorage.removeItem(SYMBOL_METADATA_CACHE_KEY);
  } catch {
    // Ignore malformed or unavailable browser storage and recover from REST.
  }
  return null;
}

export function writeSymbolMetadataCache(cache: SymbolMetadataCache): void {
  memorySymbolMetadataCache = cache;
  if (typeof window === "undefined") return;
  try {
    // One localStorage record keeps metadata and its exact API watermark together.
    window.localStorage.setItem(SYMBOL_METADATA_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // In-memory state still serves this tab when storage is unavailable.
  }
}

export function clearSymbolMetadataCache(): void {
  memorySymbolMetadataCache = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SYMBOL_METADATA_CACHE_KEY);
  } catch {
    // Ignore unavailable browser storage; the next sync can retry recovery.
  }
}

function parseSymbolBootstrapLock(value: string | null): SymbolBootstrapLock | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (
      typeof row.token !== "string" ||
      typeof row.expires_at !== "number" ||
      !Number.isFinite(row.expires_at)
    ) {
      return null;
    }
    return { token: row.token, expires_at: row.expires_at };
  } catch {
    return null;
  }
}

function tryAcquireSymbolBootstrapLock(): string | null {
  if (typeof window === "undefined") return "server";
  const now = Date.now();
  try {
    const current = parseSymbolBootstrapLock(window.localStorage.getItem(SYMBOL_METADATA_LOCK_KEY));
    if (current && current.expires_at > now) return null;
    const token = `${now.toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(
      SYMBOL_METADATA_LOCK_KEY,
      JSON.stringify({ token, expires_at: now + SYMBOL_BOOTSTRAP_LOCK_MS }),
    );
    const verified = parseSymbolBootstrapLock(window.localStorage.getItem(SYMBOL_METADATA_LOCK_KEY));
    return verified?.token === token ? token : null;
  } catch {
    // If storage is unavailable there is no cross-tab state to coordinate.
    return `${now.toString(36)}-memory`;
  }
}

function releaseSymbolBootstrapLock(token: string): void {
  if (typeof window === "undefined" || token === "server") return;
  try {
    const current = parseSymbolBootstrapLock(window.localStorage.getItem(SYMBOL_METADATA_LOCK_KEY));
    if (current?.token === token) window.localStorage.removeItem(SYMBOL_METADATA_LOCK_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
}

function waitForSymbolMetadataCache(maxWaitMs: number): Promise<SymbolMetadataCache | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const deadline = Date.now() + maxWaitMs;
    let timer: number | undefined;

    const finish = (cache: SymbolMetadataCache | null) => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
      resolve(cache);
    };

    const check = () => {
      const cache = readSymbolMetadataCache();
      if (cache || Date.now() >= deadline) {
        finish(cache);
        return;
      }
      timer = window.setTimeout(check, 250);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === SYMBOL_METADATA_CACHE_KEY || event.key === SYMBOL_METADATA_LOCK_KEY) {
        check();
      }
    };

    window.addEventListener("storage", onStorage);
    check();
  });
}

function isSymbolChanges(value: unknown): value is SymbolChanges {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    Array.isArray(row.changes) &&
    row.changes.every((change) => {
      if (!change || typeof change !== "object") return false;
      const item = change as Record<string, unknown>;
      return (
        typeof item.symbol === "string" &&
        typeof item.version === "string" &&
        typeof item.deleted === "boolean"
      );
    }) &&
    typeof row.has_more === "boolean" &&
    typeof row.next_since_version === "string" &&
    row.next_since_version.length > 0
  );
}

async function bootstrapSymbolMetadata(): Promise<SymbolMetadataCache> {
  const baseline = await apiData<SymbolChanges>("/api/v1/market/symbols/changes");
  if (!isSymbolChanges(baseline)) throw new Error("Invalid symbol changes baseline");
  const symbols = await fetchAllPages<MarketSymbol>("/api/v1/market/symbols");
  const cache: SymbolMetadataCache = {
    schema_version: SYMBOL_METADATA_SCHEMA_VERSION,
    symbols,
    next_since_version: baseline.next_since_version,
    saved_at: Date.now(),
  };
  writeSymbolMetadataCache(cache);
  // The baseline changes request is the validation for this fresh runtime;
  // do not immediately issue a second changes request after bootstrap.
  symbolMetadataInitialValidationDone = true;
  return cache;
}

export function ensureSymbolMetadataCache(): Promise<SymbolMetadataCache> {
  const cached = readSymbolMetadataCache();
  if (cached) return Promise.resolve(cached);
  if (symbolMetadataBootstrapPromise) return symbolMetadataBootstrapPromise;

  symbolMetadataBootstrapPromise = (async () => {
    while (true) {
      const current = readSymbolMetadataCache();
      if (current) return current;
      const token = tryAcquireSymbolBootstrapLock();
      if (token) {
        try {
          const afterLock = readSymbolMetadataCache();
          return afterLock ?? (await bootstrapSymbolMetadata());
        } finally {
          releaseSymbolBootstrapLock(token);
        }
      }
      const fromOtherTab = await waitForSymbolMetadataCache(SYMBOL_BOOTSTRAP_LOCK_MS);
      if (fromOtherTab) return fromOtherTab;
    }
  })().finally(() => {
    symbolMetadataBootstrapPromise = null;
  });
  return symbolMetadataBootstrapPromise;
}

async function syncSymbolMetadataChanges(cache: SymbolMetadataCache): Promise<SymbolMetadataCache> {
  const initialCursor = cache.next_since_version;
  const changesBySymbol = new Map<string, boolean>();
  const seenCursors = new Set<string>([initialCursor]);
  let cursor = initialCursor;
  while (true) {
    const page = await apiData<SymbolChanges>(
      `/api/v1/market/symbols/changes${buildQuery({
        since_version: cursor,
        limit: MARKET_PAGE_SIZE,
      })}`,
    );
    if (!isSymbolChanges(page)) throw new Error("Invalid symbol changes response");
    for (const item of page.changes) changesBySymbol.set(item.symbol, item.deleted);
    const nextCursor = page.next_since_version;
    if (!page.has_more) {
      cursor = nextCursor;
      break;
    }
    if (seenCursors.has(nextCursor)) throw new Error("Repeated symbol changes cursor");
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  const changed = [...changesBySymbol]
    .filter(([, deleted]) => !deleted)
    .map(([symbol]) => symbol);
  const metadata: MarketSymbol[] = [];
  for (let index = 0; index < changed.length; index += SYMBOL_BATCH_LIMIT) {
    const symbols = changed.slice(index, index + SYMBOL_BATCH_LIMIT);
    const batch = await apiData<MarketSymbol[]>(
      `/api/v1/market/symbols/batch${buildQuery({ symbols: symbols.join(",") })}`,
    );
    if (!Array.isArray(batch) || !batch.every(isMarketSymbol)) {
      throw new Error("Invalid symbol metadata batch");
    }
    metadata.push(...batch);
  }

  const nextSymbols = new Map(cache.symbols.map((symbol) => [symbol.symbol, symbol]));
  for (const [symbol, isDeleted] of changesBySymbol) {
    if (isDeleted) nextSymbols.delete(symbol);
  }
  for (const symbolData of metadata) nextSymbols.set(symbolData.symbol, symbolData);

  const nextCache: SymbolMetadataCache = {
    schema_version: SYMBOL_METADATA_SCHEMA_VERSION,
    symbols: [...nextSymbols.values()],
    next_since_version: cursor,
    saved_at: Date.now(),
  };
  writeSymbolMetadataCache(nextCache);
  return nextCache;
}

export function runSymbolMetadataSync(cache: SymbolMetadataCache): Promise<SymbolMetadataCache> {
  if (symbolMetadataSyncPromise) return symbolMetadataSyncPromise;
  symbolMetadataSyncPromise = syncSymbolMetadataChanges(cache).finally(() => {
    symbolMetadataSyncPromise = null;
  });
  return symbolMetadataSyncPromise;
}

export function runInitialSymbolMetadataValidation(cache: SymbolMetadataCache): Promise<SymbolMetadataCache> {
  if (symbolMetadataInitialValidationDone) return Promise.resolve(cache);
  const validation = runSymbolMetadataSync(cache);
  return validation.then(
    (nextCache) => {
      symbolMetadataInitialValidationDone = true;
      return nextCache;
    },
    (error) => {
      // The attempt is consumed for this JS runtime. A later 60-second tick
      // can retry a transient failure without duplicate Strict Mode requests.
      symbolMetadataInitialValidationDone = true;
      throw error;
    },
  );
}

/** Adopts a cache another tab wrote (or dropped) without re-validating it. */
export function adoptSymbolMetadataCache(cache: SymbolMetadataCache | null): SymbolMetadataCache | null {
  const previous = memorySymbolMetadataCache;
  memorySymbolMetadataCache = cache;
  return previous;
}

export function isInitialSymbolMetadataValidationDone(): boolean {
  return symbolMetadataInitialValidationDone;
}
