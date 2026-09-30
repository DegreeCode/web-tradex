"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
  type InfiniteData,
} from "@tanstack/react-query";

import {
  ApiError,
  apiData,
  apiPage,
  buildQuery,
  deleteData,
  patchIdempotentData,
  postData,
  postIdempotentData,
} from "./api";
import {
  appendCandleHistoryWithGaps,
  applyTradeToCandlePage,
  fillCandleGaps,
  isCandleInterval,
  mergeCandles,
  type CandlePage,
} from "./candle-data";
import { parseTradingNotification, parseNotificationBody, eventKeyFromTitle } from "./notifications";
import { invalidateMarginQueries } from "./margin";
import { invalidateBatched } from "./query-batch";
import type {
  Account,
  Candle,
  CandleInterval,
  Disclosure,
  Inquiry,
  InquiryCategory,
  InquiryDetail,
  InquiryMessage,
  Instrument,
  InstrumentState,
  Issuance,
  IssuancePreview,
  ListingRequest,
  ManagerRequest,
  MarketSymbol,
  MarketState,
  Nav,
  NavPoint,
  NavRange,
  Notification,
  Order,
  OrderRequest,
  OrderSimulation,
  OrderSimulationRequest,
  Page,
  Passkey,
  Portfolio,
  Position,
  PublicTrade,
  RealizedPnL,
  SessionList,
  Trade,
  Transfer,
  TransferRequest,
  Ticker,
  TickerSort,
  User,
  WsFrame,
} from "./types";
import {
  SYMBOL_METADATA_CACHE_KEY,
  SYMBOL_METADATA_SYNC_MS,
  adoptSymbolMetadataCache,
  clearSymbolMetadataCache,
  ensureSymbolMetadataCache,
  fetchAllPages,
  isInitialSymbolMetadataValidationDone,
  isMarketSymbol,
  parseSymbolMetadataCache,
  readSymbolMetadataCache,
  runInitialSymbolMetadataValidation,
  runSymbolMetadataSync,
  withTagList,
  writeSymbolMetadataCache,
  type SymbolMetadataCache,
} from "./symbol-metadata";
import { closeSocket, getSocket, type WsKind, type WsStatus } from "./ws";
import { isPositiveDecimal } from "./format";

const PAGE_SIZE = 30;
const TICKER_ORDER_LIMIT = 100;
const TICKER_ORDER_CACHE_MS = 60_000;
export const MARKET_STATE_CACHE_KEY = "tradex:market-state:v1";
const MAX_TRACKED_TRADE_SEQUENCES = 2_000;

interface CandleTradeRuntime {
  snapshotReady: boolean;
  lastSequence?: number;
  seenSequences: Set<number>;
  pendingSequences: Set<number>;
  recoveryInFlight: boolean;
  awaitingSnapshotRecovery: boolean;
}

interface TradePriceOverlay {
  sequence: number;
  price: string;
}

const candleTradeRuntimes = new Map<string, CandleTradeRuntime>();
const candleFetchTrades = new Map<string, PublicTrade[]>();
// Public trades carry a per-symbol sequence, while Ticker has no sequence or
// as-of field. Keep the newest accepted trade price as a small detail-view
// overlay so a slower ticker frame cannot visibly roll the last execution back.
const tradePriceOverlays = new Map<string, TradePriceOverlay>();

function candleRuntime(symbol: string): CandleTradeRuntime {
  let runtime = candleTradeRuntimes.get(symbol);
  if (!runtime) {
    runtime = {
      snapshotReady: false,
      seenSequences: new Set(),
      pendingSequences: new Set(),
      recoveryInFlight: false,
      awaitingSnapshotRecovery: false,
    };
    candleTradeRuntimes.set(symbol, runtime);
  }
  return runtime;
}

function rememberTradeSequence(runtime: CandleTradeRuntime, sequence: number): void {
  runtime.seenSequences.add(sequence);
  while (runtime.seenSequences.size > MAX_TRACKED_TRADE_SEQUENCES) {
    const oldest = runtime.seenSequences.values().next().value;
    if (oldest === undefined) break;
    runtime.seenSequences.delete(oldest);
  }
}

function updateCachedCandleQueries(
  queryClient: QueryClient,
  symbol: string,
  trade: PublicTrade,
): { updated: boolean; needsRecovery: boolean } {
  let updated = false;
  let needsRecovery = false;
  for (const [queryKey, unknownPage] of queryClient.getQueriesData<unknown>({
    queryKey: ["candles", symbol],
  })) {
    if (!Array.isArray(queryKey) || queryKey[1] !== symbol) continue;
    const interval = queryKey[2];
    const limit = queryKey[3];
    if (!isCandleInterval(interval) || typeof limit !== "number" || !Number.isInteger(limit)) continue;
    const query = queryClient.getQueryCache().find({ queryKey, exact: true });
    if (!query?.isActive()) continue;
    if (query.state.fetchStatus === "fetching") {
      const pending = candleFetchTrades.get(JSON.stringify(queryKey));
      if (pending) pending.push(trade);
      else needsRecovery = true;
      continue;
    }
    if (!unknownPage || typeof unknownPage !== "object" || !Array.isArray((unknownPage as Page<Candle>).data)) {
      continue;
    }
    if (query.state.status === "error") {
      needsRecovery = true;
      continue;
    }
    const syncedThrough = (unknownPage as CandlePage).syncedThrough;
    if (syncedThrough && Date.parse(trade.timestamp) < Date.parse(syncedThrough)) continue;
    const result = applyTradeToCandlePage(unknownPage as Page<Candle>, interval, limit, trade);
    if (result.status === "recovery") {
      needsRecovery = true;
    } else if (result.data) {
      updated = true;
      const nextData = result.data;
      queryClient.setQueryData<Page<Candle>>(queryKey, (current) => {
        if (!current) return current;
        return { ...current, data: nextData };
      });
    }
  }
  return { updated, needsRecovery };
}

function requestCandleRecovery(
  queryClient: QueryClient,
  symbol: string,
  runtime: CandleTradeRuntime,
  requiresSnapshot = false,
): void {
  if (requiresSnapshot) {
    if (runtime.awaitingSnapshotRecovery) return;
    runtime.awaitingSnapshotRecovery = true;
  }
  if (runtime.recoveryInFlight) return;
  runtime.recoveryInFlight = true;
  runtime.pendingSequences.clear();
  void queryClient
    .invalidateQueries({ queryKey: ["candles", symbol], refetchType: "active" }, { cancelRefetch: false })
    .catch(() => undefined)
    .finally(() => {
      runtime.recoveryInFlight = false;
      runtime.pendingSequences.clear();
    });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiData<User>("/api/v1/me"),
    retry: false,
    staleTime: 60_000,
  });
}

export function readMarketStateCache(): MarketState | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(MARKET_STATE_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.state === "RUNNING" || parsed.state === "GLOBAL_HALTED")) {
      return parsed as MarketState;
    }
  } catch {
    // Ignore storage issues
  }
  return undefined;
}

export function writeMarketStateCache(state: MarketState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MARKET_STATE_CACHE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage issues
  }
}

export function useMarketState() {
  const publicStatus = useSocketStatus("public");
  return useQuery({
    queryKey: ["market-state"],
    queryFn: () => apiData<MarketState>("/api/v1/market"),
    initialData: readMarketStateCache,
    refetchInterval: publicStatus === "open" ? false : 15_000,
    staleTime: 10_000,
  });
}

function composeInstrument(symbol: MarketSymbol, ticker?: Ticker): Instrument {
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

function updateTradePriceOverlay(symbol: string, trade: PublicTrade): void {
  if (!Number.isSafeInteger(trade.sequence) || typeof trade.price !== "string" || !trade.price) return;
  const previous = tradePriceOverlays.get(symbol);
  if (previous && trade.sequence <= previous.sequence) return;
  tradePriceOverlays.set(symbol, { sequence: trade.sequence, price: trade.price });
}

function clearTradePriceOverlay(symbol: string): void {
  tradePriceOverlays.delete(symbol);
}

function clearAllTradePriceOverlays(): void {
  tradePriceOverlays.clear();
}

function applyTradePriceOverlay(instrument: Instrument): Instrument {
  const overlay = tradePriceOverlays.get(instrument.symbol);
  return overlay ? { ...instrument, last_price: overlay.price } : instrument;
}

function isNotification(value: unknown): value is Notification {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.notification_id === "string" &&
    typeof row.kind === "string" &&
    typeof row.title === "string" &&
    typeof row.body === "string" &&
    typeof row.version === "number" &&
    Number.isSafeInteger(row.version) &&
    typeof row.pinned === "boolean" &&
    typeof row.read === "boolean" &&
    typeof row.created_at === "string" &&
    typeof row.updated_at === "string" &&
    (row.expires_at === null || typeof row.expires_at === "string")
  );
}

function notificationFromPrivateFrame(frame: WsFrame): Notification | null {
  if (!frame.data || typeof frame.data !== "object") return null;
  const outer = frame.data as Record<string, unknown>;
  return isNotification(outer.data) ? outer.data : null;
}

function mergeNotificationRows(
  rows: Notification[],
  incoming: Notification,
  unreadOnly: boolean,
  allowInsert: boolean,
): Notification[] {
  const existing = rows.find((row) => row.notification_id === incoming.notification_id);
  if (existing && incoming.version < existing.version) return rows;
  const withoutIncoming = rows.filter((row) => row.notification_id !== incoming.notification_id);
  const next = existing || allowInsert ? [...withoutIncoming, incoming] : withoutIncoming;
  return next
    .filter((row) => !unreadOnly || !row.read)
    .sort((left, right) => {
      const rightTime = Date.parse(right.created_at);
      const leftTime = Date.parse(left.created_at);
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });
}

export function updateNotificationCache(
  value: unknown,
  incoming: Notification,
  unreadOnly: boolean,
): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.pages)) {
    const pages = record.pages as unknown[];
    return {
      ...record,
      pages: pages.map((page, index) => {
        if (!page || typeof page !== "object" || !Array.isArray((page as { data?: unknown }).data)) {
          return page;
        }
        const pageRecord = page as Record<string, unknown>;
        return {
          ...pageRecord,
          data: mergeNotificationRows(
            pageRecord.data as Notification[],
            incoming,
            unreadOnly,
            index === 0,
          ),
        };
      }),
    };
  }
  if (Array.isArray(record.data) && record.page && typeof record.page === "object") {
    return {
      ...record,
      data: mergeNotificationRows(record.data as Notification[], incoming, unreadOnly, true),
    };
  }
  return value;
}

function updateNotificationCaches(
  queryClient: QueryClient,
  incoming: Notification,
): void {
  for (const [queryKey, current] of queryClient.getQueriesData({ queryKey: ["notifications"] })) {
    if (!Array.isArray(queryKey)) continue;
    const unreadOnly = queryKey[1] === "unread" || queryKey[2] === "unread";
    queryClient.setQueryData(queryKey, updateNotificationCache(current, incoming, unreadOnly));
  }
  // A truncated unread page cannot tell how many unseen rows remain after a read.
  const unread = queryClient.getQueryData<Page<Notification>>(["notifications", "unread"]);
  if (incoming.read && unread?.page.has_more) {
    void queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
  }
}

function mapNotificationRows(
  value: unknown,
  map: (rows: Notification[]) => Notification[],
  exhausted: boolean,
): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const mapPage = (page: unknown) => {
    if (!page || typeof page !== "object" || !Array.isArray((page as { data?: unknown }).data)) return page;
    const pageRecord = page as Page<Notification>;
    return {
      ...pageRecord,
      data: map(pageRecord.data),
      page: exhausted ? { has_more: false, next_cursor: null } : pageRecord.page,
    };
  };
  if (Array.isArray(record.pages)) return { ...record, pages: record.pages.map(mapPage) };
  return mapPage(value);
}

/**
 * Applies a successful read to cached lists instead of refetching them. `all`
 * means every notification was read, so unread lists become complete and empty.
 */
export function markNotificationsReadInCaches(
  queryClient: QueryClient,
  ids: ReadonlySet<string> | "all",
): void {
  const matches = (row: Notification) => ids === "all" || ids.has(row.notification_id);
  for (const [queryKey, current] of queryClient.getQueriesData({ queryKey: ["notifications"] })) {
    if (!Array.isArray(queryKey)) continue;
    const unreadOnly = queryKey[1] === "unread" || queryKey[2] === "unread";
    queryClient.setQueryData(queryKey, mapNotificationRows(
      current,
      (rows) => unreadOnly
        ? rows.filter((row) => !matches(row))
        : rows.map((row) => (matches(row) && !row.read ? { ...row, read: true } : row)),
      unreadOnly && ids === "all",
    ));
  }
  // Unread rows beyond a truncated page may now move into it.
  const unread = queryClient.getQueryData<Page<Notification>>(["notifications", "unread"]);
  if (ids !== "all" && unread?.page.has_more) {
    void queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
  }
}

function composeInstruments(symbols: MarketSymbol[], tickers: Ticker[] = []): Instrument[] {
  const tickerBySymbol = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
  return symbols.map((symbol) => composeInstrument(symbol, tickerBySymbol.get(symbol.symbol)));
}

function composeCachedInstruments(
  symbols: MarketSymbol[],
  queryClient: QueryClient,
): Instrument[] {
  return composeInstruments(symbols, queryClient.getQueryData<Ticker[]>(["ticker-cache"]) ?? []);
}

function applySymbolMetadataCache(
  queryClient: QueryClient,
  cache: SymbolMetadataCache,
): void {
  queryClient.setQueryData<Instrument[]>(["instruments"], (old) => {
    const previous = new Map(old?.map((instrument) => [instrument.symbol, instrument]));
    const tickers = new Map(
      (queryClient.getQueryData<Ticker[]>(["ticker-cache"]) ?? []).map((ticker) => [
        ticker.symbol,
        ticker,
      ]),
    );
    return cache.symbols.map((symbol) =>
      composeInstrument(symbol, tickers.get(symbol.symbol) ?? previous.get(symbol.symbol)),
    );
  });
}

function applySymbolMetadataDelta(
  queryClient: QueryClient,
  previous: SymbolMetadataCache,
  next: SymbolMetadataCache,
): void {
  const previousBySymbol = new Map(previous.symbols.map((symbol) => [symbol.symbol, symbol]));
  const nextBySymbol = new Map(next.symbols.map((symbol) => [symbol.symbol, symbol]));
  for (const symbol of previous.symbols) {
    if (!nextBySymbol.has(symbol.symbol)) queryClient.removeQueries({ queryKey: ["instrument", symbol.symbol] });
  }
  const tickers = queryClient.getQueryData<Ticker[]>(["ticker-cache"]) ?? [];
  for (const symbol of next.symbols) {
    const before = previousBySymbol.get(symbol.symbol);
    if (
      before?.version === symbol.version &&
      before.updated_at === symbol.updated_at &&
      before.state === symbol.state
    ) {
      continue;
    }
    const ticker = tickers.find((item) => item.symbol === symbol.symbol);
    for (const key of [symbol.symbol, symbol.symbol.replace(/\.M$/, "")]) {
      queryClient.setQueryData<Instrument>(["instrument", key], (old) =>
        applyTradePriceOverlay(composeInstrument(symbol, ticker ?? old)),
      );
    }
  }
}

export function compareVersion(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return 0;
  if (a === b) return 0;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    try {
      const diff = BigInt(a) - BigInt(b);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    } catch {
      return a.localeCompare(b);
    }
  }
  return a.localeCompare(b);
}

export const lastTradingEventTimestamps = new Map<string, number>();

export function applySymbolToQueryCaches(
  queryClient: QueryClient,
  symbol: MarketSymbol,
): void {
  const sym = symbol.symbol;
  const shortSym = sym.replace(/\.M$/, "");
  const tickers = queryClient.getQueryData<Ticker[]>(["ticker-cache"]) ?? [];
  const ticker = tickers.find((item) => item.symbol === sym);

  queryClient.setQueryData<Instrument[]>(["instruments"], (old) => {
    if (!old) return old;
    const idx = old.findIndex((inst) => inst.symbol === sym);
    if (idx >= 0) {
      return old.map((inst, i) =>
        i === idx ? applyTradePriceOverlay(composeInstrument(symbol, ticker ?? inst)) : inst,
      );
    }
    return [...old, applyTradePriceOverlay(composeInstrument(symbol, ticker))];
  });

  for (const key of [sym, shortSym]) {
    queryClient.setQueryData<Instrument>(["instrument", key], (old) => {
      if (!old) return old;
      return applyTradePriceOverlay(composeInstrument(symbol, ticker ?? old));
    });
  }
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

  const parsedEventTime = Number.isFinite(eventTime)
    ? eventTime
    : updatedAt
      ? Date.parse(updatedAt)
      : haltedAt
        ? Date.parse(haltedAt)
        : undefined;

  const lastSeen = lastTradingEventTimestamps.get(symbol);
  if (lastSeen !== undefined) {
    if (parsedEventTime === undefined || !Number.isFinite(parsedEventTime) || parsedEventTime <= lastSeen) {
      return false;
    }
  }

  const cache = readSymbolMetadataCache();
  const existing = cache?.symbols.find((s) => s.symbol === symbol);

  if (existing) {
    if (version !== undefined && version !== null) {
      const vComp = compareVersion(String(version), existing.version);
      if (vComp < 0) return false;
    }

    const existingTimeStr = existing.updated_at || existing.halted_at;
    const existingTime = existingTimeStr ? Date.parse(existingTimeStr) : undefined;
    if (existingTime !== undefined && Number.isFinite(existingTime)) {
      if (parsedEventTime === undefined || !Number.isFinite(parsedEventTime) || parsedEventTime < existingTime) {
        return false;
      }
    }
  }

  if (parsedEventTime !== undefined && Number.isFinite(parsedEventTime)) {
    lastTradingEventTimestamps.set(symbol, parsedEventTime);
  }

  const effectiveUpdatedAt = updatedAt || (parsedEventTime !== undefined && Number.isFinite(parsedEventTime)
    ? new Date(parsedEventTime).toISOString()
    : existing?.updated_at || new Date().toISOString());

  if (cache && existing) {
    const updatedSymbol: MarketSymbol = {
      ...existing,
      state,
      halt_reason: state === "TRADING" ? null : (reason !== undefined ? reason : existing.halt_reason),
      halted_at: state === "TRADING" ? null : (haltedAt !== undefined ? haltedAt : (state === "HALTED" ? effectiveUpdatedAt : existing.halted_at)),
      halted_until: state === "TRADING" ? null : (haltedUntil !== undefined ? haltedUntil : existing.halted_until),
      updated_at: effectiveUpdatedAt,
      version: version !== undefined && version !== null ? String(version) : existing.version,
    };

    const nextCache: SymbolMetadataCache = {
      ...cache,
      symbols: cache.symbols.map((s) => (s.symbol === symbol ? updatedSymbol : s)),
      saved_at: Date.now(),
    };

    writeSymbolMetadataCache(nextCache);
    applySymbolToQueryCaches(queryClient, updatedSymbol);
    return true;
  }

  return false;
}

/** Applies an authoritative symbol response to persistent and mounted caches. */
export function cacheSymbolMetadata(
  queryClient: QueryClient,
  fresh: MarketSymbol,
): void {
  const current = readSymbolMetadataCache();
  const existing = current?.symbols.find((s) => s.symbol === fresh.symbol);

  if (existing) {
    const vComp = compareVersion(fresh.version, existing.version);
    if (vComp < 0) {
      return;
    }
  }

  const freshTime = Date.parse(fresh.updated_at || "0");
  if (Number.isFinite(freshTime)) {
    const currentWatermark = lastTradingEventTimestamps.get(fresh.symbol);
    lastTradingEventTimestamps.set(
      fresh.symbol,
      currentWatermark !== undefined ? Math.max(currentWatermark, freshTime) : freshTime,
    );
  }

  if (current) {
    const idx = current.symbols.findIndex((s) => s.symbol === fresh.symbol);
    const nextSymbols = idx >= 0
      ? current.symbols.map((s, i) => (i === idx ? fresh : s))
      : [...current.symbols, fresh];
    const nextCache: SymbolMetadataCache = {
      ...current,
      symbols: nextSymbols,
      saved_at: Date.now(),
    };
    writeSymbolMetadataCache(nextCache);
  }

  applySymbolToQueryCaches(queryClient, fresh);
}

const symbolMetadataRefreshes = new Map<string, Promise<void>>();

/** Shares one in-flight batch request per symbol across WS and notification paths. */
export function refreshSymbolMetadata(
  queryClient: QueryClient,
  rawSymbol: string,
): Promise<void> {
  const symbol = canonicalSymbol(rawSymbol);
  if (!symbol) return Promise.resolve();
  const inFlight = symbolMetadataRefreshes.get(symbol);
  if (inFlight) return inFlight;
  const refresh = fetchSymbolMetadata(queryClient, symbol).finally(() => {
    symbolMetadataRefreshes.delete(symbol);
  });
  symbolMetadataRefreshes.set(symbol, refresh);
  return refresh;
}

async function fetchSymbolMetadata(
  queryClient: QueryClient,
  symbol: string,
): Promise<void> {
  try {
    const batch = await apiData<MarketSymbol[]>(
      `/api/v1/market/symbols/batch${buildQuery({ symbols: symbol })}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) return;
    const fresh = batch[0];
    if (!isMarketSymbol(fresh)) return;

    cacheSymbolMetadata(queryClient, fresh);
  } catch {
    // Non-blocking background recovery
  }
}

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
    const batch = await apiData<MarketSymbol[]>(
      `/api/v1/market/symbols/batch${buildQuery({ symbols: symbol })}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) return;
    const fetched = batch[0];
    if (!isMarketSymbol(fetched)) return;

    let finalSymbol = fetched;
    const fetchedTime = Date.parse(fetched.updated_at || "0");
    let effectiveWatermark = Number.isFinite(fetchedTime) ? fetchedTime : undefined;

    if (targetState && createdAt) {
      const notifTime = Date.parse(createdAt);
      if (Number.isFinite(notifTime) && (!Number.isFinite(fetchedTime) || fetchedTime <= notifTime)) {
        finalSymbol = {
          ...fetched,
          state: targetState,
          halt_reason: haltReason ?? fetched.halt_reason,
          halted_at: haltedAt ?? fetched.halted_at,
          updated_at: createdAt,
        };
        effectiveWatermark = notifTime;
      }
    }

    if (effectiveWatermark !== undefined) {
      const currentWatermark = lastTradingEventTimestamps.get(finalSymbol.symbol);
      lastTradingEventTimestamps.set(
        finalSymbol.symbol,
        currentWatermark !== undefined ? Math.max(currentWatermark, effectiveWatermark) : effectiveWatermark,
      );
    }

    const current = readSymbolMetadataCache() ?? (await ensureSymbolMetadataCache().catch(() => null));
    if (current) {
      const idx = current.symbols.findIndex((s) => s.symbol === finalSymbol.symbol);
      const nextSymbols = idx >= 0
        ? current.symbols.map((s, i) => (i === idx ? finalSymbol : s))
        : [...current.symbols, finalSymbol];
      const nextCache: SymbolMetadataCache = {
        ...current,
        symbols: nextSymbols,
        saved_at: Date.now(),
      };
      writeSymbolMetadataCache(nextCache);
    }

    applySymbolToQueryCaches(queryClient, finalSymbol);
  } catch {
    // Non-blocking background recovery
  }
}

export function applyTradingNotification(
  queryClient: QueryClient,
  notification: Notification,
): void {
  const tradingEvent = parseTradingNotification(notification);
  if (!tradingEvent) return;

  const { eventType, symbol: rawSymbol, reason, halted_until } = tradingEvent;
  const eventTime = notification.created_at ? Date.parse(notification.created_at) : undefined;

  if (eventType === "GLOBAL_MARKET_HALTED" || eventType === "GLOBAL_MARKET_RESUMED") {
    const lastGlobalTime = lastTradingEventTimestamps.get("__GLOBAL__");
    if (lastGlobalTime !== undefined) {
      if (eventTime === undefined || !Number.isFinite(eventTime) || eventTime <= lastGlobalTime) {
        return;
      }
    }

    const currentMarketState = queryClient.getQueryData<MarketState>(["market-state"]);
    if (currentMarketState?.changed_at) {
      const changedAt = Date.parse(currentMarketState.changed_at);
      if (Number.isFinite(changedAt)) {
        if (eventTime === undefined || !Number.isFinite(eventTime) || eventTime < changedAt) {
          return;
        }
      }
    }

    if (eventTime !== undefined && Number.isFinite(eventTime)) {
      lastTradingEventTimestamps.set("__GLOBAL__", eventTime);
    }

    const nextState: MarketState = eventType === "GLOBAL_MARKET_HALTED"
      ? {
          state: "GLOBAL_HALTED",
          reason: reason || currentMarketState?.reason || null,
          halted_at: notification.created_at || currentMarketState?.halted_at || null,
          halted_until: halted_until ?? currentMarketState?.halted_until ?? null,
          changed_at: notification.created_at || currentMarketState?.changed_at || new Date().toISOString(),
        }
      : {
          state: "RUNNING",
          reason: null,
          halted_at: null,
          halted_until: null,
          changed_at: notification.created_at || currentMarketState?.changed_at || new Date().toISOString(),
        };

    // The public market_state stream (or the disconnected poll) stays authoritative.
    queryClient.setQueryData<MarketState>(["market-state"], nextState);
    writeMarketStateCache(nextState);
    return;
  }

  if (!rawSymbol) return;
  const symbol = canonicalSymbol(rawSymbol);
  if (!symbol) return;

  const payload = (notification as { payload?: Record<string, unknown> }).payload;
  const version = payload && (typeof payload.version === "string" || typeof payload.version === "number")
    ? payload.version
    : undefined;

  let nextState: InstrumentState | undefined;
  switch (eventType) {
    case "SYMBOL_HALTED":
      nextState = "HALTED";
      break;
    case "SYMBOL_RESUMED":
    case "DELIST_CANCELED":
      nextState = "TRADING";
      break;
    case "DELIST_SCHEDULED":
      nextState = "DELIST_PENDING";
      break;
    case "DELISTED":
      nextState = "DELISTED";
      break;
    case "SYMBOL_LISTED":
      nextState = "TRADING";
      break;
    case "SYMBOL_METADATA_CHANGED":
      void refreshSymbolMetadata(queryClient, symbol);
      return;
    default:
      return;
  }

  const cache = readSymbolMetadataCache();
  const existing = cache?.symbols.find((s) => s.symbol === symbol);

  if (cache && existing) {
    applySymbolTradingState(
      queryClient,
      symbol,
      nextState,
      reason,
      notification.created_at,
      halted_until,
      notification.created_at,
      eventTime,
      version,
    );
    void refreshSymbolMetadata(queryClient, symbol);
  } else {
    void refreshMissingSymbolMetadata(
      queryClient,
      symbol,
      nextState,
      reason,
      notification.created_at,
      notification.created_at,
    );
  }
}

function useSocketStatus(kind: WsKind): WsStatus {
  const socket = getSocket(kind);
  const subscribe = useCallback(
    (notify: () => void) => socket.onStatus(() => notify()),
    [socket],
  );
  const getSnapshot = useCallback(() => socket.getStatus(), [socket]);
  const getServerSnapshot = useCallback((): WsStatus => "closed", []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Private events invalidate account data as it changes, so while that socket
// is open a focus or remount only re-asks the server once this has passed.
const PRIVATE_LIVE_STALE_MS = 60_000;
const PRIVATE_POLLED_STALE_MS = 10_000;

function usePrivateStaleTime(): number {
  return useSocketStatus("private") === "open" ? PRIVATE_LIVE_STALE_MS : PRIVATE_POLLED_STALE_MS;
}

export function useInstruments() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["instruments"],
    queryFn: async () => {
      const cache = await ensureSymbolMetadataCache();
      return composeCachedInstruments(cache.symbols, queryClient);
    },
    initialData: () => {
      const cached = readSymbolMetadataCache();
      return cached ? composeCachedInstruments(cached.symbols, queryClient) : undefined;
    },
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Fetches only the server-defined ticker order; prices stay on the WS cache. */
export function useTickerOrder(sort: TickerSort) {
  return useQuery({
    queryKey: ["ticker-order", sort],
    queryFn: async () => {
      const page = await apiPage<string>(
        `/api/v1/market/tickers${buildQuery({
          sort,
          simple: "true",
          limit: TICKER_ORDER_LIMIT,
        })}`,
      );
      return [...new Set(page.data)].slice(0, TICKER_ORDER_LIMIT);
    },
    // Focus, reconnect, and remount refetches are suppressed while this cache
    // is fresh; the interval cannot issue requests more often than once/minute.
    refetchInterval: TICKER_ORDER_CACHE_MS,
    staleTime: TICKER_ORDER_CACHE_MS,
  });
}

function canonicalSymbol(symbol: string | undefined): string | undefined {
  if (!symbol) return undefined;
  const trimmed = symbol.trim();
  if (!trimmed) return undefined;
  return trimmed.endsWith(".M") ? trimmed : `${trimmed}.M`;
}

export function useInstrument(symbol: string | undefined) {
  const queryClient = useQueryClient();
  const lookupSymbol = canonicalSymbol(symbol);
  return useQuery({
    queryKey: ["instrument", lookupSymbol],
    queryFn: async () => {
      const cache = await ensureSymbolMetadataCache();
      let metadata = cache.symbols.find((item) => item.symbol === lookupSymbol);
      if (!metadata && lookupSymbol) {
        // The shared cache only syncs once a minute, so a symbol listed since
        // then (e.g. opened from a shared link) is looked up directly once.
        await refreshSymbolMetadata(queryClient, lookupSymbol);
        metadata = readSymbolMetadataCache()?.symbols.find((item) => item.symbol === lookupSymbol);
      }
      if (!metadata) {
        throw new ApiError(404, "NOT_FOUND", "종목을 찾을 수 없어요");
      }
      const ticker = queryClient.getQueryData<Ticker[]>(["ticker-cache"])?.find(
        (item) => item.symbol === metadata.symbol,
      );
      return applyTradePriceOverlay(composeInstrument(metadata, ticker));
    },
    enabled: Boolean(lookupSymbol),
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useSymbolTrades(symbol: string | undefined, limit = 150) {
  const publicStatus = useSocketStatus("public");
  return useQuery({
    queryKey: ["symbol-trades", symbol, limit],
    queryFn: () =>
      apiPage<PublicTrade>(
        `/api/v1/market/symbols/${encodeURIComponent(symbol ?? "")}/trades${buildQuery({ limit })}`,
      ),
    enabled: Boolean(symbol),
    refetchInterval: publicStatus === "open" ? false : 5_000,
    // Public snapshots/updates own this cache while connected. Focus and mount
    // must not race that stream with a redundant REST response.
    staleTime: publicStatus === "open" ? Infinity : 3_000,
    refetchOnWindowFocus: publicStatus !== "open",
    refetchOnReconnect: publicStatus !== "open",
    refetchOnMount: publicStatus !== "open",
  });
}

export function useOrders(limit = PAGE_SIZE, enabled = true) {
  const privateStatus = useSocketStatus("private");
  const staleTime = usePrivateStaleTime();
  return useInfiniteQuery({
    queryKey: ["orders", limit],
    queryFn: ({ pageParam }) =>
      apiPage<Order>(`/api/v1/orders${buildQuery({ limit, cursor: pageParam })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    // Fills arrive over the private socket; a slow poll only catches silent
    // trigger expiry while a trigger order is still waiting.
    refetchInterval: (query) =>
      privateStatus !== "open"
        ? 15_000
        : query.state.data?.pages.some((page) =>
              page.data.some((order) => order.order_type === "TRIGGER" && order.status === "PENDING"),
            )
          ? 60_000
          : false,
    staleTime,
    enabled,
  });
}

export function useMyTrades(limit = PAGE_SIZE, enabled = true) {
  const staleTime = usePrivateStaleTime();
  return useInfiniteQuery({
    queryKey: ["my-trades", limit],
    queryFn: ({ pageParam }) =>
      apiPage<Trade>(`/api/v1/me/trades${buildQuery({ limit, cursor: pageParam })}`),
    staleTime,
    enabled,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
  });
}

export function useRealizedPnL(limit = PAGE_SIZE) {
  const staleTime = usePrivateStaleTime();
  return useInfiniteQuery({
    queryKey: ["realized-pnl", limit],
    staleTime,
    queryFn: ({ pageParam }) =>
      apiPage<RealizedPnL>(`/api/v1/me/realized-pnl${buildQuery({ limit, cursor: pageParam })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
  });
}

export function useAccounts() {
  const staleTime = usePrivateStaleTime();
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiData<Account[]>("/api/v1/me/accounts"),
    staleTime,
  });
}

export function usePortfolio(accountId?: string, enabled = true) {
  const staleTime = usePrivateStaleTime();
  return useQuery({
    staleTime,
    queryKey: ["portfolio", accountId ?? "primary"],
    queryFn: () =>
      apiData<Portfolio>(
        accountId ? `/api/v1/me/accounts/${accountId}/portfolio` : "/api/v1/me/portfolio",
      ),
    enabled,
  });
}

function combinePortfolios(results: UseQueryResult<Portfolio>[]) {
  return {
    portfolios: results.map((result) => result.data).filter((value): value is Portfolio => Boolean(value)),
    isLoading: results.some((result) => result.isLoading),
    error: results.find((result) => result.isError)?.error ?? null,
  };
}

export function useAllPortfolios() {
  const accounts = useAccounts();
  const queryClient = useQueryClient();
  const staleTime = usePrivateStaleTime();
  const accountIds = (accounts.data ?? []).map((account) => account.account_id);
  const results = useQueries({
    queries: accountIds.map((accountId) => ({
      queryKey: ["portfolio", accountId],
      queryFn: () => apiData<Portfolio>(`/api/v1/me/accounts/${accountId}/portfolio`),
      staleTime,
    })),
    combine: combinePortfolios,
  });
  return {
    accounts: accounts.data ?? [],
    portfolios: results.portfolios,
    isLoading: accounts.isLoading || results.isLoading,
    error: accounts.error ?? results.error,
    refetch: () => {
      void accounts.refetch();
      for (const accountId of accountIds) {
        void queryClient.refetchQueries({ queryKey: ["portfolio", accountId], exact: true });
      }
    },
  };
}

export function useSessions() {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: () => apiData<SessionList>("/api/v1/me/sessions?limit=50"),
    staleTime: 15_000,
  });
}

export function usePasskeys() {
  return useQuery({
    queryKey: ["passkeys"],
    queryFn: () => apiData<Passkey[]>("/api/v1/me/passkeys"),
    staleTime: 15_000,
  });
}

export function useTransfers(scope: "mine" | "approval" = "mine", limit = 50) {
  const privateStatus = useSocketStatus("private");
  return useInfiniteQuery({
    queryKey: ["transfers", scope, limit],
    queryFn: ({ pageParam }) =>
      apiPage<Transfer>(`/api/v1/transfers${buildQuery({ scope, limit, cursor: pageParam })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    refetchInterval: privateStatus === "open" ? false : 30_000,
    staleTime: privateStatus === "open" ? PRIVATE_LIVE_STALE_MS : PRIVATE_POLLED_STALE_MS,
  });
}

export function useTransferDetails(transfers: Transfer[]): UseQueryResult<Transfer>[] {
  return useQueries({
    queries: transfers.map((transfer) => ({
      queryKey: ["transfer", transfer.transfer_id],
      queryFn: () => apiData<Transfer>(`/api/v1/transfers/${transfer.transfer_id}`),
      // Settled transfers no longer change; only pending ones need refreshing.
      staleTime: transfer.status === "PENDING" ? 15_000 : Infinity,
    })),
  });
}

export function useIssuancePreview(symbol: string | undefined, deposit: string) {
  return useQuery({
    queryKey: ["issuance-preview", symbol, deposit],
    queryFn: () =>
      apiData<IssuancePreview>(
        `/api/v1/symbols/${encodeURIComponent(symbol ?? "")}/issuance-preview${buildQuery({ deposit_credit: deposit })}`,
      ),
    enabled: Boolean(symbol) && deposit.length > 0 && isPositiveDecimal(deposit),
    staleTime: 30_000,
    retry: false,
  });
}

export function useManagerRequests(symbol: string | undefined) {
  return useQuery({
    queryKey: ["manager-requests", symbol],
    queryFn: () =>
      apiPage<ManagerRequest>(
        `/api/v1/symbols/${encodeURIComponent(symbol ?? "")}/manager-transfer-requests${buildQuery({ limit: 50 })}`,
      ),
    enabled: Boolean(symbol),
    staleTime: 15_000,
  });
}

function invalidateTrading(queryClient: QueryClient) {
  // Batched with the TRADE_EXECUTED notification that usually follows.
  invalidateBatched(queryClient, [["orders"], ["portfolio"], ["my-trades"]]);
  if (getSocket("public").getStatus() !== "open") {
    void queryClient.invalidateQueries({ queryKey: ["symbol-trades"] });
  }
}

export function useOrderSimulation(payload: OrderSimulationRequest | null) {
  return useQuery({
    queryKey: ["order-simulation", payload],
    queryFn: ({ signal }) =>
      apiData<OrderSimulation>("/api/v1/orders/simulation", {
        method: "POST",
        body: payload,
        signal,
      }),
    // Quotes are requested explicitly and never reused after the inputs change.
    enabled: false,
    gcTime: 0,
    retry: false,
  });
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: OrderRequest) =>
      postIdempotentData<Order>("/api/v1/orders", payload),
    onSuccess: () => invalidateTrading(queryClient),
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      postIdempotentData<Order>(`/api/v1/orders/${orderId}/cancellation`, {}),
    onSuccess: () => invalidateTrading(queryClient),
  });
}

export function useCreateTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TransferRequest) =>
      postIdempotentData<Transfer>("/api/v1/transfers", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}

type TransferAction = "acceptance" | "rejection" | "cancellation";

export function useTransferAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transferId, action }: { transferId: string; action: TransferAction }) => {
      if (action === "cancellation") {
        return postIdempotentData<Transfer>(
          `/api/v1/transfers/${transferId}/cancellation`,
          {},
        );
      }
      return patchIdempotentData<Transfer>(
        `/api/v1/transfers/${transferId}/recipient-decision`,
        { decision: action === "acceptance" ? "ACCEPT" : "REJECT" },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["transfer"] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      void queryClient.invalidateQueries({ queryKey: ["nav"] });
    },
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postIdempotentData<Account>("/api/v1/me/accounts", {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => deleteData<{ status: string }>(`/api/v1/me/accounts/${accountId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}

export function useRevokeSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionIds: string[]) =>
      postData<{ revoked_count: number; current_revoked: boolean }>(
        "/api/v1/me/sessions/revoke",
        { session_ids: sessionIds },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useRevokeAllSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      postData<{ revoked_count: number; current_revoked: boolean }>(
        "/api/v1/me/sessions/revoke-all",
        {},
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useDeletePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (passkeyId: string) =>
      deleteData<{ status: string }>(`/api/v1/me/passkeys/${passkeyId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
    },
  });
}

export function useRotateRecoveryKeys() {
  return useMutation({
    mutationFn: () =>
      postData<{ recovery_keys: string[] }>(
        "/api/v1/me/recovery-keys/rotate",
        {},
      ),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postData<{ status: string }>("/api/v1/auth/logout", {}),
    onSettled: async () => {
      closeSocket("private");
      await queryClient.cancelQueries();
      // Keep the observed auth query so AuthProvider receives the anonymous
      // state before navigation, even when the logout request failed.
      queryClient.setQueryData(["me"], null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
      queryClient.getMutationCache().clear();
    },
  });
}

export function useCreateListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ListingRequest) =>
      withTagList(await postIdempotentData<MarketSymbol>("/api/v1/symbols", payload)),
    onSuccess: (symbol) => {
      cacheSymbolMetadata(queryClient, symbol);
      const ticker = queryClient.getQueryData<Ticker[]>(["ticker-cache"])?.find((row) => row.symbol === symbol.symbol);
      queryClient.setQueryData(["instrument", symbol.symbol], composeInstrument(symbol, ticker));
      void queryClient.invalidateQueries({ queryKey: ["instruments"] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}

export function useUpdateMetadata(symbol: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name?: string; description?: string; tags?: string[]; icon_url?: string }) =>
      withTagList(await patchIdempotentData<MarketSymbol>(`/api/v1/symbols/${symbol}`, payload)),
    onSuccess: (metadata) => {
      cacheSymbolMetadata(queryClient, metadata);
      void queryClient.invalidateQueries({ queryKey: ["icon-requests", symbol] });
      void queryClient.invalidateQueries({ queryKey: ["instrument", symbol] });
      void queryClient.invalidateQueries({ queryKey: ["instruments"] });
    },
  });
}

export function useCreateIssuance(symbol: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (depositCredit: string) =>
      postIdempotentData<Issuance>(
        `/api/v1/symbols/${symbol}/issuances`,
        { deposit_credit: depositCredit, force: false },
      ),
    onSuccess: () => {
      // Instrument queries only re-read the local metadata cache, so the new
      // supply has to be fetched from the server.
      void refreshSymbolMetadata(queryClient, symbol);
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      void queryClient.invalidateQueries({ queryKey: ["issuance-preview", symbol] });
    },
  });
}

export function useCreateManagerRequest(symbol: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { target_user_id: string; reason: string }) =>
      postIdempotentData<ManagerRequest>(
        `/api/v1/symbols/${symbol}/manager-transfer-requests`,
        payload,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["manager-requests", symbol] });
    },
  });
}

export function useRespondManagerRequest(symbol: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, decision }: { requestId: string; decision: "ACCEPT" | "REJECT" }) =>
      patchIdempotentData<ManagerRequest>(
        `/api/v1/symbols/${symbol}/manager-transfer-requests/${requestId}`,
        { decision },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["manager-requests", symbol] });
      // An accepted request changes the manager, which lives in symbol metadata.
      void refreshSymbolMetadata(queryClient, symbol);
    },
  });
}

export function findPosition(portfolio: Portfolio | undefined, symbol: string): Position | undefined {
  return portfolio?.positions.find((position) => position.symbol === symbol);
}

export function useNav() {
  const privateStatus = useSocketStatus("private");
  return useQuery({
    queryKey: ["nav"],
    queryFn: () => apiData<Nav>("/api/v1/me/nav"),
    refetchInterval: privateStatus === "open" ? false : 30_000,
    staleTime: privateStatus === "open" ? PRIVATE_LIVE_STALE_MS : PRIVATE_POLLED_STALE_MS,
  });
}

function useNavHistoryQuery(range: NavRange, path: string, scope: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["nav-history", scope, range],
    queryFn: ({ pageParam }) =>
      apiPage<NavPoint>(`${path}${buildQuery({ range, limit: 500, cursor: pageParam })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    enabled,
  });
}

export function useNavHistory(range: NavRange, enabled = true) {
  return useNavHistoryQuery(range, "/api/v1/me/nav/history", "user", enabled);
}

export function useAccountPortfolioHistory(accountId: string | undefined, range: NavRange) {
  return useNavHistoryQuery(
    range,
    `/api/v1/me/accounts/${accountId ?? ""}/portfolio/history`,
    accountId ?? "unknown",
    Boolean(accountId),
  );
}

export function useCandles(
  symbol: string | undefined,
  interval: CandleInterval,
  limit = 200,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const queryKey = ["candles", symbol, interval, limit] as const;
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const current = queryClient.getQueryData<CandlePage>(queryKey);
      // Synthetic clock ticks are not evidence that we received real candles.
      const from = current?.data.find((candle) => !candle.synthetic)?.timestamp;
      const to = new Date().toISOString();
      const pending: PublicTrade[] = [];
      const fetchKey = JSON.stringify(queryKey);
      candleFetchTrades.set(fetchKey, pending);
      try {
        let cursor: string | undefined;
        let fetched: Candle[] = [];
        let page: Page<Candle>;
        do {
          page = await apiPage<Candle>(
            `/api/v1/market/symbols/${encodeURIComponent(symbol ?? "")}/candles${buildQuery({
              interval, limit, from, to, cursor,
            })}`,
          );
          fetched = mergeCandles(fetched, page.data);
          cursor = from && page.page.has_more ? page.page.next_cursor ?? undefined : undefined;
        } while (cursor);
        // Keep the older-history cursor: this request only advances the newest end.
        const latest = queryClient.getQueryData<CandlePage>(queryKey);
        const real = mergeCandles(latest?.data.filter((candle) => !candle.synthetic) ?? [], fetched);
        let result: CandlePage = {
          data: mergeCandles(
            latest?.data.filter((candle) => from && Date.parse(candle.timestamp) < Date.parse(from)) ?? [],
            mergeCandles(real, fillCandleGaps(real, interval, limit, to).data),
          ),
          page: from && latest ? latest.page : page.page,
          historyLoaded: latest?.historyLoaded || real.length > limit,
          syncedThrough: to,
        };
        // REST includes trades before `to`. Replay only the later WS events,
        // otherwise the open bucket's volume and trade count would be doubled.
        for (const trade of pending) {
          if (Date.parse(trade.timestamp) < Date.parse(to)) continue;
          const applied = applyTradeToCandlePage(result, interval, limit, trade);
          if (applied.data) result = { ...result, data: applied.data };
        }
        return result;
      } finally {
        if (candleFetchTrades.get(fetchKey) === pending) candleFetchTrades.delete(fetchKey);
      }
    },
    enabled: Boolean(symbol) && enabled,
    // Keep the chart mounted during interval loads, never across symbols.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === symbol ? previousData : undefined,
    // Re-entering an interval or returning to the tab catches up the cached tail.
    // There is no polling; trades keep an already mounted chart live.
    staleTime: 0,
    refetchInterval: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    retry: false,
  });

  useEffect(() => {
    if (!symbol || !enabled || !query.isSuccess || query.isFetching) return;
    const runtime = candleTradeRuntimes.get(symbol);
    if (!runtime || runtime.recoveryInFlight || runtime.awaitingSnapshotRecovery) return;
    if (runtime.pendingSequences.size === 0) return;
    requestCandleRecovery(queryClient, symbol, runtime);
  }, [enabled, query.dataUpdatedAt, query.isFetching, query.isSuccess, queryClient, symbol]);

  const older = useMutation({
    mutationKey: ["older-candles", symbol, interval, limit],
    mutationFn: (request: { symbol: string; interval: CandleInterval; limit: number; cursor: string }) =>
      apiPage<Candle>(
        `/api/v1/market/symbols/${encodeURIComponent(request.symbol)}/candles${buildQuery({
          interval: request.interval,
          limit: request.limit,
          cursor: request.cursor,
        })}`,
      ),
    onSuccess: (page, request) => {
      queryClient.setQueryData<CandlePage>(
        ["candles", request.symbol, request.interval, request.limit],
        (current) => {
          // A replaced bootstrap or another completed request owns its cursor.
          if (!current || current.page.next_cursor !== request.cursor) return current;
          return appendCandleHistoryWithGaps(current, page, request.interval);
        },
      );
    },
    retry: false,
  });
  const olderIsCurrent = older.variables?.symbol === symbol && older.variables?.interval === interval;
  const isLoadingOlder = olderIsCurrent && older.isPending;
  const hasOlder = Boolean(
    enabled && !query.isPlaceholderData && !query.isFetching &&
    query.data?.page.has_more && query.data.page.next_cursor,
  );
  const loadOlder = () => {
    const cursor = query.data?.page.next_cursor;
    if (!symbol || !cursor || !hasOlder || queryClient.isMutating({
      mutationKey: ["older-candles", symbol, interval, limit], exact: true,
    })) return;
    older.mutate({ symbol, interval, limit, cursor });
  };

  return {
    ...query,
    hasOlder,
    isLoadingOlder,
    olderError: olderIsCurrent && older.isError ? older.error : null,
    loadOlder,
  };
}

export function useDisclosures(options: { symbol?: string; type?: string; limit?: number; enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { symbol, type, limit = 30, enabled = true } = options;
  const path = symbol
    ? `/api/v1/market/symbols/${encodeURIComponent(symbol)}/disclosures`
    : "/api/v1/market/disclosures";
  return useInfiniteQuery({
    queryKey: ["disclosures", symbol ?? "all", type ?? "all", limit],
    queryFn: async ({ pageParam }) => {
      const page = await apiPage<Disclosure>(`${path}${buildQuery({ type, limit, cursor: pageParam })}`);
      return pageParam ? page : mergeDisclosurePage(
        page, queryClient.getQueryData<Disclosure[]>(["public-disclosures"]) ?? [], symbol, type,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    enabled,
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useNotifications(options: { unread?: boolean; limit?: number } = {}) {
  const { unread = false, limit = 30 } = options;
  return useInfiniteQuery({
    queryKey: ["notifications", "list", unread ? "unread" : "all", limit],
    queryFn: ({ pageParam }) =>
      apiPage<Notification>(
        `/api/v1/notifications${buildQuery({
          unread: unread ? "true" : undefined,
          limit,
          cursor: pageParam,
        })}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useUnreadNotifications(enabled = true) {
  return useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () =>
      apiPage<Notification>(`/api/v1/notifications${buildQuery({ unread: "true", limit: 50 })}`),
    enabled,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      postData<Notification>(`/api/v1/notifications/${notificationId}/read`, {}),
    onSuccess: (notification, notificationId) => {
      if (isNotification(notification)) updateNotificationCaches(queryClient, notification);
      else markNotificationsReadInCaches(queryClient, new Set([notificationId]));
    },
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationIds: string[]) =>
      postData<{ read_count: number }>("/api/v1/notifications/read-batch", {
        notification_ids: notificationIds,
      }),
    onSuccess: (_result, notificationIds) =>
      markNotificationsReadInCaches(queryClient, new Set(notificationIds)),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiData<{ read_count: number }>("/api/v1/notifications/read-all", { method: "POST" }),
    onSuccess: () => markNotificationsReadInCaches(queryClient, "all"),
  });
}

export function useInquiries(limit = 30) {
  const privateStatus = useSocketStatus("private");
  return useInfiniteQuery({
    queryKey: ["inquiries", limit],
    queryFn: ({ pageParam }) =>
      apiPage<Inquiry>(`/api/v1/inquiries${buildQuery({ limit, cursor: pageParam })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    refetchInterval: privateStatus === "open" ? false : 60_000,
    staleTime: privateStatus === "open" ? PRIVATE_LIVE_STALE_MS : PRIVATE_POLLED_STALE_MS,
  });
}

export function useInquiry(ticket: string | null) {
  return useQuery({
    queryKey: ["inquiry", ticket],
    queryFn: () => apiData<InquiryDetail>(`/api/v1/inquiries/${ticket}`),
    enabled: Boolean(ticket),
  });
}

export function useCreateInquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { category: InquiryCategory; subject: string; body: string }) =>
      postData<Inquiry>("/api/v1/inquiries", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inquiries"] });
    },
  });
}

export function useReplyInquiry(ticket: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      postData<InquiryMessage>(`/api/v1/inquiries/${ticket}/messages`, { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inquiry", ticket] });
      void queryClient.invalidateQueries({ queryKey: ["inquiries"] });
    },
  });
}

export function useResolveInquiry(ticket: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      postData<{ status: string }>(`/api/v1/inquiries/${ticket}/resolution`, {
        status: "RESOLVED",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inquiry", ticket] });
      void queryClient.invalidateQueries({ queryKey: ["inquiries"] });
    },
  });
}

function useChannelFrames(
  kind: WsKind,
  channel: string | null,
  handler: (frame: WsFrame) => void,
  onGap?: () => void,
) {
  const handlerRef = useRef(handler);
  const gapRef = useRef(onGap);
  useEffect(() => {
    handlerRef.current = handler;
    gapRef.current = onGap;
  }, [handler, onGap]);

  useEffect(() => {
    if (!channel) return;
    const socket = getSocket(kind);
    const off = socket.onFrame((frame) => {
      if (frame.stream === channel) handlerRef.current(frame);
    });
    const offGap = socket.onGap((stream) => {
      if (stream === channel || stream === kind) gapRef.current?.();
    });
    socket.subscribe(channel);
    return () => {
      off();
      offGap();
      socket.unsubscribe(channel);
    };
  }, [kind, channel]);
}

export function useTickerStream(enabled = true) {
  const queryClient = useQueryClient();
  const revision = useRef(0);
  const recoveryRequested = useRef(false);
  useEffect(() => {
    return () => {
      revision.current += 1;
      recoveryRequested.current = false;
    };
  }, [enabled]);
  const applyFrame = (frame: WsFrame) => {
    if (!Array.isArray(frame.data)) return;
    const rows = frame.data as Array<Ticker & { deleted?: boolean }>;
    queryClient.setQueryData<Ticker[]>(["ticker-cache"], (old) => {
      const bySymbol = new Map<string, Ticker>();
      if (frame.type !== "snapshot") {
        for (const ticker of old ?? []) bySymbol.set(ticker.symbol, ticker);
      }
      for (const ticker of rows) {
        if (ticker.deleted) bySymbol.delete(ticker.symbol);
        else bySymbol.set(ticker.symbol, ticker);
      }
      return [...bySymbol.values()];
    });
    queryClient.setQueryData<Instrument[]>(["instruments"], (old) => {
      if (!old) return old;
      const bySymbol = new Map(old.map((instrument) => [instrument.symbol, instrument]));
      for (const ticker of rows) {
        if (ticker.deleted) {
          bySymbol.delete(ticker.symbol);
          continue;
        }
        const metadata = bySymbol.get(ticker.symbol);
        if (metadata) bySymbol.set(ticker.symbol, { ...metadata, ...ticker });
      }
      return [...bySymbol.values()];
    });
    for (const ticker of rows) {
      if (ticker.deleted) {
        clearTradePriceOverlay(ticker.symbol);
        queryClient.removeQueries({ queryKey: ["instrument", ticker.symbol] });
      } else {
        queryClient.setQueryData<Instrument>(["instrument", ticker.symbol], (old) =>
          old ? applyTradePriceOverlay({ ...old, ...ticker }) : old,
        );
      }
    }
  };
  useChannelFrames("public", enabled ? "tickers" : null, (frame) => {
    revision.current += 1;
    recoveryRequested.current = false;
    applyFrame(frame);
  }, () => {
    clearAllTradePriceOverlays();
    // Reconcile once per outage. A newer live frame always wins over this REST read.
    if (recoveryRequested.current) return;
    recoveryRequested.current = true;
    const beforeFetch = revision.current;
    void fetchAllPages<Ticker>("/api/v1/market/tickers").then((data) => {
      if (revision.current !== beforeFetch) return;
      applyFrame({ type: "snapshot", stream: "tickers", data });
    }).catch(() => {
      // Preserve the last prices until the socket delivers its next snapshot.
    });
  });
}

export function useMarketStateStream(enabled = true) {
  const queryClient = useQueryClient();
  useChannelFrames("public", enabled ? "market_state" : null, (frame) => {
    const raw = frame.data as Record<string, unknown> | undefined;
    if (!raw) return;
    if (typeof raw.symbol === "string" && typeof raw.state === "string") {
      applySymbolTradingState(
        queryClient,
        raw.symbol,
        raw.state as InstrumentState,
        typeof raw.reason === "string" ? raw.reason : null,
        typeof raw.halted_at === "string" ? raw.halted_at : null,
        typeof raw.halted_until === "string" ? raw.halted_until : null,
      );
      void refreshSymbolMetadata(queryClient, raw.symbol);
      return;
    }
    const marketState = raw as unknown as MarketState;
    queryClient.setQueryData(["market-state"], marketState);
    writeMarketStateCache(marketState);
  }, () => void queryClient.invalidateQueries({ queryKey: ["market-state"] }));
}

function mergeDisclosurePage(
  page: Page<Disclosure>, incoming: Disclosure[], symbol?: string, type?: string,
): Page<Disclosure> {
  const oldest = page.data.at(-1)?.occurred_at;
  const rows = new Map(page.data.map((row) => [row.disclosure_id, row]));
  for (const row of incoming) {
    if (symbol && row.symbol !== symbol || type && row.type !== type) continue;
    // Older rows belong to cursor pagination, not the live head of the list.
    if (oldest && Date.parse(row.occurred_at) < Date.parse(oldest)) continue;
    rows.set(row.disclosure_id, row);
  }
  return { ...page, data: [...rows.values()].sort((a, b) =>
    Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || b.disclosure_id.localeCompare(a.disclosure_id),
  ) };
}

export function reconcileDisclosures(queryClient: QueryClient, incoming: Disclosure[]) {
  // Global market-state frames have no disclosure identity and are handled separately.
  const rows = incoming.filter((row) => row.disclosure_id && row.occurred_at);
  queryClient.setQueryData<Disclosure[]>(["public-disclosures"], (old) =>
    mergeDisclosurePage({ data: [], page: { has_more: false, next_cursor: null } }, [...old ?? [], ...rows]).data.slice(0, 50),
  );
  for (const [key, current] of queryClient.getQueriesData<InfiniteData<Page<Disclosure>>>({ queryKey: ["disclosures"] })) {
    if (!current?.pages.length) continue;
    const symbol = key[1] === "all" ? undefined : key[1] as string;
    const type = key[2] === "all" ? undefined : key[2] as string;
    const olderIds = new Set(current.pages.slice(1).flatMap((page) => page.data.map((row) => row.disclosure_id)));
    queryClient.setQueryData(key, {
      ...current,
      pages: [mergeDisclosurePage(current.pages[0], rows.filter((row) => !olderIds.has(row.disclosure_id)), symbol, type), ...current.pages.slice(1)],
    });
  }
}

export function useDisclosureStream(enabled = true) {
  const queryClient = useQueryClient();
  const recoveryRequested = useRef(false);
  useChannelFrames("public", enabled ? "disclosures" : null, (frame) => {
    recoveryRequested.current = false;
    if (frame.type === "snapshot" && Array.isArray(frame.data)) {
      reconcileDisclosures(queryClient, frame.data as Disclosure[]);
    } else if (frame.type === "update" && frame.data) {
      reconcileDisclosures(queryClient, [frame.data as Disclosure]);
    }
  }, () => {
    if (recoveryRequested.current) return;
    recoveryRequested.current = true;
    void queryClient.invalidateQueries({ queryKey: ["disclosures"], refetchType: "all" });
  });
}

export function useSymbolMetadataSync(enabled = true) {
  const queryClient = useQueryClient();
  const sinceVersion = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let synchronizing = false;

    const applyCachedMetadata = (cache: SymbolMetadataCache) => {
      sinceVersion.current = cache.next_since_version;
      applySymbolMetadataCache(queryClient, cache);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === MARKET_STATE_CACHE_KEY && event.newValue) {
        try {
          const state = JSON.parse(event.newValue) as MarketState;
          if (state && (state.state === "RUNNING" || state.state === "GLOBAL_HALTED")) {
            queryClient.setQueryData(["market-state"], state);
            if (state.changed_at) {
              const t = Date.parse(state.changed_at);
              if (Number.isFinite(t)) {
                const prev = lastTradingEventTimestamps.get("__GLOBAL__");
                if (prev === undefined || t > prev) {
                  lastTradingEventTimestamps.set("__GLOBAL__", t);
                }
              }
            }
          }
        } catch {
          // Ignore malformed cross-tab updates
        }
        return;
      }
      if (event.key !== SYMBOL_METADATA_CACHE_KEY) return;
      if (event.newValue === null) {
        adoptSymbolMetadataCache(null);
        return;
      }
      try {
        const cache = parseSymbolMetadataCache(JSON.parse(event.newValue));
        if (cache) {
          const previous = adoptSymbolMetadataCache(cache);
          for (const s of cache.symbols) {
            const t = Date.parse(s.updated_at || s.halted_at || "0");
            if (Number.isFinite(t)) {
              const prev = lastTradingEventTimestamps.get(s.symbol);
              if (prev === undefined || t > prev) {
                lastTradingEventTimestamps.set(s.symbol, t);
              }
            }
          }
          if (previous) {
            applySymbolMetadataDelta(queryClient, previous, cache);
          } else {
            const tickers = queryClient.getQueryData<Ticker[]>(["ticker-cache"]) ?? [];
            for (const symbol of cache.symbols) {
              const ticker = tickers.find((item) => item.symbol === symbol.symbol);
              for (const key of [symbol.symbol, symbol.symbol.replace(/\.M$/, "")]) {
                queryClient.setQueryData<Instrument>(["instrument", key], (old) =>
                  old ? applyTradePriceOverlay(composeInstrument(symbol, ticker ?? old)) : old,
                );
              }
            }
          }
          applyCachedMetadata(cache);
        }
      } catch {
        // Ignore malformed cross-tab updates and keep the last valid cache.
      }
    };

    window.addEventListener("storage", onStorage);

    async function synchronize() {
      if (synchronizing) return;
      synchronizing = true;
      const cachedBefore = readSymbolMetadataCache();
      try {
        const cache = await ensureSymbolMetadataCache();
        if (stopped) return;
        if (!cachedBefore) {
          applyCachedMetadata(cache);
          return;
        }
        if (!isInitialSymbolMetadataValidationDone()) {
          const validated = await runInitialSymbolMetadataValidation(cache);
          if (stopped) return;
          applySymbolMetadataDelta(queryClient, cache, validated);
          applyCachedMetadata(validated);
          return;
        }
        if (Date.now() - cache.saved_at < SYMBOL_METADATA_SYNC_MS) {
          applyCachedMetadata(cache);
          return;
        }
        const nextCache = await runSymbolMetadataSync(cache);
        if (stopped) return;
        applySymbolMetadataDelta(queryClient, cache, nextCache);
        applyCachedMetadata(nextCache);
      } catch (error) {
        if (error instanceof ApiError && error.code === "INVALID_REQUEST") {
          clearSymbolMetadataCache();
          try {
            const recovered = await ensureSymbolMetadataCache();
            if (!stopped) applyCachedMetadata(recovered);
          } catch {
            // Keep the last in-memory data and retry on the next cadence.
          }
        }
      } finally {
        synchronizing = false;
      }
    }

    // Hidden tabs skip the cadence and catch up once they become visible.
    const syncIfVisible = () => {
      if (document.visibilityState === "visible") void synchronize();
    };
    void synchronize();
    const timer = window.setInterval(syncIfVisible, SYMBOL_METADATA_SYNC_MS);
    document.addEventListener("visibilitychange", syncIfVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", syncIfVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled, queryClient]);
}

/**
 * Makes a socket snapshot the trade list. A REST fetch still in flight would
 * otherwise resolve later and overwrite the snapshot (and any updates applied
 * on top of it) with an older page. Cancelling reverts synchronously, so the
 * snapshot written right after wins.
 */
export function replaceSymbolTrades(
  queryClient: QueryClient,
  symbol: string,
  limit: number,
  snapshot: PublicTrade[],
) {
  const queryKey = ["symbol-trades", symbol, limit];
  void queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<Page<PublicTrade>>(queryKey, (old) => ({
    data: snapshot,
    page: old?.page ?? { next_cursor: null, has_more: false },
  }));
}

export function useSymbolTradeStream(symbol: string | undefined, limit = 150) {
  const queryClient = useQueryClient();

  useChannelFrames("public", symbol ? `trades:${symbol}` : null, (frame) => {
    if (!symbol) return;
    const runtime = candleRuntime(symbol);
    if (frame.type === "snapshot" && Array.isArray(frame.data)) {
      const snapshot = frame.data as PublicTrade[];
      const sequences = snapshot
        .map((trade) => trade.sequence)
        .filter((sequence): sequence is number => Number.isSafeInteger(sequence));
      runtime.snapshotReady = true;
      runtime.awaitingSnapshotRecovery = false;
      runtime.lastSequence = sequences.length > 0 ? Math.max(...sequences) : undefined;
      runtime.seenSequences.clear();
      runtime.pendingSequences.clear();
      replaceSymbolTrades(queryClient, symbol, limit, snapshot);
      return;
    }
    if (frame.type !== "update" || !frame.data) return;
    const trade = frame.data as PublicTrade;
    if (!Number.isSafeInteger(trade.sequence)) return;
    if (runtime.awaitingSnapshotRecovery) return;
    if (!runtime.snapshotReady) {
      runtime.pendingSequences.add(trade.sequence);
      return;
    }
    if (runtime.seenSequences.has(trade.sequence)) return;
    if (runtime.lastSequence !== undefined && trade.sequence <= runtime.lastSequence) {
      clearTradePriceOverlay(symbol);
      runtime.snapshotReady = false;
      runtime.lastSequence = undefined;
      runtime.seenSequences.clear();
      runtime.pendingSequences.clear();
      requestCandleRecovery(queryClient, symbol, runtime, true);
      return;
    }
    if (runtime.lastSequence !== undefined && trade.sequence !== runtime.lastSequence + 1) {
      clearTradePriceOverlay(symbol);
      runtime.snapshotReady = false;
      runtime.lastSequence = undefined;
      runtime.seenSequences.clear();
      runtime.pendingSequences.clear();
      requestCandleRecovery(queryClient, symbol, runtime, true);
      return;
    }
    runtime.lastSequence = trade.sequence;
    rememberTradeSequence(runtime, trade.sequence);
    updateTradePriceOverlay(symbol, trade);
    queryClient.setQueryData<Instrument>(["instrument", symbol], (old) =>
      old ? applyTradePriceOverlay(old) : old,
    );
    queryClient.setQueryData<Page<PublicTrade>>(["symbol-trades", symbol, limit], (old) => {
      if (!old) return old;
      if (old.data.some((row) => row.sequence === trade.sequence)) return old;
      return { data: [trade, ...old.data].slice(0, 400), page: old.page };
    });
    const result = updateCachedCandleQueries(queryClient, symbol, trade);
    if (result.needsRecovery) {
      runtime.pendingSequences.add(trade.sequence);
      // The cached page cannot safely correct an older bucket (or be merged
      // while its REST bootstrap is in flight). Make the canonical REST page
      // authoritative once for active observers; requestCandleRecovery clears
      // this triggering sequence so it cannot be double-counted afterward.
      requestCandleRecovery(queryClient, symbol, runtime);
    }
  }, () => {
    if (!symbol) return;
    const runtime = candleRuntime(symbol);
    clearTradePriceOverlay(symbol);
    runtime.snapshotReady = false;
    runtime.lastSequence = undefined;
    runtime.seenSequences.clear();
    runtime.pendingSequences.clear();
    requestCandleRecovery(queryClient, symbol, runtime, true);
    void queryClient.invalidateQueries({ queryKey: ["symbol-trades", symbol] });
  });
}

/** Notifications are also the authoritative private delivery path for trade events. */
export function reconcileNotificationData(
  queryClient: QueryClient,
  notification: Notification,
) {
  const parsed = parseNotificationBody(notification.body);
  const event = parsed.eventKey ?? eventKeyFromTitle(notification.title);
  const keys = new Set<string>();
  if (["TRADE_EXECUTED", "TRIGGER_ACTIVATED", "transfer.updated", "ISSUANCE_CREATED", "LOCKUP_RELEASE"].includes(event ?? "")) {
    for (const key of ["orders", "my-trades", "portfolio", "accounts", "nav", "nav-history", "realized-pnl"]) keys.add(key);
  }
  if (event === "transfer.updated") keys.add("transfers");
  // Delisting settles remaining holdings into Credit.
  if (event === "DELISTED") {
    for (const key of ["portfolio", "accounts", "nav", "nav-history", "realized-pnl"]) keys.add(key);
  }
  if (event?.startsWith("margin.")) {
    // A warning only changes risk; settlements and liquidations move balances too.
    invalidateMarginQueries(queryClient, { balances: event !== "margin.warning" });
  }
  if (event === "MANAGER_CHANGED" || event === "MANAGER_FORCED_CHANGE") keys.add("manager-requests");
  if (event === "AUTH_PASSKEY_ADDED" || event === "AUTH_PASSKEY_DELETED") keys.add("passkeys");
  if (event === "AUTH_SESSIONS_REVOKED" || event === "AUTH_LOGIN" || event === "AUTH_LOGOUT") keys.add("sessions");
  if (event === "ICON_REJECTED") keys.add("icon-requests");
  if (event === "CURVE_CEILING_REACHED") keys.add("issuance-preview");
  if ([
    "SYMBOL_METADATA_CHANGED", "SYMBOL_LISTED", "ISSUANCE_CREATED", "LOCKUP_RELEASE",
    "CURVE_CEILING_REACHED", "MANAGER_CHANGED", "MANAGER_FORCED_CHANGE",
  ].includes(event ?? "")) {
    // applyTradingNotification already refreshes these metadata events.
    if (parsed.symbol && event !== "SYMBOL_METADATA_CHANGED" && event !== "SYMBOL_LISTED") {
      void refreshSymbolMetadata(queryClient, parsed.symbol);
    }
    keys.add("icon-requests");
  }
  if (event === "inquiry.replied") {
    keys.add("inquiries");
    keys.add("inquiry");
  }
  if (event === "ACCOUNT_CREATED" || event === "ACCOUNT_DELETED") keys.add("accounts");
  invalidateNotificationKeys(queryClient, keys);
}

// NAV history is a period series: refresh it when a chart next mounts or regains
// focus instead of refetching up to 500 points for every event.
const PASSIVE_REFRESH_KEYS = new Set(["nav-history"]);

function invalidateNotificationKeys(
  queryClient: QueryClient,
  keys: Iterable<string>,
): void {
  const active: string[][] = [];
  const passive: string[][] = [];
  for (const key of keys) (PASSIVE_REFRESH_KEYS.has(key) ? passive : active).push([key]);
  invalidateBatched(queryClient, active);
  invalidateBatched(queryClient, passive, { passive: true });
}

export function usePrivateStream(enabled: boolean) {
  const queryClient = useQueryClient();
  const handlerRef = useRef<(frame: WsFrame) => void>(() => {});

  useEffect(() => {
    handlerRef.current = (frame) => {
      const stream = frame.stream;
      if (!stream) return;
      if (stream === "notification.created" || stream === "notification.updated") {
        const notification = notificationFromPrivateFrame(frame);
        if (!notification) return;
        updateNotificationCaches(queryClient, notification);
        // Updates (e.g. read state) carry no new domain event to reconcile.
        if (stream === "notification.created") {
          applyTradingNotification(queryClient, notification);
          reconcileNotificationData(queryClient, notification);
        }
        return;
      }
      // Private trade.executed is not delivered; fills arrive as notifications.
      // Domain streams below share one batched refetch with their notification.
      if (stream === "trigger.activated") {
        invalidateNotificationKeys(queryClient, ["orders", "my-trades", "portfolio", "nav", "nav-history"]);
        return;
      }
      if (stream === "transfer.updated") {
        invalidateNotificationKeys(queryClient, ["transfers", "portfolio", "nav"]);
        return;
      }
      if (stream.startsWith("margin.")) {
        const marginData = frame.data as { position_id?: string } | undefined;
        invalidateMarginQueries(queryClient, {
          positionId: marginData?.position_id,
          balances: stream !== "margin.warning",
        });
        return;
      }
      if (stream === "listing.updated" || stream === "issuance.created") {
        const symbol = (frame.data as { symbol?: string } | undefined)?.symbol;
        if (symbol) {
          void refreshSymbolMetadata(queryClient, symbol);
        } else {
          const cache = readSymbolMetadataCache();
          // Apply the result too: the periodic sync would see an already
          // fresh cache and never push this delta into mounted queries.
          if (cache) {
            void runSymbolMetadataSync(cache).then((next) => {
              applySymbolMetadataDelta(queryClient, cache, next);
              applySymbolMetadataCache(queryClient, next);
            }, () => undefined);
          }
        }
        return;
      }
      if (stream === "inquiry.replied") {
        invalidateNotificationKeys(queryClient, ["inquiries", "inquiry"]);
      }
    };
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket("private");
    const release = socket.retain();
    let reconciliationRequested = false;
    const off = socket.onFrame((frame) => {
      if (frame.type === "update") reconciliationRequested = false;
      handlerRef.current(frame);
    });
    const offGap = socket.onGap(() => {
      // Private streams have no replay/resume. Reconcile once for this gap;
      // repeated failed reconnects must not turn this into a poller.
      if (reconciliationRequested) return;
      reconciliationRequested = true;
      invalidateMarginQueries(queryClient);
      invalidateNotificationKeys(queryClient, [
        "notifications",
        "orders",
        "my-trades",
        "portfolio",
        "accounts",
        "nav",
        "nav-history",
        "transfers",
        "inquiries",
        "icon-requests",
      ]);
    });
    return () => {
      off();
      offGap();
      release();
    };
  }, [enabled, queryClient]);
}
