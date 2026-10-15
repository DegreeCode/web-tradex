import test from "node:test";
import assert from "node:assert/strict";
import { appendCandleHistory, appendCandleHistoryWithGaps, applyTradeToCandlePage, mergeCandles, materializeCandlePage, advanceCandlePage, MAX_MATERIALIZED_CANDLE_BUCKETS } from "../src/lib/candle-data";
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

test("very sparse history keeps only a contiguous newest window and retires its cursor", () => {
  const result = appendCandleHistoryWithGaps(page([candle(100_000, "20")]), page([candle(0, "10")]), "1m");
  assert.equal(result.data.length, MAX_MATERIALIZED_CANDLE_BUCKETS);
  assert.equal(result.page.has_more, false);
  assert.equal(result.page.next_cursor, null);
  assert.deepEqual(result.data.map((c) => Date.parse(c.timestamp) / 60_000),
    Array.from({ length: MAX_MATERIALIZED_CANDLE_BUCKETS }, (_, i) => 100_000 - i));
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

test("sparse second candles fill the entire displayed range within the total cap", () => {
  const rows = [100_000, 50_000, 0].map((second) => ({
    ...candle(0, String(second + 1)), interval: "1s" as const,
    timestamp: new Date(second * 1_000).toISOString(),
  }));
  const result = materializeCandlePage(page(rows), "1s");
  assert.equal(result.data.length, MAX_MATERIALIZED_CANDLE_BUCKETS);
  assert.deepEqual(result.data.map((c) => Date.parse(c.timestamp) / 1_000),
    Array.from({ length: MAX_MATERIALIZED_CANDLE_BUCKETS }, (_, i) => 100_000 - i));
  assert.equal(result.data[1].close, "50001");
  assert.equal(result.page.has_more, false);
});

test("older loading retains its cursor while there is room and closes it at exact capacity", () => {
  const current = page([candle(2)]);
  const extended = appendCandleHistoryWithGaps(current, page([candle(0)]), "1m");
  assert.equal(extended.page.next_cursor, "older");
  assert.deepEqual(extended.data.map((c) => Date.parse(c.timestamp) / 60_000), [2, 1, 0]);
  const almostFull = appendCandleHistoryWithGaps(page([candle(MAX_MATERIALIZED_CANDLE_BUCKETS - 2)]), page([candle(0)]), "1m");
  assert.equal(almostFull.data.length, MAX_MATERIALIZED_CANDLE_BUCKETS - 1);
  assert.equal(almostFull.page.has_more, true);
  assert.equal(almostFull.page.next_cursor, "older");
  const full = appendCandleHistoryWithGaps(page([candle(MAX_MATERIALIZED_CANDLE_BUCKETS - 1)]), page([candle(0)]), "1m");
  assert.equal(full.data.length, MAX_MATERIALIZED_CANDLE_BUCKETS);
  assert.equal(full.page.has_more, false);
});

test("a late real trade replaces a synthetic bucket and corrects following dots", () => {
  const current = advanceCandlePage(page([candle(0)]), "1m", candle(3).timestamp);
  const result = applyTradeToCandlePage(current, "1m", 200, {
    symbol: "AAA.M", side: "BUY", price: "25", quantity: "2", credit: "50", fee: "0",
    timestamp: candle(1).timestamp, sequence: 1,
  });
  assert.equal(result.status, "updated");
  assert.deepEqual(result.data?.map((c) => c.close), ["25", "25", "25", "10"]);
  const real = result.data![2];
  assert.equal(real.synthetic, false);
  assert.equal(real.open, "25");
  assert.equal(real.volume_shares, "2");
  assert.equal(real.trade_count, 1);
  assert.equal(result.data![0].synthetic, true);
  assert.equal(current.data[2].synthetic, true, "input is immutable");
});

test("clock-only windows retain a price seed without claiming real data", () => {
  const result = advanceCandlePage({ ...page([candle(0)]), syncedThrough: candle(0).timestamp }, "1m", candle(10_000).timestamp);
  assert.equal(result.data.length, MAX_MATERIALIZED_CANDLE_BUCKETS);
  assert.ok(result.data.every((c) => c.synthetic && c.close === "10"));
  assert.equal(result.data.find((c) => !c.synthetic), undefined);
  assert.equal(result.syncedThrough, candle(0).timestamp);
  const next = advanceCandlePage(result, "1m", candle(10_001).timestamp);
  assert.equal(next.data.length, MAX_MATERIALIZED_CANDLE_BUCKETS);
  assert.equal(next.data[0].close, "10");
  const corrected = materializeCandlePage({ ...next, data: mergeCandles(next.data, [candle(9_900, "20")]) }, "1m");
  assert.equal(corrected.data[0].close, "20");
});


test("REST-sized older pages continue past 500 and retire only at the materialized cap", () => {
  const restLimit = 500;
  const newest = MAX_MATERIALIZED_CANDLE_BUCKETS - 1;
  let current = page(Array.from({ length: restLimit }, (_, i) => candle(newest - i)));
  for (let offset = restLimit; offset < MAX_MATERIALIZED_CANDLE_BUCKETS; offset += restLimit) {
    assert.equal(current.page.has_more, true);
    const older = {
      data: Array.from({ length: restLimit }, (_, i) => candle(newest - offset - i)),
      page: { has_more: true, next_cursor: `cursor-${offset}` },
    };
    current = appendCandleHistoryWithGaps(current, older, "1m");
    assert.equal(current.data.length, offset + restLimit);
    assert.deepEqual(current.data.map((c) => Date.parse(c.timestamp) / 60_000),
      Array.from({ length: current.data.length }, (_, i) => newest - i));
    if (current.data.length < MAX_MATERIALIZED_CANDLE_BUCKETS) {
      assert.equal(current.page.has_more, true);
      assert.equal(current.page.next_cursor, older.page.next_cursor);
    }
  }
  assert.equal(current.page.has_more, false);
  assert.equal(current.page.next_cursor, null);
});

test("older seam fills beyond 500 without prematurely retiring the cursor", () => {
  const current = page([candle(900, "90"), candle(899, "89")]);
  const extended = appendCandleHistoryWithGaps(current, page([candle(200, "20"), candle(0, "10")]), "1m");
  assert.equal(extended.data.length, 901);
  assert.equal(extended.page.has_more, true);
  assert.equal(extended.page.next_cursor, "older");
  assert.deepEqual(extended.data.map((c) => Date.parse(c.timestamp) / 60_000),
    Array.from({ length: 901 }, (_, i) => 900 - i));
  assert.equal(extended.data[2].close, "20");
});

for (const interval of ["1s", "1m"] as const) {
  test(`${interval} hot paths preserve the contiguous 5000-bucket window and untouched candle objects`, () => {
    const step = interval === "1s" ? 1_000 : 60_000;
    const newest = Date.parse("2026-10-14T00:00:00.000Z");
    const at = (offset: number) => new Date(newest + offset * step).toISOString();
    const current = page(Array.from({ length: MAX_MATERIALIZED_CANDLE_BUCKETS }, (_, index) => ({
      ...candle(0), interval, timestamp: at(-index),
    })));
    const trade = (offset: number): PublicTrade => ({
      symbol: "AAA.M", side: "BUY", price: "25", quantity: "2", credit: "50", fee: "0",
      timestamp: at(offset), sequence: offset,
    });
    const same = applyTradeToCandlePage(current, interval, 200, trade(0)).data!;
    assert.equal(same.length, MAX_MATERIALIZED_CANDLE_BUCKETS, "REST limit does not truncate history");
    assert.equal(same[0].close, "25");
    assert.equal(same[0].volume_shares, "3");
    assert.equal(same[1], current.data[1]);
    assert.equal(current.data[0].close, "10");

    for (const offset of [1, 3, MAX_MATERIALIZED_CANDLE_BUCKETS + 100]) {
      const advanced = advanceCandlePage(current, interval, at(offset));
      assert.equal(advanced.data.length, MAX_MATERIALIZED_CANDLE_BUCKETS);
      assert.equal(advanced.page.has_more, false);
      assert.deepEqual(advanced.data.map((c) => Date.parse(c.timestamp)),
        Array.from({ length: MAX_MATERIALIZED_CANDLE_BUCKETS }, (_, i) => newest + (offset - i) * step));
      assert.deepEqual(advanced, materializeCandlePage(current, interval, at(offset)));
      if (offset < MAX_MATERIALIZED_CANDLE_BUCKETS) assert.equal(advanced.data[offset], current.data[0]);
      const next = applyTradeToCandlePage(current, interval, 200, trade(offset)).data!;
      assert.equal(next[0].close, "25");
      assert.equal(next[0].volume_shares, "2");
      assert.ok(!next[0].synthetic);
      assert.deepEqual(next.slice(1), advanced.data.slice(1));
      if (offset < MAX_MATERIALIZED_CANDLE_BUCKETS) assert.equal(next[offset], current.data[0]);
    }
  });
}

test("incremental paths normalize sparse inputs instead of preserving holes", () => {
  const current = page([candle(3, "30"), candle(0)]);
  const trade: PublicTrade = {
    symbol: "AAA.M", side: "BUY", price: "35", quantity: "2", credit: "70", fee: "0",
    timestamp: candle(3).timestamp, sequence: 3,
  };
  const updated = applyTradeToCandlePage(current, "1m", 200, trade).data!;
  assert.deepEqual(updated.map((c) => Date.parse(c.timestamp) / 60_000), [3, 2, 1, 0]);
  const advanced = advanceCandlePage(current, "1m", candle(4).timestamp);
  assert.deepEqual(advanced.data.map((c) => Date.parse(c.timestamp) / 60_000), [4, 3, 2, 1, 0]);
});

test("contiguous cached flats with a stale close are normalized before clock advancement", () => {
  const stale = page([candle(3, "999", true), candle(2, "999", true), candle(1, "20")]);
  const next = advanceCandlePage(stale, "1m", candle(4).timestamp);
  assert.deepEqual(next.data.map(c => c.close), ["20", "20", "20", "20"]);
  assert.equal(next.data.at(-1)?.volume_shares, stale.data.at(-1)?.volume_shares);
});
