import { addDecimal, compareDecimal } from "./format";
import type { Candle, CandleInterval, Page, PublicTrade } from "./types";

// Live trades re-merge the same cached timestamps over and over; parsing each
// ISO string once keeps that merge cheap. Bounded like the bucket memo below.
const MAX_MEMOIZED_TIMES = 10_000;
const timeMemo = new Map<string, number>();

/** Date.parse with a bounded memo for the timestamps a candle page repeats. */
function parseTime(timestamp: string): number {
  let time = timeMemo.get(timestamp);
  if (time === undefined) {
    time = Date.parse(timestamp);
    if (timeMemo.size >= MAX_MEMOIZED_TIMES) timeMemo.clear();
    timeMemo.set(timestamp, time);
  }
  return time;
}

export interface CandlePage extends Page<Candle> {
  historyLoaded?: boolean;
  /** Exclusive REST trade timestamp boundary, used to avoid delayed WS duplicates. */
  syncedThrough?: string;
}

/** Newer observations win overlaps; gap fillers never replace real trades. */
export function mergeCandles(older: Candle[], newer: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of [...older, ...newer]) {
    const time = parseTime(candle.timestamp);
    const previous = byTime.get(time);
    if (!candle.synthetic || !previous || previous.synthetic) byTime.set(time, candle);
  }
  return [...byTime].sort(([a], [b]) => b - a).map(([, candle]) => candle);
}

export function appendCandleHistory(current: CandlePage, older: Page<Candle>): CandlePage {
  return { ...current, data: mergeCandles(older.data, current.data), page: older.page, historyLoaded: true };
}

// The API documents Asia/Seoul as the default APP_TIMEZONE. Candle timestamps
// are emitted as UTC instants, so bucket arithmetic is performed in this zone.
const CANDLE_APP_TIMEZONE = "Asia/Seoul";
const CANDLE_FIXED_INTERVAL_MS: Partial<Record<CandleInterval, number>> = {
  "1s": 1_000,
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
};
const CANDLE_INTERVALS: readonly CandleInterval[] = [
  "1s",
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
  "1M",
  "1y",
];
const CANDLE_ORIGIN_LOCAL_MS = Date.UTC(2000, 0, 1);
// Never walk an unbounded no-trade period. The API limits candle pages to 500,
// so the chart only materializes the bounded, most-recent window it can show.
const MAX_SYNTHETIC_CANDLE_BUCKETS = 500;

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const candleTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CANDLE_APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function zonedParts(date: Date): ZonedDateParts {
  const values: Partial<ZonedDateParts> = {};
  for (const part of candleTimeFormatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type as keyof ZonedDateParts] = Number(part.value);
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function localPartsAtUtcMillis(localMillis: number): ZonedDateParts {
  const date = new Date(localMillis);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function localPartsToInstant(parts: ZonedDateParts): number {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let instant = target;
  // Solve the timezone offset from the target local fields instead of relying
  // on the browser's local timezone. A second pass handles DST transitions.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const observed = zonedParts(new Date(instant));
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    instant += target - observedAsUtc;
  }
  return instant;
}

function localMillisToTimestamp(localMillis: number): string {
  return new Date(localPartsToInstant(localPartsAtUtcMillis(localMillis))).toISOString();
}

// Every live trade re-buckets the whole cached page, and each bucket costs an
// Intl.formatToParts call. The same timestamps recur trade after trade, so the
// results are memoized in a bounded cache that is simply dropped when full.
const MAX_MEMOIZED_BUCKETS = 10_000;
const bucketMemo = new Map<string, string | null>();

function memoizedBucket(
  kind: "bucket" | "previous",
  timestamp: string,
  interval: CandleInterval,
  compute: () => string | null,
): string | null {
  const key = `${kind}|${interval}|${timestamp}`;
  const cached = bucketMemo.get(key);
  if (cached !== undefined) return cached;
  const value = compute();
  if (bucketMemo.size >= MAX_MEMOIZED_BUCKETS) bucketMemo.clear();
  bucketMemo.set(key, value);
  return value;
}

function candleBucketTimestamp(timestamp: string, interval: CandleInterval): string | null {
  return memoizedBucket("bucket", timestamp, interval, () => computeCandleBucketTimestamp(timestamp, interval));
}

function previousCandleBucketTimestamp(timestamp: string, interval: CandleInterval): string | null {
  return memoizedBucket("previous", timestamp, interval, () => computePreviousCandleBucketTimestamp(timestamp, interval));
}

function computeCandleBucketTimestamp(timestamp: string, interval: CandleInterval): string | null {
  const instant = parseTime(timestamp);
  if (!Number.isFinite(instant)) return null;
  const local = zonedParts(new Date(instant));
  const localMillis = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  let bucketLocalMillis: number;
  const fixedSize = CANDLE_FIXED_INTERVAL_MS[interval];
  if (fixedSize) {
    bucketLocalMillis =
      CANDLE_ORIGIN_LOCAL_MS + Math.floor((localMillis - CANDLE_ORIGIN_LOCAL_MS) / fixedSize) * fixedSize;
  } else if (interval === "1d") {
    bucketLocalMillis = Date.UTC(local.year, local.month - 1, local.day);
  } else if (interval === "1w") {
    const dayOfWeek = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    const daysFromMonday = (dayOfWeek + 6) % 7;
    bucketLocalMillis = Date.UTC(local.year, local.month - 1, local.day - daysFromMonday);
  } else if (interval === "1M") {
    bucketLocalMillis = Date.UTC(local.year, local.month - 1, 1);
  } else if (interval === "1y") {
    bucketLocalMillis = Date.UTC(local.year, 0, 1);
  } else {
    return null;
  }
  return localMillisToTimestamp(bucketLocalMillis);
}

function computePreviousCandleBucketTimestamp(timestamp: string, interval: CandleInterval): string | null {
  const instant = parseTime(timestamp);
  if (!Number.isFinite(instant)) return null;
  const local = zonedParts(new Date(instant));
  const localMillis = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  const fixedSize = CANDLE_FIXED_INTERVAL_MS[interval];
  if (fixedSize) return localMillisToTimestamp(localMillis - fixedSize);
  if (interval === "1d") return localMillisToTimestamp(Date.UTC(local.year, local.month - 1, local.day - 1));
  if (interval === "1w") return localMillisToTimestamp(Date.UTC(local.year, local.month - 1, local.day - 7));
  if (interval === "1M") return localMillisToTimestamp(Date.UTC(local.year, local.month - 2, 1));
  if (interval === "1y") return localMillisToTimestamp(Date.UTC(local.year - 1, 0, 1));
  return null;
}

interface FilledCandleData {
  data: Candle[];
  capped: boolean;
}

export function fillCandleGaps(
  candles: Candle[],
  interval: CandleInterval,
  limit: number,
  throughTimestamp?: string,
): FilledCandleData {
  const byTimestamp = new Map<string, Candle>();
  for (const candle of candles) {
    const bucket = candleBucketTimestamp(candle.timestamp, interval);
    if (bucket) byTimestamp.set(bucket, { ...candle, interval, timestamp: bucket });
  }
  const sorted = [...byTimestamp.values()]
    .map((candle) => ({ candle, time: parseTime(candle.timestamp) }))
    .sort((left, right) => left.time - right.time)
    .map(({ candle }) => candle);
  const safeLimit = Math.max(0, Math.min(MAX_SYNTHETIC_CANDLE_BUCKETS, Math.floor(limit)));
  if (sorted.length === 0 || safeLimit === 0) return { data: [], capped: limit > safeLimit };

  // The REST page is newest-first and may contain very sparse buckets. Walk
  // backwards from the newest real/current bucket so a large old gap cannot
  // consume the entire synthetic budget before the chart's visible window is
  // reached. A synthetic bucket's close comes from the nearest earlier real
  // bucket, which is the previous chronological close by definition.
  const realTimes = sorted.map((candle) => parseTime(candle.timestamp));
  const latestReal = sorted[sorted.length - 1];
  const requestedBucket = throughTimestamp
    ? candleBucketTimestamp(throughTimestamp, interval)
    : null;
  const latestRealTime = parseTime(latestReal.timestamp);
  const requestedTime = requestedBucket ? parseTime(requestedBucket) : Number.NEGATIVE_INFINITY;
  let cursor = requestedTime > latestRealTime ? requestedBucket : latestReal.timestamp;
  const descending: Candle[] = [];

  const previousReal = (timestamp: string): Candle | undefined => {
    const time = parseTime(timestamp);
    let low = 0;
    let high = realTimes.length - 1;
    let index = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (realTimes[middle] < time) {
        index = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return index >= 0 ? sorted[index] : undefined;
  };

  while (cursor && descending.length < safeLimit) {
    const real = byTimestamp.get(cursor);
    if (real) {
      descending.push(real);
    } else {
      const previous = previousReal(cursor);
      if (!previous) break;
      descending.push({
        symbol: previous.symbol,
        interval,
        timestamp: cursor,
        open: previous.close,
        high: previous.close,
        low: previous.close,
        close: previous.close,
        volume_shares: "0",
        volume_credit: "0",
        trade_count: 0,
        synthetic: true,
      });
    }
    cursor = previousCandleBucketTimestamp(cursor, interval);
  }

  return {
    data: descending,
    // Valid API limits are <=500, so stopping at safeLimit is intentional
    // pagination/window behavior rather than a recovery condition.
    capped: limit > safeLimit,
  };
}

/** Fill the newly loaded history and its seam without rebuilding newer candles. */
export function appendCandleHistoryWithGaps(
  current: CandlePage,
  older: Page<Candle>,
  interval: CandleInterval,
): CandlePage {
  const merged = appendCandleHistory(current, older);
  if (older.data.length === 0) return merged;
  const boundary = current.data[current.data.length - 1];
  const history = boundary
    ? merged.data.filter((candle) => parseTime(candle.timestamp) <= parseTime(boundary.timestamp))
    : merged.data;
  const fillers: Candle[] = [];
  for (let index = 0; index + 1 < history.length; index += 1) {
    // Keep the existing per-gap safety bound for sparse second-level history.
    // Each adjacent pair seeds from the earlier close, including page seams.
    fillers.push(...fillCandleGaps(
      [history[index + 1], history[index]], interval, MAX_SYNTHETIC_CANDLE_BUCKETS,
    ).data);
  }
  return { ...merged, data: mergeCandles(fillers, merged.data) };
}

export function isCandleInterval(value: unknown): value is CandleInterval {
  return typeof value === "string" && CANDLE_INTERVALS.includes(value as CandleInterval);
}

/** `count` lets one entry stand for several trades (a guest's polled ticker delta). */
export function applyTradeToCandlePage(
  page: CandlePage,
  interval: CandleInterval,
  limit: number,
  trade: PublicTrade,
  count = 1,
): { status: "updated" | "recovery"; data?: Candle[] } {
  const timestamp = candleBucketTimestamp(trade.timestamp, interval);
  if (!timestamp || !trade.price || !trade.quantity || !trade.credit) return { status: "recovery" };
  const data = [...page.data];
  const tradeTime = parseTime(timestamp);
  const latestTime = data.reduce((latest, candle) => {
    const value = parseTime(candle.timestamp);
    return Number.isFinite(value) && value > latest ? value : latest;
  }, Number.NEGATIVE_INFINITY);
  const existingIndex = data.findIndex(
    (candle) => candleBucketTimestamp(candle.timestamp, interval) === timestamp,
  );
  if (existingIndex < 0 && Number.isFinite(latestTime) && tradeTime < latestTime) return { status: "recovery" };
  if (
    existingIndex >= 0 &&
    !data[existingIndex].synthetic &&
    Number.isFinite(latestTime) &&
    tradeTime < latestTime
  ) {
    return { status: "recovery" };
  }

  if (existingIndex >= 0) {
    const existing = data[existingIndex];
    data[existingIndex] = existing.synthetic
      ? {
          ...existing,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volume_shares: trade.quantity,
          volume_credit: trade.credit,
          trade_count: count,
          synthetic: false,
        }
      : {
          ...existing,
          high: compareDecimal(existing.high, trade.price) >= 0 ? existing.high : trade.price,
          low: compareDecimal(existing.low, trade.price) <= 0 ? existing.low : trade.price,
          close: trade.price,
          volume_shares: addDecimal(existing.volume_shares, trade.quantity),
          volume_credit: addDecimal(existing.volume_credit, trade.credit),
          trade_count: existing.trade_count + count,
        };
  } else {
    data.push({
      symbol: trade.symbol,
      interval,
      timestamp,
      open: trade.price,
      high: trade.price,
      low: trade.price,
      close: trade.price,
      volume_shares: trade.quantity,
      volume_credit: trade.credit,
      trade_count: count,
    });
  }
  const filled = fillCandleGaps(data, interval, limit);
  if (filled.capped) return { status: "recovery" };
  const retained = page.historyLoaded
    ? data
    : mergeCandles([], data.filter((candle) => !candle.synthetic)).slice(0, limit);
  return { status: "updated", data: mergeCandles(retained, filled.data) };
}
