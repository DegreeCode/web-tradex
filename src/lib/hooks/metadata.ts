"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api";
import {
  MARKET_STATE_CACHE_KEY,
  applySymbolMetadataCache,
  applySymbolMetadataDelta,
  isMarketState,
  noteMarketStateTime,
  noteSymbolMetadataTimes,
} from "../market-cache";
import {
  SYMBOL_METADATA_CACHE_KEY,
  SYMBOL_METADATA_SYNC_MS,
  adoptSymbolMetadataCache,
  clearSymbolMetadataCache,
  ensureSymbolMetadataCache,
  isInitialSymbolMetadataValidationDone,
  parseSymbolMetadataCache,
  readSymbolMetadataCache,
  runInitialSymbolMetadataValidation,
  runSymbolMetadataSync,
  type SymbolMetadataCache,
} from "../symbol-metadata";

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
