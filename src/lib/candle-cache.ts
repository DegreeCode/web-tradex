/**
 * Per-symbol runtime that keeps cached candle pages live from the public trade
 * stream, and falls back to a REST refetch whenever a trade cannot be merged.
 */
import type { QueryClient } from "@tanstack/react-query";

import {
  advanceCandlePage, applyTradeToCandlePage, isCandleInterval,
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
  awaitingSnapshotRecovery: boolean;
}

export const candleTradeRuntimes = new Map<string, CandleTradeRuntime>();
export const candleFetchTrades = new Map<string, PublicTrade[]>();
const candleClockListeners = new Map<string, Set<() => void>>();

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
  count = 1,
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
    const result = applyTradeToCandlePage(unknownPage as Page<Candle>, interval, limit, trade, count);
    if (result.status === "recovery") {
      needsRecovery = true;
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
      runtime.pendingSequences.clear();
      resumeCandleClocks(symbol);
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
        const next = advanceCandlePage(page, interval, new Date(now).toISOString());
        if (next !== page) queryClient.setQueryData(queryKey, next);
      } finally {
        updating = false;
      }
    }
    // Future-dated data must not wake the clock at boundaries that cannot
    // change it. Calendar intervals use APP timezone, not a fixed day length.
    const latest = (query.state.data as CandlePage).data[0];
    const boundary = nextCandleBucketTimestamp(
      new Date(Math.max(now, Date.parse(latest.timestamp))).toISOString(), interval,
    );
    if (!boundary) return;
    // Browsers overflow delays above ~24.8 days (monthly/yearly buckets).
    const delay = Math.min(2_147_483_647, Math.max(1, Date.parse(boundary) - now));
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
