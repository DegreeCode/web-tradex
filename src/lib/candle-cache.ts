/**
 * Per-symbol runtime that keeps cached candle pages live from the public trade
 * stream, and falls back to a REST refetch whenever a trade cannot be merged.
 */
import type { QueryClient } from "@tanstack/react-query";

import { applyTradeToCandlePage, isCandleInterval, type CandlePage } from "./candle-data";
import type { Candle, Page, PublicTrade } from "./types";

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
      queryClient.setQueryData<Page<Candle>>(queryKey, (current) => {
        if (!current) return current;
        return { ...current, data: nextData };
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
    });
}
