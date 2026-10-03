"use client";

import { useSyncExternalStore } from "react";
import { isCandleInterval } from "./candle-data";
import type { CandleInterval } from "./types";

export const CHART_SETTINGS_STORAGE_KEY = "tradex:chart-settings:v1";

export interface ChartSettings {
  candleInterval?: CandleInterval;
  seriesType?: "candle" | "line";
  /** Volume pane height divided by chart height. */
  volumePaneRatio?: number;
  /** Defaults to true for existing browsers. */
  showAverageCost?: boolean;
  /** Defaults to a linear price scale. */
  logarithmic?: boolean;
}

const OLD_PREFERENCES_KEY = "tradex:preferences:v1";
const LEGACY_INTERVAL_KEY = "tradex:candle-interval:v1";
const LEGACY_VOLUME_KEY = "tradex:volume-pane-ratio:v1";
let settings: ChartSettings | undefined;
const listeners = new Set<() => void>();

function isVolumePaneRatio(value: unknown): value is number {
  return typeof value === "number" && value > 0 && value < 1;
}

export function sanitizeChartSettings(raw: unknown): ChartSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const out: ChartSettings = {};
  if (isCandleInterval(input.candleInterval)) out.candleInterval = input.candleInterval;
  if (input.seriesType === "candle" || input.seriesType === "line") out.seriesType = input.seriesType;
  if (isVolumePaneRatio(input.volumePaneRatio)) out.volumePaneRatio = input.volumePaneRatio;
  if (typeof input.showAverageCost === "boolean") out.showAverageCost = input.showAverageCost;
  if (typeof input.logarithmic === "boolean") out.logarithmic = input.logarithmic;
  return out;
}

function parseRecord(raw: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Also called before general preferences are saved so old chart values survive. */
export function migrateLegacyChartSettings(storage: Storage): ChartSettings {
  const current = storage.getItem(CHART_SETTINGS_STORAGE_KEY);
  if (current !== null) return sanitizeChartSettings(parseRecord(current));
  const previousRaw = storage.getItem(OLD_PREFERENCES_KEY);
  const previous = parseRecord(previousRaw);
  const legacyRatio = storage.getItem(LEGACY_VOLUME_KEY);
  const migrated = sanitizeChartSettings({
    candleInterval: previous.candleInterval ?? storage.getItem(LEGACY_INTERVAL_KEY),
    volumePaneRatio: previous.volumePaneRatio ?? (legacyRatio === null ? undefined : Number(legacyRatio)),
  });
  if (Object.keys(migrated).length === 0) return migrated;
  // Only remove old chart fields after the new record has been safely written.
  storage.setItem(CHART_SETTINGS_STORAGE_KEY, JSON.stringify(migrated));
  try {
    delete previous.candleInterval;
    delete previous.volumePaneRatio;
    if (previousRaw !== null) storage.setItem(OLD_PREFERENCES_KEY, JSON.stringify(previous));
    storage.removeItem(LEGACY_INTERVAL_KEY);
    storage.removeItem(LEGACY_VOLUME_KEY);
  } catch {
    // The new record is saved; leftover old fields no longer take precedence.
  }
  return migrated;
}

function loadSettings(): ChartSettings {
  try {
    return migrateLegacyChartSettings(window.localStorage);
  } catch {
    return settings ?? {};
  }
}

export function readChartSettings(): ChartSettings {
  if (typeof window === "undefined") return {};
  if (settings === undefined) settings = loadSettings();
  return settings;
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function updateChartSettings(patch: Partial<ChartSettings>): void {
  const next: ChartSettings = { ...readChartSettings(), ...patch };
  for (const key of Object.keys(next) as (keyof ChartSettings)[]) {
    if (next[key] === undefined) delete next[key];
  }
  settings = sanitizeChartSettings(next);
  try {
    window.localStorage.setItem(CHART_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Keep controls usable when browser storage is unavailable.
  }
  emit();
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CHART_SETTINGS_STORAGE_KEY && event.key !== null) return;
    settings = sanitizeChartSettings(parseRecord(event.newValue));
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

/** Null until hydration to keep the static markup consistent. */
export function useChartSettings(): ChartSettings | null {
  return useSyncExternalStore(subscribe, readChartSettings, getServerSnapshot);
}

export function calculateVolumePaneHeight(totalHeight: number): number {
  const ratio = readChartSettings().volumePaneRatio;
  return ratio === undefined
    ? Math.min(78, Math.max(56, Math.round(totalHeight * 0.28)))
    : Math.round(totalHeight * ratio);
}

export function setVolumePaneRatio(ratio: number): void {
  if (isVolumePaneRatio(ratio)) updateChartSettings({ volumePaneRatio: ratio });
}
