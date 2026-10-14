import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { advanceCandlePage, nextCandleBucketTimestamp, MAX_MATERIALIZED_CANDLE_BUCKETS, type CandlePage } from "../src/lib/candle-data";
import {
  candleFetchTrades, candleRuntime, candleTradeRuntimes, startCandleClock, resumeCandleClocks, requestCandleRecovery,
  updateCachedCandleQueries, type CandleClockEnvironment,
} from "../src/lib/candle-cache";
import { canIncrementallyUpdate } from "../src/lib/chart-updates";
import type { CandleInterval } from "../src/lib/types";

function page(timestamp: string, interval: CandleInterval = "1s"): CandlePage {
  return {
    data: [{ symbol: "CLOCK.M", interval, timestamp, open: "10", high: "10", low: "10", close: "10",
      volume_shares: "1", volume_credit: "10", trade_count: 1 }],
    page: { has_more: true, next_cursor: "older" },
    syncedThrough: timestamp,
  };
}

for (const [interval, before, boundary] of [
  ["1s", "2026-10-14T14:59:59.000Z", "2026-10-14T15:00:00.000Z"],
  ["1m", "2026-10-14T14:59:00.000Z", "2026-10-14T15:00:00.000Z"],
  ["1h", "2026-10-14T14:00:00.000Z", "2026-10-14T15:00:00.000Z"],
  ["1d", "2026-10-13T15:00:00.000Z", "2026-10-14T15:00:00.000Z"],
] as const) {
  test(`${interval} clock appends at the Asia/Seoul boundary as a prefix extension`, () => {
    const current = page(before, interval);
    assert.equal(nextCandleBucketTimestamp(before, interval), boundary);
    assert.equal(advanceCandlePage(current, interval, new Date(Date.parse(boundary) - 1).toISOString()), current);
    const next = advanceCandlePage(current, interval, boundary);
    assert.equal(next.data.length, 2);
    assert.deepEqual(next.data[0], {
      ...current.data[0], timestamp: boundary, volume_shares: "0", volume_credit: "0", trade_count: 0,
      synthetic: true,
    });
    assert.equal(next.syncedThrough, current.syncedThrough);
    const points = (p: CandlePage) => p.data.toReversed().map((c) => ({ time: Date.parse(c.timestamp) / 1000 }));
    assert.equal(canIncrementallyUpdate(points(current), points(next)), true);
    assert.equal(advanceCandlePage(next, interval, boundary), next);
  });
}

test("calendar scheduling uses Monday, month and year boundaries", () => {
  assert.equal(nextCandleBucketTimestamp("2026-10-18T14:59:59.999Z", "1w"), "2026-10-18T15:00:00.000Z");
  assert.equal(nextCandleBucketTimestamp("2028-02-01T00:00:00.000Z", "1M"), "2028-02-29T15:00:00.000Z");
  assert.equal(nextCandleBucketTimestamp("2026-12-31T14:59:59.999Z", "1y"), "2026-12-31T15:00:00.000Z");
});

test("clock cannot fabricate candles without a price seed", () => {
  const empty = { ...page("2026-10-14T00:00:00.000Z"), data: [] };
  assert.equal(advanceCandlePage(empty, "1s", "2026-10-15T00:00:00.000Z"), empty);
});

class FakeClock implements CandleClockEnvironment {
  time = Date.parse("2026-10-14T00:00:00.250Z");
  isHidden = false;
  timer?: { at: number; callback: () => void };
  visibility?: () => void;
  now = () => this.time;
  hidden = () => this.isHidden;
  schedule = (callback: () => void, delay: number) => {
    assert.ok(delay > 0 && delay <= 2_147_483_647);
    const timer = { at: this.time + delay, callback };
    this.timer = timer;
    return () => { if (this.timer === timer) this.timer = undefined; };
  };
  onVisibilityChange = (callback: () => void) => {
    this.visibility = callback;
    return () => { this.visibility = undefined; };
  };
  tick() {
    assert.ok(this.timer);
    const timer = this.timer;
    this.time = timer.at;
    this.timer = undefined;
    timer.callback();
  }
  hide(hidden: boolean) {
    this.isHidden = hidden;
    this.visibility?.();
  }
}

function setup(initial: CandlePage | undefined = page("2026-10-14T00:00:00.000Z"), enabled = true, respectRecovery = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const key = ["candles", "CLOCK.M", "1s", 200] as const;
  let fetches = 0;
  if (initial) client.setQueryData(key, initial);
  const observer = new QueryObserver(client, {
    queryKey: key, enabled, staleTime: Infinity,
    queryFn: async () => { fetches += 1; return initial!; },
  });
  const unsubscribe = observer.subscribe(() => {});
  const clock = new FakeClock();
  const stop = startCandleClock(client, "CLOCK.M", "1s", 200, { clock, respectRecovery });
  return { client, key, clock, observer, fetches: () => fetches,
    data: () => client.getQueryData<CandlePage>(key)!,
    cleanup: () => {
      stop(); unsubscribe(); client.clear(); candleTradeRuntimes.delete("CLOCK.M");
      candleFetchTrades.delete(JSON.stringify(key));
    },
  };
}

test("mounted guest clock schedules boundaries, pauses hidden, catches up and cleans up without requests", () => {
  const h = setup();
  try {
    assert.ok(h.clock.timer);
    assert.equal(h.clock.timer.at - h.clock.time, 750);
    h.clock.tick();
    assert.equal(h.data().data.length, 2);
    h.clock.hide(true);
    assert.equal(h.clock.timer, undefined);
    h.clock.time += (MAX_MATERIALIZED_CANDLE_BUCKETS + 1) * 1_000;
    h.clock.hide(false);
    assert.equal(h.data().data.length, MAX_MATERIALIZED_CANDLE_BUCKETS);
    assert.equal(h.data().data[0].timestamp, new Date(h.clock.time).toISOString());
    assert.equal(h.data().page.has_more, false);
    assert.equal(h.fetches(), 0);
  } finally { h.cleanup(); }
  assert.equal(h.clock.timer, undefined);
  assert.equal(h.clock.visibility, undefined);
});

test("empty and disabled queries do not schedule a clock", () => {
  for (const [initial, enabled] of [
    [{ ...page("2026-10-14T00:00:00.000Z"), data: [] }, true],
    [page("2026-10-14T00:00:00.000Z"), false],
  ] satisfies [CandlePage, boolean][]) {
    const h = setup(initial, enabled);
    try { assert.equal(h.clock.timer, undefined); assert.equal(h.fetches(), 0); }
    finally { h.cleanup(); }
  }
});

test("clock waits for fetch ownership and preserves buffered WS replay", async () => {
  const h = setup();
  try {
    let resolve!: (value: CandlePage) => void;
    const original = h.data();
    const pending: Parameters<typeof updateCachedCandleQueries>[2][] = [];
    candleFetchTrades.set(JSON.stringify(h.key), pending);
    const fetch = h.client.fetchQuery({ queryKey: h.key, staleTime: 0,
      queryFn: () => new Promise<CandlePage>((done) => { resolve = done; }) });
    h.clock.tick();
    assert.equal(h.data(), original);
    const trade = { symbol: "CLOCK.M", side: "BUY" as const, price: "20", quantity: "1", credit: "20",
      fee: "0", timestamp: new Date(h.clock.time).toISOString(), sequence: 1 };
    updateCachedCandleQueries(h.client, "CLOCK.M", trade);
    assert.deepEqual(pending, [trade]);
    candleFetchTrades.delete(JSON.stringify(h.key));
    resolve(original);
    await fetch;
    assert.equal(h.data().data.length, 2, "fetch completion catches up immediately");
    assert.equal(h.data().syncedThrough, original.syncedThrough);
    assert.deepEqual(pending, [trade], "clock did not consume or reorder replay");
    updateCachedCandleQueries(h.client, "CLOCK.M", trade);
    assert.equal(h.data().data[0].synthetic, false);
    assert.equal(h.data().data[0].close, "20");
    assert.equal(h.fetches(), 0);
  } finally { h.cleanup(); }
});

test("clock respects recovery, snapshot and pending sequence guards", () => {
  const h = setup();
  try {
    const original = h.data();
    const runtime = candleRuntime("CLOCK.M");
    runtime.recoveryInFlight = true;
    h.clock.tick();
    assert.equal(h.data(), original);
    runtime.recoveryInFlight = false;
    runtime.awaitingSnapshotRecovery = true;
    h.clock.tick();
    assert.equal(h.data(), original);
    runtime.awaitingSnapshotRecovery = false;
    runtime.pendingSequences.add(1);
    h.clock.tick();
    assert.equal(h.data(), original);
    runtime.pendingSequences.clear();
    resumeCandleClocks("CLOCK.M");
    assert.equal(h.data().data.length, 4, "ownership release catches up without waiting for another boundary");
    assert.equal(h.fetches(), 0);
  } finally { h.cleanup(); }
});

test("a future bucket schedules only after it can change", () => {
  const h = setup(page("2026-10-14T01:00:00.000Z"));
  try {
    assert.equal(h.clock.timer?.at, Date.parse("2026-10-14T01:00:01.000Z"));
    assert.equal(h.data().data.length, 1);
  } finally { h.cleanup(); }
});


test("guest clocks ignore a stale signed-in recovery owner", () => {
  const runtime = candleRuntime("CLOCK.M");
  runtime.awaitingSnapshotRecovery = true;
  const h = setup(page("2026-10-14T00:00:00.000Z"), true, false);
  try {
    h.clock.tick();
    assert.equal(h.data().data.length, 2);
    assert.equal(h.fetches(), 0);
  } finally { h.cleanup(); }
});

test("REST recovery completion wakes the clock after releasing its runtime flag", async () => {
  const h = setup();
  try {
    const original = h.data();
    let resolve!: (value: CandlePage) => void;
    let fetches = 0;
    h.observer.setOptions({ queryKey: h.key, staleTime: Infinity,
      queryFn: () => {
        fetches += 1;
        return new Promise<CandlePage>((done) => { resolve = done; });
      },
    });
    const runtime = candleRuntime("CLOCK.M");
    requestCandleRecovery(h.client, "CLOCK.M", runtime);
    h.clock.tick();
    assert.equal(runtime.recoveryInFlight, true);
    assert.equal(h.data(), original);
    resolve(original);
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(runtime.recoveryInFlight, false);
    assert.equal(h.data().data.length, 2);
    assert.equal(fetches, 1, "only the existing recovery request ran");
  } finally { h.cleanup(); }
});
