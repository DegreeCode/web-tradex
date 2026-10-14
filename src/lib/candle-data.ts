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
// Bound memory and sparse-gap catch-up while allowing useful scrollback (about
// 3.5 days at 1m). This total window is independent of the REST limit of at most
// 500 rows per request: older pages keep extending it until this cap is reached.
export const MAX_MATERIALIZED_CANDLE_BUCKETS = 5_000;

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

// Fetch/history normalization re-buckets cached timestamps, and each bucket
// costs an Intl.formatToParts call. Memoize those recurring timestamps in a
// bounded cache; ordinary live updates only compute the new tail.
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

/** Next boundary in APP timezone, including variable-length calendar buckets. */
export function nextCandleBucketTimestamp(timestamp: string, interval: CandleInterval): string | null {
  const bucket = candleBucketTimestamp(timestamp, interval);
  if (!bucket) return null;
  const local = zonedParts(new Date(bucket));
  const millis = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const fixed = CANDLE_FIXED_INTERVAL_MS[interval];
  if (fixed) return localMillisToTimestamp(millis + fixed);
  if (interval === "1d") return localMillisToTimestamp(Date.UTC(local.year, local.month - 1, local.day + 1));
  if (interval === "1w") return localMillisToTimestamp(Date.UTC(local.year, local.month - 1, local.day + 7));
  if (interval === "1M") return localMillisToTimestamp(Date.UTC(local.year, local.month, 1));
  if (interval === "1y") return localMillisToTimestamp(Date.UTC(local.year + 1, 0, 1));
  return null;
}

// Cache validity by immutable array identity, not by page metadata: Query's
// structural sharing can replace arrays, in which case we validate them again.
const materializedIntervals = new WeakMap<Candle[], CandleInterval>();

function rememberMaterializedData(data: Candle[], interval: CandleInterval): Candle[] {
  materializedIntervals.set(data, interval);
  return data;
}

function isMaterializedData(data: Candle[], interval: CandleInterval): boolean {
  if (materializedIntervals.get(data) === interval) return true;
  if (data.length === 0 || data.length > MAX_MATERIALIZED_CANDLE_BUCKETS) return false;
  const newest = candleBucketTimestamp(data[0].timestamp, interval);
  if (!newest || parseTime(newest) !== parseTime(data[0].timestamp)) return false;
  const fixed = CANDLE_FIXED_INTERVAL_MS[interval];
  for (let index = 0; index < data.length; index += 1) {
    if (data[index].interval !== interval) return false;
    if (index === 0) continue;
    const expected = fixed
      ? parseTime(data[index - 1].timestamp) - fixed
      : parseTime(previousCandleBucketTimestamp(data[index - 1].timestamp, interval) ?? "");
    if (parseTime(data[index].timestamp) !== expected) return false;
  }
  rememberMaterializedData(data, interval);
  return true;
}

function flatCandle(previous: Candle, interval: CandleInterval, timestamp: string): Candle {
  return {
    symbol: previous.symbol, interval, timestamp,
    open: previous.close, high: previous.close, low: previous.close, close: previous.close,
    volume_shares: "0", volume_credit: "0", trade_count: 0, synthetic: true,
  };
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
    if (bucket && (!candle.synthetic || !byTimestamp.has(bucket))) {
      byTimestamp.set(bucket, { ...candle, interval, timestamp: bucket });
    }
  }
  const sorted = [...byTimestamp.values()]
    .map((candle) => ({ candle, time: parseTime(candle.timestamp) }))
    .sort((left, right) => left.time - right.time)
    .map(({ candle }) => candle);
  const safeLimit = Math.max(0, Math.min(MAX_MATERIALIZED_CANDLE_BUCKETS, Math.floor(limit)));
  if (sorted.length === 0 || safeLimit === 0) return { data: [], capped: limit > safeLimit };

  // The REST page is newest-first and may contain very sparse buckets. Walk
  // backwards from the newest real/current bucket so a large old gap cannot
  // consume the entire synthetic budget before the chart's visible window is
  // reached. A synthetic bucket's close comes from the nearest earlier real
  // bucket, which is the previous chronological close by definition.
  // Synthetic observations are not price evidence. Keep only the oldest as a
  // seed if its real predecessor has rolled out of the bounded window; rebuild
  // the rest so a late trade also corrects the flat candles that follow it.
  const seeds = sorted.filter((candle, index) => !candle.synthetic || index === 0);
  const seedTimes = seeds.map((candle) => parseTime(candle.timestamp));
  const latest = sorted[sorted.length - 1];
  const requestedBucket = throughTimestamp
    ? candleBucketTimestamp(throughTimestamp, interval)
    : null;
  const latestTime = parseTime(latest.timestamp);
  const requestedTime = requestedBucket ? parseTime(requestedBucket) : Number.NEGATIVE_INFINITY;
  let cursor = requestedTime > latestTime ? requestedBucket : latest.timestamp;
  const descending: Candle[] = [];

  const previousSeed = (timestamp: string): Candle | undefined => {
    const time = parseTime(timestamp);
    let low = 0;
    let high = seedTimes.length - 1;
    let index = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (seedTimes[middle] < time) {
        index = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return index >= 0 ? seeds[index] : undefined;
  };

  while (cursor && descending.length < safeLimit) {
    const real = byTimestamp.get(cursor);
    if (real && (!real.synthetic || real === sorted[0])) {
      descending.push(real);
    } else {
      const previous = previousSeed(cursor);
      if (!previous) break;
      descending.push(flatCandle(previous, interval, cursor));
    }
    cursor = previousCandleBucketTimestamp(cursor, interval);
  }

  return {
    data: rememberMaterializedData(descending, interval),
    capped: Boolean(cursor && parseTime(cursor) >= parseTime(sorted[0].timestamp)),
  };
}

/** A page is always one contiguous newest window, never real rows plus holes. */
export function materializeCandlePage(
  page: CandlePage,
  interval: CandleInterval,
  throughTimestamp?: string,
): CandlePage {
  const filled = fillCandleGaps(page.data, interval, MAX_MATERIALIZED_CANDLE_BUCKETS, throughTimestamp);
  return replaceCandlePageData(page, filled.data);
}

export function replaceCandlePageData(page: CandlePage, data: Candle[]): CandlePage {
  return {
    ...page,
    data,
    // At capacity, extending history would immediately discard what was loaded.
    // Retire the REST cursor instead of skipping omitted buckets silently.
    page: data.length >= MAX_MATERIALIZED_CANDLE_BUCKETS
      ? { ...page.page, has_more: false, next_cursor: null }
      : page.page,
  };
}

/** Fill history and its seam in one bounded walk from the newest bucket. */
export function appendCandleHistoryWithGaps(
  current: CandlePage,
  older: Page<Candle>,
  interval: CandleInterval,
): CandlePage {
  return materializeCandlePage(appendCandleHistory(current, older), interval);
}

/** Clock-only changes preserve REST synchronization and never invent a seed. */
export function advanceCandlePage(
  page: CandlePage,
  interval: CandleInterval,
  now: string,
): CandlePage {
  const latest = page.data[0];
  const bucket = candleBucketTimestamp(now, interval);
  if (!latest || !bucket || parseTime(bucket) <= parseTime(latest.timestamp)) return page;
  if (!isMaterializedData(page.data, interval)) return materializeCandlePage(page, interval, now);
  // Walk only the new tail. A long hidden period still does at most one window
  // of work, starting from now rather than iterating every elapsed bucket.
  const appended: Candle[] = [];
  let cursor: string | null = bucket;
  while (cursor && parseTime(cursor) > parseTime(latest.timestamp) &&
    appended.length < MAX_MATERIALIZED_CANDLE_BUCKETS) {
    appended.push(flatCandle(latest, interval, cursor));
    cursor = previousCandleBucketTimestamp(cursor, interval);
  }
  const data = appended.concat(page.data.slice(0, MAX_MATERIALIZED_CANDLE_BUCKETS - appended.length));
  return replaceCandlePageData(page, rememberMaterializedData(data, interval));
}

export function isCandleInterval(value: unknown): value is CandleInterval {
  return typeof value === "string" && CANDLE_INTERVALS.includes(value as CandleInterval);
}

/**
 * `count` lets one entry stand for several trades (a guest's polled ticker delta).
 * The REST limit stays in the call signature; materialized pages use the total
 * bucket cap so clock ticks and trades retain the same contiguous window.
 */
export function applyTradeToCandlePage(
  page: CandlePage,
  interval: CandleInterval,
  _limit: number,
  trade: PublicTrade,
  count = 1,
): { status: "updated" | "recovery"; data?: Candle[] } {
  const timestamp = candleBucketTimestamp(trade.timestamp, interval);
  if (!timestamp || !trade.price || !trade.quantity || !trade.credit) return { status: "recovery" };
  const contiguous = isMaterializedData(page.data, interval);
  const tradeTime = parseTime(timestamp);
  const latestTime = contiguous ? parseTime(page.data[0].timestamp) : page.data.reduce((latest, candle) => {
    const value = parseTime(candle.timestamp);
    return Number.isFinite(value) && value > latest ? value : latest;
  }, Number.NEGATIVE_INFINITY);
  // A trade in a new bucket only needs the missing tail plus its real candle.
  // The rest of the immutable window can retain its objects and timestamps.
  if (contiguous && tradeTime > latestTime) {
    const advanced = advanceCandlePage(page, interval, timestamp);
    const data = advanced.data.slice();
    data[0] = {
      symbol: trade.symbol, interval, timestamp,
      open: trade.price, high: trade.price, low: trade.price, close: trade.price,
      volume_shares: trade.quantity, volume_credit: trade.credit, trade_count: count,
    };
    return { status: "updated", data: rememberMaterializedData(data, interval) };
  }
  const data = [...page.data];
  const existingIndex = contiguous && tradeTime === latestTime ? 0 : data.findIndex(
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
  if (contiguous && existingIndex === 0) {
    return { status: "updated", data: rememberMaterializedData(data, interval) };
  }
  // Historical synthetic replacements also correct following dots; sparse or
  // unordered inputs likewise take the full normalization path.
  return { status: "updated", data: materializeCandlePage({ ...page, data }, interval).data };
}
