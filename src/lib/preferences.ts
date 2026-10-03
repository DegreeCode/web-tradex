"use client";

import { useSyncExternalStore } from "react";

/** All per-browser UI preferences live in this one JSON record. */
export const PREFERENCES_STORAGE_KEY = "tradex:preferences:v1";

export interface Preferences {
  tradeExecutionPopup?: boolean;
  /** Toasts for important notifications that arrive while the app is open. */
  liveNotificationPopup?: boolean;
  /** Volume pane height ÷ chart height, strictly between 0 and 1. */
  volumePaneRatio?: number;
  /** Validated against the supported intervals by the symbol page. */
  candleInterval?: string;
  /** Allowed slippage in percent as typed (≤ 4 decimals); absent means the server default. */
  slippagePercent?: string;
}

// Single-value keys used before the preferences were bundled; migrated once.
const LEGACY_STORAGE_KEYS = {
  tradeExecutionPopup: "tradex:trade-execution-popup:v1",
  volumePaneRatio: "tradex:volume-pane-ratio:v1",
  candleInterval: "tradex:candle-interval:v1",
} as const;

const DEFAULT_TRADE_EXECUTION_POPUP = true;
const DEFAULT_LIVE_NOTIFICATION_POPUP = true;
const SLIPPAGE_PERCENT_PATTERN = /^(?!$)\d*\.?\d{0,4}$/;

let preferences: Preferences | undefined;
const listeners = new Set<() => void>();

function isVolumePaneRatio(value: unknown): value is number {
  return typeof value === "number" && value > 0 && value < 1;
}

/** Keeps only well-formed fields so a hand-edited or stale record cannot break the UI. */
export function sanitizePreferences(raw: unknown): Preferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const out: Preferences = {};
  if (typeof input.tradeExecutionPopup === "boolean") out.tradeExecutionPopup = input.tradeExecutionPopup;
  if (typeof input.liveNotificationPopup === "boolean") out.liveNotificationPopup = input.liveNotificationPopup;
  if (isVolumePaneRatio(input.volumePaneRatio)) out.volumePaneRatio = input.volumePaneRatio;
  if (typeof input.candleInterval === "string" && input.candleInterval) out.candleInterval = input.candleInterval;
  if (typeof input.slippagePercent === "string" && SLIPPAGE_PERCENT_PATTERN.test(input.slippagePercent)) {
    out.slippagePercent = input.slippagePercent;
  }
  return out;
}

function parsePreferences(raw: string | null): Preferences {
  if (raw === null) return {};
  try {
    return sanitizePreferences(JSON.parse(raw));
  } catch {
    return {};
  }
}

function migrateLegacyPreferences(storage: Storage): Preferences {
  const popup = storage.getItem(LEGACY_STORAGE_KEYS.tradeExecutionPopup);
  const ratio = storage.getItem(LEGACY_STORAGE_KEYS.volumePaneRatio);
  const migrated = sanitizePreferences({
    tradeExecutionPopup: popup === "true" ? true : popup === "false" ? false : undefined,
    volumePaneRatio: ratio === null ? undefined : Number(ratio),
    candleInterval: storage.getItem(LEGACY_STORAGE_KEYS.candleInterval) ?? undefined,
  });
  if (Object.keys(migrated).length === 0) return migrated;
  try {
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(migrated));
    // Remove the old keys only once the bundled record is safely written.
    Object.values(LEGACY_STORAGE_KEYS).forEach((key) => storage.removeItem(key));
  } catch {
    // Retry the migration on the next load.
  }
  return migrated;
}

function loadPreferences(): Preferences {
  try {
    const storage = window.localStorage;
    const raw = storage.getItem(PREFERENCES_STORAGE_KEY);
    return raw === null ? migrateLegacyPreferences(storage) : parsePreferences(raw);
  } catch {
    // Keep the in-memory preferences if storage becomes unavailable later.
    return preferences ?? {};
  }
}

function emit() {
  listeners.forEach((listener) => listener());
}

/** Current preferences; an empty record on the server. */
export function readPreferences(): Preferences {
  if (typeof window === "undefined") return {};
  if (preferences === undefined) preferences = loadPreferences();
  return preferences;
}

/** Merges a patch (undefined removes a field) and persists the whole record. */
export function updatePreferences(patch: Partial<Preferences>): void {
  const next: Preferences = { ...readPreferences(), ...patch };
  for (const key of Object.keys(next) as (keyof Preferences)[]) {
    if (next[key] === undefined) delete next[key];
  }
  preferences = sanitizePreferences(next);
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Keep the in-memory preferences when browser storage is unavailable.
  }
  emit();
}

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  // Another tab changed the record (key null: storage was cleared).
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PREFERENCES_STORAGE_KEY && event.key !== null) return;
    preferences = parsePreferences(event.newValue);
    emit();
  };
  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getServerSnapshot(): null {
  return null;
}

/** Preferences for rendering; null until hydrated so the server markup matches. */
export function usePreferences(): Preferences | null {
  return useSyncExternalStore(subscribe, readPreferences, getServerSnapshot);
}

export function useTradeExecutionPopupPreference() {
  const stored = usePreferences();
  const enabled = stored?.tradeExecutionPopup ?? DEFAULT_TRADE_EXECUTION_POPUP;
  const setEnabled = (next: boolean) => updatePreferences({ tradeExecutionPopup: next });
  return { enabled, setEnabled, hydrated: stored !== null };
}

/** Reads the same preference at the visual emission point without suppressing order processing. */
export function shouldShowTradeExecutionPopup(): boolean {
  if (typeof window === "undefined") return DEFAULT_TRADE_EXECUTION_POPUP;
  // Re-read so a change made in another tab applies even without a storage event.
  preferences = loadPreferences();
  return preferences.tradeExecutionPopup ?? DEFAULT_TRADE_EXECUTION_POPUP;
}

export function useLiveNotificationPopupPreference() {
  const stored = usePreferences();
  const enabled = stored?.liveNotificationPopup ?? DEFAULT_LIVE_NOTIFICATION_POPUP;
  const setEnabled = (next: boolean) => updatePreferences({ liveNotificationPopup: next });
  return { enabled, setEnabled, hydrated: stored !== null };
}

/** Read when a notification arrives, so a change in another tab applies at once. */
export function shouldShowLiveNotificationPopup(): boolean {
  if (typeof window === "undefined") return false;
  preferences = loadPreferences();
  return preferences.liveNotificationPopup ?? DEFAULT_LIVE_NOTIFICATION_POPUP;
}

/** Allowed slippage shared by spot and margin forms; remembered once typed. */
export function useSlippagePreference(): [string, (value: string) => void] {
  const slippage = usePreferences()?.slippagePercent ?? "";
  const setSlippage = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") {
      updatePreferences({ slippagePercent: undefined });
    } else if (SLIPPAGE_PERCENT_PATTERN.test(trimmed)) {
      updatePreferences({ slippagePercent: trimmed });
    }
  };
  return [slippage, setSlippage];
}

export function calculateVolumePaneHeight(totalHeight: number): number {
  const ratio = readPreferences().volumePaneRatio;
  return ratio === undefined
    ? Math.min(78, Math.max(56, Math.round(totalHeight * 0.28)))
    : Math.round(totalHeight * ratio);
}

export function setVolumePaneRatio(ratio: number): void {
  if (isVolumePaneRatio(ratio)) updatePreferences({ volumePaneRatio: ratio });
}
