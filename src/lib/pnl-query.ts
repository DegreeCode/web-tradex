import { infiniteQueryOptions } from "@tanstack/react-query";
import { apiData, apiPage, buildQuery } from "./api";
import type { PnLEntry, PnLFilters, PnLHistory, PnLSummary } from "./pnl";

export type PnLPage = PnLHistory & {
  summary?: PnLSummary;
  historyError?: unknown;
};
type PnLPageParam = { cursor: string; as_of: string } | null;

/** One cache entry owns the summary and its ledger; returned cutoffs never change the key. */
export function pnlQueryOptions(filters: PnLFilters) {
  return infiniteQueryOptions({
    queryKey: ["pnl", "snapshot", filters] as const,
    initialPageParam: null as PnLPageParam,
    queryFn: async ({ pageParam, signal }): Promise<PnLPage> => {
      const summary = pageParam
        ? undefined
        : await apiData<PnLSummary>(
            `/api/v1/me/pnl${buildQuery({ ...filters })}`,
            { signal },
          );
      const asOf = pageParam?.as_of ?? summary!.as_of;
      try {
        const history = (await apiPage<PnLEntry>(
          `/api/v1/me/pnl/history${buildQuery({ ...filters, as_of: asOf, limit: 20, cursor: pageParam?.cursor })}`,
          { signal },
        )) as PnLHistory;
        return { ...history, ...(summary ? { summary } : {}) };
      } catch (error) {
        // Keep a valid total visible when its first history page fails. Explicit
        // filter/session cancellation still aborts the request and stores nothing.
        if (!summary || signal.aborted) throw error;
        return {
          summary,
          historyError: error,
          data: [],
          page: { has_more: false, next_cursor: null },
          as_of: summary.as_of,
          market_type: summary.market_type,
        };
      }
    },
    getNextPageParam: (last) =>
      last.page.has_more && last.page.next_cursor
        ? { cursor: last.page.next_cursor, as_of: last.as_of }
        : null,
    staleTime: 15_000,
    retry: false,
  });
}
