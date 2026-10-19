"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { apiPage, buildQuery, isApiError } from "../api";
import { normalizeSymbolHoldings, symbolHoldingsRangeQuery, type SymbolHoldingsRange } from "../symbol-holdings";

export function symbolHoldingsQueryOptions(symbol: string | undefined, rangeKey: SymbolHoldingsRange) {
  return queryOptions({
    queryKey: ["symbol-holdings", symbol, rangeKey] as const,
    queryFn: async ({ signal }) => {
      const page = await apiPage<unknown>(
        `/api/v1/market/symbols/${encodeURIComponent(symbol!)}/holdings${buildQuery(symbolHoldingsRangeQuery(rangeKey))}`,
        { signal },
      );
      return normalizeSymbolHoldings(page);
    },
    enabled: Boolean(symbol),
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === symbol ? previousData : undefined,
    staleTime: 60_000,
    refetchInterval: (query) =>
      isApiError(query.state.error) && query.state.error.status >= 400 && query.state.error.status < 500
        ? false
        : 60_000,
    // Query's visibility manager pauses this timer in hidden tabs, including for guests.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

export function useSymbolHoldings(symbol: string | undefined, rangeKey: SymbolHoldingsRange) {
  return useQuery(symbolHoldingsQueryOptions(symbol, rangeKey));
}
