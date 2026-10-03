/**
 * Keeps the market query caches (instrument list, instrument details, market
 * state) consistent with symbol metadata, live tickers and trading events.
 */
import type { QueryClient } from "@tanstack/react-query";

import { apiData, buildQuery } from "./api";
import { reconcileDisclosureListings } from "./disclosure-cache";
import { parseTradingNotification } from "./notifications";
import {
  ensureSymbolMetadataCache,
  isMarketSymbol,
  readSymbolMetadataCache,
  writeSymbolMetadataCache,
  type SymbolMetadataCache,
} from "./symbol-metadata";
import type {
  Instrument,
  InstrumentState,
  MarketState,
  MarketSymbol,
  Notification,
  PublicTrade,
  Ticker,
} from "./types";

export const MARKET_STATE_CACHE_KEY = "tradex:market-state:v1";
const GLOBAL_EVENT_KEY = "__GLOBAL__";

/** Symbols are stored with the `.M` suffix; links and events may omit it. */
export function canonicalSymbol(symbol: string | undefined): string | undefined {
  const trimmed = symbol?.trim();
  if (!trimmed) return undefined;
  return trimmed.endsWith(".M") ? trimmed : `${trimmed}.M`;
}

export function isMarketState(value: unknown): value is MarketState {
  const state = (value as { state?: unknown } | null)?.state;
  return state === "RUNNING" || state === "GLOBAL_HALTED";
}

export function readMarketStateCache(): MarketState | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(MARKET_STATE_CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    return isMarketState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeMarketStateCache(state: MarketState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MARKET_STATE_CACHE_KEY, JSON.stringify(state));
  } catch {
    // The in-memory query still serves this tab.
  }
}

// ---------------------------------------------------------------------------
// Instruments: symbol metadata + ticker, with the newest trade price on top.
// ---------------------------------------------------------------------------

export function composeInstrument(symbol: MarketSymbol, ticker?: Ticker): Instrument {
  return {
    ...symbol,
    symbol: symbol.symbol,
    last_price: ticker?.last_price ?? "0",
    curve_spot_price: ticker?.curve_spot_price ?? "0",
    market_value: ticker?.market_value ?? "0",
    holder_count: ticker?.holder_count ?? 0,
    open: ticker?.open ?? "0",
    high: ticker?.high ?? "0",
    low: ticker?.low ?? "0",
    volume_shares: ticker?.volume_shares ?? "0",
    volume_credit: ticker?.volume_credit ?? "0",
    change_ppm: ticker?.change_ppm ?? 0,
    trade_count: ticker?.trade_count ?? 0,
    window_start: ticker?.window_start ?? "",
  };
}

function tickersBySymbol(queryClient: QueryClient): Map<string, Ticker> {
  const tickers = queryClient.getQueryData<Ticker[]>(["ticker-cache"]) ?? [];
  return new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
}

export function composeCachedInstruments(symbols: MarketSymbol[], queryClient: QueryClient): Instrument[] {
  const tickers = tickersBySymbol(queryClient);
  return symbols.map((symbol) => composeInstrument(symbol, tickers.get(symbol.symbol)));
}

export function findCachedTicker(queryClient: QueryClient, symbol: string): Ticker | undefined {
  return queryClient.getQueryData<Ticker[]>(["ticker-cache"])?.find((ticker) => ticker.symbol === symbol);
}

// Public trades carry a per-symbol sequence, while Ticker has no sequence or
// as-of field. Keep the newest accepted trade price as a small detail-view
// overlay so a slower ticker frame cannot visibly roll the last execution back.
const tradePriceOverlays = new Map<string, { sequence: number; price: string }>();

export function updateTradePriceOverlay(symbol: string, trade: PublicTrade): void {
  if (!Number.isSafeInteger(trade.sequence) || typeof trade.price !== "string" || !trade.price) return;
  const previous = tradePriceOverlays.get(symbol);
  if (previous && trade.sequence <= previous.sequence) return;
  tradePriceOverlays.set(symbol, { sequence: trade.sequence, price: trade.price });
}

export function clearTradePriceOverlay(symbol?: string): void {
  if (symbol === undefined) tradePriceOverlays.clear();
  else tradePriceOverlays.delete(symbol);
}

export function applyTradePriceOverlay(instrument: Instrument): Instrument {
  const overlay = tradePriceOverlays.get(instrument.symbol);
  return overlay ? { ...instrument, last_price: overlay.price } : instrument;
}

/** Re-composes a mounted instrument detail; unmounted symbols compose on demand. */
function updateInstrumentDetail(queryClient: QueryClient, symbol: MarketSymbol, ticker: Ticker | undefined) {
  queryClient.setQueryData<Instrument>(["instrument", symbol.symbol], (old) =>
    old ? applyTradePriceOverlay(composeInstrument(symbol, ticker ?? old)) : old,
  );
}

export function applySymbolMetadataCache(queryClient: QueryClient, cache: SymbolMetadataCache): void {
  reconcileDisclosureListings(queryClient, cache.symbols);
  queryClient.setQueryData<Instrument[]>(["instruments"], (old) => {
    const previous = new Map(old?.map((instrument) => [instrument.symbol, instrument]));
    const tickers = tickersBySymbol(queryClient);
    return cache.symbols.map((symbol) =>
      composeInstrument(symbol, tickers.get(symbol.symbol) ?? previous.get(symbol.symbol)),
    );
  });
}

/** Pushes only the symbols that changed between two caches into mounted details. */
export function applySymbolMetadataDelta(
  queryClient: QueryClient,
  previous: SymbolMetadataCache | null,
  next: SymbolMetadataCache,
): void {
  reconcileDisclosureListings(queryClient, next.symbols);
  const previousBySymbol = new Map(previous?.symbols.map((symbol) => [symbol.symbol, symbol]));
  const nextSymbols = new Set(next.symbols.map((symbol) => symbol.symbol));
  for (const symbol of previous?.symbols ?? []) {
    if (!nextSymbols.has(symbol.symbol)) queryClient.removeQueries({ queryKey: ["instrument", symbol.symbol] });
  }
  const tickers = tickersBySymbol(queryClient);
  for (const symbol of next.symbols) {
    const before = previousBySymbol.get(symbol.symbol);
    if (
      before?.version === symbol.version &&
      before.updated_at === symbol.updated_at &&
      before.state === symbol.state
    ) {
      continue;
    }
    updateInstrumentDetail(queryClient, symbol, tickers.get(symbol.symbol));
  }
}

export function applySymbolToQueryCaches(queryClient: QueryClient, symbol: MarketSymbol): void {
  reconcileDisclosureListings(queryClient, [symbol]);
  const ticker = findCachedTicker(queryClient, symbol.symbol);
  queryClient.setQueryData<Instrument[]>(["instruments"], (old) => {
    if (!old) return old;
    const index = old.findIndex((instrument) => instrument.symbol === symbol.symbol);
    if (index < 0) return [...old, applyTradePriceOverlay(composeInstrument(symbol, ticker))];
    return old.map((instrument, i) =>
      i === index ? applyTradePriceOverlay(composeInstrument(symbol, ticker ?? instrument)) : instrument,
    );
  });
  updateInstrumentDetail(queryClient, symbol, ticker);
}

// ---------------------------------------------------------------------------
// Trading state: events may arrive out of order over REST, WS and
// notifications, so each symbol keeps a watermark of the newest event applied.
// ---------------------------------------------------------------------------

export function compareVersion(a: string | undefined, b: string | undefined): number {
  if (!a || !b || a === b) return 0;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const diff = BigInt(a) - BigInt(b);
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  }
  return a.localeCompare(b);
}

export const lastTradingEventTimestamps = new Map<string, number>();

/** Raises a symbol's (or the market's) event watermark; it never moves back. */
export function noteTradingEventTime(key: string, time: number): void {
  if (!Number.isFinite(time)) return;
  const current = lastTradingEventTimestamps.get(key);
  if (current === undefined || time > current) lastTradingEventTimestamps.set(key, time);
}

export function noteMarketStateTime(state: MarketState): void {
  if (state.changed_at) noteTradingEventTime(GLOBAL_EVENT_KEY, Date.parse(state.changed_at));
}

/** Records every cached symbol's last change, e.g. after another tab synced. */
export function noteSymbolMetadataTimes(cache: SymbolMetadataCache): void {
  for (const symbol of cache.symbols) {
    noteTradingEventTime(symbol.symbol, Date.parse(symbol.updated_at || symbol.halted_at || "0"));
  }
}

function upsertCachedSymbol(cache: SymbolMetadataCache, symbol: MarketSymbol): void {
  const index = cache.symbols.findIndex((row) => row.symbol === symbol.symbol);
  writeSymbolMetadataCache({
    ...cache,
    symbols: index >= 0
      ? cache.symbols.map((row, i) => (i === index ? symbol : row))
      : [...cache.symbols, symbol],
    saved_at: Date.now(),
  });
}

function finiteTime(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

export function applySymbolTradingState(
  queryClient: QueryClient,
  rawSymbol: string,
  state: InstrumentState,
  reason?: string | null,
  haltedAt?: string | null,
  haltedUntil?: string | null,
  updatedAt?: string | null,
  eventTime?: number,
  version?: string | number,
): boolean {
  const symbol = canonicalSymbol(rawSymbol);
  if (!symbol) return false;

  const parsedEventTime = finiteTime(eventTime)
    ? eventTime
    : updatedAt
      ? Date.parse(updatedAt)
      : haltedAt
        ? Date.parse(haltedAt)
        : undefined;

  const lastSeen = lastTradingEventTimestamps.get(symbol);
  if (lastSeen !== undefined && (!finiteTime(parsedEventTime) || parsedEventTime <= lastSeen)) return false;

  const cache = readSymbolMetadataCache();
  const existing = cache?.symbols.find((s) => s.symbol === symbol);
  if (!cache || !existing) {
    if (finiteTime(parsedEventTime)) noteTradingEventTime(symbol, parsedEventTime);
    return false;
  }

  if (version !== undefined && version !== null && compareVersion(String(version), existing.version) < 0) {
    return false;
  }
  const existingTime = Date.parse(existing.updated_at || existing.halted_at || "");
  if (Number.isFinite(existingTime) && (!finiteTime(parsedEventTime) || parsedEventTime < existingTime)) {
    return false;
  }

  if (finiteTime(parsedEventTime)) noteTradingEventTime(symbol, parsedEventTime);
  const effectiveUpdatedAt = updatedAt ||
    (finiteTime(parsedEventTime) ? new Date(parsedEventTime).toISOString() : existing.updated_at || new Date().toISOString());
  const trading = state === "TRADING";
  const updatedSymbol: MarketSymbol = {
    ...existing,
    state,
    halt_reason: trading ? null : reason !== undefined ? reason : existing.halt_reason,
    halted_at: trading
      ? null
      : haltedAt !== undefined ? haltedAt : state === "HALTED" ? effectiveUpdatedAt : existing.halted_at,
    halted_until: trading ? null : haltedUntil !== undefined ? haltedUntil : existing.halted_until,
    updated_at: effectiveUpdatedAt,
    version: version !== undefined && version !== null ? String(version) : existing.version,
  };
  upsertCachedSymbol(cache, updatedSymbol);
  applySymbolToQueryCaches(queryClient, updatedSymbol);
  return true;
}

/** Applies an authoritative symbol response to persistent and mounted caches. */
export function cacheSymbolMetadata(queryClient: QueryClient, fresh: MarketSymbol): void {
  const current = readSymbolMetadataCache();
  const existing = current?.symbols.find((s) => s.symbol === fresh.symbol);
  if (existing && compareVersion(fresh.version, existing.version) < 0) return;

  noteTradingEventTime(fresh.symbol, Date.parse(fresh.updated_at || "0"));
  if (current) upsertCachedSymbol(current, fresh);
  applySymbolToQueryCaches(queryClient, fresh);
}

async function fetchSymbol(symbol: string): Promise<MarketSymbol | null> {
  const batch = await apiData<MarketSymbol[]>(`/api/v1/market/symbols/batch${buildQuery({ symbols: symbol })}`);
  const fresh = Array.isArray(batch) ? batch[0] : undefined;
  return isMarketSymbol(fresh) ? fresh : null;
}

const symbolMetadataRefreshes = new Map<string, Promise<void>>();

/** Shares one in-flight batch request per symbol across WS and notification paths. */
export function refreshSymbolMetadata(queryClient: QueryClient, rawSymbol: string): Promise<void> {
  const symbol = canonicalSymbol(rawSymbol);
  if (!symbol) return Promise.resolve();
  const inFlight = symbolMetadataRefreshes.get(symbol);
  if (inFlight) return inFlight;
  const refresh = fetchSymbol(symbol)
    .then((fresh) => {
      if (fresh) cacheSymbolMetadata(queryClient, fresh);
    })
    .catch(() => undefined) // Non-blocking background recovery.
    .finally(() => symbolMetadataRefreshes.delete(symbol));
  symbolMetadataRefreshes.set(symbol, refresh);
  return refresh;
}

/**
 * Loads a symbol the local cache does not know yet. A trading notification
 * newer than the fetched row wins, since the batch can lag behind the event.
 */
export async function refreshMissingSymbolMetadata(
  queryClient: QueryClient,
  rawSymbol: string,
  targetState?: InstrumentState,
  haltReason?: string | null,
  haltedAt?: string | null,
  createdAt?: string,
): Promise<void> {
  const symbol = canonicalSymbol(rawSymbol);
  if (!symbol) return;
  try {
    const fetched = await fetchSymbol(symbol);
    if (!fetched) return;

    let finalSymbol = fetched;
    const fetchedTime = Date.parse(fetched.updated_at || "0");
    let watermark = fetchedTime;
    if (targetState && createdAt) {
      const notifiedTime = Date.parse(createdAt);
      if (Number.isFinite(notifiedTime) && (!Number.isFinite(fetchedTime) || fetchedTime <= notifiedTime)) {
        finalSymbol = {
          ...fetched,
          state: targetState,
          halt_reason: haltReason ?? fetched.halt_reason,
          halted_at: haltedAt ?? fetched.halted_at,
          updated_at: createdAt,
        };
        watermark = notifiedTime;
      }
    }
    noteTradingEventTime(finalSymbol.symbol, watermark);

    const current = readSymbolMetadataCache() ?? (await ensureSymbolMetadataCache().catch(() => null));
    if (current) upsertCachedSymbol(current, finalSymbol);
    applySymbolToQueryCaches(queryClient, finalSymbol);
  } catch {
    // Non-blocking background recovery.
  }
}

const NOTIFIED_SYMBOL_STATE: Partial<Record<string, InstrumentState>> = {
  SYMBOL_HALTED: "HALTED",
  SYMBOL_RESUMED: "TRADING",
  DELIST_CANCELED: "TRADING",
  SYMBOL_LISTED: "TRADING",
  DELIST_SCHEDULED: "DELIST_PENDING",
  DELISTED: "DELISTED",
};

function applyGlobalMarketNotification(
  queryClient: QueryClient,
  notification: Notification,
  halted: boolean,
  reason: string | undefined,
  haltedUntil: string | null | undefined,
): void {
  const eventTime = Date.parse(notification.created_at);
  const lastGlobal = lastTradingEventTimestamps.get(GLOBAL_EVENT_KEY);
  if (lastGlobal !== undefined && (!Number.isFinite(eventTime) || eventTime <= lastGlobal)) return;

  const current = queryClient.getQueryData<MarketState>(["market-state"]);
  const changedAt = current?.changed_at ? Date.parse(current.changed_at) : NaN;
  if (Number.isFinite(changedAt) && (!Number.isFinite(eventTime) || eventTime < changedAt)) return;

  noteTradingEventTime(GLOBAL_EVENT_KEY, eventTime);
  const changed = notification.created_at || current?.changed_at || new Date().toISOString();
  const nextState: MarketState = halted
    ? {
        state: "GLOBAL_HALTED",
        reason: reason || current?.reason || null,
        halted_at: notification.created_at || current?.halted_at || null,
        halted_until: haltedUntil ?? current?.halted_until ?? null,
        changed_at: changed,
      }
    : { state: "RUNNING", reason: null, halted_at: null, halted_until: null, changed_at: changed };
  // The public market_state stream (or the disconnected poll) stays authoritative.
  queryClient.setQueryData<MarketState>(["market-state"], nextState);
  writeMarketStateCache(nextState);
}

export function applyTradingNotification(queryClient: QueryClient, notification: Notification): void {
  const tradingEvent = parseTradingNotification(notification);
  if (!tradingEvent) return;
  const { eventType, symbol: rawSymbol, reason, halted_until } = tradingEvent;

  if (eventType === "GLOBAL_MARKET_HALTED" || eventType === "GLOBAL_MARKET_RESUMED") {
    applyGlobalMarketNotification(queryClient, notification, eventType === "GLOBAL_MARKET_HALTED", reason, halted_until);
    return;
  }

  const symbol = canonicalSymbol(rawSymbol);
  if (!symbol) return;
  if (eventType === "SYMBOL_METADATA_CHANGED") {
    void refreshSymbolMetadata(queryClient, symbol);
    return;
  }
  const nextState = NOTIFIED_SYMBOL_STATE[eventType];
  if (!nextState) return;

  const known = readSymbolMetadataCache()?.symbols.some((s) => s.symbol === symbol);
  if (!known) {
    void refreshMissingSymbolMetadata(
      queryClient, symbol, nextState, reason, notification.created_at, notification.created_at,
    );
    return;
  }
  const payload = (notification as { payload?: Record<string, unknown> }).payload;
  const version = typeof payload?.version === "string" || typeof payload?.version === "number"
    ? payload.version
    : undefined;
  applySymbolTradingState(
    queryClient,
    symbol,
    nextState,
    reason,
    notification.created_at,
    halted_until,
    notification.created_at,
    notification.created_at ? Date.parse(notification.created_at) : undefined,
    version,
  );
  void refreshSymbolMetadata(queryClient, symbol);
}
