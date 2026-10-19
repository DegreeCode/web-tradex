"use client";

import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPage, buildQuery } from "../api";
import { fetchCandleSnapshot } from "../candle-query";
import { appendCandleHistoryWithGaps, type CandlePage } from "../candle-data";
import { candleTradeRuntimes, startCandleClock, requestCandleRecovery } from "../candle-cache";
import { useSignedIn } from "../session-mode";
import type { Candle, CandleInterval } from "../types";

export function useCandles(
  symbol: string | undefined,
  interval: CandleInterval,
  limit = 200,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();
  const queryKey = ["candles", symbol, interval, limit] as const;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchCandleSnapshot(queryClient, symbol, interval, limit, signedIn, signal),
    enabled: Boolean(symbol) && enabled,
    // Keep the chart mounted during interval loads, never across symbols.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === symbol ? previousData : undefined,
    // Re-entering an interval or returning to the tab catches up the cached tail.
    // Trades and the local boundary clock keep mounted charts live. A guest
    // loads candles once per visit and its polled ticker supplies later trades.
    staleTime: signedIn ? 0 : Infinity,
    ...(signedIn ? {} : { gcTime: 0 }),
    refetchInterval: false,
    refetchOnMount: signedIn ? "always" : false,
    // The public stream and the local boundary clock own the cached tail. A
    // focus/reconnect refetch would pull the whole page again for nothing.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  useEffect(() => {
    if (!symbol || !enabled || !query.isSuccess || query.isFetching) return;
    const runtime = candleTradeRuntimes.get(symbol);
    if (!runtime || runtime.recoveryInFlight || runtime.awaitingSnapshotRecovery) return;
    if (runtime.pendingSequences.size === 0) return;
    requestCandleRecovery(queryClient, symbol, runtime);
  }, [enabled, query.dataUpdatedAt, query.isFetching, query.isSuccess, queryClient, symbol]);

  useEffect(() => {
    if (!symbol || !enabled) return;
    return startCandleClock(queryClient, symbol, interval, limit, { respectRecovery: signedIn });
  }, [enabled, interval, limit, queryClient, signedIn, symbol]);

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
  // Older history is a signed-in feature; a guest's chart stops at its first load.
  const hasOlder = Boolean(
    signedIn && enabled && !query.isPlaceholderData && !query.isFetching &&
    query.data?.page.has_more && query.data.page.next_cursor,
  );
  const loadOlder = () => {
    const cursor = query.data?.page.next_cursor;
    if (!symbol || !cursor || !hasOlder || queryClient.isMutating({
      mutationKey: ["older-candles", symbol, interval, limit], exact: true,
    })) return;
    older.mutate({ symbol, interval, limit, cursor });
  };

  // The live window stays bounded; older pages accumulate in `history` so the
  // chart can keep loading them without a hard cap.
  const candles = useMemo(() => {
    const page = query.data;
    if (!page) return [];
    return page.history?.length ? [...page.data, ...page.history] : page.data;
  }, [query.data]);

  return {
    ...query,
    candles,
    hasOlder,
    isLoadingOlder,
    olderError: olderIsCurrent && older.isError ? older.error : null,
    loadOlder,
  };
}
