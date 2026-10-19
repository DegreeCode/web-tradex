"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { apiData, apiPage, buildQuery, postIdempotentData } from "../api";
import { invalidateBatched } from "../query-batch";
import { isSignedIn } from "../session-mode";
import type { Order, OrderRequest, OrderSimulation, OrderSimulationRequest, Trade } from "../types";
import { getSocket } from "../ws";
import { useSocketStatus, usePrivateStaleTime } from "./socket";

const PAGE_SIZE = 30;

export function useOrders(limit = PAGE_SIZE, enabled = true, filters: { account_id?: string; status?: string } = {}) {
  const privateStatus = useSocketStatus("private");
  const staleTime = usePrivateStaleTime();
  return useInfiniteQuery({
    queryKey: ["orders", limit, filters],
    queryFn: ({ pageParam, signal }) =>
      apiPage<Order>(`/api/v1/orders${buildQuery({ ...filters, limit, cursor: pageParam })}`, { signal }),
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
    queryFn: ({ pageParam, signal }) =>
      apiPage<Trade>(`/api/v1/me/trades${buildQuery({ limit, cursor: pageParam })}`, { signal }),
    staleTime,
    enabled,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
  });
}

function invalidateTrading(queryClient: QueryClient) {
  // Batched with the TRADE_EXECUTED notification that usually follows.
  invalidateBatched(queryClient, [["orders"], ["order-groups"], ["portfolio"], ["my-trades"], ["accounts"], ["nav"], ["pnl"], ["pnl-history"], ["margin-positions"], ["margin-position"]]);
  if (!isSignedIn() || getSocket("public").getStatus() !== "open") {
    void queryClient.invalidateQueries({ queryKey: ["symbol-trades"] });
  }
}

/**
 * The live reference price stays out of the key so a price tick does not drop
 * a shown quote; each explicit refetch sends the price current at that moment.
 */
export function useOrderSimulation(payload: OrderSimulationRequest | null, referencePrice?: string) {
  return useQuery({
    queryKey: ["order-simulation", payload],
    queryFn: ({ signal }) =>
      apiData<OrderSimulation>("/api/v1/orders/simulation", {
        method: "POST",
        body: payload && referencePrice ? { ...payload, slippage_reference_price: referencePrice } : payload,
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
      postIdempotentData<Order>(`/api/v1/orders/${encodeURIComponent(orderId)}/cancellation`, {}),
    onSuccess: () => invalidateTrading(queryClient),
  });
}
