import test from "node:test";
import assert from "node:assert/strict";
import {
  pickCandleInterval,
  resolveCandleIntervals,
} from "../src/lib/candle-intervals";
import type { CandleInterval } from "../src/lib/types";

const canonical: CandleInterval[] = [
  "1s", "1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M", "1y",
];
const fallback: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

test("omitted market or intervals preserve the old timeframe buttons", () => {
  for (const info of [undefined, null, {}, { market: undefined }, { market: null }, { market: {} }]) {
    assert.deepEqual(resolveCandleIntervals(info), fallback);
  }
});

test("non-array intervals use the compatibility fallback", () => {
  for (const candle_intervals of [undefined, null, "1h", 60, {}, { 0: "1m" }]) {
    assert.deepEqual(resolveCandleIntervals({ market: { candle_intervals } }), fallback);
  }
});

test("unknown and duplicate intervals are dropped without changing the response", () => {
  const candle_intervals = ["4h", "unknown", "1m", "4h", "1m", "1M", "1M", "1H", 60, null];
  const original = [...candle_intervals];
  assert.deepEqual(resolveCandleIntervals({ market: { candle_intervals } }), ["1m", "4h", "1M"]);
  assert.deepEqual(candle_intervals, original);
});

test("server intervals are returned in canonical order including seconds and calendar intervals", () => {
  const candle_intervals = [...canonical].reverse();
  assert.deepEqual(resolveCandleIntervals({ market: { candle_intervals } }), canonical);
});

test("an exposed empty list stays empty", () => {
  assert.deepEqual(resolveCandleIntervals({ market: { candle_intervals: [] } }), []);
});

test("an array containing only unknown intervals stays empty", () => {
  assert.deepEqual(resolveCandleIntervals({ market: { candle_intervals: ["2m", "1H", 60] } }), []);
});

test("an available saved interval takes precedence over the default", () => {
  assert.equal(pickCandleInterval("5m", ["5m", "1h", "4h"]), "5m");
  assert.equal(pickCandleInterval("1s", canonical), "1s");
  assert.equal(pickCandleInterval("1M", canonical), "1M");
});

test("a disabled saved interval uses the default and returns when re-enabled", () => {
  const settings = { candleInterval: "30m" as const };
  assert.equal(pickCandleInterval(settings.candleInterval, fallback), "1h");
  assert.equal(settings.candleInterval, "30m");
  assert.equal(pickCandleInterval(settings.candleInterval, canonical), "30m");
});

test("no saved interval uses the available default", () => {
  assert.equal(pickCandleInterval(undefined, fallback), "1h");
});

test("when saved and default intervals are disabled the nearest duration to saved wins", () => {
  assert.equal(pickCandleInterval("15m", ["1m", "5m", "30m", "4h"]), "5m");
  assert.equal(pickCandleInterval("1w", ["1d", "1M", "1y"]), "1d");
  assert.equal(pickCandleInterval("1M", ["1s", "1w", "1y"]), "1w");
  assert.equal(pickCandleInterval("1y", ["1d", "1M"]), "1M");
});

test("with no saved interval a disabled default uses its nearest duration", () => {
  assert.equal(pickCandleInterval(undefined, ["30m", "4h", "1d"]), "30m");
});

test("a custom default participates in default and nearest selection", () => {
  assert.equal(pickCandleInterval("1s", ["5m", "30m"], "30m"), "30m");
  assert.equal(pickCandleInterval(undefined, ["4h", "1w"], "1d"), "4h");
});

test("a single available interval is selected even when saved and default are disabled", () => {
  assert.equal(pickCandleInterval("1s", ["1y"]), "1y");
});

test("no interval is selected from an empty list", () => {
  assert.equal(pickCandleInterval("1m", []), undefined);
  assert.equal(pickCandleInterval(undefined, []), undefined);
});
