"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiData, apiPage, buildQuery, patchIdempotentData, postIdempotentData } from "../api";
import type { Transfer, TransferRequest } from "../types";
import { useSocketStatus, privateStaleTime } from "./socket";

export function useTransfers(scope: "mine" | "approval" = "mine", limit = 50) {
  const privateStatus = useSocketStatus("private");
  return useInfiniteQuery({
    queryKey: ["transfers", scope, limit],
    queryFn: ({ pageParam, signal }) =>
      apiPage<Transfer>(`/api/v1/transfers${buildQuery({ scope, limit, cursor: pageParam })}`, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    refetchInterval: privateStatus === "open" ? false : 30_000,
    staleTime: privateStaleTime(privateStatus),
  });
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
      void queryClient.invalidateQueries({ queryKey: ["transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
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
      void queryClient.invalidateQueries({ queryKey: ["transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["transfer"] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      void queryClient.invalidateQueries({ queryKey: ["nav"] });
    },
  });
}
