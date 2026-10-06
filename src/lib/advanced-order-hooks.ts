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
import type { PnLEntry, PnLFilters, PnLSummary, PnLHistory } from "./pnl";

export function usePnLSummary(filters: PnLFilters) {
  return useQuery({
    queryKey: ["pnl", filters],
    queryFn: ({ signal }) =>
      apiData<PnLSummary>(`/api/v1/me/pnl${buildQuery({ ...filters })}`, {
        signal,
      }),
    staleTime: 15_000,
    retry: false,
  });
}
export function usePnLHistory(filters: PnLFilters, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["pnl-history", filters],
    queryFn: ({ pageParam, signal }) =>
      apiPage<PnLEntry>(
        `/api/v1/me/pnl/history${buildQuery({ ...filters, limit: 20, cursor: pageParam })}`,
        { signal },
      ) as Promise<PnLHistory>,
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.page.has_more ? last.page.next_cursor : null,
    enabled,
    staleTime: 15_000,
    retry: false,
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
      }>(`/api/v1/orders/${orderId}/amendment`, body),
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
    queryFn: () => apiData<OrderGroup>(`/api/v1/order-groups/${groupId}`),
    staleTime: 15_000,
  });
}
export function useOrderGroupChildren(groupId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["order-groups", groupId, "children"],
    queryFn: ({ pageParam }) =>
      apiPage<OrderGroup>(
        `/api/v1/order-groups/${groupId}/children${buildQuery({ limit: 20, cursor: pageParam })}`,
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
        `/api/v1/order-groups/${groupId}/cancellation`,
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
