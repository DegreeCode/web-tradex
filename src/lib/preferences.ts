"use client";

import { useSyncExternalStore } from "react";
import { migrateLegacyChartSettings } from "./chart-settings";

/** General per-browser preferences; chart settings have their own record. */
export const PREFERENCES_STORAGE_KEY = "tradex:preferences:v1";

export interface Preferences {
  tradeExecutionPopup?: boolean;
  /** Toasts for important notifications that arrive while the app is open. */
  liveNotificationPopup?: boolean;
  /** Restore account choices only for the user who made them. */
  selectedAccount?: { userId: string; accountId: string };
  /** Allowed slippage in percent as typed (≤ 4 decimals); absent means the server default. */
  slippagePercent?: string;
}

// Single-value keys used before the preferences were bundled; migrated once.
const LEGACY_STORAGE_KEYS = {
  tradeExecutionPopup: "tradex:trade-execution-popup:v1",
} as const;

const DEFAULT_TRADE_EXECUTION_POPUP = true;
const DEFAULT_LIVE_NOTIFICATION_POPUP = true;
const SLIPPAGE_PERCENT_PATTERN = /^(?!$)\d*\.?\d{0,4}$/;

let preferences: Preferences | undefined;
const listeners = new Set<() => void>();

/** Keeps only well-formed fields so a hand-edited or stale record cannot break the UI. */
export function sanitizePreferences(raw: unknown): Preferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const out: Preferences = {};
  if (typeof input.tradeExecutionPopup === "boolean") out.tradeExecutionPopup = input.tradeExecutionPopup;
  if (typeof input.liveNotificationPopup === "boolean") out.liveNotificationPopup = input.liveNotificationPopup;
  if (input.selectedAccount && typeof input.selectedAccount === "object") {
    const account = input.selectedAccount as Record<string, unknown>;
    if (typeof account.userId === "string" && account.userId.trim() &&
        typeof account.accountId === "string" && account.accountId.trim()) {
      out.selectedAccount = { userId: account.userId, accountId: account.accountId };
    }
  }
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
  const migrated = sanitizePreferences({
    tradeExecutionPopup: popup === "true" ? true : popup === "false" ? false : undefined,
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
    try {
      migrateLegacyChartSettings(storage);
    } catch {
      // General preferences can still be read if chart migration cannot write.
    }
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
    const storage = window.localStorage;
    // Preserve legacy chart fields when their separate record could not be written.
    let legacyChartFields = {};
    try {
      migrateLegacyChartSettings(storage);
    } catch {
      try {
        const old = JSON.parse(storage.getItem(PREFERENCES_STORAGE_KEY) ?? "{}");
        legacyChartFields = { candleInterval: old?.candleInterval, volumePaneRatio: old?.volumePaneRatio };
      } catch { /* Ignore malformed legacy data. */ }
    }
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ ...legacyChartFields, ...preferences }));
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
