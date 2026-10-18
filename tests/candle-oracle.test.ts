import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceCandlePage, appendCandleHistoryWithGaps, applyTradeToCandlePage,
  materializeCandlePage, MAX_MATERIALIZED_CANDLE_BUCKETS,
  candleSnapshotFrom, candleSnapshotTo, reconcileCandleSnapshot, compareTradeTimestamps, candleClockTimestamp,
  type CandlePage,
} from "../src/lib/candle-data";
import type { Candle, PublicTrade } from "../src/lib/types";

// Independent oracle: Seoul's modern UTC+9 boundaries, integer trade values,
// sequence-based OHLC (as in backend SQL), no production bucket/fill helpers.
const sizes = { "1s": 1_000, "1m": 60_000, "1h": 3_600_000, "1d": 86_400_000 };
const origin = Date.parse("2026-10-13T15:00:00Z");
const iso = (time: number) => new Date(time).toISOString();
function random(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}
function trade(time: number, sequence: number, price: number): PublicTrade {
  return { symbol: "ORACLE.M", side: "BUY", timestamp: iso(time), sequence,
    price: String(price), quantity: "2", credit: String(price * 2), fee: "0" };
}
function oracle(trades: PublicTrade[], interval: keyof typeof sizes): Candle[] {
  const result = new Map<number, Candle>();
  for (const t of [...trades].sort((a, b) => a.sequence - b.sequence)) {
    const time = Math.floor((Date.parse(t.timestamp) + 32_400_000) / sizes[interval]) * sizes[interval] - 32_400_000;
    const c = result.get(time);
    if (!c) result.set(time, { symbol: t.symbol, interval, timestamp: iso(time), open: t.price,
      high: t.price, low: t.price, close: t.price, volume_shares: t.quantity, volume_credit: t.credit, trade_count: 1 });
    else {
      c.high = String(Math.max(Number(c.high), Number(t.price)));
      c.low = String(Math.min(Number(c.low), Number(t.price)));
      c.close = t.price; c.volume_shares = String(Number(c.volume_shares) + 2);
      c.volume_credit = String(Number(c.volume_credit) + Number(t.credit)); c.trade_count++;
    }
  }
  return [...result.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
const page = (data: Candle[]): CandlePage => ({ data, page: { has_more: true, next_cursor: "older" } });
function check(current: CandlePage, seen: PublicTrade[], interval: keyof typeof sizes, context: string) {
  const expected = oracle(seen, interval);
  const byTime = new Map(expected.map(c => [c.timestamp, c]));
  if (expected.length) assert.ok(current.data[0]?.timestamp >= expected[0].timestamp, `${context}: newest real candle lost`);
  assert.ok(current.data.length <= MAX_MATERIALIZED_CANDLE_BUCKETS, context);
  for (let i = 0; i < current.data.length; i++) {
    const c = current.data[i];
    if (i) assert.equal(Date.parse(current.data[i - 1].timestamp) - Date.parse(c.timestamp), sizes[interval], context);
    if (c.synthetic) {
      assert.ok(!byTime.has(c.timestamp), `${context}: synthetic hides trades at ${c.timestamp}`);
      const previous = expected.find(real => real.timestamp < c.timestamp);
      assert.ok(previous, `${context}: no real seed`);
      assert.deepEqual([c.open, c.high, c.low, c.close, c.volume_shares, c.volume_credit, c.trade_count],
        [previous.close, previous.close, previous.close, previous.close, "0", "0", 0], context);
    } else {
      const real = byTime.get(c.timestamp);
      assert.ok(real, `${context}: invented real candle`);
      for (const field of ["open", "high", "low", "close", "volume_shares", "volume_credit", "trade_count"] as const)
        assert.equal(String(c[field]), String(real[field]), `${context}: ${field} at ${c.timestamp}`);
    }
  }
}

for (const interval of Object.keys(sizes) as (keyof typeof sizes)[]) {
  for (const seed of [1, 7, 42, 20261014]) {
    test(`oracle ${interval} seed=${seed} (480 events)`, () => {
      const rng = random(seed), size = sizes[interval];
      const initial = trade(origin, 0, 10);
      const seen = [initial];
      let current = materializeCandlePage(page(oracle(seen, interval)), interval);
      const events: { time: number; t?: PublicTrade; kind: number }[] = [];
      for (let i = 1; i <= 240; i++) {
        const time = origin + Math.floor(i * size / 3 + rng() * size / 4);
        events.push({ time: time + Math.floor(rng() * (size / 2 + 2000)), t: trade(time, i, 1 + Math.floor(rng() * 100)), kind: 0 });
        events.push({ time: time + Math.floor(rng() * size), kind: 1 + Math.floor(rng() * 3) });
      }
      const serverTrades = [initial, ...events.flatMap(e => e.t ? [e.t] : [])];
      const snapshot = (now: number, serverNow: number) => {
        const to = candleSnapshotTo(current, now);
        const from = candleSnapshotFrom(current, interval);
        const covered = serverTrades.filter(t => compareTradeTimestamps(t.timestamp, to) < 0 && (!from || t.timestamp >= from));
        for (const t of covered) if (!seen.some(known => known.sequence === t.sequence)) seen.push(t);
        // Delayed/reordered WS events arrive while the REST response is in
        // flight; replay includes duplicates and events on both sides of `to`.
        const pending = serverTrades.filter(t => Date.parse(t.timestamp) <= serverNow &&
          !seen.some(known => known.sequence === t.sequence) && rng() < 0.5);
        seen.push(...pending);
        const replay = [...pending, ...pending.slice(0, 2), ...covered.slice(-2)].reverse();
        current = reconcileCandleSnapshot(current, page(oracle(covered, interval)), interval, to, replay, from, candleClockTimestamp(now));
      };
      events.sort((a, b) => a.time - b.time);
      for (const [step, event] of events.entries()) {
        const context = `seed=${seed} interval=${interval} step=${step} kind=${event.kind}`;
        if (event.t) {
          if (seen.some(known => known.sequence === event.t!.sequence) ||
            (current.syncedThrough && compareTradeTimestamps(event.t.timestamp, current.syncedThrough) < 0)) {
            check(current, seen, interval, context);
            continue;
          }
          seen.push(event.t);
          const result = applyTradeToCandlePage(current, interval, 200, event.t);
          const bucket = Math.floor((Date.parse(event.t.timestamp) + 32_400_000) / size) * size - 32_400_000;
          if (current.data.every(c => c.synthetic || Date.parse(c.timestamp) <= bucket))
            assert.equal(result.status, "updated", `${context}: clock-only tail must not recover`);
          if (result.status === "recovery") {
            // Model completion of the existing REST recovery, including all
            // observed trades. No correctness assertion is waived on recovery.
            snapshot(event.time, event.time);
          } else current = { ...current, data: result.data! };
        } else if (event.kind === 1) {
          const clientOffset = Math.floor(rng() * 4001) - 2000;
          // The production scheduling policy is exercised separately with a
          // QueryObserver; the pure advance primitive takes a trusted horizon.
          current = advanceCandlePage(current, interval, iso(event.time + clientOffset - 3000));
        } else if (event.kind === 2) {
          snapshot(event.time + Math.floor(rng() * 4001) - 2000, event.time);
        } else {
          const older = trade(origin - (step + 1) * size, -step - 1, 5 + Math.floor(rng() * 10));
          seen.push(older);
          current = appendCandleHistoryWithGaps(current, page(oracle([older], interval)), interval);
        }
        check(current, seen, interval, context);
      }
    });
  }
}

// Small adversarial cases retain precise failing step labels alongside random runs.
test("fixture=101 step=2: delayed trade after clock corrects real candle and all flats", () => {
  const seen = [trade(origin, 0, 10)];
  const current = advanceCandlePage(page(oracle(seen, "1s")), "1s", iso(origin + 3000));
  seen.push(trade(origin + 900, 1, 20));
  const result = applyTradeToCandlePage(current, "1s", 200, seen[1]);
  assert.equal(result.status, "updated");
  check({ ...current, data: result.data! }, seen, "1s", "fixture=101 step=2");
});

test("fixture=102 step=2: reverse arrivals preserve sequence-based open and close", () => {
  const seen = [trade(origin + 900, 2, 20)];
  let current = page([]);
  current = { ...current, data: applyTradeToCandlePage(current, "1s", 200, seen[0]).data! };
  seen.push(trade(origin + 100, 1, 10));
  current = { ...current, data: applyTradeToCandlePage(current, "1s", 200, seen[1]).data! };
  check(current, seen, "1s", "fixture=102 step=2");
});

for (const interval of Object.keys(sizes) as (keyof typeof sizes)[]) {
  test(`oracle capped ${interval} seed=99 (64 events)`, () => {
    const rng = random(99), size = sizes[interval];
    const seen = [trade(origin, 0, 10)];
    let current = materializeCandlePage(page(oracle(seen, interval)), interval);
    let horizon = origin;
    for (let step = 0; step < 32; step++) {
      horizon += (5000 + Math.floor(rng() * 100)) * size;
      current = advanceCandlePage(current, interval, iso(horizon));
      check(current, seen, interval, `seed=99 interval=${interval} step=${step} clock`);
      // The predecessor has left the page; a late real trade must replace the
      // carry-in price throughout the entire surviving synthetic window.
      const older = trade(horizon - 5001 * size, step + 1, 20 + Math.floor(rng() * 50));
      seen.push(older);
      current = appendCandleHistoryWithGaps(current, page(oracle([older], interval)), interval);
      check(current, seen, interval, `seed=99 interval=${interval} step=${step} history`);
      assert.equal(current.data.length, 5000);
      // History keeps the REST cursor open so the chart can page further back.
      assert.equal(current.page.has_more, true);
    }
  });
}
