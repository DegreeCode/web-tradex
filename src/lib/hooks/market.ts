"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiData, apiPage, buildQuery } from "../api";
import {
  applyTradePriceOverlay,
  canonicalSymbol,
  composeCachedInstruments,
  composeInstrument,
  findCachedTicker,
  readMarketStateCache,
  refreshSymbolMetadata,
} from "../market-cache";
import { ensureSymbolMetadataCache, readSymbolMetadataCache } from "../symbol-metadata";
import type { MarketState, Ticker, TickerSort } from "../types";
import { useSocketStatus } from "./socket";
import { applyTickers, GUEST_TICKER_POLL_MS } from "./tickers";

const TICKER_ORDER_LIMIT = 100;

const TICKER_ORDER_CACHE_MS = 60_000;

// The API's largest page, so prices also cover search results below the order.
const POLLED_TICKER_LIMIT = 200;

export function useMarketState() {
  const publicStatus = useSocketStatus("public");
  return useQuery({
    queryKey: ["market-state"],
    queryFn: ({ signal }) => apiData<MarketState>("/api/v1/market", { signal }),
    initialData: readMarketStateCache,
    refetchInterval: publicStatus === "open" ? false : 15_000,
    staleTime: 10_000,
  });
}

export function useInstruments() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["instruments"],
    structuralSharing: false,
    queryFn: async () => {
      const cache = await ensureSymbolMetadataCache();
      return composeCachedInstruments(cache.symbols, queryClient);
    },
    // Read persisted data through the asynchronous query path. Seeding it
    // during render would disagree with the exported HTML on a return visit.
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * An open stream owns prices, so REST only asks for the order. Without a
 * stream, a sorted ticker page supplies both prices and order in one request.
 */
export function useTickerOrder(sort: TickerSort) {
  const queryClient = useQueryClient();
  const live = useSocketStatus("public") === "open";
  return useQuery({
    queryKey: ["ticker-order", sort, live ? "live" : "polled"],
    queryFn: async ({ signal }) => {
      if (!live) {
        const page = await apiPage<Ticker>(
          `/api/v1/market/tickers${buildQuery({ sort, limit: POLLED_TICKER_LIMIT })}`,
          { signal },
        );
        applyTickers(queryClient, page.data);
        return [...new Set(page.data.map((ticker) => ticker.symbol))].slice(0, TICKER_ORDER_LIMIT);
      }
      const page = await apiPage<string>(
        `/api/v1/market/tickers${buildQuery({
          sort,
          simple: "true",
          limit: TICKER_ORDER_LIMIT,
        })}`,
        { signal },
      );
      return [...new Set(page.data)].slice(0, TICKER_ORDER_LIMIT);
    },
    // Focus, reconnect, and remount refetches are suppressed while this cache
    // is fresh, so neither mode asks more often than its interval.
    refetchInterval: live ? TICKER_ORDER_CACHE_MS : GUEST_TICKER_POLL_MS,
    staleTime: live ? TICKER_ORDER_CACHE_MS : GUEST_TICKER_POLL_MS,
  });
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
      return applyTradePriceOverlay(composeInstrument(metadata, findCachedTicker(queryClient, metadata.symbol)));
    },
    enabled: Boolean(lookupSymbol),
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
