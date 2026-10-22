"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiData, apiPage, buildQuery, patchIdempotentData, postIdempotentData } from "../api";
import { isPositiveDecimal } from "../format";
import {
  cacheSymbolMetadata,
  composeInstrument,
  findCachedTicker,
  refreshSymbolMetadata,
} from "../market-cache";
import { withTagList } from "../symbol-metadata";
import { invalidateBatched } from "../query-batch";
import type { Issuance, IssuancePreview, ListingRequest, ManagerRequest, MarketSymbol } from "../types";

export function useIssuancePreview(symbol: string | undefined, deposit: string) {
  return useQuery({
    queryKey: ["issuance-preview", symbol, deposit],
    queryFn: ({ signal }) =>
      apiData<IssuancePreview>(
        `/api/v1/symbols/${encodeURIComponent(symbol ?? "")}/issuance-preview${buildQuery({ deposit_credit: deposit })}`,
        { signal },
      ),
    enabled: Boolean(symbol) && deposit.length > 0 && isPositiveDecimal(deposit),
    staleTime: 30_000,
    retry: false,
  });
}

export function useManagerRequests(symbol: string | undefined) {
  return useQuery({
    queryKey: ["manager-requests", symbol],
    queryFn: ({ signal }) =>
      apiPage<ManagerRequest>(
        `/api/v1/symbols/${encodeURIComponent(symbol ?? "")}/manager-transfer-requests${buildQuery({ limit: 50 })}`,
        { signal },
      ),
    enabled: Boolean(symbol),
    staleTime: 15_000,
  });
}

export function useCreateListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ListingRequest) =>
      withTagList(await postIdempotentData<MarketSymbol>("/api/v1/symbols", payload)),
    onSuccess: (symbol) => {
      cacheSymbolMetadata(queryClient, symbol);
      // Seeds the detail view the success handler navigates to.
      queryClient.setQueryData(
        ["instrument", symbol.symbol],
        composeInstrument(symbol, findCachedTicker(queryClient, symbol.symbol)),
      );
      void queryClient.invalidateQueries({ queryKey: ["instruments"] });
      invalidateBatched(queryClient, [["accounts"], ["portfolio"], ["nav"]]);
    },
  });
}

export function useUpdateMetadata(symbol: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name?: string; description?: string; tags?: string[]; icon_url?: string }) =>
      withTagList(await patchIdempotentData<MarketSymbol>(`/api/v1/symbols/${encodeURIComponent(symbol)}`, payload)),
    onSuccess: (metadata) => {
      cacheSymbolMetadata(queryClient, metadata);
      void queryClient.invalidateQueries({ queryKey: ["icon-requests", symbol] });
      void queryClient.invalidateQueries({ queryKey: ["instrument", symbol] });
      void queryClient.invalidateQueries({ queryKey: ["instruments"] });
    },
  });
}

export function useCreateIssuance(symbol: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (depositCredit: string) =>
      postIdempotentData<Issuance>(
        `/api/v1/symbols/${encodeURIComponent(symbol)}/issuances`,
        { deposit_credit: depositCredit, force: false },
      ),
    onSuccess: () => {
      // Instrument queries only re-read the local metadata cache, so the new
      // supply has to be fetched from the server.
      void refreshSymbolMetadata(queryClient, symbol);
      invalidateBatched(queryClient, [["accounts"], ["portfolio"], ["nav"]]);
      void queryClient.invalidateQueries({ queryKey: ["issuance-preview", symbol] });
    },
  });
}

export function useCreateManagerRequest(symbol: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { target_user_id: string; reason: string }) =>
      postIdempotentData<ManagerRequest>(
        `/api/v1/symbols/${encodeURIComponent(symbol)}/manager-transfer-requests`,
        payload,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["manager-requests", symbol] });
    },
  });
}

export function useRespondManagerRequest(symbol: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, decision }: { requestId: string; decision: "ACCEPT" | "REJECT" }) =>
      patchIdempotentData<ManagerRequest>(
        `/api/v1/symbols/${encodeURIComponent(symbol)}/manager-transfer-requests/${encodeURIComponent(requestId)}`,
        { decision },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["manager-requests", symbol] });
      // An accepted request changes the manager, which lives in symbol metadata.
      void refreshSymbolMetadata(queryClient, symbol);
    },
  });
}
