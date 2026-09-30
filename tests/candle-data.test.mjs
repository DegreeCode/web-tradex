import assert from "node:assert/strict";
import { test } from "node:test";
import { appendCandleHistory, mergeCandles } from "../src/lib/candle-data.ts";

const candle = (minute, close = "10", synthetic = false) => ({
  symbol: "AAA.M", interval: "1m", timestamp: new Date(minute * 60000).toISOString(),
  open: close, high: close, low: close, close,
  volume_shares: synthetic ? "0" : "1", volume_credit: close,
  trade_count: synthetic ? 0 : 1, synthetic,
});

test("older pages extend history without replacing a live overlap", () => {
  const current = { data: [candle(3, "30"), candle(2, "22")], page: { has_more: true, next_cursor: "first" } };
  const older = { data: [candle(2, "20"), candle(1)], page: { has_more: true, next_cursor: "second" } };
  const merged = appendCandleHistory(current, older);
  assert.deepEqual(merged.data.map((row) => row.close), ["30", "22", "10"]);
  assert.deepEqual(merged.page, older.page);
  assert.equal(merged.historyLoaded, true);
  assert.equal(current.data.length, 2);
});

test("gap fillers cannot discard real candles in a sparse history page", () => {
  const real = candle(1, "15");
  const filled = candle(1, "10", true);
  assert.deepEqual(mergeCandles([real], [filled]), [real]);
  assert.deepEqual(mergeCandles([filled], [real]), [real]);
  assert.deepEqual(mergeCandles([candle(-200), real], [candle(5, "20", true)]).map((row) => row.timestamp),
    [candle(5).timestamp, real.timestamp, candle(-200).timestamp]);
});

test("empty final page preserves the chart and marks history exhausted", () => {
  const current = { data: [candle(3)], page: { has_more: true, next_cursor: "last" } };
  const merged = appendCandleHistory(current, { data: [], page: { has_more: false, next_cursor: null } });
  assert.deepEqual(merged.data, current.data);
  assert.equal(merged.page.has_more, false);
});
