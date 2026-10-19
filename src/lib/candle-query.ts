import type { QueryClient } from "@tanstack/react-query";
import { apiPage, buildQuery } from "./api";
import {
  candleClockTimestamp, candleSnapshotFrom, candleSnapshotTo, reconcileCandleSnapshot,
  MAX_MATERIALIZED_CANDLE_BUCKETS, mergeCandles, type CandlePage,
} from "./candle-data";
import { candleFetchTrades, candleTradeRuntimes, type CandleFetchBuffer } from "./candle-cache";
import type { Candle, CandleInterval, Page } from "./types";

/** One cancellable REST snapshot, including every page needed for recovery. */
export async function fetchCandleSnapshot(
  queryClient: QueryClient,
  symbol: string | undefined,
  interval: CandleInterval,
  limit: number,
  signedIn: boolean,
  signal: AbortSignal,
): Promise<CandlePage> {
  const queryKey = ["candles", symbol, interval, limit] as const;
  const current = queryClient.getQueryData<CandlePage>(queryKey);
  // Synthetic clock ticks are not evidence that we received real candles.
  const runtime = signedIn && symbol ? candleTradeRuntimes.get(symbol) : undefined;
  const recoveryFrom = runtime?.recoveryFrom;
  const from = candleSnapshotFrom(current, interval, recoveryFrom);
  const to = candleSnapshotTo(current, Date.now(), runtime?.latestTradeTimestamp);
  const pending: CandleFetchBuffer = [];
  pending.syncedThrough = to;
  const fetchKey = JSON.stringify(queryKey);
  candleFetchTrades.set(fetchKey, pending);
  try {
    let cursor: string | undefined;
    let fetched: Candle[] = [];
    let page: Page<Candle>;
    const seenCursors = new Set<string>();
    do {
      page = await apiPage<Candle>(
        `/api/v1/market/symbols/${encodeURIComponent(symbol ?? "")}/candles${buildQuery({
          interval, limit, from, to, cursor,
        })}`,
        { signal },
      );
      // Recovery can span many REST pages after a long hidden period;
      // only the newest bounded window can survive materialization.
      fetched = mergeCandles(fetched, page.data).slice(0, MAX_MATERIALIZED_CANDLE_BUCKETS);
      const next = from && page.page.has_more ? page.page.next_cursor ?? undefined : undefined;
      // A repeated cursor would otherwise loop forever on a bad server page.
      cursor = next && !seenCursors.has(next) ? next : undefined;
      if (next) seenCursors.add(next);
    } while (cursor && fetched.length < MAX_MATERIALIZED_CANDLE_BUCKETS);
    // Keep the older-history cursor: this request only advances the newest end.
    const latest = queryClient.getQueryData<CandlePage>(queryKey);
    const result = reconcileCandleSnapshot(latest, { ...page, data: fetched }, interval,
      to, pending, from, candleClockTimestamp(Date.now()));
    if (runtime && runtime.recoveryFrom === recoveryFrom) runtime.recoveryFrom = undefined;
    return result;
  } finally {
    if (candleFetchTrades.get(fetchKey) === pending) candleFetchTrades.delete(fetchKey);
  }
}
