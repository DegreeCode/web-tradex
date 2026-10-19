import type { CandleInterval } from "./types";

const CANDLE_INTERVALS: readonly CandleInterval[] = [
  "1s", "1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M", "1y",
];

export const CANDLE_INTERVAL_LABELS: Record<CandleInterval, string> = {
  "1s": "1초",
  "1m": "1분",
  "5m": "5분",
  "15m": "15분",
  "30m": "30분",
  "1h": "1시간",
  "4h": "4시간",
  "1d": "1일",
  "1w": "1주",
  "1M": "1개월",
  "1y": "1년",
};

const FALLBACK_CANDLE_INTERVALS: readonly CandleInterval[] = [
  "1m", "5m", "15m", "1h", "4h", "1d",
];

// Calendar intervals use representative durations only for choosing a nearby
// option. Candle bucket boundaries still follow the existing calendar math.
const CANDLE_INTERVAL_SECONDS: Record<CandleInterval, number> = {
  "1s": 1,
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "30m": 30 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
  "1w": 7 * 24 * 60 * 60,
  "1M": 30 * 24 * 60 * 60,
  "1y": 365 * 24 * 60 * 60,
};

/** Missing exposure preserves the old buttons; an exposed empty list stays empty. */
export function resolveCandleIntervals(
  info?: { market?: { candle_intervals?: unknown } | null } | null,
): CandleInterval[] {
  const intervals = info?.market?.candle_intervals;
  if (!Array.isArray(intervals)) return [...FALLBACK_CANDLE_INTERVALS];
  const available = new Set<unknown>(intervals);
  return CANDLE_INTERVALS.filter((interval) => available.has(interval));
}

/** Chooses a usable interval without changing the user's saved preference. */
export function pickCandleInterval(
  saved: CandleInterval | undefined,
  available: readonly CandleInterval[],
  defaultInterval: CandleInterval = "1h",
): CandleInterval | undefined {
  if (available.length === 0) return undefined;
  if (saved && available.includes(saved)) return saved;
  if (available.includes(defaultInterval)) return defaultInterval;
  const targetSeconds = CANDLE_INTERVAL_SECONDS[saved ?? defaultInterval];
  // Keep the first option on ties; resolved lists are in canonical order.
  return available.reduce((nearest, interval) =>
    Math.abs(CANDLE_INTERVAL_SECONDS[interval] - targetSeconds) <
    Math.abs(CANDLE_INTERVAL_SECONDS[nearest] - targetSeconds) ? interval : nearest,
  );
}
