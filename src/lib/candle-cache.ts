/**
 * Per-symbol runtime that keeps cached candle pages live from the public trade
 * stream, and falls back to a REST refetch whenever a trade cannot be merged.
 */
import type { QueryClient } from "@tanstack/react-query";

import {
  advanceCandlePage, applyTradeToCandlePage, isCandleInterval,
  CANDLE_CLOCK_GRACE_MS, candleClockTimestamp, compareTradeTimestamps, type BufferedCandleTrade,
  nextCandleBucketTimestamp, replaceCandlePageData, type CandlePage,
} from "./candle-data";
import type { Candle, CandleInterval, Page, PublicTrade } from "./types";

const MAX_TRACKED_TRADE_SEQUENCES = 2_000;

export interface CandleTradeRuntime {
  snapshotReady: boolean;
  lastSequence?: number;
  seenSequences: Set<number>;
  pendingSequences: Set<number>;
  recoveryInFlight: boolean;
  recoveryFrom?: string;
  latestTradeTimestamp?: string;
  awaitingSnapshotRecovery: boolean;
}

export const candleTradeRuntimes = new Map<string, CandleTradeRuntime>();
export type CandleFetchBuffer = BufferedCandleTrade[] & { syncedThrough?: string };
export const candleFetchTrades = new Map<string, CandleFetchBuffer>();
const candleClockListeners = new Map<string, Set<() => void>>();
const runtimeConsumers = new Map<string, number>();

/** A symbol's replay history only lives while its trade stream is mounted. */
export function retainCandleRuntime(symbol: string): () => void {
  const runtime = candleRuntime(symbol);
  runtimeConsumers.set(symbol, (runtimeConsumers.get(symbol) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (runtimeConsumers.get(symbol) ?? 1) - 1;
    if (remaining > 0) {
      runtimeConsumers.set(symbol, remaining);
      return;
    }
    runtimeConsumers.delete(symbol);
    if (candleTradeRuntimes.get(symbol) === runtime) candleTradeRuntimes.delete(symbol);
  };
}

/** Recovery flags are outside Query state; wake clocks when that ownership ends. */
export function resumeCandleClocks(symbol: string): void {
  for (const refresh of candleClockListeners.get(symbol) ?? []) refresh();
}

export function candleRuntime(symbol: string): CandleTradeRuntime {
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

export function rememberTradeSequence(runtime: CandleTradeRuntime, sequence: number): void {
  runtime.seenSequences.add(sequence);
  while (runtime.seenSequences.size > MAX_TRACKED_TRADE_SEQUENCES) {
    const oldest = runtime.seenSequences.values().next().value;
    if (oldest === undefined) break;
    runtime.seenSequences.delete(oldest);
  }
}

export function updateCachedCandleQueries(
  queryClient: QueryClient,
  symbol: string,
  trade: PublicTrade,
  count?: number,
): { updated: boolean; needsRecovery: boolean } {
  const runtime = candleTradeRuntimes.get(symbol);
  if (count === undefined && runtime && (!runtime.latestTradeTimestamp || compareTradeTimestamps(trade.timestamp, runtime.latestTradeTimestamp) > 0)) {
    runtime.latestTradeTimestamp = trade.timestamp;
  }
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
      if (pending) pending.push(count === undefined ? trade : { ...trade, candleTradeCount: count });
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
    if (syncedThrough && compareTradeTimestamps(trade.timestamp, syncedThrough) < 0) continue;
    const result = applyTradeToCandlePage(unknownPage as Page<Candle>, interval, limit, trade, count);
    if (result.status === "recovery") {
      needsRecovery = true;
      const runtime = candleRuntime(symbol);
      if (!runtime.recoveryFrom || compareTradeTimestamps(trade.timestamp, runtime.recoveryFrom) < 0) {
        runtime.recoveryFrom = trade.timestamp;
      }
    } else if (result.data) {
      updated = true;
      const nextData = result.data;
      queryClient.setQueryData<CandlePage>(queryKey, (current) => {
        if (!current) return current;
        return replaceCandlePageData(current, nextData);
      });
    }
  }
  return { updated, needsRecovery };
}

/** The initial WS snapshot can contain trades newer than the conservative
 * bootstrap REST cutoff. Merge that tail, or recover if snapshot truncation
 * makes its coverage unknowable. Reconnects already have a recovery owner. */
export function reconcileCandleTradeSnapshot(
  queryClient: QueryClient,
  symbol: string,
  trades: PublicTrade[],
  snapshotLimit: number,
  runtime: CandleTradeRuntime,
): void {
  const sorted = [...trades].sort((a, b) => a.sequence - b.sequence);
  const latest = sorted.reduce<string | undefined>((latest, trade) =>
    !latest || compareTradeTimestamps(trade.timestamp, latest) > 0 ? trade.timestamp : latest, undefined);
  if (latest && (!runtime.latestTradeTimestamp || compareTradeTimestamps(latest, runtime.latestTradeTimestamp) > 0)) {
    runtime.latestTradeTimestamp = latest;
  }
  const reconcileIdle = !runtime.snapshotReady || runtime.awaitingSnapshotRecovery;
  let needsRecovery = false;
  for (const [key, page] of queryClient.getQueriesData<CandlePage>({ queryKey: ["candles", symbol] })) {
    const query = queryClient.getQueryCache().find({ queryKey: key, exact: true });
    if (!query?.isActive() || !isCandleInterval(key[2])) continue;
    const pending = candleFetchTrades.get(JSON.stringify(key));
    if (pending) {
      pending.push(...sorted);
      // A truncated snapshot may omit the beginning of the REST replay tail.
      // Record uncertainty for the existing post-fetch recovery effect.
      if (sorted.length >= snapshotLimit && (!pending.syncedThrough ||
        compareTradeTimestamps(sorted[0].timestamp, pending.syncedThrough) > 0)) {
        runtime.pendingSequences.add(sorted[0].sequence);
      }
      continue;
    }
    if (!reconcileIdle || !page?.syncedThrough || !sorted.length) continue;
    if (sorted.length >= snapshotLimit && compareTradeTimestamps(sorted[0].timestamp, page.syncedThrough) > 0) {
      needsRecovery = true;
      continue;
    }
    let next = page;
    for (const trade of sorted) {
      const applied = applyTradeToCandlePage(next, key[2], Number(key[3]), trade);
      if (!applied.data) { needsRecovery = true; break; }
      next = replaceCandlePageData(next, applied.data);
    }
    if (next !== page) queryClient.setQueryData(key, next);
  }
  if (needsRecovery) requestCandleRecovery(queryClient, symbol, runtime);
}

export function requestCandleRecovery(
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
      // A completed request from an unmounted stream cannot schedule recovery
      // for a fresh runtime created by a later visit to the same symbol.
      if (candleTradeRuntimes.get(symbol) !== runtime) return;
      // A truncated WS snapshot received during this request can expose a
      // missing replay prefix. Its observed server time bounds the next
      // ordinary recovery; do not silently clear that new uncertainty.
      if (runtime.pendingSequences.size && runtime.snapshotReady && !runtime.awaitingSnapshotRecovery) {
        requestCandleRecovery(queryClient, symbol, runtime);
      } else {
        resumeCandleClocks(symbol);
      }
    });
}

/** Injectable browser clock so scheduling, visibility and fetch races are testable. */
export interface CandleClockEnvironment {
  now(): number;
  hidden(): boolean;
  schedule(callback: () => void, delay: number): () => void;
  onVisibilityChange(callback: () => void): () => void;
}

const browserCandleClock: CandleClockEnvironment = {
  now: () => Date.now(),
  hidden: () => document.hidden,
  schedule: (callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
  onVisibilityChange: (callback) => {
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
  },
};

/** Local cache updates only: never fetch, invalidate, or touch the WS replay queue. */
export function startCandleClock(
  queryClient: QueryClient,
  symbol: string,
  interval: CandleInterval,
  limit: number,
  options: { clock?: CandleClockEnvironment; respectRecovery?: boolean } = {},
): () => void {
  const clock = options.clock ?? browserCandleClock;
  const queryKey = ["candles", symbol, interval, limit] as const;
  const fetchKey = JSON.stringify(queryKey);
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (!query) return () => undefined;
  let cancelTimer: (() => void) | undefined;
  let updating = false;
  let stopped = false;
  const refresh = () => {
    if (stopped || updating) return;
    cancelTimer?.();
    cancelTimer = undefined;
    if (clock.hidden() || !query.isActive() || query.state.status !== "success") return;
    const page = query.state.data as CandlePage | undefined;
    if (!page?.data.length) return;
    const now = clock.now();
    // Guests have no WS recovery owner, including after signing out while an
    // old signed-in runtime was awaiting a snapshot.
    const runtime = options.respectRecovery === false ? undefined : candleTradeRuntimes.get(symbol);
    // A fetch owns its snapshot and buffered WS replay. Recovery can span the
    // REST completion and the next WS snapshot, so check both runtime flags.
    const busy = query.state.fetchStatus !== "idle" || candleFetchTrades.has(fetchKey) ||
      runtime?.recoveryInFlight || runtime?.awaitingSnapshotRecovery ||
      Boolean(runtime?.pendingSequences.size);
    if (!busy) {
      updating = true;
      try {
        const next = advanceCandlePage(page, interval, candleClockTimestamp(now));
        if (next !== page) queryClient.setQueryData(queryKey, next);
      } finally {
        updating = false;
      }
    }
    // Future-dated data must not wake the clock at boundaries that cannot
    // change it. Calendar intervals use APP timezone, not a fixed day length.
    const latest = (query.state.data as CandlePage).data[0];
    const boundary = nextCandleBucketTimestamp(
      new Date(Math.max(now - CANDLE_CLOCK_GRACE_MS, Date.parse(latest.timestamp))).toISOString(), interval,
    );
    if (!boundary) return;
    // Browsers overflow delays above ~24.8 days (monthly/yearly buckets).
    const delay = Math.min(2_147_483_647, Math.max(1, Date.parse(boundary) + CANDLE_CLOCK_GRACE_MS - now));
    cancelTimer = clock.schedule(refresh, delay);
  };
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.query === query) refresh();
  });
  const listeners = candleClockListeners.get(symbol) ?? new Set<() => void>();
  listeners.add(refresh);
  candleClockListeners.set(symbol, listeners);
  const removeVisibility = clock.onVisibilityChange(refresh);
  refresh();
  return () => {
    stopped = true;
    cancelTimer?.();
    unsubscribe();
    removeVisibility();
    listeners.delete(refresh);
    if (listeners.size === 0) candleClockListeners.delete(symbol);
  };
}
