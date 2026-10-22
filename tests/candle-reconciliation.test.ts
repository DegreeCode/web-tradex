import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  applyTradeToCandlePage, advanceCandlePage, candleClockTimestamp, candleSnapshotFrom,
  candleSnapshotTo, compareTradeTimestamps, reconcileCandleSnapshot, type CandlePage,
  type BufferedCandleTrade,
} from "../src/lib/candle-data";
import { candleFetchTrades, candleTradeRuntimes, candleRuntime, retainCandleRuntime, updateCachedCandleQueries } from "../src/lib/candle-cache";
import { fetchCandleSnapshot } from "../src/lib/candle-query";
import type { PublicTrade } from "../src/lib/types";

const base = Date.parse("2026-10-14T15:00:00Z");
const at = (ms: number) => new Date(base + ms).toISOString();
const trade = (ms: number, sequence: number, price = "20"): PublicTrade => ({
  symbol: "REPLAY.M", side: "BUY", price, quantity: "2", credit: String(Number(price) * 2), fee: "0",
  timestamp: at(ms), sequence,
});
const empty = (): CandlePage => ({ data: [], page: { has_more: false, next_cursor: null } });
function apply(page: CandlePage, t: PublicTrade, count?: number): CandlePage {
  const result = applyTradeToCandlePage(page, "1s", 200, t, count);
  assert.equal(result.status, "updated");
  return { ...page, data: result.data! };
}
function rest(page: CandlePage): CandlePage {
  // The API sends OHLCV, not client trade-order metadata.
  return { ...page, data: page.data.map(c => ({ symbol: c.symbol, interval: c.interval, timestamp: c.timestamp,
    open: c.open, high: c.high, low: c.low, close: c.close, volume_shares: c.volume_shares,
    volume_credit: c.volume_credit, trade_count: c.trade_count })) };
}

test("leaving the last trade stream releases its replay history and reopening starts fresh", () => {
  const release = retainCandleRuntime("LIFETIME.M");
  const second = retainCandleRuntime("LIFETIME.M");
  const old = candleRuntime("LIFETIME.M");
  old.seenSequences.add(10);
  release();
  release();
  assert.equal(candleTradeRuntimes.get("LIFETIME.M"), old);
  second();
  assert.equal(candleTradeRuntimes.has("LIFETIME.M"), false);
  const reopened = retainCandleRuntime("LIFETIME.M");
  assert.equal(candleRuntime("LIFETIME.M").seenSequences.size, 0);
  reopened();
});

test("canceling a candle fetch aborts its transport and releases the replay buffer", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  let transport: AbortSignal | null = null;
  t.mock.method(globalThis, "fetch", (_url: string, options: RequestInit) =>
    new Promise((_resolve, reject) => {
      transport = options.signal as AbortSignal;
      transport.addEventListener("abort", () => reject(transport!.reason), { once: true });
    }),
  );
  const controller = new AbortController();
  const pending = fetchCandleSnapshot(client, "CANCEL.M", "1m", 200, true, controller.signal);
  const key = JSON.stringify(["candles", "CANCEL.M", "1m", 200]);
  assert.equal(candleFetchTrades.has(key), true);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal((transport as unknown as AbortSignal).aborted, true);
  assert.equal(candleFetchTrades.has(key), false);
});

test("snapshot cutoff is conservative with ±2s skew and includes already applied server trades", () => {
  for (const skew of [-2000, 0, 2000]) {
    let current = apply(empty(), trade(100, 1));
    const to = candleSnapshotTo(current, base + 1000 + skew);
    assert.ok(compareTradeTimestamps(to, at(100)) > 0);
    assert.ok(compareTradeTimestamps(to, at(1000)) <= 0, "never acknowledge future server trades");
    current = reconcileCandleSnapshot(current, rest(current), "1s", to, [], undefined, candleClockTimestamp(base + 1000 + skew));
    current = apply(current, trade(500, 2, "30"));
    assert.equal(current.data[0].volume_shares, "4", "a delayed trade was not silently skipped");
    assert.equal(current.data[0].close, "30");
  }
});

test("refetch covers older ambiguous buckets and the entire unsynchronized range", () => {
  let current = apply(empty(), trade(100, 1));
  current.syncedThrough = at(200);
  current = apply(current, trade(2100, 3));
  assert.equal(candleSnapshotFrom(current, "1s"), at(0));
  assert.equal(candleSnapshotFrom(current, "1s", at(-1900)), at(-2000));
  const delayed = trade(1500, 2, "40");
  const fetched = rest(apply(current, delayed));
  const result = reconcileCandleSnapshot(current, fetched, "1s", at(2200), [delayed], at(0));
  assert.equal(result.data.find(c => c.timestamp === at(1000))?.close, "40");
  assert.equal(result.data.find(c => c.timestamp === at(1000))?.trade_count, 1);
});

test("exclusive-to replay sorts reverse arrivals, deduplicates and preserves nanoseconds", () => {
  const initial = apply(empty(), trade(100, 1));
  const to = at(500).replace(".500Z", ".500000500Z");
  const before = { ...trade(500, 2, "30"), timestamp: to.replace("500Z", "499Z") };
  const equal = { ...trade(500, 3, "40"), timestamp: to };
  const after = { ...trade(500, 4, "50"), timestamp: to.replace("500Z", "501Z") };
  const fetched = rest(apply(initial, before));
  const result = reconcileCandleSnapshot(initial, fetched, "1s", to, [after, equal, before, equal]);
  assert.deepEqual([result.data[0].open, result.data[0].close, result.data[0].volume_shares, result.data[0].trade_count],
    ["20", "50", "8", 4]);
  assert.equal(compareTradeTimestamps(before.timestamp, to), -1);
  assert.equal(compareTradeTimestamps(after.timestamp, to), 1);
});

test("nanosecond successor rolls into the next millisecond and next second", () => {
  for (const [timestamp, expected] of [
    [at(500).replace(".500Z", ".500999999Z"), at(501).replace("Z", "000000Z")],
    [at(999).replace(".999Z", ".999999999Z"), at(1000).replace("Z", "000000Z")],
  ]) {
    const current = apply(empty(), { ...trade(0, 1), timestamp });
    assert.equal(candleSnapshotTo(current, base), expected);
  }
});

test("late real corrections propagate through flats but stop at the next real candle", () => {
  let current = apply(empty(), trade(100, 1));
  current = apply(current, trade(3100, 3, "60"));
  current = advanceCandlePage(current, "1s", at(5000));
  current = apply(current, trade(900, 2, "40"));
  assert.deepEqual(current.data.map(c => c.close), ["60", "60", "60", "40", "40", "40"]);
});

test("ambiguous REST history retains recovery and records the bucket to repair", () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const key = ["candles", "REPLAY.M", "1s", 200];
  const current = rest(apply(apply(empty(), trade(100, 1)), trade(2100, 3)));
  client.setQueryData(key, current);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => current, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  try {
    assert.equal(updateCachedCandleQueries(client, "REPLAY.M", trade(900, 2)).needsRecovery, true);
    assert.equal(candleTradeRuntimes.get("REPLAY.M")?.recoveryFrom, at(900));
    assert.equal(candleSnapshotFrom(current, "1s", candleTradeRuntimes.get("REPLAY.M")?.recoveryFrom), at(0));
  } finally { unsubscribe(); client.clear(); candleTradeRuntimes.delete("REPLAY.M"); }
});

test("guest aggregate count survives an in-flight fetch buffer", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const key = ["candles", "REPLAY.M", "1s", 200];
  const current = rest(apply(empty(), trade(100, 1)));
  client.setQueryData(key, current);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => current, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  const pending: BufferedCandleTrade[] = [];
  candleFetchTrades.set(JSON.stringify(key), pending);
  let resolve!: (value: CandlePage) => void;
  try {
    const fetching = client.fetchQuery({ queryKey: key, staleTime: 0,
      queryFn: () => new Promise<CandlePage>(done => { resolve = done; }) });
    updateCachedCandleQueries(client, "REPLAY.M", trade(600, 8, "30"), 7);
    assert.equal(pending[0].candleTradeCount, 7);
    resolve(reconcileCandleSnapshot(current, current, "1s", at(500), pending));
    await fetching;
    assert.equal(client.getQueryData<CandlePage>(key)?.data[0].trade_count, 8);
  } finally { unsubscribe(); client.clear(); candleFetchTrades.delete(JSON.stringify(key)); }
});

for (const phase of ["before", "during", "after"] as const) {
  test(`initial WS snapshot ${phase} REST preserves the bootstrap tail without another request`, async () => {
    const { candleRuntime, reconcileCandleTradeSnapshot } = await import("../src/lib/candle-cache");
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const key = ["candles", "REPLAY.M", "1s", 200];
    const runtime = candleRuntime("REPLAY.M");
    const first = trade(100, 1), second = trade(600, 2, "30");
    const initial = { ...rest(apply(empty(), first)), syncedThrough: at(500) };
    let fetches = 0;
    client.setQueryData(key, initial);
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity,
      queryFn: async () => { fetches++; return initial; } });
    const unsubscribe = observer.subscribe(() => {});
    try {
      if (phase === "during") {
        const pending: BufferedCandleTrade[] = [];
        candleFetchTrades.set(JSON.stringify(key), pending);
        reconcileCandleTradeSnapshot(client, "REPLAY.M", [second, first], 150, runtime);
        assert.equal(pending.length, 2);
        client.setQueryData(key, reconcileCandleSnapshot(initial, initial, "1s", at(500), pending));
      } else if (phase === "before") {
        client.removeQueries({ queryKey: key });
        reconcileCandleTradeSnapshot(client, "REPLAY.M", [second, first], 150, runtime);
        const to = candleSnapshotTo(undefined, base, runtime.latestTradeTimestamp);
        assert.ok(compareTradeTimestamps(to, second.timestamp) > 0);
        client.setQueryData(key, reconcileCandleSnapshot(undefined, rest(apply(apply(empty(), first), second)), "1s", to, []));
      } else {
        reconcileCandleTradeSnapshot(client, "REPLAY.M", [second, first], 150, runtime);
      }
      const result = client.getQueryData<CandlePage>(key)!;
      assert.equal(result.data[0].trade_count, 2);
      assert.equal(result.data[0].close, "30");
      assert.equal(fetches, 0);
    } finally {
      unsubscribe(); client.clear(); candleFetchTrades.delete(JSON.stringify(key)); candleTradeRuntimes.delete("REPLAY.M");
    }
  });
}

test("a repeated WS snapshot does not double-count live trades", async () => {
  const { candleRuntime, reconcileCandleTradeSnapshot } = await import("../src/lib/candle-cache");
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const key = ["candles", "REPLAY.M", "1s", 200];
  const runtime = candleRuntime("REPLAY.M");
  const first = trade(100, 1);
  const initial = apply(empty(), first);
  client.setQueryData(key, initial);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => initial, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  try {
    runtime.snapshotReady = true;
    reconcileCandleTradeSnapshot(client, "REPLAY.M", [first], 150, runtime);
    assert.equal(client.getQueryData<CandlePage>(key)?.data[0].trade_count, 1);
  } finally { unsubscribe(); client.clear(); candleTradeRuntimes.delete("REPLAY.M"); }
});

test("a client behind the server cannot refetch away an already-applied live trade", () => {
  let current = apply(empty(), trade(100, 1));
  current = apply(current, trade(900, 2, "30"));
  const to = candleSnapshotTo(current, base + 1000 - 2000);
  assert.ok(compareTradeTimestamps(to, at(900)) > 0, "REST must include the latest existing live observation");
  const result = reconcileCandleSnapshot(current, rest(current), "1s", to, []);
  assert.equal(result.data[0].trade_count, 2);
  assert.equal(result.data[0].close, "30");
});

test("a truncated initial snapshot requests recovery only when its replay prefix is missing", async () => {
  const { candleRuntime, reconcileCandleTradeSnapshot } = await import("../src/lib/candle-cache");
  for (const cutoff of [500, 800]) {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const key = ["candles", "REPLAY.M", "1s", 200];
    const runtime = candleRuntime("REPLAY.M");
    const initial = { ...rest(apply(empty(), trade(100, 1))), syncedThrough: at(cutoff) };
    client.setQueryData(key, initial);
    let fetches = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity,
      queryFn: async () => { fetches++; return initial; } });
    const unsubscribe = observer.subscribe(() => {});
    try {
      reconcileCandleTradeSnapshot(client, "REPLAY.M", [trade(600, 2), trade(900, 3)], 2, runtime);
      await new Promise<void>(done => setImmediate(done));
      assert.equal(fetches, cutoff === 500 ? 1 : 0);
    } finally { unsubscribe(); client.clear(); candleTradeRuntimes.delete("REPLAY.M"); }
  }
});

test("OHLC follows backend sequence even when server timestamps move backwards", () => {
  let current = apply(empty(), trade(900, 1, "20"));
  current = apply(current, trade(100, 2, "30"));
  assert.deepEqual([current.data[0].open, current.data[0].close], ["20", "30"]);
  assert.ok(compareTradeTimestamps(candleSnapshotTo(current, base), at(900)) > 0,
    "the cutoff includes the maximum timestamp, not just the last sequence");
});

test("guest ticker daily count reset still advances the approximate close", () => {
  let current = apply(empty(), trade(100, 9999, "20"), 1);
  current = apply(current, trade(900, 1, "30"), 1);
  assert.deepEqual([current.data[0].open, current.data[0].close, current.data[0].trade_count], ["20", "30", 2]);
});

test("a truncated snapshot buffered during REST recovers only an uncovered prefix", async () => {
  const { candleRuntime, reconcileCandleTradeSnapshot } = await import("../src/lib/candle-cache");
  for (const cutoff of [500, 800]) {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const key = ["candles", "REPLAY.M", "1s", 200];
    const runtime = candleRuntime("REPLAY.M");
    const initial = { ...rest(apply(empty(), trade(100, 1))), syncedThrough: at(cutoff) };
    client.setQueryData(key, initial);
    let fetches = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity,
      queryFn: async () => { fetches++; return initial; } });
    const unsubscribe = observer.subscribe(() => {});
    const pending = Object.assign([] as BufferedCandleTrade[], { syncedThrough: at(cutoff) });
    candleFetchTrades.set(JSON.stringify(key), pending);
    try {
      reconcileCandleTradeSnapshot(client, "REPLAY.M", [trade(600, 2), trade(900, 3)], 2, runtime);
      assert.equal(runtime.pendingSequences.size, cutoff === 500 ? 1 : 0);
      assert.equal(pending.length, 2);
      assert.equal(fetches, 0, "the fetch owner finishes before deciding whether recovery is needed");
    } finally {
      unsubscribe(); client.clear(); candleTradeRuntimes.delete("REPLAY.M"); candleFetchTrades.delete(JSON.stringify(key));
    }
  }
});

test("REST recovery keeps every real candle across more than one live window", async (t) => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  t.after(() => client.clear());
  t.mock.method(Date, "now", () => base + 5_504_000);
  const key = ["candles", "REPLAY.M", "1s", 500];
  const current = { ...rest(apply(empty(), trade(100, 0))), page: { has_more: true, next_cursor: "earlier" } };
  client.setQueryData(key, current);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const newest = 5500 - requests * 500;
    requests++;
    return Response.json({
      data: Array.from({ length: 500 }, (_, index) => ({ ...current.data[0], timestamp: at((newest - index) * 1000) })),
      page: { has_more: requests < 11, next_cursor: requests < 11 ? `page-${requests}` : null },
    });
  });
  const result = await fetchCandleSnapshot(client, "REPLAY.M", "1s", 500, true, new AbortController().signal);
  assert.equal(requests, 11);
  assert.equal(result.data.length, 5000);
  const real = [...result.data, ...result.history ?? []].filter(candle => !candle.synthetic);
  assert.equal(real.length, 5501);
  assert.equal(real.at(-1)?.timestamp, at(0));
  assert.ok(real.some(candle => candle.timestamp === at(1000)), "the final recovery page survives");
  assert.deepEqual(result.page, current.page, "newest-end recovery keeps the older-history cursor");
});
