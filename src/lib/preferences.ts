"use client";

import { useSyncExternalStore } from "react";

export const TRADE_EXECUTION_POPUP_STORAGE_KEY = "tradex:trade-execution-popup:v1";
const DEFAULT_TRADE_EXECUTION_POPUP = true;

let tradeExecutionPopupPreference: boolean | undefined;
const tradeExecutionPopupListeners = new Set<() => void>();

function readStoredTradeExecutionPopup(): boolean {
  try {
    const stored = window.localStorage.getItem(TRADE_EXECUTION_POPUP_STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // Keep an in-memory preference if storage becomes unavailable later.
    return tradeExecutionPopupPreference ?? DEFAULT_TRADE_EXECUTION_POPUP;
  }
  return DEFAULT_TRADE_EXECUTION_POPUP;
}

function getTradeExecutionPopupSnapshot(): boolean | null {
  if (typeof window === "undefined") return null;
  if (tradeExecutionPopupPreference === undefined) {
    tradeExecutionPopupPreference = readStoredTradeExecutionPopup();
  }
  return tradeExecutionPopupPreference;
}

function subscribeToTradeExecutionPopup(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== TRADE_EXECUTION_POPUP_STORAGE_KEY) return;
    tradeExecutionPopupPreference =
      event.newValue === "false" ? false : event.newValue === "true" ? true : DEFAULT_TRADE_EXECUTION_POPUP;
    tradeExecutionPopupListeners.forEach((listener) => listener());
  };
  tradeExecutionPopupListeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    tradeExecutionPopupListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getServerTradeExecutionPopupSnapshot(): null {
  return null;
}

export function useTradeExecutionPopupPreference() {
  const storedPreference = useSyncExternalStore(
    subscribeToTradeExecutionPopup,
    getTradeExecutionPopupSnapshot,
    getServerTradeExecutionPopupSnapshot,
  );
  const enabled = storedPreference ?? DEFAULT_TRADE_EXECUTION_POPUP;

  const setEnabled = (next: boolean) => {
    tradeExecutionPopupPreference = next;
    try {
      window.localStorage.setItem(TRADE_EXECUTION_POPUP_STORAGE_KEY, String(next));
    } catch {
      // Keep the in-memory preference when browser storage is unavailable.
    }
    tradeExecutionPopupListeners.forEach((listener) => listener());
  };

  return { enabled, setEnabled, hydrated: storedPreference !== null };
}

/** Reads the same preference at the visual emission point without suppressing order processing. */
export function shouldShowTradeExecutionPopup(): boolean {
  if (typeof window === "undefined") return DEFAULT_TRADE_EXECUTION_POPUP;
  tradeExecutionPopupPreference = readStoredTradeExecutionPopup();
  return tradeExecutionPopupPreference;
}

export const VOLUME_PANE_RATIO_STORAGE_KEY = "tradex:volume-pane-ratio:v1";
let volumePaneRatioPreference: number | undefined;

export function calculateVolumePaneHeight(totalHeight: number): number {
  if (volumePaneRatioPreference === undefined && typeof window !== "undefined") {
    try {
      const stored = Number(window.localStorage.getItem(VOLUME_PANE_RATIO_STORAGE_KEY));
      if (stored > 0 && stored < 1) volumePaneRatioPreference = stored;
    } catch {
      // Storage may be disabled; retain the in-memory preference.
    }
  }
  return volumePaneRatioPreference === undefined
    ? Math.min(78, Math.max(56, Math.round(totalHeight * 0.28)))
    : Math.round(totalHeight * volumePaneRatioPreference);
}

export function setVolumePaneRatio(ratio: number): void {
  volumePaneRatioPreference = ratio;
  try {
    window.localStorage.setItem(VOLUME_PANE_RATIO_STORAGE_KEY, String(ratio));
  } catch {
    // Keep the in-memory preference when browser storage is unavailable.
  }
}
