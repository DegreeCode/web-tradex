"use client";

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  applySymbolTradingState,
  applyTradePriceOverlay,
  clearTradePriceOverlay,
  isMarketState,
  noteMarketStateTime,
  refreshSymbolMetadata,
  writeMarketStateCache,
} from "../market-cache";
import { fetchAllPages } from "../symbol-metadata";
import type { Instrument, Ticker, WsFrame } from "../types";
import { useChannelFrames } from "./socket";

// A guest's market screens poll one ticker request every 5 seconds: 12 of the
// 60 anonymous requests a minute, leaving room for trades, candles, metadata
// sync and a second tab.
export const GUEST_TICKER_POLL_MS = 5_000;

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
    const next: Ticker[] = [];
    for (const ticker of old) {
      known.add(ticker.symbol);
      const update = changed.get(ticker.symbol);
      if (!update?.deleted) next.push(update ?? ticker);
    }
    for (const ticker of changed.values()) if (!ticker.deleted && !known.has(ticker.symbol)) next.push(ticker);
    return next;
  });
  // Unchanged rows keep their identity, so memoized list rows skip rendering.
  queryClient.setQueryData<Instrument[]>(["instruments"], (old) =>
    old?.reduce<Instrument[]>((next, instrument) => {
      const update = changed.get(instrument.symbol);
      if (!update?.deleted) next.push(update ? { ...instrument, ...update } : instrument);
      return next;
    }, []),
  );
  // A tombstone always drops the detail and its price overlay.
  for (const ticker of rows) {
    if (!ticker.deleted) continue;
    clearTradePriceOverlay(ticker.symbol);
    queryClient.removeQueries({ queryKey: ["instrument", ticker.symbol] });
  }
  // Visit cached details once rather than looking up a query for every ticker.
  // Inactive details also need current prices when reopened without a refetch.
  queryClient.setQueriesData<Instrument>({ queryKey: ["instrument"] }, (old) => {
    const ticker = old && changed.get(old.symbol);
    return old && ticker && !ticker.deleted ? applyTradePriceOverlay({ ...old, ...ticker }) : old;
  });
}

export function useTickerStream(enabled = true) {
  const queryClient = useQueryClient();
  const revision = useRef(0);
  const recoveryRequested = useRef(false);
  const recovery = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      revision.current += 1;
      recoveryRequested.current = false;
      recovery.current?.abort();
    };
  }, [enabled]);
  const applyFrame = (frame: WsFrame) => {
    if (!Array.isArray(frame.data)) return;
    applyTickers(queryClient, frame.data as LiveTicker[], frame.type === "snapshot");
  };
  useChannelFrames("public", enabled ? "tickers" : null, (frame) => {
    revision.current += 1;
    recoveryRequested.current = false;
    recovery.current?.abort();
    applyFrame(frame);
  }, () => {
    clearTradePriceOverlay();
    // Reconcile once per outage. A newer live frame always wins over this REST read.
    if (recoveryRequested.current) return;
    recoveryRequested.current = true;
    const beforeFetch = revision.current;
    const controller = new AbortController();
    recovery.current = controller;
    void fetchAllPages<Ticker>("/api/v1/market/tickers", controller.signal).then((data) => {
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
    if (typeof raw.symbol === "string") {
      if (raw.state !== "TRADING" && raw.state !== "HALTED" && raw.state !== "DELIST_PENDING" && raw.state !== "DELISTED") return;
      applySymbolTradingState(
        queryClient,
        raw.symbol,
        raw.state,
        typeof raw.reason === "string" ? raw.reason : null,
        typeof raw.halted_at === "string" ? raw.halted_at : null,
        typeof raw.halted_until === "string" ? raw.halted_until : null,
        typeof raw.updated_at === "string" ? raw.updated_at : typeof raw.changed_at === "string" ? raw.changed_at : null,
        undefined,
        typeof raw.version === "string" || typeof raw.version === "number" ? raw.version : undefined,
      );
      void refreshSymbolMetadata(queryClient, raw.symbol);
      return;
    }
    if (!isMarketState(raw)) return;
    const marketState = raw;
    noteMarketStateTime(marketState);
    queryClient.setQueryData(["market-state"], marketState);
    writeMarketStateCache(marketState);
  }, () => void queryClient.invalidateQueries({ queryKey: ["market-state"] }));
}
