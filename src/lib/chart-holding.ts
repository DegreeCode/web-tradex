"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { defaultAccountId } from "./accounts";
import type { Account, Portfolio, Position } from "./types";

export interface ChartHolding {
  averagePrice: string;
  returnPercent: number | null;
}

export function buildChartHolding(position: Position | undefined, spotPrice: string): ChartHolding | undefined {
  if (!position) return undefined;
  const quantity = Number(position.total_quantity);
  const averagePrice = Number(position.average_cost_basis);
  const cost = Number(position.cost_basis);
  const spot = Number(spotPrice);
  if (
    ![quantity, averagePrice, cost, spot].every(Number.isFinite) ||
    quantity <= 0 || averagePrice < 0 || cost < 0 || spot < 0
  ) return undefined;
  const percent = cost > 0 ? ((spot * quantity - cost) / cost) * 100 : null;
  return {
    averagePrice: position.average_cost_basis,
    returnPercent: percent !== null && Number.isFinite(percent) ? percent : null,
  };
}

/** Reads the order form's cache without mounting a fetching query observer. */
export function cachedChartPortfolio(client: QueryClient, selectedAccountId?: string): Portfolio | undefined {
  const accounts = client.getQueryData<Account[]>(["accounts"]) ?? [];
  const accountId = selectedAccountId || defaultAccountId(accounts);
  const portfolio = client.getQueryData<Portfolio>(["portfolio", accountId || "primary"]);
  if (portfolio) return portfolio;
  const primary = client.getQueryData<Portfolio>(["portfolio", "primary"]);
  return primary && (!accountId || primary.account_id === accountId) ? primary : undefined;
}

export function subscribeChartPortfolio(client: QueryClient, notify: () => void): () => void {
  return client.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey[0];
    if (key === "accounts" || key === "portfolio") notify();
  });
}

export function useCachedChartPortfolio(accountId?: string, enabled = true): Portfolio | undefined {
  const client = useQueryClient();
  const subscribe = useCallback(
    (notify: () => void) => enabled ? subscribeChartPortfolio(client, notify) : () => {},
    [client, enabled],
  );
  const getSnapshot = useCallback(
    () => enabled ? cachedChartPortfolio(client, accountId) : undefined,
    [client, accountId, enabled],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}
