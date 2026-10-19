"use client";

import { useRef } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type QueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { apiPage, buildQuery } from "../api";
import { currentDisclosures } from "../disclosure-cache";
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
  const live = queryClient.getQueryData<Disclosure[]>(["public-disclosures"]) ?? [];
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

function mergeDisclosurePage(
  queryClient: QueryClient, page: Page<Disclosure>, incoming: Disclosure[], symbol?: string, type?: string,
): Page<Disclosure> {
  const data = currentDisclosures(queryClient, page.data, symbol);
  const oldest = data.at(-1)?.occurred_at;
  const rows = new Map(data.map((row) => [row.disclosure_id, row]));
  for (const row of currentDisclosures(queryClient, incoming, symbol)) {
    if (symbol && row.symbol !== symbol || type && row.type !== type) continue;
    // Older rows belong to cursor pagination, not the live head of the list.
    if (oldest && Date.parse(row.occurred_at) < Date.parse(oldest)) continue;
    rows.set(row.disclosure_id, row);
  }
  return { ...page, data: [...rows.values()].sort((a, b) =>
    Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || b.disclosure_id.localeCompare(a.disclosure_id),
  ) };
}

export function reconcileDisclosures(queryClient: QueryClient, incoming: Disclosure[], snapshot = false) {
  // Global market-state frames have no disclosure identity and are handled separately.
  const rows = currentDisclosures(queryClient, incoming.filter((row) => row.disclosure_id && row.occurred_at));
  queryClient.setQueryData<Disclosure[]>(["public-disclosures"], (old) =>
    mergeDisclosurePage(queryClient, { data: [], page: { has_more: false, next_cursor: null } },
      [...(snapshot ? [] : old ?? []), ...rows]).data.slice(0, 50),
  );
  for (const [key, current] of queryClient.getQueriesData<InfiniteData<Page<Disclosure>>>({ queryKey: ["disclosures"] })) {
    if (!current?.pages.length) continue;
    const invalidated = queryClient.getQueryState(key)?.isInvalidated;
    const symbol = key[1] === "all" ? undefined : key[1] as string;
    const type = key[2] === "all" ? undefined : key[2] as string;
    const olderIds = new Set(current.pages.slice(1).flatMap((page) => page.data.map((row) => row.disclosure_id)));
    queryClient.setQueryData(key, {
      ...current,
      pages: [mergeDisclosurePage(queryClient, current.pages[0], rows.filter((row) => !olderIds.has(row.disclosure_id)), symbol, type), ...current.pages.slice(1)],
    });
    // A partial live update cannot satisfy a requested full REST refresh.
    if (invalidated) void queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
  }
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
    void queryClient.invalidateQueries({ queryKey: ["disclosures"], refetchType: "all" });
  });
}
