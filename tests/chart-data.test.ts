import test from "node:test";
import assert from "node:assert/strict";

import { buildTradeChartData } from "../src/lib/chart-trades";
import { canIncrementallyUpdate, findChartPoint } from "../src/lib/chart-updates";
import type { PublicTrade } from "../src/lib/types";

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
  assert.equal(canIncrementallyUpdate(previous, points(0, 60, 180, 300)), false);
  assert.equal(canIncrementallyUpdate(points(60, 180), points(180, 300)), false);
  assert.equal(canIncrementallyUpdate([], points(60)), false);
  assert.equal(canIncrementallyUpdate(points(60), []), false);
});
