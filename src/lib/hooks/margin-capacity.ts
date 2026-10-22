"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { apiData } from "../api";
import {
  isMarginCapacityClientError,
  isMarginCapacityHiddenError,
  normalizeMarginCapacity,
  retryMarginCapacity,
} from "../margin-capacity";

export function marginCapacityQueryOptions(symbol: string | undefined, enabled = true) {
  return queryOptions({
    queryKey: ["margin-capacity", symbol],
    queryFn: async ({ signal }) => normalizeMarginCapacity(
      await apiData<unknown>(`/api/v1/market/symbols/${encodeURIComponent(symbol!)}/margin-status`, { signal }),
    ),
    enabled: enabled && Boolean(symbol),
    staleTime: 30_000,
    // TanStack pauses this timer in hidden tabs and removes it on unmount.
    refetchInterval: (query) => isMarginCapacityClientError(query.state.error) ? false : 60_000,
    refetchIntervalInBackground: false,
    refetchOnMount: (query) => !isMarginCapacityClientError(query.state.error),
    refetchOnWindowFocus: (query) => !isMarginCapacityClientError(query.state.error),
    refetchOnReconnect: (query) => !isMarginCapacityClientError(query.state.error),
    retry: retryMarginCapacity,
    // A failed initial load has no data: refetchOnMount alone cannot stop it.
    retryOnMount: false,
  });
}

export function useMarginCapacity(symbol: string | undefined, enabled = true) {
  const query = useQuery(marginCapacityQueryOptions(symbol, enabled));
  return {
    ...query,
    hidden: isMarginCapacityHiddenError(query.error) || (query.isSuccess && query.data === null),
    // A failed refresh must not leave an old availability claim on screen.
    capacity: query.isError ? null : query.data ?? null,
  };
}
