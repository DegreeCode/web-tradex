"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
  type InfiniteData,
} from "@tanstack/react-query";

import {
  ApiError,
  apiData,
  apiPage,
  buildQuery,
  csrfToken,
  deleteData,
  patchIdempotentData,
  postData,
  postIdempotentData,
} from "./api";
import {
  appendCandleHistoryWithGaps,
  applyTradeToCandlePage,
  fillCandleGaps,
  mergeCandles,
  type CandlePage,
} from "./candle-data";
import {
  candleFetchTrades,
  candleRuntime,
  candleTradeRuntimes,
  rememberTradeSequence,
  requestCandleRecovery,
  updateCachedCandleQueries,
  type CandleTradeRuntime,
} from "./candle-cache";
import { isPositiveDecimal } from "./format";
import { currentDisclosures } from "./disclosure-cache";
import { invalidateMarginQueries } from "./margin";
import {
  MARKET_STATE_CACHE_KEY,
  applySymbolMetadataCache,
  applySymbolMetadataDelta,
  applySymbolTradingState,
  applyTradePriceOverlay,
  applyTradingNotification,
  cacheSymbolMetadata,
  canonicalSymbol,
  clearTradePriceOverlay,
  composeCachedInstruments,
  composeInstrument,
  findCachedTicker,
  isMarketState,
  noteMarketStateTime,
  noteSymbolMetadataTimes,
  readMarketStateCache,
  refreshSymbolMetadata,
  updateTradePriceOverlay,
  writeMarketStateCache,
} from "./market-cache";
import {
  isNotification,
  markNotificationsReadInCaches,
  notificationFromPrivateFrame,
  updateNotificationCaches,
} from "./notification-cache";
import { eventKeyFromTitle, parseNotificationBody } from "./notifications";
import { invalidateBatched } from "./query-batch";
import { isSignedIn, useSignedIn } from "./session-mode";
import {
  SYMBOL_METADATA_CACHE_KEY,
  SYMBOL_METADATA_SYNC_MS,
  adoptSymbolMetadataCache,
  clearSymbolMetadataCache,
  ensureSymbolMetadataCache,
  fetchAllPages,
  isInitialSymbolMetadataValidationDone,
  parseSymbolMetadataCache,
  readSymbolMetadataCache,
  runInitialSymbolMetadataValidation,
  runSymbolMetadataSync,
  withTagList,
  type SymbolMetadataCache,
} from "./symbol-metadata";
import type {
  Account,
  Candle,
  CandleInterval,
  Disclosure,
  Inquiry,
  InquiryCategory,
  InquiryDetail,
  InquiryMessage,
  Instrument,
  InstrumentState,
  Issuance,
  IssuancePreview,
  ListingRequest,
  ManagerRequest,
  MarketSymbol,
  MarketState,
  Nav,
  NavPoint,
  NavRange,
  Notification,
  Order,
  OrderRequest,
  OrderSimulation,
  OrderSimulationRequest,
  Page,
  Passkey,
  Portfolio,
  Position,
  PublicTrade,
  RealizedPnL,
  SessionList,
  Trade,
  Transfer,
  TransferRequest,
  Ticker,
  TickerSort,
  User,
  WsFrame,
} from "./types";
import { closeSocket, getSocket, type StreamSocket, type WsKind, type WsStatus } from "./ws";

const PAGE_SIZE = 30;
const TICKER_ORDER_LIMIT = 100;
const TICKER_ORDER_CACHE_MS = 60_000;
// A guest's market screens poll one ticker request every 5 seconds: 12 of the
// 60 anonymous requests a minute, leaving room for trades, candles, metadata
// sync and a second tab.
const GUEST_TICKER_POLL_MS = 5_000;
// The API's largest page, so prices also cover search results below the order.
const POLLED_TICKER_LIMIT = 200;

/**
 * The CSRF cookie is issued and cleared together with the session cookie, so
 * without it there is no session to ask about and a guest never calls /me.
 */
export function fetchMe(): Promise<User | null> {
  if (!csrfToken()) return Promise.resolve(null);
  return apiData<User>("/api/v1/me");
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });
}

export function useMarketState() {
  const publicStatus = useSocketStatus("public");
  return useQuery({
    queryKey: ["market-state"],
    queryFn: () => apiData<MarketState>("/api/v1/market"),
    initialData: readMarketStateCache,
    refetchInterval: publicStatus === "open" ? false : 15_000,
    staleTime: 10_000,
  });
}

/** A guest never opens a socket, so its streams stay closed and REST stands in. */
function useSocketStatus(kind: WsKind): WsStatus {
  const signedIn = useSignedIn();
  const socket = signedIn ? getSocket(kind) : null;
  const subscribe = useCallback(
    (notify: () => void) => socket?.onStatus(() => notify()) ?? (() => {}),
    [socket],
  );
  const getSnapshot = useCallback((): WsStatus => socket?.getStatus() ?? "closed", [socket]);
  const getServerSnapshot = useCallback((): WsStatus => "closed", []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Private events invalidate account data as it changes, so while that socket
// is open a focus or remount only re-asks the server once this has passed.
const PRIVATE_LIVE_STALE_MS = 60_000;
const PRIVATE_POLLED_STALE_MS = 10_000;

function privateStaleTime(status: WsStatus): number {
  return status === "open" ? PRIVATE_LIVE_STALE_MS : PRIVATE_POLLED_STALE_MS;
}

function usePrivateStaleTime(): number {
  return privateStaleTime(useSocketStatus("private"));
}

export function useInstruments() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["instruments"],
    queryFn: async () => {
      const cache = await ensureSymbolMetadataCache();
      return composeCachedInstruments(cache.symbols, queryClient);
    },
    initialData: () => {
      const cached = readSymbolMetadataCache();
      return cached ? composeCachedInstruments(cached.symbols, queryClient) : undefined;
    },
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * The server-defined ticker order. Signed in, only the order is fetched and
 * prices stay on the WS cache. A guest has no stream, so one sorted page with
 * full tickers is polled instead and carries both the order and the prices.
 */
export function useTickerOrder(sort: TickerSort) {
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: ["ticker-order", sort, signedIn ? "live" : "polled"],
    queryFn: async () => {
      if (!signedIn) {
        const page = await apiPage<Ticker>(
          `/api/v1/market/tickers${buildQuery({ sort, limit: POLLED_TICKER_LIMIT })}`,
        );
        applyTickers(queryClient, page.data);
        return [...new Set(page.data.map((ticker) => ticker.symbol))].slice(0, TICKER_ORDER_LIMIT);
      }
      const page = await apiPage<string>(
        `/api/v1/market/tickers${buildQuery({
          sort,
          simple: "true",
          limit: TICKER_ORDER_LIMIT,
        })}`,
      );
      return [...new Set(page.data)].slice(0, TICKER_ORDER_LIMIT);
    },
    // Focus, reconnect, and remount refetches are suppressed while this cache
    // is fresh, so neither mode asks more often than its interval.
    refetchInterval: signedIn ? TICKER_ORDER_CACHE_MS : GUEST_TICKER_POLL_MS,
    staleTime: signedIn ? TICKER_ORDER_CACHE_MS : GUEST_TICKER_POLL_MS,
  });
}

export function useInstrument(symbol: string | undefined) {
  const queryClient = useQueryClient();
  const lookupSymbol = canonicalSymbol(symbol);
  return useQuery({
    queryKey: ["instrument", lookupSymbol],
    queryFn: async () => {
      const cache = await ensureSymbolMetadataCache();
      let metadata = cache.symbols.find((item) => item.symbol === lookupSymbol);
      if (!metadata && lookupSymbol) {
        // The shared cache only syncs once a minute, so a symbol listed since
        // then (e.g. opened from a shared link) is looked up directly once.
        await refreshSymbolMetadata(queryClient, lookupSymbol);
        metadata = readSymbolMetadataCache()?.symbols.find((item) => item.symbol === lookupSymbol);
      }
      if (!metadata) {
        throw new ApiError(404, "NOT_FOUND", "종목을 찾을 수 없어요");
      }
      return applyTradePriceOverlay(composeInstrument(metadata, findCachedTicker(queryClient, metadata.symbol)));
    },
    enabled: Boolean(lookupSymbol),
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useSymbolTrades(symbol: string | undefined, limit = 150) {
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();
  const publicStatus = useSocketStatus("public");
  // Public snapshots/updates own this cache while connected, and a guest's
  // polled ticker refetches it when a trade happens. Neither should race that
  // with a timer, focus or mount refetch.
  const pushed = publicStatus === "open" || !signedIn;
  return useQuery({
    queryKey: ["symbol-trades", symbol, limit],
    queryFn: async () => {
      const page = await apiPage<PublicTrade>(
        `/api/v1/market/symbols/${encodeURIComponent(symbol ?? "")}/trades${buildQuery({ limit })}`,
      );
      if (!signedIn && symbol) applyPolledTrades(queryClient, symbol, page.data);
      return page;
    },
    enabled: Boolean(symbol),
    refetchInterval: pushed ? false : 5_000,
    staleTime: pushed ? Infinity : 3_000,
    refetchOnWindowFocus: !pushed,
    refetchOnReconnect: !pushed,
    refetchOnMount: !pushed,
  });
}

// The last polled ticker state per symbol, so a remounted detail view still
// notices trades that happened while it was away.
const polledTickerMarks = new Map<string, string>();

/**
 * A guest's symbol view has no stream: its ticker is polled every 5 seconds,
 * and trades (and through them the candles) are refetched only when the
 * ticker shows a new trade, so a quiet symbol costs one request per poll.
 */
export function usePolledSymbolTicker(symbol: string | undefined, limit = 150) {
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();
  const { data: ticker } = useQuery({
    queryKey: ["ticker", symbol],
    queryFn: async () => {
      const row = await apiData<Ticker>(`/api/v1/market/tickers/${encodeURIComponent(symbol ?? "")}`);
      applyTickers(queryClient, [row]);
      return row;
    },
    enabled: Boolean(symbol) && !signedIn,
    refetchInterval: GUEST_TICKER_POLL_MS,
    staleTime: GUEST_TICKER_POLL_MS,
  });

  useEffect(() => {
    if (!symbol || !ticker || signedIn) return;
    const mark = `${ticker.window_start}:${ticker.trade_count}:${ticker.last_price}`;
    const previous = polledTickerMarks.get(symbol);
    polledTickerMarks.set(symbol, mark);
    if (previous === undefined || previous === mark) return;
    // Joins a trades fetch that is already running (e.g. the first one on mount).
    void queryClient.invalidateQueries(
      { queryKey: ["symbol-trades", symbol, limit], exact: true },
      { cancelRefetch: false },
    );
  }, [limit, queryClient, signedIn, symbol, ticker]);
}

export function useOrders(limit = PAGE_SIZE, enabled = true) {
  const privateStatus = useSocketStatus("private");
  const staleTime = usePrivateStaleTime();
  return useInfiniteQuery({
    queryKey: ["orders", limit],
    queryFn: ({ pageParam }) =>
      apiPage<Order>(`/api/v1/orders${buildQuery({ limit, cursor: pageParam })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    // Fills arrive over the private socket; a slow poll only catches silent
    // trigger expiry while a trigger order is still waiting.
    refetchInterval: (query) =>
      privateStatus !== "open"
        ? 15_000
        : query.state.data?.pages.some((page) =>
              page.data.some((order) => order.order_type === "TRIGGER" && order.status === "PENDING"),
            )
          ? 60_000
          : false,
    staleTime,
    enabled,
  });
}

export function useMyTrades(limit = PAGE_SIZE, enabled = true) {
  const staleTime = usePrivateStaleTime();
  return useInfiniteQuery({
    queryKey: ["my-trades", limit],
    queryFn: ({ pageParam }) =>
      apiPage<Trade>(`/api/v1/me/trades${buildQuery({ limit, cursor: pageParam })}`),
    staleTime,
    enabled,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
  });
}

export function useRealizedPnL(limit = PAGE_SIZE) {
  const staleTime = usePrivateStaleTime();
  return useInfiniteQuery({
    queryKey: ["realized-pnl", limit],
    staleTime,
    queryFn: ({ pageParam }) =>
      apiPage<RealizedPnL>(`/api/v1/me/realized-pnl${buildQuery({ limit, cursor: pageParam })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
  });
}

export function useAccounts() {
  const staleTime = usePrivateStaleTime();
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiData<Account[]>("/api/v1/me/accounts"),
    staleTime,
  });
}

export function usePortfolio(accountId?: string, enabled = true) {
  const staleTime = usePrivateStaleTime();
  return useQuery({
    staleTime,
    queryKey: ["portfolio", accountId ?? "primary"],
    queryFn: () =>
      apiData<Portfolio>(
        accountId ? `/api/v1/me/accounts/${accountId}/portfolio` : "/api/v1/me/portfolio",
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
      queryFn: () => apiData<Portfolio>(`/api/v1/me/accounts/${accountId}/portfolio`),
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

export function useSessions() {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: () => apiData<SessionList>("/api/v1/me/sessions?limit=50"),
    staleTime: 15_000,
  });
}

export function usePasskeys(enabled = true) {
  return useQuery({
    queryKey: ["passkeys"],
    queryFn: () => apiData<Passkey[]>("/api/v1/me/passkeys"),
    enabled,
    staleTime: 15_000,
  });
}

export function useTransfers(scope: "mine" | "approval" = "mine", limit = 50) {
  const privateStatus = useSocketStatus("private");
  return useInfiniteQuery({
    queryKey: ["transfers", scope, limit],
    queryFn: ({ pageParam }) =>
      apiPage<Transfer>(`/api/v1/transfers${buildQuery({ scope, limit, cursor: pageParam })}`),
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
      queryFn: () => apiData<Transfer>(`/api/v1/transfers/${transfer.transfer_id}`),
      // Settled transfers no longer change; only pending ones need refreshing.
      staleTime: transfer.status === "PENDING" ? 15_000 : Infinity,
    })),
  });
}

export function useIssuancePreview(symbol: string | undefined, deposit: string) {
  return useQuery({
    queryKey: ["issuance-preview", symbol, deposit],
    queryFn: () =>
      apiData<IssuancePreview>(
        `/api/v1/symbols/${encodeURIComponent(symbol ?? "")}/issuance-preview${buildQuery({ deposit_credit: deposit })}`,
      ),
    enabled: Boolean(symbol) && deposit.length > 0 && isPositiveDecimal(deposit),
    staleTime: 30_000,
    retry: false,
  });
}

export function useManagerRequests(symbol: string | undefined) {
  return useQuery({
    queryKey: ["manager-requests", symbol],
    queryFn: () =>
      apiPage<ManagerRequest>(
        `/api/v1/symbols/${encodeURIComponent(symbol ?? "")}/manager-transfer-requests${buildQuery({ limit: 50 })}`,
      ),
    enabled: Boolean(symbol),
    staleTime: 15_000,
  });
}

function invalidateTrading(queryClient: QueryClient) {
  // Batched with the TRADE_EXECUTED notification that usually follows.
  invalidateBatched(queryClient, [["orders"], ["portfolio"], ["my-trades"]]);
  if (!isSignedIn() || getSocket("public").getStatus() !== "open") {
    void queryClient.invalidateQueries({ queryKey: ["symbol-trades"] });
  }
}

/**
 * The live reference price stays out of the key so a price tick does not drop
 * a shown quote; each explicit refetch sends the price current at that moment.
 */
export function useOrderSimulation(payload: OrderSimulationRequest | null, referencePrice?: string) {
  return useQuery({
    queryKey: ["order-simulation", payload],
    queryFn: ({ signal }) =>
      apiData<OrderSimulation>("/api/v1/orders/simulation", {
        method: "POST",
        body: payload && referencePrice ? { ...payload, slippage_reference_price: referencePrice } : payload,
        signal,
      }),
    // Quotes are requested explicitly and never reused after the inputs change.
    enabled: false,
    gcTime: 0,
    retry: false,
  });
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: OrderRequest) =>
      postIdempotentData<Order>("/api/v1/orders", payload),
    onSuccess: () => invalidateTrading(queryClient),
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      postIdempotentData<Order>(`/api/v1/orders/${orderId}/cancellation`, {}),
    onSuccess: () => invalidateTrading(queryClient),
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
          `/api/v1/transfers/${transferId}/cancellation`,
          {},
        );
      }
      return patchIdempotentData<Transfer>(
        `/api/v1/transfers/${transferId}/recipient-decision`,
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
    mutationFn: (accountId: string) => deleteData<{ status: string }>(`/api/v1/me/accounts/${accountId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}

export function useRevokeSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionIds: string[]) =>
      postData<{ revoked_count: number; current_revoked: boolean }>(
        "/api/v1/me/sessions/revoke",
        { session_ids: sessionIds },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useRevokeAllSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      postData<{ revoked_count: number; current_revoked: boolean }>(
        "/api/v1/me/sessions/revoke-all",
        {},
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useDeletePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (passkeyId: string) =>
      deleteData<{ status: string }>(`/api/v1/me/passkeys/${passkeyId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
    },
  });
}

export function useRotateRecoveryKeys() {
  return useMutation({
    mutationFn: () =>
      postData<{ recovery_keys: string[] }>(
        "/api/v1/me/recovery-keys/rotate",
        {},
      ),
  });
}

/**
 * Drops everything cached under the current session except the observed auth
 * query, so the next account never sees the previous one's data.
 */
export async function clearSessionCache(queryClient: QueryClient): Promise<void> {
  const notMe = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== "me";
  closeSocket("private");
  await queryClient.cancelQueries({ predicate: notMe });
  queryClient.removeQueries({ predicate: notMe });
  queryClient.getMutationCache().clear();
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postData<{ status: string }>("/api/v1/auth/logout", {}),
    onSettled: async () => {
      await queryClient.cancelQueries({ queryKey: ["me"], exact: true });
      // Keep the observed auth query so AuthProvider receives the anonymous
      // state before navigation, even when the logout request failed.
      queryClient.setQueryData(["me"], null);
      await clearSessionCache(queryClient);
    },
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
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}

export function useUpdateMetadata(symbol: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name?: string; description?: string; tags?: string[]; icon_url?: string }) =>
      withTagList(await patchIdempotentData<MarketSymbol>(`/api/v1/symbols/${symbol}`, payload)),
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
        `/api/v1/symbols/${symbol}/issuances`,
        { deposit_credit: depositCredit, force: false },
      ),
    onSuccess: () => {
      // Instrument queries only re-read the local metadata cache, so the new
      // supply has to be fetched from the server.
      void refreshSymbolMetadata(queryClient, symbol);
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      void queryClient.invalidateQueries({ queryKey: ["issuance-preview", symbol] });
    },
  });
}

export function useCreateManagerRequest(symbol: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { target_user_id: string; reason: string }) =>
      postIdempotentData<ManagerRequest>(
        `/api/v1/symbols/${symbol}/manager-transfer-requests`,
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
        `/api/v1/symbols/${symbol}/manager-transfer-requests/${requestId}`,
        { decision },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["manager-requests", symbol] });
      // An accepted request changes the manager, which lives in symbol metadata.
      void refreshSymbolMetadata(queryClient, symbol);
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
    queryFn: () => apiData<Nav>("/api/v1/me/nav"),
    refetchInterval: privateStatus === "open" ? false : 30_000,
    staleTime: privateStaleTime(privateStatus),
  });
}

function useNavHistoryQuery(range: NavRange, path: string, scope: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["nav-history", scope, range],
    queryFn: ({ pageParam }) =>
      apiPage<NavPoint>(`${path}${buildQuery({ range, limit: 500, cursor: pageParam })}`),
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
    `/api/v1/me/accounts/${accountId ?? ""}/portfolio/history`,
    accountId ?? "unknown",
    Boolean(accountId),
  );
}

export function useCandles(
  symbol: string | undefined,
  interval: CandleInterval,
  limit = 200,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const queryKey = ["candles", symbol, interval, limit] as const;
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const current = queryClient.getQueryData<CandlePage>(queryKey);
      // Synthetic clock ticks are not evidence that we received real candles.
      const from = current?.data.find((candle) => !candle.synthetic)?.timestamp;
      const to = new Date().toISOString();
      const pending: PublicTrade[] = [];
      const fetchKey = JSON.stringify(queryKey);
      candleFetchTrades.set(fetchKey, pending);
      try {
        let cursor: string | undefined;
        let fetched: Candle[] = [];
        let page: Page<Candle>;
        do {
          page = await apiPage<Candle>(
            `/api/v1/market/symbols/${encodeURIComponent(symbol ?? "")}/candles${buildQuery({
              interval, limit, from, to, cursor,
            })}`,
          );
          fetched = mergeCandles(fetched, page.data);
          cursor = from && page.page.has_more ? page.page.next_cursor ?? undefined : undefined;
        } while (cursor);
        // Keep the older-history cursor: this request only advances the newest end.
        const latest = queryClient.getQueryData<CandlePage>(queryKey);
        const real = mergeCandles(latest?.data.filter((candle) => !candle.synthetic) ?? [], fetched);
        let result: CandlePage = {
          data: mergeCandles(
            latest?.data.filter((candle) => from && Date.parse(candle.timestamp) < Date.parse(from)) ?? [],
            mergeCandles(real, fillCandleGaps(real, interval, limit, to).data),
          ),
          page: from && latest ? latest.page : page.page,
          historyLoaded: latest?.historyLoaded || real.length > limit,
          syncedThrough: to,
        };
        // REST includes trades before `to`. Replay only the later WS events,
        // otherwise the open bucket's volume and trade count would be doubled.
        for (const trade of pending) {
          if (Date.parse(trade.timestamp) < Date.parse(to)) continue;
          const applied = applyTradeToCandlePage(result, interval, limit, trade);
          if (applied.data) result = { ...result, data: applied.data };
        }
        return result;
      } finally {
        if (candleFetchTrades.get(fetchKey) === pending) candleFetchTrades.delete(fetchKey);
      }
    },
    enabled: Boolean(symbol) && enabled,
    // Keep the chart mounted during interval loads, never across symbols.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === symbol ? previousData : undefined,
    // Re-entering an interval or returning to the tab catches up the cached tail.
    // There is no polling; trades keep an already mounted chart live.
    staleTime: 0,
    refetchInterval: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    retry: false,
  });

  useEffect(() => {
    if (!symbol || !enabled || !query.isSuccess || query.isFetching) return;
    const runtime = candleTradeRuntimes.get(symbol);
    if (!runtime || runtime.recoveryInFlight || runtime.awaitingSnapshotRecovery) return;
    if (runtime.pendingSequences.size === 0) return;
    requestCandleRecovery(queryClient, symbol, runtime);
  }, [enabled, query.dataUpdatedAt, query.isFetching, query.isSuccess, queryClient, symbol]);

  const older = useMutation({
    mutationKey: ["older-candles", symbol, interval, limit],
    mutationFn: (request: { symbol: string; interval: CandleInterval; limit: number; cursor: string }) =>
      apiPage<Candle>(
        `/api/v1/market/symbols/${encodeURIComponent(request.symbol)}/candles${buildQuery({
          interval: request.interval,
          limit: request.limit,
          cursor: request.cursor,
        })}`,
      ),
    onSuccess: (page, request) => {
      queryClient.setQueryData<CandlePage>(
        ["candles", request.symbol, request.interval, request.limit],
        (current) => {
          // A replaced bootstrap or another completed request owns its cursor.
          if (!current || current.page.next_cursor !== request.cursor) return current;
          return appendCandleHistoryWithGaps(current, page, request.interval);
        },
      );
    },
    retry: false,
  });
  const olderIsCurrent = older.variables?.symbol === symbol && older.variables?.interval === interval;
  const isLoadingOlder = olderIsCurrent && older.isPending;
  const hasOlder = Boolean(
    enabled && !query.isPlaceholderData && !query.isFetching &&
    query.data?.page.has_more && query.data.page.next_cursor,
  );
  const loadOlder = () => {
    const cursor = query.data?.page.next_cursor;
    if (!symbol || !cursor || !hasOlder || queryClient.isMutating({
      mutationKey: ["older-candles", symbol, interval, limit], exact: true,
    })) return;
    older.mutate({ symbol, interval, limit, cursor });
  };

  return {
    ...query,
    hasOlder,
    isLoadingOlder,
    olderError: olderIsCurrent && older.isError ? older.error : null,
    loadOlder,
  };
}

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
  return useInfiniteQuery({
    queryKey: ["disclosures", symbol ?? "all", type ?? "all", limit],
    queryFn: ({ pageParam, signal }) => loadDisclosurePage(queryClient, { symbol, type, limit, cursor: pageParam, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    enabled,
    staleTime: Infinity,
    refetchInterval: false,
    // Relisting invalidates inactive lists, which reload on their next visit.
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useNotifications(options: { unread?: boolean; limit?: number } = {}) {
  const { unread = false, limit = 30 } = options;
  return useInfiniteQuery({
    queryKey: ["notifications", "list", unread ? "unread" : "all", limit],
    queryFn: ({ pageParam }) =>
      apiPage<Notification>(
        `/api/v1/notifications${buildQuery({
          sort: "pinned",
          unread: unread ? "true" : undefined,
          limit,
          cursor: pageParam,
        })}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useUnreadNotifications(enabled = true) {
  return useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () =>
      apiPage<Notification>(`/api/v1/notifications${buildQuery({ sort: "pinned", unread: "true", limit: 50 })}`),
    enabled,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      postData<Notification>(`/api/v1/notifications/${notificationId}/read`, {}),
    onSuccess: (notification, notificationId) => {
      if (isNotification(notification)) updateNotificationCaches(queryClient, notification);
      else markNotificationsReadInCaches(queryClient, new Set([notificationId]));
    },
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationIds: string[]) =>
      postData<{ read_count: number }>("/api/v1/notifications/read-batch", {
        notification_ids: notificationIds,
      }),
    onSuccess: (_result, notificationIds) =>
      markNotificationsReadInCaches(queryClient, new Set(notificationIds)),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiData<{ read_count: number }>("/api/v1/notifications/read-all", { method: "POST" }),
    onSuccess: () => markNotificationsReadInCaches(queryClient, "all"),
  });
}

export function useInquiries(limit = 30) {
  const privateStatus = useSocketStatus("private");
  return useInfiniteQuery({
    queryKey: ["inquiries", limit],
    queryFn: ({ pageParam }) =>
      apiPage<Inquiry>(`/api/v1/inquiries${buildQuery({ limit, cursor: pageParam })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    refetchInterval: privateStatus === "open" ? false : 60_000,
    staleTime: privateStaleTime(privateStatus),
  });
}

export function useInquiry(ticket: string | null) {
  return useQuery({
    queryKey: ["inquiry", ticket],
    queryFn: () => apiData<InquiryDetail>(`/api/v1/inquiries/${ticket}`),
    enabled: Boolean(ticket),
  });
}

export function useCreateInquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { category: InquiryCategory; subject: string; body: string }) =>
      postData<Inquiry>("/api/v1/inquiries", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inquiries"] });
    },
  });
}

export function useReplyInquiry(ticket: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      postData<InquiryMessage>(`/api/v1/inquiries/${ticket}/messages`, { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inquiry", ticket] });
      void queryClient.invalidateQueries({ queryKey: ["inquiries"] });
    },
  });
}

export function useResolveInquiry(ticket: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      postData<{ status: string }>(`/api/v1/inquiries/${ticket}/resolution`, {
        status: "RESOLVED",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inquiry", ticket] });
      void queryClient.invalidateQueries({ queryKey: ["inquiries"] });
    },
  });
}

function useChannelFrames(
  kind: WsKind,
  channel: string | null,
  handler: (frame: WsFrame) => void,
  onGap?: () => void,
) {
  const handlerRef = useRef(handler);
  const gapRef = useRef(onGap);
  const signedIn = useSignedIn();
  useEffect(() => {
    handlerRef.current = handler;
    gapRef.current = onGap;
  }, [handler, onGap]);

  useEffect(() => {
    if (!channel || !signedIn) return;
    const socket = getSocket(kind);
    const off = socket.onFrame((frame) => {
      if (frame.stream === channel) handlerRef.current(frame);
    });
    const offGap = socket.onGap((stream) => {
      if (stream === channel || stream === kind) gapRef.current?.();
    });
    socket.subscribe(channel);
    return () => {
      off();
      offGap();
      socket.unsubscribe(channel);
    };
  }, [kind, channel, signedIn]);
}

type LiveTicker = Ticker & { deleted?: boolean };

/**
 * Writes tickers into the ticker cache and every instrument view. A snapshot
 * replaces the cache; anything else (stream updates, polled pages) merges.
 */
export function applyTickers(queryClient: QueryClient, rows: LiveTicker[], snapshot = false): void {
  const changed = new Map(rows.map((ticker) => [ticker.symbol, ticker]));
  queryClient.setQueryData<Ticker[]>(["ticker-cache"], (old) => {
    if (snapshot || !old) return rows.filter((ticker) => !ticker.deleted);
    const known = new Set<string>();
    const next = old.flatMap((ticker) => {
      known.add(ticker.symbol);
      const update = changed.get(ticker.symbol);
      return !update ? [ticker] : update.deleted ? [] : [update];
    });
    for (const ticker of rows) if (!ticker.deleted && !known.has(ticker.symbol)) next.push(ticker);
    return next;
  });
  // Unchanged rows keep their identity, so memoized list rows skip rendering.
  queryClient.setQueryData<Instrument[]>(["instruments"], (old) =>
    old?.flatMap((instrument) => {
      const update = changed.get(instrument.symbol);
      return !update ? [instrument] : update.deleted ? [] : [{ ...instrument, ...update }];
    }),
  );
  for (const ticker of rows) {
    if (ticker.deleted) {
      clearTradePriceOverlay(ticker.symbol);
      queryClient.removeQueries({ queryKey: ["instrument", ticker.symbol] });
    } else {
      queryClient.setQueryData<Instrument>(["instrument", ticker.symbol], (old) =>
        old ? applyTradePriceOverlay({ ...old, ...ticker }) : old,
      );
    }
  }
}

export function useTickerStream(enabled = true) {
  const queryClient = useQueryClient();
  const revision = useRef(0);
  const recoveryRequested = useRef(false);
  useEffect(() => {
    return () => {
      revision.current += 1;
      recoveryRequested.current = false;
    };
  }, [enabled]);
  const applyFrame = (frame: WsFrame) => {
    if (!Array.isArray(frame.data)) return;
    applyTickers(queryClient, frame.data as LiveTicker[], frame.type === "snapshot");
  };
  useChannelFrames("public", enabled ? "tickers" : null, (frame) => {
    revision.current += 1;
    recoveryRequested.current = false;
    applyFrame(frame);
  }, () => {
    clearTradePriceOverlay();
    // Reconcile once per outage. A newer live frame always wins over this REST read.
    if (recoveryRequested.current) return;
    recoveryRequested.current = true;
    const beforeFetch = revision.current;
    void fetchAllPages<Ticker>("/api/v1/market/tickers").then((data) => {
      if (revision.current !== beforeFetch) return;
      applyFrame({ type: "snapshot", stream: "tickers", data });
    }).catch(() => {
      // Preserve the last prices until the socket delivers its next snapshot.
    });
  });
}

export function useMarketStateStream(enabled = true) {
  const queryClient = useQueryClient();
  useChannelFrames("public", enabled ? "market_state" : null, (frame) => {
    const raw = frame.data as Record<string, unknown> | undefined;
    if (!raw) return;
    if (typeof raw.symbol === "string" && typeof raw.state === "string") {
      applySymbolTradingState(
        queryClient,
        raw.symbol,
        raw.state as InstrumentState,
        typeof raw.reason === "string" ? raw.reason : null,
        typeof raw.halted_at === "string" ? raw.halted_at : null,
        typeof raw.halted_until === "string" ? raw.halted_until : null,
      );
      void refreshSymbolMetadata(queryClient, raw.symbol);
      return;
    }
    const marketState = raw as unknown as MarketState;
    queryClient.setQueryData(["market-state"], marketState);
    writeMarketStateCache(marketState);
  }, () => void queryClient.invalidateQueries({ queryKey: ["market-state"] }));
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

export function useSymbolMetadataSync(enabled = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let synchronizing = false;

    const applyCachedMetadata = (cache: SymbolMetadataCache) => applySymbolMetadataCache(queryClient, cache);

    const onStorage = (event: StorageEvent) => {
      // Another tab synced first; adopt its result instead of asking again.
      try {
        if (event.key === MARKET_STATE_CACHE_KEY && event.newValue) {
          const state: unknown = JSON.parse(event.newValue);
          if (!isMarketState(state)) return;
          queryClient.setQueryData(["market-state"], state);
          noteMarketStateTime(state);
        } else if (event.key === SYMBOL_METADATA_CACHE_KEY) {
          if (event.newValue === null) {
            adoptSymbolMetadataCache(null);
            return;
          }
          const cache = parseSymbolMetadataCache(JSON.parse(event.newValue));
          if (!cache) return;
          const previous = adoptSymbolMetadataCache(cache);
          noteSymbolMetadataTimes(cache);
          applySymbolMetadataDelta(queryClient, previous, cache);
          applySymbolMetadataCache(queryClient, cache);
        }
      } catch {
        // Ignore malformed cross-tab updates and keep the last valid cache.
      }
    };

    window.addEventListener("storage", onStorage);

    async function synchronize() {
      if (synchronizing) return;
      synchronizing = true;
      const cachedBefore = readSymbolMetadataCache();
      try {
        const cache = await ensureSymbolMetadataCache();
        if (stopped) return;
        if (!cachedBefore) {
          applyCachedMetadata(cache);
          return;
        }
        if (!isInitialSymbolMetadataValidationDone()) {
          const validated = await runInitialSymbolMetadataValidation(cache);
          if (stopped) return;
          applySymbolMetadataDelta(queryClient, cache, validated);
          applyCachedMetadata(validated);
          return;
        }
        if (Date.now() - cache.saved_at < SYMBOL_METADATA_SYNC_MS) {
          applyCachedMetadata(cache);
          return;
        }
        const nextCache = await runSymbolMetadataSync(cache);
        if (stopped) return;
        applySymbolMetadataDelta(queryClient, cache, nextCache);
        applyCachedMetadata(nextCache);
      } catch (error) {
        if (error instanceof ApiError && error.code === "INVALID_REQUEST") {
          clearSymbolMetadataCache();
          try {
            const recovered = await ensureSymbolMetadataCache();
            if (!stopped) applyCachedMetadata(recovered);
          } catch {
            // Keep the last in-memory data and retry on the next cadence.
          }
        }
      } finally {
        synchronizing = false;
      }
    }

    // Hidden tabs skip the cadence and catch up once they become visible.
    const syncIfVisible = () => {
      if (document.visibilityState === "visible") void synchronize();
    };
    void synchronize();
    const timer = window.setInterval(syncIfVisible, SYMBOL_METADATA_SYNC_MS);
    document.addEventListener("visibilitychange", syncIfVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", syncIfVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled, queryClient]);
}

/**
 * Makes a socket snapshot the trade list. A REST fetch still in flight would
 * otherwise resolve later and overwrite the snapshot (and any updates applied
 * on top of it) with an older page. Cancelling reverts synchronously, so the
 * snapshot written right after wins.
 */
export function replaceSymbolTrades(
  queryClient: QueryClient,
  symbol: string,
  limit: number,
  snapshot: PublicTrade[],
) {
  const queryKey = ["symbol-trades", symbol, limit];
  void queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<Page<PublicTrade>>(queryKey, (old) => ({
    data: snapshot,
    page: old?.page ?? { next_cursor: null, has_more: false },
  }));
}

function awaitSnapshot(queryClient: QueryClient, symbol: string, runtime: CandleTradeRuntime): void {
  clearTradePriceOverlay(symbol);
  runtime.snapshotReady = false;
  runtime.lastSequence = undefined;
  runtime.seenSequences.clear();
  runtime.pendingSequences.clear();
  requestCandleRecovery(queryClient, symbol, runtime, true);
}

/**
 * Feeds a polled trades page into the candles the way stream updates would.
 * Trades already applied are skipped by sequence, and ones the candle page was
 * fetched after are skipped by time. A page that no longer reaches the last
 * applied trade missed some, so the candle tail is refetched instead.
 */
export function applyPolledTrades(queryClient: QueryClient, symbol: string, trades: PublicTrade[]): void {
  const runtime = candleRuntime(symbol);
  const previous = runtime.lastSequence;
  const fresh = trades
    .filter((trade) => Number.isSafeInteger(trade.sequence) && (previous === undefined || trade.sequence > previous))
    .sort((a, b) => a.sequence - b.sequence);
  if (fresh.length === 0) return;
  runtime.lastSequence = fresh[fresh.length - 1].sequence;
  if (previous !== undefined && fresh[0].sequence !== previous + 1) {
    requestCandleRecovery(queryClient, symbol, runtime);
    return;
  }
  let needsRecovery = false;
  for (const trade of fresh) {
    if (updateCachedCandleQueries(queryClient, symbol, trade).needsRecovery) needsRecovery = true;
  }
  if (needsRecovery) requestCandleRecovery(queryClient, symbol, runtime);
}

export function useSymbolTradeStream(symbol: string | undefined, limit = 150) {
  const queryClient = useQueryClient();

  useChannelFrames("public", symbol ? `trades:${symbol}` : null, (frame) => {
    if (!symbol) return;
    const runtime = candleRuntime(symbol);
    if (frame.type === "snapshot" && Array.isArray(frame.data)) {
      const snapshot = frame.data as PublicTrade[];
      const sequences = snapshot
        .map((trade) => trade.sequence)
        .filter((sequence): sequence is number => Number.isSafeInteger(sequence));
      runtime.snapshotReady = true;
      runtime.awaitingSnapshotRecovery = false;
      runtime.lastSequence = sequences.length > 0 ? Math.max(...sequences) : undefined;
      runtime.seenSequences.clear();
      runtime.pendingSequences.clear();
      replaceSymbolTrades(queryClient, symbol, limit, snapshot);
      return;
    }
    if (frame.type !== "update" || !frame.data) return;
    const trade = frame.data as PublicTrade;
    if (!Number.isSafeInteger(trade.sequence)) return;
    if (runtime.awaitingSnapshotRecovery) return;
    if (!runtime.snapshotReady) {
      runtime.pendingSequences.add(trade.sequence);
      return;
    }
    if (runtime.seenSequences.has(trade.sequence)) return;
    // A replayed or skipped sequence means trades were lost: wait for a snapshot.
    if (runtime.lastSequence !== undefined && trade.sequence !== runtime.lastSequence + 1) {
      awaitSnapshot(queryClient, symbol, runtime);
      return;
    }
    runtime.lastSequence = trade.sequence;
    rememberTradeSequence(runtime, trade.sequence);
    updateTradePriceOverlay(symbol, trade);
    queryClient.setQueryData<Instrument>(["instrument", symbol], (old) =>
      old ? applyTradePriceOverlay(old) : old,
    );
    queryClient.setQueryData<Page<PublicTrade>>(["symbol-trades", symbol, limit], (old) => {
      if (!old) return old;
      if (old.data.some((row) => row.sequence === trade.sequence)) return old;
      return { data: [trade, ...old.data].slice(0, 400), page: old.page };
    });
    const result = updateCachedCandleQueries(queryClient, symbol, trade);
    if (result.needsRecovery) {
      runtime.pendingSequences.add(trade.sequence);
      // The cached page cannot safely correct an older bucket (or be merged
      // while its REST bootstrap is in flight). Make the canonical REST page
      // authoritative once for active observers; requestCandleRecovery clears
      // this triggering sequence so it cannot be double-counted afterward.
      requestCandleRecovery(queryClient, symbol, runtime);
    }
  }, () => {
    if (!symbol) return;
    awaitSnapshot(queryClient, symbol, candleRuntime(symbol));
    void queryClient.invalidateQueries({ queryKey: ["symbol-trades", symbol] });
  });
}

/** Notifications are also the authoritative private delivery path for trade events. */
export function reconcileNotificationData(
  queryClient: QueryClient,
  notification: Notification,
) {
  const parsed = parseNotificationBody(notification.body);
  const event = parsed.eventKey ?? eventKeyFromTitle(notification.title);
  const keys = new Set<string>();
  if (["TRADE_EXECUTED", "TRIGGER_ACTIVATED", "transfer.updated", "ISSUANCE_CREATED", "LOCKUP_RELEASE"].includes(event ?? "")) {
    for (const key of ["orders", "my-trades", "portfolio", "accounts", "nav", "nav-history", "realized-pnl"]) keys.add(key);
  }
  if (event === "transfer.updated") keys.add("transfers");
  // Delisting settles remaining holdings into Credit.
  if (event === "DELISTED") {
    for (const key of ["portfolio", "accounts", "nav", "nav-history", "realized-pnl"]) keys.add(key);
  }
  if (event?.startsWith("margin.")) {
    // A warning only changes risk; settlements and liquidations move balances too.
    invalidateMarginQueries(queryClient, { balances: event !== "margin.warning" });
  }
  if (event === "MANAGER_CHANGED" || event === "MANAGER_FORCED_CHANGE") keys.add("manager-requests");
  if (event === "AUTH_PASSKEY_ADDED" || event === "AUTH_PASSKEY_DELETED") keys.add("passkeys");
  if (event === "AUTH_SESSIONS_REVOKED" || event === "AUTH_LOGIN" || event === "AUTH_LOGOUT") keys.add("sessions");
  if (event === "ICON_REJECTED") keys.add("icon-requests");
  if (event === "CURVE_CEILING_REACHED") keys.add("issuance-preview");
  if ([
    "SYMBOL_METADATA_CHANGED", "SYMBOL_LISTED", "ISSUANCE_CREATED", "LOCKUP_RELEASE",
    "CURVE_CEILING_REACHED", "MANAGER_CHANGED", "MANAGER_FORCED_CHANGE",
  ].includes(event ?? "")) {
    // applyTradingNotification already refreshes these metadata events.
    if (parsed.symbol && event !== "SYMBOL_METADATA_CHANGED" && event !== "SYMBOL_LISTED") {
      void refreshSymbolMetadata(queryClient, parsed.symbol);
    }
    keys.add("icon-requests");
  }
  if (event === "inquiry.replied") {
    keys.add("inquiries");
    keys.add("inquiry");
  }
  if (event === "ACCOUNT_CREATED" || event === "ACCOUNT_DELETED") keys.add("accounts");
  invalidateNotificationKeys(queryClient, keys);
}

// NAV history is a period series: refresh it when a chart next mounts or regains
// focus instead of refetching up to 500 points for every event.
const PASSIVE_REFRESH_KEYS = new Set(["nav-history"]);

function invalidateNotificationKeys(
  queryClient: QueryClient,
  keys: Iterable<string>,
): void {
  const active: string[][] = [];
  const passive: string[][] = [];
  for (const key of keys) (PASSIVE_REFRESH_KEYS.has(key) ? passive : active).push([key]);
  invalidateBatched(queryClient, active);
  invalidateBatched(queryClient, passive, { passive: true });
}

/**
 * Private streams have no replay/resume, so a gap is reconciled over REST:
 * once when it happens, and again when the next connection opens, because
 * changes made between that refetch and the reconnect were never delivered.
 * Repeated failed reconnects must not turn this into a poller.
 */
export function resyncPrivateStreamGaps(
  socket: Pick<StreamSocket, "onFrame" | "onGap" | "onStatus">,
  reconcile: () => void,
): () => void {
  let reconciliationRequested = false;
  let resyncOnOpen = false;
  const offFrame = socket.onFrame((frame) => {
    if (frame.type === "update") reconciliationRequested = false;
  });
  const offGap = socket.onGap(() => {
    resyncOnOpen = true;
    if (reconciliationRequested) return;
    reconciliationRequested = true;
    reconcile();
  });
  const offStatus = socket.onStatus((status) => {
    if (status !== "open" || !resyncOnOpen) return;
    resyncOnOpen = false;
    reconciliationRequested = false;
    reconcile();
  });
  return () => {
    offFrame();
    offGap();
    offStatus();
  };
}

export function usePrivateStream(enabled: boolean) {
  const queryClient = useQueryClient();
  const handlerRef = useRef<(frame: WsFrame) => void>(() => {});

  useEffect(() => {
    handlerRef.current = (frame) => {
      const stream = frame.stream;
      if (!stream) return;
      if (stream === "notification.created" || stream === "notification.updated") {
        const notification = notificationFromPrivateFrame(frame);
        if (!notification) return;
        updateNotificationCaches(queryClient, notification);
        // Updates (e.g. read state) carry no new domain event to reconcile.
        if (stream === "notification.created") {
          applyTradingNotification(queryClient, notification);
          reconcileNotificationData(queryClient, notification);
        }
        return;
      }
      // Private trade.executed is not delivered; fills arrive as notifications.
      // Domain streams below share one batched refetch with their notification.
      if (stream === "trigger.activated") {
        invalidateNotificationKeys(queryClient, ["orders", "my-trades", "portfolio", "nav", "nav-history"]);
        return;
      }
      if (stream === "transfer.updated") {
        invalidateNotificationKeys(queryClient, ["transfers", "portfolio", "nav"]);
        return;
      }
      if (stream.startsWith("margin.")) {
        const marginData = frame.data as { position_id?: string } | undefined;
        invalidateMarginQueries(queryClient, {
          positionId: marginData?.position_id,
          balances: stream !== "margin.warning",
        });
        return;
      }
      if (stream === "listing.updated" || stream === "issuance.created") {
        const symbol = (frame.data as { symbol?: string } | undefined)?.symbol;
        if (symbol) {
          void refreshSymbolMetadata(queryClient, symbol);
        } else {
          const cache = readSymbolMetadataCache();
          // Apply the result too: the periodic sync would see an already
          // fresh cache and never push this delta into mounted queries.
          if (cache) {
            void runSymbolMetadataSync(cache).then((next) => {
              applySymbolMetadataDelta(queryClient, cache, next);
              applySymbolMetadataCache(queryClient, next);
            }, () => undefined);
          }
        }
        return;
      }
      if (stream === "inquiry.replied") {
        invalidateNotificationKeys(queryClient, ["inquiries", "inquiry"]);
      }
    };
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket("private");
    const release = socket.retain();
    const off = socket.onFrame((frame) => handlerRef.current(frame));
    const offResync = resyncPrivateStreamGaps(socket, () => {
      invalidateMarginQueries(queryClient);
      invalidateNotificationKeys(queryClient, [
        "notifications",
        "orders",
        "my-trades",
        "portfolio",
        "accounts",
        "nav",
        "nav-history",
        "transfers",
        "inquiries",
        "icon-requests",
      ]);
    });
    return () => {
      off();
      offResync();
      release();
    };
  }, [enabled, queryClient]);
}
