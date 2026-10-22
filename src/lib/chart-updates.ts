import type { LightweightCandlePoint, LightweightLinePoint, LightweightVolumePoint } from "../components/lightweight-chart";
import { decimalPrecision, toNumber } from "./format";
import type { Candle } from "./types";

// Query's immutable rows survive last-bar updates. Weak keys release points
// when their candles leave the cache, including when switching symbols.
const candlePoints = new WeakMap<Candle, { point?: LightweightCandlePoint; precision: number }>();
const linePoints = new WeakMap<LightweightCandlePoint, LightweightLinePoint>();
const volumePoints = new WeakMap<LightweightCandlePoint, LightweightVolumePoint>();

export function buildCandleChartData(candles: Candle[]) {
  const data: LightweightCandlePoint[] = [];
  let pricePrecision = 0;
  let ordered = true;
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    let converted = candlePoints.get(candle);
    if (!converted) {
      const precision = Math.max(decimalPrecision(candle.open), decimalPrecision(candle.high),
        decimalPrecision(candle.low), decimalPrecision(candle.close));
      const time = Math.floor(Date.parse(candle.timestamp) / 1_000);
      const point: LightweightCandlePoint | undefined = Number.isFinite(time) ? {
        time: time as LightweightCandlePoint["time"], timestamp: candle.timestamp,
        open: toNumber(candle.open), high: toNumber(candle.high), low: toNumber(candle.low), close: toNumber(candle.close),
        volume: candle.volume_shares, volumeValue: toNumber(candle.volume_shares), tradeCount: candle.trade_count,
        openText: candle.open, highText: candle.high, lowText: candle.low, closeText: candle.close,
        synthetic: candle.synthetic,
      } : undefined;
      converted = { point, precision };
      candlePoints.set(candle, converted);
    }
    pricePrecision = Math.max(pricePrecision, converted.precision);
    if (!converted.point) continue;
    if (data.length && converted.point.time <= data[data.length - 1].time) ordered = false;
    data.push(converted.point);
  }
  // Sparse fixtures or an older cache can still need sorting/deduplication.
  if (!ordered) data.sort((left, right) => left.time - right.time);
  return {
    data: ordered ? data : data.filter((point, index) => index === 0 || point.time !== data[index - 1].time),
    pricePrecision,
  };
}

export function candleLinePoint(point: LightweightCandlePoint): LightweightLinePoint {
  let line = linePoints.get(point);
  if (!line) {
    line = { time: point.time, value: point.close, timestamp: point.timestamp, valueText: point.closeText };
    linePoints.set(point, line);
  }
  return line;
}

export function candleVolumePoint(point: LightweightCandlePoint): LightweightVolumePoint {
  let volume = volumePoints.get(point);
  if (!volume) {
    volume = { time: point.time, value: point.volumeValue, color: point.close >= point.open ? "#f0445299" : "#3182f699" };
    volumePoints.set(point, volume);
  }
  return volume;
}

export function canIncrementallyUpdate<T extends { time: number }>(
  previous: T[],
  next: T[],
): boolean {
  if (previous.length === 0 || next.length < previous.length) return false;
  // update(..., true) can only replace an existing timestamp. A finer
  // interval or a backfill inserts historical points and needs setData.
  // Equal endpoints alone don't guarantee matching historical timestamps.
  // A corrected middle bucket must go through setData too.
  return previous.every((point, index) => point.time === next[index].time);
}

/** Chart data is sorted oldest first; crosshair lookup must stay cheap. */
export function findChartPoint<T extends { time: number }>(points: T[], time: number | null): T | undefined {
  if (time === null) return undefined;
  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const point = points[middle];
    if (point.time === time) return point;
    if (point.time < time) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}
