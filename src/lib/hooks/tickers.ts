"use client";

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  applySymbolTradingState,
  applyTradePriceOverlay,
  clearTradePriceOverlay,
  clearDeletedSymbolState,
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

const TICKER_FIELDS = [
  "symbol", "last_price", "curve_spot_price", "market_value", "holder_count", "open", "high", "low",
  "volume_shares", "volume_credit", "change_ppm", "trade_count", "window_start",
] as const satisfies readonly (keyof Ticker)[];

function sameTicker(left: Ticker, right: Ticker): boolean {
  return TICKER_FIELDS.every((field) => left[field] === right[field]);
}

function shareRows<T>(old: T[] | undefined, next: T[]): T[] {
  return old?.length === next.length && old.every((row, index) => row === next[index]) ? old : next;
}

function preserveRowIdentity(queryClient: QueryClient, key: "ticker-cache" | "instruments"): void {
  // These mergers preserve row identity themselves. Query's recursive sharing
  // otherwise traverses every field of thousands of rows on each frame.
  const queryKey = [key];
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (query) {
    if (query.options.structuralSharing !== false) query.setOptions({ ...query.options, structuralSharing: false });
  } else {
    queryClient.setQueryDefaults(queryKey, { ...queryClient.getQueryDefaults(queryKey), structuralSharing: false });
  }
}

/**
 * Writes tickers into the ticker cache and every instrument view. A snapshot
 * replaces the cache; anything else (stream updates, polled pages) merges.
 */
export function applyTickers(queryClient: QueryClient, rows: LiveTicker[], snapshot = false): void {
  const changed = new Map(rows.map((ticker) => [ticker.symbol, ticker]));
  preserveRowIdentity(queryClient, "ticker-cache");
  preserveRowIdentity(queryClient, "instruments");
  queryClient.setQueryData<Ticker[]>(["ticker-cache"], (old) => {
    if (snapshot || !old) {
      const previous = new Map(old?.map((ticker) => [ticker.symbol, ticker]));
      return shareRows(old, rows.filter((ticker) => !ticker.deleted).map((ticker) => {
        const before = previous.get(ticker.symbol);
        return before && sameTicker(before, ticker) ? before : ticker;
      }));
    }
    const additions = new Set(changed.keys());
    let next: Ticker[] | undefined;
    old.forEach((ticker, index) => {
      additions.delete(ticker.symbol);
      const update = changed.get(ticker.symbol);
      if (update?.deleted) {
        next ??= old.slice(0, index);
        return;
      }
      const row = update && !sameTicker(ticker, update) ? update : ticker;
      if (row !== ticker) next ??= old.slice(0, index);
      next?.push(row);
    });
    for (const symbol of additions) {
      const ticker = changed.get(symbol)!;
      if (!ticker.deleted) (next ??= old.slice()).push(ticker);
    }
    return next ?? old;
  });
  queryClient.setQueryData<Instrument[]>(["instruments"], (old) => {
    if (!old) return old;
    let next: Instrument[] | undefined;
    old.forEach((instrument, index) => {
      const update = changed.get(instrument.symbol);
      if (update?.deleted) {
        next ??= old.slice(0, index);
        return;
      }
      const row = update && !sameTicker(instrument, update) ? { ...instrument, ...update } : instrument;
      if (row !== instrument) next ??= old.slice(0, index);
      next?.push(row);
    });
    return next ?? old;
  });
  for (const ticker of rows) {
    if (!ticker.deleted) continue;
    clearDeletedSymbolState(ticker.symbol);
    queryClient.removeQueries({ queryKey: ["instrument", ticker.symbol] });
  }
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
