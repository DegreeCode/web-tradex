"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiData, apiPage, buildQuery, patchIdempotentData, postIdempotentData } from "../api";
import { invalidateBatched } from "../query-batch";
import type { Page, Transfer, TransferRequest } from "../types";
import { useSocketStatus, privateStaleTime } from "./socket";

export function useTransfers(scope: "mine" | "approval" = "mine", limit = 50) {
  const privateStatus = useSocketStatus("private");
  const queryClient = useQueryClient();
  const queryKey = ["transfers", scope, limit] as const;
  const headKey = ["transfer-head", scope, limit] as const;
  const history = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      apiPage<Transfer>(`/api/v1/transfers${buildQuery({ scope, limit, cursor: pageParam })}`, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    staleTime: privateStaleTime(privateStatus),
  });
  // Poll the head independently: v5 infinite-query refetches visit every loaded
  // page. Explicit refreshes and mutation invalidations still reconcile history.
  const head = useQuery({
    queryKey: headKey,
    queryFn: async ({ signal }) => {
      const before = queryClient.getQueryData<InfiniteData<Page<Transfer>>>(queryKey)?.pages[0];
      const fresh = await apiPage<Transfer>(`/api/v1/transfers${buildQuery({ scope, limit })}`, { signal });
      queryClient.setQueryData<InfiniteData<Page<Transfer>, string | null>>(queryKey, (old) => {
        // A full refresh or a socket recovery that finished in the meantime wins.
        if (!old?.pages.length || old.pages[0] !== before) return old;
        if (!fresh.page.has_more) return { pages: [fresh], pageParams: [null] };
        const seen = new Set(fresh.data.map((transfer) => transfer.transfer_id));
        return {
          ...old,
          pages: old.pages.map((page, index) => ({
            ...page,
            ...(index === 0 && old.pages.length === 1 ? fresh : {}),
            data: index === 0
              ? [...fresh.data, ...(old.pages.length > 1 ? page.data.filter((transfer) => !seen.has(transfer.transfer_id)) : [])]
              : page.data.filter((transfer) => !seen.has(transfer.transfer_id)),
          })),
        };
      });
      return fresh;
    },
    initialData: () => history.data?.pages[0],
    initialDataUpdatedAt: history.dataUpdatedAt,
    enabled: Boolean(history.data) && privateStatus !== "open",
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: privateStatus === "open" ? false : 30_000,
    staleTime: 30_000,
  });
  const headError = head.isError && head.errorUpdatedAt >= history.dataUpdatedAt ? head.error : null;
  return {
    ...history,
    isError: history.isError || Boolean(headError),
    error: history.error ?? headError,
    refetch: async (...args: Parameters<typeof history.refetch>) => {
      await queryClient.cancelQueries({ queryKey: headKey, exact: true });
      const result = await history.refetch(...args);
      if (result.isSuccess) queryClient.setQueryData(headKey, result.data.pages[0]);
      return result;
    },
  };
}

export function useTransferDetails(transfers: Transfer[]): UseQueryResult<Transfer>[] {
  return useQueries({
    queries: transfers.map((transfer) => ({
      queryKey: ["transfer", transfer.transfer_id],
      queryFn: ({ signal }) => apiData<Transfer>(`/api/v1/transfers/${encodeURIComponent(transfer.transfer_id)}`, { signal }),
      // Settled transfers no longer change; only pending ones need refreshing.
      staleTime: transfer.status === "PENDING" ? 15_000 : Infinity,
    })),
  });
}

export function useCreateTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TransferRequest) =>
      postIdempotentData<Transfer>("/api/v1/transfers", payload),
    onSuccess: () => {
      invalidateBatched(queryClient, [["transfers"], ["accounts"], ["portfolio"], ["nav"]]);
    },
  });
}

type TransferAction = "acceptance" | "rejection" | "cancellation";

export function useTransferAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transferId, action }: { transferId: string; action: TransferAction }) => {
      if (action === "cancellation") {
        return postIdempotentData<Transfer>(
          `/api/v1/transfers/${encodeURIComponent(transferId)}/cancellation`,
          {},
        );
      }
      return patchIdempotentData<Transfer>(
        `/api/v1/transfers/${encodeURIComponent(transferId)}/recipient-decision`,
        { decision: action === "acceptance" ? "ACCEPT" : "REJECT" },
      );
    },
    onSuccess: () => {
      invalidateBatched(queryClient, [["transfers"], ["transfer"], ["accounts"], ["portfolio"], ["nav"]]);
    },
  });
}
