import test from "node:test";
import assert from "node:assert/strict";

import { buildTradeChartData } from "../src/lib/chart-trades";
import { buildCandleChartData, candleLinePoint, candleVolumePoint, canIncrementallyUpdate, findChartPoint } from "../src/lib/chart-updates";
import type { Candle, PublicTrade } from "../src/lib/types";

const trade = (sequence: number, timestamp: string, price = "10", quantity = "0.1"): PublicTrade => ({
  symbol: "AAA.M", side: "BUY", price, quantity, credit: "1", fee: "0", sequence, timestamp,
});

test("trade charts preserve the sequence close across nanoseconds and backward server clocks", () => {
  for (const [firstTime, lastTime] of [
    ["2026-10-14T01:02:03.123000001Z", "2026-10-14T01:02:03.123000002Z"],
    ["2026-10-14T01:02:03.900Z", "2026-10-14T01:02:03.100Z"],
  ]) {
    const first = trade(1, firstTime);
    const last = trade(2, lastTime, "11.00000001", "0.2");
    for (const input of [[first, last], [last, first]]) {
      const data = buildTradeChartData(input);
      assert.equal(data.points.length, 1);
      assert.equal(data.points[0].timestamp, lastTime);
      assert.equal(data.points[0].valueText, last.price);
      assert.equal(data.volume[0].value, 0.3);
      assert.equal(data.pricePrecision, 8);
    }
  }
});

test("trade chart prices and volumes stay aligned in chronological order", () => {
  const older = trade(1, "2026-10-14T01:02:03.100Z", "20");
  const newer = trade(2, "2026-10-14T01:02:04.100Z", "10", "0.2");
  const data = buildTradeChartData([newer, trade(3, "invalid"), older]);
  assert.deepEqual(data.points.map(point => point.value), [20, 10]);
  assert.deepEqual(data.volume.map(point => point.time), data.points.map(point => point.time));
  assert.deepEqual(data.volume.map(point => point.value), [0.1, 0.2]);
  assert.equal(data.volume[1].color, "#3182f699");
  assert.deepEqual(buildTradeChartData([]), { points: [], volume: [], pricePrecision: 0 });
});

test("hover lookup reads corrected points and handles removed or missing timestamps", () => {
  const points = [10, 20, 30, 40].map(time => ({ time, value: 1 }));
  for (const point of points) assert.equal(findChartPoint(points, point.time), point);
  const corrected = points.map(point => point.time === 20 ? { ...point, value: 5 } : point);
  assert.equal(findChartPoint(corrected, 20)?.value, 5);
  for (const time of [null, 0, 25, 50]) assert.equal(findChartPoint(points, time), undefined);
  assert.equal(findChartPoint([], 20), undefined);
});

test("charts update incrementally only for corrections and new trailing bars", () => {
  const points = (...times: number[]) => times.map(time => ({ time, value: 1 }));
  const previous = points(60, 180, 300);
  assert.equal(canIncrementallyUpdate(previous, previous.map(point => ({ ...point, value: 2 }))), true);
  assert.equal(canIncrementallyUpdate(previous, points(60, 180, 300, 360)), true);
  // Finer intervals, backfills, rolling windows and empty states need setData.
  assert.equal(canIncrementallyUpdate(previous, points(60, 120, 180, 240, 300)), false);
  assert.equal(canIncrementallyUpdate(previous, points(60, 240, 300)), false);
  assert.equal(canIncrementallyUpdate(previous, points(0, 60, 180, 300)), false);
  assert.equal(canIncrementallyUpdate(points(60, 180), points(180, 300)), false);
  assert.equal(canIncrementallyUpdate([], points(60)), false);
  assert.equal(canIncrementallyUpdate(points(60), []), false);
});

const candle = (timestamp: string, close = "10.10"): Candle => ({
  symbol: "AAA.M", interval: "1m", timestamp, open: "10", high: close, low: "9", close,
  volume_shares: "2.5", volume_credit: "25", trade_count: 1,
});

test("candle conversion reuses unchanged rows and propagates last and historical corrections", () => {
  const older = candle("2026-10-14T00:00:00Z");
  const newer = candle("2026-10-14T00:01:00Z");
  const first = buildCandleChartData([newer, older]);
  const next = buildCandleChartData([{ ...newer, close: "11.12345678", volume_shares: "3" }, older]);
  assert.equal(next.data[0], first.data[0]);
  assert.notEqual(next.data[1], first.data[1]);
  assert.equal(next.data[1].close, 11.12345678);
  assert.equal(next.pricePrecision, 8);
  assert.equal(candleLinePoint(next.data[0]), candleLinePoint(first.data[0]));
  assert.equal(candleVolumePoint(next.data[0]), candleVolumePoint(first.data[0]));
  assert.equal(candleLinePoint(next.data[1]).value, 11.12345678);
  assert.equal(candleVolumePoint(next.data[1]).value, 3);
  const corrected = buildCandleChartData([newer, { ...older, close: "7", synthetic: true }]);
  assert.equal(corrected.data[0].close, 7);
  assert.equal(corrected.data[0].synthetic, true);
  assert.equal(candleLinePoint(corrected.data[0]).valueText, "7");
  assert.equal(candleVolumePoint(corrected.data[0]).color, "#3182f699");
  assert.equal(corrected.pricePrecision, 2, "precision can shrink after a correction");
});

test("candle conversion preserves values, precision, ordering and duplicate handling", () => {
  const older = candle("2026-10-14T00:00:00Z");
  const newer = candle("2026-10-14T00:01:00Z");
  const result = buildCandleChartData([older, newer, { ...newer, close: "12" }, candle("invalid", "1.1234")]);
  assert.deepEqual(result.data.map(point => point.close), [10.1, 12]);
  // The fallback keeps the first duplicate encountered in the reverse walk.
  assert.deepEqual(result.data.map(point => point.timestamp), [older.timestamp, newer.timestamp]);
  assert.equal(result.pricePrecision, 4);
  assert.equal(result.data[0].volumeValue, 2.5);
  assert.equal(result.data[0].tradeCount, 1);
  assert.deepEqual(buildCandleChartData([]), { data: [], pricePrecision: 0 });
});
