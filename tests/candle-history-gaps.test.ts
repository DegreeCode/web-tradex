import test from "node:test";
import assert from "node:assert/strict";
import { appendCandleHistoryWithGaps } from "../src/lib/candle-data";
import type { Candle, CandleInterval } from "../src/lib/types";

const candle = (minute: number, close: string): Candle => ({
  symbol: "AAA.M", interval: "1m", timestamp: new Date(minute * 60_000).toISOString(),
  open: close, high: close, low: close, close, volume_shares: "1", volume_credit: close, trade_count: 1,
});
const page = (data: Candle[]) => ({ data, page: { has_more: true, next_cursor: "older" } });

test("older page fills internal and boundary gaps using prior chronological close", () => {
  const current = page([candle(7, "70"), candle(6, "60")]);
  const older = { data: [candle(3, "30"), candle(0, "10")], page: { has_more: false, next_cursor: null } };
  const result = appendCandleHistoryWithGaps(current, older, "1m");
  assert.deepEqual(result.data.map(c => c.close), ["70", "60", "30", "30", "30", "10", "10", "10"]);
  assert.deepEqual(result.data.map(c => Date.parse(c.timestamp) / 60_000), [7,6,5,4,3,2,1,0]);
  for (const c of result.data.filter(c => c.synthetic)) {
    assert.deepEqual([c.open,c.high,c.low], [c.close,c.close,c.close]);
    assert.deepEqual([c.volume_shares,c.volume_credit,c.trade_count], ["0","0",0]);
  }
  assert.deepEqual(result.page, older.page);
  assert.equal(result.historyLoaded, true);
  assert.equal(current.data.length, 2);
  assert.equal(result.data[0], current.data[0]);
});

test("live overlaps win and later real history replaces a synthetic bucket", () => {
  const filled = appendCandleHistoryWithGaps(page([candle(6,"60")]), page([candle(3,"30")]), "1m");
  const next = appendCandleHistoryWithGaps(filled, page([candle(5,"55"),candle(6,"1"),candle(0,"10")]), "1m");
  assert.equal(next.data.find(c => c.timestamp === candle(6,"").timestamp)?.close,"60");
  assert.equal(next.data.find(c => c.timestamp === candle(5,"").timestamp)?.close,"55");
  assert.equal(next.data.find(c => c.timestamp === candle(5,"").timestamp)?.synthetic, undefined);
});

test("monthly history follows calendar boundaries in Asia/Seoul", () => {
  const at = (timestamp: string, close: string): Candle => ({ ...candle(0,close), interval:"1M" as CandleInterval, timestamp });
  const result = appendCandleHistoryWithGaps(page([at("2026-03-31T15:00:00.000Z","40")]), page([at("2025-12-31T15:00:00.000Z","10")]), "1M");
  assert.deepEqual(result.data.map(c => c.timestamp), ["2026-03-31T15:00:00.000Z","2026-02-28T15:00:00.000Z","2026-01-31T15:00:00.000Z","2025-12-31T15:00:00.000Z"]);
  assert.deepEqual(result.data.map(c=>c.close),["40","10","10","10"]);
});

test("very sparse history stays bounded without dropping real candles", () => {
  const result = appendCandleHistoryWithGaps(page([candle(100000,"20")]), page([candle(0,"10")]), "1m");
  assert.equal(result.data.length,501);
  assert.equal(result.data.at(-1)?.close,"10");
  assert.equal(result.data[0].close,"20");
});
