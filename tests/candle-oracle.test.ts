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
class ReferenceCandles {
  readonly candles: Candle[] = [];
  private readonly buckets = new Map<number, { candle: Candle; first: number; last: number }>();
  private consumed = 0;

  constructor(private readonly interval: keyof typeof sizes) {}

  include(trades: PublicTrade[]) {
    for (; this.consumed < trades.length; this.consumed++) {
      const t = trades[this.consumed];
      const time = Math.floor((Date.parse(t.timestamp) + 32_400_000) / sizes[this.interval]) * sizes[this.interval] - 32_400_000;
      const existing = this.buckets.get(time);
      if (!existing) {
        const candle: Candle = { symbol: t.symbol, interval: this.interval, timestamp: iso(time), open: t.price,
          high: t.price, low: t.price, close: t.price, volume_shares: t.quantity, volume_credit: t.credit, trade_count: 1 };
        this.buckets.set(time, { candle, first: t.sequence, last: t.sequence });
        const index = this.candles.findIndex(row => row.timestamp < candle.timestamp);
        this.candles.splice(index < 0 ? this.candles.length : index, 0, candle);
      } else {
        const c = existing.candle;
        c.high = String(Math.max(Number(c.high), Number(t.price)));
        c.low = String(Math.min(Number(c.low), Number(t.price)));
        if (t.sequence < existing.first) { c.open = t.price; existing.first = t.sequence; }
        if (t.sequence > existing.last) { c.close = t.price; existing.last = t.sequence; }
        c.volume_shares = String(Number(c.volume_shares) + 2);
        c.volume_credit = String(Number(c.volume_credit) + Number(t.credit));
        c.trade_count++;
      }
    }
    return this.candles;
  }
}

function oracle(trades: PublicTrade[], interval: keyof typeof sizes): Candle[] {
  // Copies keep production inputs independent of the mutable reference state.
  return new ReferenceCandles(interval).include(trades).map(candle => ({ ...candle }));
}
const page = (data: Candle[]): CandlePage => ({ data, page: { has_more: true, next_cursor: "older" } });
const references = new WeakMap<PublicTrade[], ReferenceCandles>();
const fields = ["open", "high", "low", "close", "volume_shares", "volume_credit", "trade_count"] as const;
function check(current: CandlePage, seen: PublicTrade[], interval: keyof typeof sizes, context: string) {
  let reference = references.get(seen);
  if (!reference) { reference = new ReferenceCandles(interval); references.set(seen, reference); }
  const expected = reference.include(seen);
  if (expected.length) assert.ok(current.data[0]?.timestamp >= expected[0].timestamp, `${context}: newest real candle lost`);
  assert.ok(current.data.length <= MAX_MATERIALIZED_CANDLE_BUCKETS, context);
  let expectedIndex = 0;
  let previousTime: number | undefined;
  // Both sides descend: one sweep finds real rows and synthetic carry-in seeds.
  for (const c of current.data) {
    const time = Date.parse(c.timestamp);
    if (previousTime !== undefined) assert.equal(previousTime - time, sizes[interval], context);
    previousTime = time;
    while (expectedIndex < expected.length && expected[expectedIndex].timestamp > c.timestamp) expectedIndex++;
    const real = expected[expectedIndex];
    if (c.synthetic) {
      assert.notEqual(real?.timestamp, c.timestamp, context);
      assert.ok(real, context);
      assert.equal(c.open, real.close, context);
      assert.equal(c.high, real.close, context);
      assert.equal(c.low, real.close, context);
      assert.equal(c.close, real.close, context);
      assert.equal(c.volume_shares, "0", context);
      assert.equal(c.volume_credit, "0", context);
      assert.equal(c.trade_count, 0, context);
    } else {
      assert.ok(real && real.timestamp === c.timestamp, context);
      for (const field of fields) assert.equal(String(c[field]), String(real[field]), context);
    }
  }
}

for (const interval of Object.keys(sizes) as (keyof typeof sizes)[]) {
  for (const seed of [1, 7, 42, 20261014]) {
    test(`oracle ${interval} seed=${seed} (480 events)`, () => {
      const rng = random(seed), size = sizes[interval];
      const initial = trade(origin, 0, 10);
      const seen = [initial];
      const seenSequences = new Set([initial.sequence]);
      const remember = (t: PublicTrade) => { seen.push(t); seenSequences.add(t.sequence); };
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
        for (const t of covered) if (!seenSequences.has(t.sequence)) remember(t);
        // Delayed/reordered WS events arrive while the REST response is in
        // flight; replay includes duplicates and events on both sides of `to`.
        const pending = serverTrades.filter(t => Date.parse(t.timestamp) <= serverNow &&
          !seenSequences.has(t.sequence) && rng() < 0.5);
        pending.forEach(remember);
        const replay = [...pending, ...pending.slice(0, 2), ...covered.slice(-2)].reverse();
        current = reconcileCandleSnapshot(current, page(oracle(covered, interval)), interval, to, replay, from, candleClockTimestamp(now));
      };
      events.sort((a, b) => a.time - b.time);
      for (const [step, event] of events.entries()) {
        const context = `seed=${seed} interval=${interval} step=${step} kind=${event.kind}`;
        if (event.t) {
          if (seenSequences.has(event.t.sequence) ||
            (current.syncedThrough && compareTradeTimestamps(event.t.timestamp, current.syncedThrough) < 0)) {
            check(current, seen, interval, context);
            continue;
          }
          remember(event.t);
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
          remember(older);
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
  test(`oracle capped ${interval} seed=99 (16 events)`, () => {
    const rng = random(99), size = sizes[interval];
    const seen = [trade(origin, 0, 10)];
    let current = materializeCandlePage(page(oracle(seen, interval)), interval);
    let horizon = origin;
    // Every step repeats the same slide past the cap; a few cover the invariant.
    for (let step = 0; step < 8; step++) {
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
