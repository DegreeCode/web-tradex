import test from "node:test";
import assert from "node:assert/strict";
import { appendCandleHistory, appendCandleHistoryWithGaps, applyTradeToCandlePage, mergeCandles } from "../src/lib/candle-data";
import { canIncrementallyUpdate } from "../src/lib/chart-updates";
import type { Candle, CandleInterval, PublicTrade } from "../src/lib/types";

const candle = (minute: number, close = "10", synthetic = false): Candle => ({
  symbol: "AAA.M", interval: "1m", timestamp: new Date(minute * 60_000).toISOString(),
  open: close, high: close, low: close, close,
  volume_shares: synthetic ? "0" : "1", volume_credit: synthetic ? "0" : close,
  trade_count: synthetic ? 0 : 1, ...(synthetic ? { synthetic } : {}),
});
const page = (data: Candle[], hasMore = true) => ({ data, page: { has_more: hasMore, next_cursor: hasMore ? "older" : null } });

test("older pages extend history without replacing a live overlap", () => {
  const current = page([candle(3, "30"), candle(2, "22")]);
  const merged = appendCandleHistory(current, page([candle(2, "20"), candle(1)]));
  assert.deepEqual(merged.data.map((row) => row.close), ["30", "22", "10"]);
  assert.equal(merged.historyLoaded, true);
  assert.equal(current.data.length, 2, "the cached page is not mutated");

  const exhausted = appendCandleHistory(current, page([], false));
  assert.deepEqual(exhausted.data, current.data);
  assert.equal(exhausted.page.has_more, false);
});

test("gap fillers never replace real candles", () => {
  const real = candle(1, "15");
  const filled = candle(1, "10", true);
  assert.deepEqual(mergeCandles([real], [filled]), [real]);
  assert.deepEqual(mergeCandles([filled], [real]), [real]);
});

test("older history fills gaps from the prior chronological close", () => {
  const result = appendCandleHistoryWithGaps(page([candle(7, "70"), candle(6, "60")]), page([candle(3, "30"), candle(0, "10")], false), "1m");
  assert.deepEqual(result.data.map((c) => c.close), ["70", "60", "30", "30", "30", "10", "10", "10"]);
  assert.deepEqual(result.data.map((c) => Date.parse(c.timestamp) / 60_000), [7, 6, 5, 4, 3, 2, 1, 0]);
  for (const c of result.data.filter((row) => row.synthetic)) {
    assert.deepEqual([c.volume_shares, c.trade_count], ["0", 0]);
  }
  // Later real history replaces a synthetic bucket; live candles still win.
  const next = appendCandleHistoryWithGaps(result, page([candle(5, "55"), candle(6, "1")]), "1m");
  assert.equal(next.data.find((c) => c.timestamp === candle(6).timestamp)?.close, "60");
  assert.equal(next.data.find((c) => c.timestamp === candle(5).timestamp)?.synthetic, undefined);
});

test("monthly buckets follow Asia/Seoul calendar boundaries", () => {
  const at = (timestamp: string, close: string): Candle => ({ ...candle(0, close), interval: "1M" as CandleInterval, timestamp });
  const result = appendCandleHistoryWithGaps(page([at("2026-03-31T15:00:00.000Z", "40")]), page([at("2025-12-31T15:00:00.000Z", "10")]), "1M");
  assert.deepEqual(result.data.map((c) => c.timestamp), [
    "2026-03-31T15:00:00.000Z", "2026-02-28T15:00:00.000Z", "2026-01-31T15:00:00.000Z", "2025-12-31T15:00:00.000Z",
  ]);
});

test("very sparse history stays bounded without dropping real candles", () => {
  const result = appendCandleHistoryWithGaps(page([candle(100_000, "20")]), page([candle(0, "10")]), "1m");
  assert.equal(result.data.length, 501);
  assert.equal(result.data.at(-1)?.close, "10");
});

test("a live trade updates the open bucket and older buckets need a refetch", () => {
  const trade = (minute: number, price: string): PublicTrade => ({
    symbol: "AAA.M", side: "BUY", price, quantity: "2", credit: "4", fee: "0",
    timestamp: new Date(minute * 60_000 + 5_000).toISOString(), sequence: minute,
  });
  const current = page([candle(10, "10"), candle(9, "9")]);
  const updated = applyTradeToCandlePage(current, "1m", 200, trade(10, "12"));
  assert.equal(updated.status, "updated");
  const open = updated.data?.find((c) => c.timestamp === candle(10).timestamp);
  assert.deepEqual([open?.high, open?.close, open?.volume_shares, open?.trade_count], ["12", "12", "3", 2]);
  assert.equal(applyTradeToCandlePage(current, "1m", 200, trade(9, "1")).status, "recovery");
});

test("charts update incrementally only for corrections and new trailing bars", () => {
  const points = (...times: number[]) => times.map((time) => ({ time, value: 1 }));
  const previous = points(60, 180, 300);
  assert.equal(canIncrementallyUpdate(previous, previous.map((point) => ({ ...point, value: 2 }))), true);
  assert.equal(canIncrementallyUpdate(previous, points(60, 180, 300, 360)), true);
  // Finer intervals, backfills, rolling windows and empty states need setData.
  assert.equal(canIncrementallyUpdate(previous, points(60, 120, 180, 240, 300)), false);
  assert.equal(canIncrementallyUpdate(previous, points(0, 60, 180, 300)), false);
  assert.equal(canIncrementallyUpdate(points(60, 180), points(180, 300)), false);
  assert.equal(canIncrementallyUpdate([], points(60)), false);
  assert.equal(canIncrementallyUpdate(points(60), []), false);
});
