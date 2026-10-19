"use client";

import { useQuery } from "@tanstack/react-query";
import { apiData } from "../api";
import {
  isMarginCapacityClientError,
  isMarginCapacityHiddenError,
  normalizeMarginCapacity,
  retryMarginCapacity,
} from "../margin-capacity";

export function useMarginCapacity(symbol: string | undefined) {
  const query = useQuery({
    queryKey: ["margin-capacity", symbol],
    queryFn: async ({ signal }) => normalizeMarginCapacity(
      await apiData<unknown>(`/api/v1/market/symbols/${encodeURIComponent(symbol!)}/margin-status`, { signal }),
    ),
    enabled: Boolean(symbol),
    staleTime: 30_000,
    // TanStack pauses this timer in hidden tabs and removes it on unmount.
    refetchInterval: (query) => isMarginCapacityClientError(query.state.error) ? false : 60_000,
    refetchIntervalInBackground: false,
    retry: retryMarginCapacity,
  });
  return {
    ...query,
    hidden: isMarginCapacityHiddenError(query.error) || (query.isSuccess && query.data === null),
    // A failed refresh must not leave an old availability claim on screen.
    capacity: query.isError ? null : query.data ?? null,
  };
}
