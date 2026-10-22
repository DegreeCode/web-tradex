"use client";

import { useRef } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type QueryClient,
  type InfiniteData,
  replaceEqualDeep,
} from "@tanstack/react-query";
import { apiPage, buildQuery } from "../api";
import { currentDisclosures, mergeDisclosurePage } from "../disclosure-cache";
import { useSignedIn } from "../session-mode";
import type { Disclosure, Page } from "../types";
import { useChannelFrames } from "./socket";

export async function loadDisclosurePage(
  queryClient: QueryClient,
  options: { symbol?: string; type?: string; limit: number; cursor?: string | null; signal?: AbortSignal },
): Promise<Page<Disclosure>> {
  const { symbol, type, limit, cursor, signal } = options;
  const path = symbol
    ? `/api/v1/market/symbols/${encodeURIComponent(symbol)}/disclosures`
    : "/api/v1/market/disclosures";
  const before = new Set(queryClient.getQueryData<Disclosure[]>(["public-disclosures"])?.map(row => row.disclosure_id));
  const response = await apiPage<Disclosure>(`${path}${buildQuery({ type, limit, cursor })}`, { signal });
  const page = { ...response, data: currentDisclosures(queryClient, response.data, symbol)
    .map(row => symbol && !row.symbol ? { ...row, symbol } : row) };
  if (cursor) return page;
  const live = currentDisclosures(queryClient, queryClient.getQueryData<Disclosure[]>(["public-disclosures"]) ?? [], symbol);
  // An empty REST page is authoritative. Only events received during this
  // request can extend it; an old socket snapshot must not fill it back in.
  return mergeDisclosurePage(queryClient, page,
    page.data.length ? live : live.filter(row => !before.has(row.disclosure_id)), symbol, type);
}

export function useDisclosures(options: { symbol?: string; type?: string; limit?: number; enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { symbol, type, limit = 30, enabled = true } = options;
  const signedIn = useSignedIn();
  return useInfiniteQuery({
    queryKey: ["disclosures", symbol ?? "all", type ?? "all", limit],
    queryFn: ({ pageParam, signal }) => loadDisclosurePage(queryClient, { symbol, type, limit, cursor: pageParam, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    // Disclosures are left out of guest browsing.
    enabled: enabled && signedIn,
    staleTime: Infinity,
    refetchInterval: false,
    // Relisting invalidates inactive lists, which reload on their next visit.
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function reconcileDisclosures(queryClient: QueryClient, incoming: Disclosure[], snapshot = false) {
  // Global market-state frames have no disclosure identity and are handled separately.
  const rows = currentDisclosures(queryClient, incoming.filter((row) => row.disclosure_id && row.occurred_at));
  const old = queryClient.getQueryData<Disclosure[]>(["public-disclosures"]);
  const live = mergeDisclosurePage(queryClient, { data: [], page: { has_more: false, next_cursor: null } },
    [...(snapshot ? [] : currentDisclosures(queryClient, old ?? [])), ...rows]).data.slice(0, 50);
  const next = replaceEqualDeep(old, live);
  if (next !== old) queryClient.setQueryData(["public-disclosures"], next);
  const symbols = new Set(rows.map(row => row.symbol));
  const types = new Set(rows.map(row => row.type));
  for (const [key, current] of queryClient.getQueriesData<InfiniteData<Page<Disclosure>>>({
    queryKey: ["disclosures"],
    predicate: ({ queryKey }) => (queryKey[1] === "all" || symbols.has(queryKey[1] as string)) &&
      (queryKey[2] === "all" || types.has(queryKey[2] as string)),
  })) {
    if (!current?.pages.length) continue;
    const invalidated = queryClient.getQueryState(key)?.isInvalidated;
    const symbol = key[1] === "all" ? undefined : key[1] as string;
    const type = key[2] === "all" ? undefined : key[2] as string;
    const olderIds = new Set(current.pages.slice(1).flatMap((page) => page.data.map((row) => row.disclosure_id)));
    const page = mergeDisclosurePage(queryClient, current.pages[0], rows.filter((row) => !olderIds.has(row.disclosure_id)), symbol, type);
    if (page === current.pages[0]) continue;
    queryClient.setQueryData(key, {
      ...current,
      pages: [page, ...current.pages.slice(1)],
    });
    // A partial live update cannot satisfy a requested full REST refresh.
    if (invalidated) void queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
  }
}

export function invalidateDisclosureQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ["disclosures"], refetchType: "active" });
}

export function useDisclosureStream(enabled = true) {
  const queryClient = useQueryClient();
  const recoveryRequested = useRef(false);
  useChannelFrames("public", enabled ? "disclosures" : null, (frame) => {
    recoveryRequested.current = false;
    if (frame.type === "snapshot" && Array.isArray(frame.data)) {
      reconcileDisclosures(queryClient, frame.data as Disclosure[], true);
    } else if (frame.type === "update" && frame.data) {
      reconcileDisclosures(queryClient, [frame.data as Disclosure]);
    }
  }, () => {
    if (recoveryRequested.current) return;
    recoveryRequested.current = true;
    void invalidateDisclosureQueries(queryClient);
  });
}
