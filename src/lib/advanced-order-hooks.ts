"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiData, apiPage, buildQuery, postIdempotentData } from "./api";
import { invalidateBatched } from "./query-batch";
import { invalidateMarginQueries } from "./margin";
import type {
  Order,
  OrderAmendment,
  OrderGroup,
  OrderGroupRequest,
} from "./types";
import type { PnLFilters } from "./pnl";
import { pnlQueryOptions } from "./pnl-query";
import { useSocketStatus } from "./hooks/socket";

export function usePnL(filters: PnLFilters) {
  return useInfiniteQuery(pnlQueryOptions(filters));
}
export function useOrder(orderId: string, initial?: Order) {
  const privateStatus = useSocketStatus("private");
  return useQuery({
    queryKey: ["orders", "detail", orderId],
    queryFn: ({ signal }) =>
      apiData<Order>(`/api/v1/orders/${encodeURIComponent(orderId)}`, { signal }),
    initialData: initial,
    refetchOnMount: "always",
    staleTime: 10_000,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "ACTIVATED") return 2_000;
      // Events handle live changes; this also catches silent trigger expiry.
      if (status === "PENDING")
        return privateStatus === "open" ? 60_000 : 15_000;
      return false;
    },
  });
}
export function useAmendOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      body,
    }: {
      orderId: string;
      body: OrderAmendment;
    }) =>
      postIdempotentData<{
        amended: boolean;
        order: Order;
        affected_orders: Order[];
      }>(`/api/v1/orders/${encodeURIComponent(orderId)}/amendment`, body),
    onSettled: () => {
      invalidateBatched(client, [
        ["orders"],
        ["order-groups"],
        ["portfolio"],
        ["accounts"],
        ["nav"],
      ]);
    },
  });
}
export function useCreateOrderGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: OrderGroupRequest) =>
      postIdempotentData<OrderGroup>("/api/v1/order-groups", body),
    onSuccess: () => {
      invalidateBatched(client, [
        ["orders"],
        ["order-groups"],
        ["portfolio"],
        ["accounts"],
        ["pnl"],
        ["pnl-history"],
      ]);
      invalidateMarginQueries(client);
    },
  });
}
export function useOrderGroup(groupId: string) {
  return useQuery({
    queryKey: ["order-groups", groupId],
    queryFn: ({ signal }) => apiData<OrderGroup>(`/api/v1/order-groups/${encodeURIComponent(groupId)}`, { signal }),
    staleTime: 15_000,
  });
}
export function useOrderGroupChildren(groupId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["order-groups", groupId, "children"],
    queryFn: ({ pageParam, signal }) =>
      apiPage<OrderGroup>(
        `/api/v1/order-groups/${encodeURIComponent(groupId)}/children${buildQuery({ limit: 20, cursor: pageParam })}`,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.page.has_more ? last.page.next_cursor : null,
    enabled,
  });
}
export function useCancelOrderGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) =>
      postIdempotentData<OrderGroup>(
        `/api/v1/order-groups/${encodeURIComponent(groupId)}/cancellation`,
        {},
      ),
    onSettled: () => {
      invalidateBatched(client, [
        ["orders"],
        ["order-groups"],
        ["portfolio"],
        ["accounts"],
        ["nav"],
      ]);
      invalidateMarginQueries(client);
    },
  });
}
