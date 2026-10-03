import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { readSymbolMetadataCache } from "./symbol-metadata";
import type { Disclosure, MarketSymbol, Page } from "./types";

type Listing = Pick<MarketSymbol, "symbol" | "listing_sequence" | "listed_at">;
const listingsByClient = new WeakMap<QueryClient, Map<string, Listing>>();

/** Server reads are scoped to a listing; cached socket rows must be too. */
export function currentDisclosures(
  queryClient: QueryClient, rows: Disclosure[], symbol?: string,
): Disclosure[] {
  const listings = new Map(listingsByClient.get(queryClient));
  for (const item of readSymbolMetadataCache()?.symbols ?? []) {
    const known = listings.get(item.symbol);
    if (!known || item.listing_sequence > known.listing_sequence) listings.set(item.symbol, item);
  }
  return rows.filter((row) => {
    const listing = listings.get(row.symbol || symbol || "");
    if (!listing) return true;
    const listedAt = Date.parse(listing.listed_at);
    return !Number.isFinite(listedAt) || Date.parse(row.occurred_at) >= listedAt;
  });
}

/** Drop previous-listing rows and restart pagination when metadata catches up. */
export function reconcileDisclosureListings(queryClient: QueryClient, symbols: Listing[]): void {
  let known = listingsByClient.get(queryClient);
  if (!known) {
    known = new Map();
    listingsByClient.set(queryClient, known);
  }
  const relisted = new Set<string>();
  for (const symbol of symbols) {
    const previous = known.get(symbol.symbol);
    if (previous && previous.listing_sequence > symbol.listing_sequence) continue;
    if (previous && previous.listing_sequence < symbol.listing_sequence) relisted.add(symbol.symbol);
    known.set(symbol.symbol, symbol);
  }

  const live = queryClient.getQueryData<Disclosure[]>(["public-disclosures"]);
  if (live) {
    const current = currentDisclosures(queryClient, live);
    if (current.length !== live.length) queryClient.setQueryData(["public-disclosures"], current);
  }
  for (const [key, cached] of queryClient.getQueriesData<InfiniteData<Page<Disclosure>>>({ queryKey: ["disclosures"] })) {
    if (!cached?.pages.length) continue;
    const symbol = key[1] === "all" ? undefined : key[1] as string;
    const changed = symbol ? relisted.has(symbol) : relisted.size > 0;
    const pages = cached.pages.map((page) => ({ ...page, data: currentDisclosures(queryClient, page.data, symbol) }));
    if (!changed && pages.every((page, index) => page.data.length === cached.pages[index].data.length)) continue;

    // Cancel before writing, since cancellation can restore the previous data.
    void queryClient.cancelQueries({ queryKey: key, exact: true });
    queryClient.setQueryData(key, {
      pages: [{ ...pages[0], page: { has_more: false, next_cursor: null } }],
      pageParams: [null],
    });
    void queryClient.invalidateQueries({ queryKey: key, exact: true });
  }
}
