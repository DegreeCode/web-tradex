"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiData, apiPage, buildQuery, deleteData, postIdempotentData } from "../api";
import type { Account, Nav, NavPoint, NavRange, Portfolio, Position } from "../types";
import { usePrivateStaleTime, useSocketStatus, privateStaleTime } from "./socket";

export function useAccounts(enabled = true) {
  const staleTime = usePrivateStaleTime();
  return useQuery({
    queryKey: ["accounts"],
    queryFn: ({ signal }) => apiData<Account[]>("/api/v1/me/accounts", { signal }),
    staleTime,
    enabled,
  });
}

export function usePortfolio(accountId?: string, enabled = true) {
  const staleTime = usePrivateStaleTime();
  return useQuery({
    staleTime,
    queryKey: ["portfolio", accountId ?? "primary"],
    queryFn: ({ signal }) =>
      apiData<Portfolio>(
        accountId ? `/api/v1/me/accounts/${encodeURIComponent(accountId)}/portfolio` : "/api/v1/me/portfolio",
        { signal },
      ),
    enabled,
  });
}

function combinePortfolios(results: UseQueryResult<Portfolio>[]) {
  return {
    portfolios: results.map((result) => result.data).filter((value): value is Portfolio => Boolean(value)),
    isLoading: results.some((result) => result.isLoading),
    error: results.find((result) => result.isError)?.error ?? null,
  };
}

export function useAllPortfolios() {
  const accounts = useAccounts();
  const queryClient = useQueryClient();
  const staleTime = usePrivateStaleTime();
  const accountIds = (accounts.data ?? []).map((account) => account.account_id);
  const results = useQueries({
    queries: accountIds.map((accountId) => ({
      queryKey: ["portfolio", accountId],
      queryFn: ({ signal }) => apiData<Portfolio>(`/api/v1/me/accounts/${encodeURIComponent(accountId)}/portfolio`, { signal }),
      staleTime,
    })),
    combine: combinePortfolios,
  });
  return {
    accounts: accounts.data ?? [],
    portfolios: results.portfolios,
    isLoading: accounts.isLoading || results.isLoading,
    error: accounts.error ?? results.error,
    refetch: () => {
      void accounts.refetch();
      for (const accountId of accountIds) {
        void queryClient.refetchQueries({ queryKey: ["portfolio", accountId], exact: true });
      }
    },
  };
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postIdempotentData<Account>("/api/v1/me/accounts", {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => deleteData<{ status: string }>(`/api/v1/me/accounts/${encodeURIComponent(accountId)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}

export function findPosition(portfolio: Portfolio | undefined, symbol: string): Position | undefined {
  return portfolio?.positions.find((position) => position.symbol === symbol);
}

export function useNav() {
  const privateStatus = useSocketStatus("private");
  return useQuery({
    queryKey: ["nav"],
    queryFn: ({ signal }) => apiData<Nav>("/api/v1/me/nav", { signal }),
    refetchInterval: privateStatus === "open" ? false : 30_000,
    staleTime: privateStaleTime(privateStatus),
  });
}

function useNavHistoryQuery(range: NavRange, path: string, scope: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["nav-history", scope, range],
    queryFn: ({ pageParam, signal }) =>
      apiPage<NavPoint>(`${path}${buildQuery({ range, limit: 500, cursor: pageParam })}`, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    enabled,
  });
}

export function useNavHistory(range: NavRange, enabled = true) {
  return useNavHistoryQuery(range, "/api/v1/me/nav/history", "user", enabled);
}

export function useAccountPortfolioHistory(accountId: string | undefined, range: NavRange) {
  return useNavHistoryQuery(
    range,
    `/api/v1/me/accounts/${encodeURIComponent(accountId ?? "")}/portfolio/history`,
    accountId ?? "unknown",
    Boolean(accountId),
  );
}
