"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiData, apiPage, buildQuery } from "../api";
import {
  candleRuntime,
  candleTradeRuntimes,
  retainCandleRuntime,
  rememberTradeSequence,
  resumeCandleClocks,
  reconcileCandleTradeSnapshot,
  requestCandleRecovery,
  updateCachedCandleQueries,
  type CandleTradeRuntime,
} from "../candle-cache";
import { addDecimal, compareDecimal } from "../format";
import {
  applyTradePriceOverlay,
  clearTradePriceOverlay,
  updateTradePriceOverlay,
} from "../market-cache";
import { useSignedIn } from "../session-mode";
import type { Instrument, Page, PublicTrade, Ticker, WsFrame } from "../types";
import { getSocket } from "../ws";
import { useSocketStatus, useChannelFrames } from "./socket";
import { applyTickers, GUEST_TICKER_POLL_MS } from "./tickers";

export async function fetchSymbolTrades(
  queryClient: QueryClient, symbol: string, limit: number, signal?: AbortSignal,
): Promise<Page<PublicTrade>> {
  const runtime = candleTradeRuntimes.get(symbol);
  const page = await apiPage<PublicTrade>(
    `/api/v1/market/symbols/${encodeURIComponent(symbol)}/trades${buildQuery({ limit })}`,
    { signal },
  );
  if (runtime && !signal?.aborted && candleTradeRuntimes.get(symbol) === runtime && getSocket("public").getStatus() !== "open") {
    applySymbolTradeSnapshot(queryClient, symbol, limit, page.data, runtime);
  }
  return page;
}

/** Signed in only: a guest's symbol view follows its polled ticker instead. */
export function useSymbolTrades(symbol: string | undefined, limit = 150) {
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();
  const publicStatus = useSocketStatus("public");
  return useQuery({
    queryKey: ["symbol-trades", symbol, limit],
    queryFn: ({ signal }) => fetchSymbolTrades(queryClient, symbol ?? "", limit, signal),
    enabled: Boolean(symbol) && signedIn,
    refetchInterval: publicStatus === "open" ? false : 5_000,
    // Public snapshots/updates own this cache while connected. Focus and mount
    // must not race that stream with a redundant REST response.
    staleTime: publicStatus === "open" ? Infinity : 3_000,
    refetchOnWindowFocus: publicStatus !== "open",
    refetchOnReconnect: publicStatus !== "open",
    refetchOnMount: publicStatus !== "open",
  });
}

/**
 * What a guest's ticker poll says traded since the previous poll, as one trade
 * at the last price carrying the volume in between, or null when nothing did.
 * The ticker's day totals restart with a new window.
 */
export function tradeSinceTicker(
  previous: Ticker,
  current: Ticker,
  at: Date,
): { trade: PublicTrade; count: number } | null {
  const sameWindow = previous.window_start === current.window_start;
  const count = current.trade_count - (sameWindow ? previous.trade_count : 0);
  if (count <= 0 || !current.last_price) return null;
  const since = (now: string, before: string) => {
    if (!sameWindow) return now;
    const delta = addDecimal(now, before.startsWith("-") ? before.slice(1) : `-${before}`);
    return compareDecimal(delta, "0") > 0 ? delta : "0";
  };
  return {
    count,
    trade: {
      symbol: current.symbol,
      side: "BUY",
      price: current.last_price,
      quantity: since(current.volume_shares, previous.volume_shares),
      credit: since(current.volume_credit, previous.volume_credit),
      fee: "0",
      timestamp: at.toISOString(),
      sequence: current.trade_count,
    },
  };
}

/**
 * Poll a symbol's price whenever its stream is unavailable. Guests also use
 * the ticker delta to approximate candles without private trade requests.
 */
export function usePolledSymbolTicker(symbol: string | undefined) {
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();
  const polling = useSocketStatus("public") !== "open";
  const previous = useRef<Ticker | null>(null);
  const { data: ticker } = useQuery({
    queryKey: ["ticker", symbol],
    queryFn: async ({ signal }) => {
      const row = await apiData<Ticker>(`/api/v1/market/tickers/${encodeURIComponent(symbol ?? "")}`, { signal });
      applyTickers(queryClient, [row]);
      return row;
    },
    enabled: Boolean(symbol) && polling,
    refetchInterval: GUEST_TICKER_POLL_MS,
    staleTime: GUEST_TICKER_POLL_MS,
    // Each visit starts from a fresh ticker, the baseline for the candles it loads.
    gcTime: 0,
  });

  useEffect(() => {
    previous.current = null;
  }, [symbol, signedIn, polling]);

  useEffect(() => {
    if (!symbol || !ticker || signedIn || ticker.symbol !== symbol) return;
    const before = previous.current;
    previous.current = ticker;
    const since = before ? tradeSinceTicker(before, ticker, new Date()) : null;
    // A candle the update can't merge into stays as it is: a guest never refetches candles.
    if (since) updateCachedCandleQueries(queryClient, symbol, since.trade, since.count);
  }, [queryClient, signedIn, symbol, ticker]);
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
  runtime.pendingSequences.clear();
  const alreadyAwaiting = runtime.awaitingSnapshotRecovery;
  requestCandleRecovery(queryClient, symbol, runtime, true);
  if (!alreadyAwaiting) getSocket("public").resubscribe(`trades:${symbol}`);
}

function applySymbolTradeSnapshot(
  queryClient: QueryClient, symbol: string, limit: number, snapshot: PublicTrade[], runtime: CandleTradeRuntime,
): void {
  const trades = snapshot.filter((trade) => Number.isSafeInteger(trade.sequence));
  const sequences = trades.map((trade) => trade.sequence);
  runtime.lastSequence = sequences.length > 0 ? Math.max(...sequences) : undefined;
  runtime.pendingSequences.clear();
  // REST polls and returning socket snapshots overlap. Keep the applied sequence
  // history through outages so that neither path adds the same volume twice.
  const unseen = trades.filter((trade) => !runtime.seenSequences.has(trade.sequence));
  runtime.snapshotReady = false;
  reconcileCandleTradeSnapshot(queryClient, symbol, unseen, limit, runtime);
  for (const trade of trades) rememberTradeSequence(runtime, trade.sequence);
  runtime.snapshotReady = true;
  runtime.awaitingSnapshotRecovery = false;
  resumeCandleClocks(symbol);
}

export function applySymbolTradeFrame(
  queryClient: QueryClient, symbol: string, limit: number, frame: WsFrame,
): void {
  const runtime = candleRuntime(symbol);
  if (frame.type === "snapshot" && Array.isArray(frame.data)) {
    const snapshot = frame.data as PublicTrade[];
    applySymbolTradeSnapshot(queryClient, symbol, limit, snapshot, runtime);
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
}

export function useSymbolTradeStream(symbol: string | undefined, limit = 150) {
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();

  useEffect(() => {
    if (!symbol || !signedIn) return;
    return retainCandleRuntime(symbol);
  }, [symbol, signedIn]);

  useChannelFrames("public", symbol ? `trades:${symbol}` : null, (frame) => {
    if (symbol) applySymbolTradeFrame(queryClient, symbol, limit, frame);
  }, () => {
    if (!symbol) return;
    awaitSnapshot(queryClient, symbol, candleRuntime(symbol));
    void queryClient.invalidateQueries({ queryKey: ["symbol-trades", symbol] });
  });
}
