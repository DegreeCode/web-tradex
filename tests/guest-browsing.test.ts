import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { updateCachedCandleQueries } from "../src/lib/candle-cache";
import { applyTickers, fetchMe, tradeSinceTicker } from "../src/lib/hooks";
import { isGuestRoute } from "../src/lib/navigation";
import { loginHref } from "../src/lib/routes";
import type { CandlePage } from "../src/lib/candle-data";
import type { Instrument, Ticker } from "../src/lib/types";

test("only the market screens open without signing in", () => {
  assert.ok(isGuestRoute("/market"));
  assert.ok(isGuestRoute("/market/symbol"));
  for (const path of ["/", "/marketing", "/portfolio", "/orders", "/margin", "/notifications"]) {
    assert.ok(!isGuestRoute(path), path);
  }
  assert.equal(loginHref("/market/symbol?symbol=AAA.M"), "/login?next=%2Fmarket%2Fsymbol%3Fsymbol%3DAAA.M");
});

test("a browser without the CSRF cookie has no session and never asks /me", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("unexpected request");
  }) as typeof fetch;
  try {
    assert.equal(await fetchMe(), null);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const ticker = (symbol: string, price: string): Ticker => ({
  symbol, last_price: price, curve_spot_price: price, market_value: "0", holder_count: 0,
  open: price, high: price, low: price, volume_shares: "0", volume_credit: "0",
  change_ppm: 0, trade_count: 0, window_start: "2026-10-03T00:00:00+09:00",
});

test("a polled ticker page merges into the cache and keeps symbols outside the page", () => {
  const client = new QueryClient();
  applyTickers(client, [ticker("AAA.M", "1"), ticker("BBB.M", "2")], true);
  client.setQueryData<Instrument[]>(["instruments"], [
    { symbol: "AAA.M", name: "A" } as Instrument,
    { symbol: "BBB.M", name: "B" } as Instrument,
  ]);

  applyTickers(client, [ticker("BBB.M", "3")]);

  assert.deepEqual(
    client.getQueryData<Ticker[]>(["ticker-cache"])?.map((row) => [row.symbol, row.curve_spot_price]),
    [["AAA.M", "1"], ["BBB.M", "3"]],
  );
  const instruments = client.getQueryData<Instrument[]>(["instruments"]);
  assert.equal(instruments?.[1].curve_spot_price, "3");
  assert.equal(instruments?.[1].name, "B");
});

const polled = (overrides: Partial<Ticker>): Ticker => ({
  ...ticker("AAA.M", "10"), trade_count: 4, volume_shares: "4", volume_credit: "40", ...overrides,
});
const at = (second: number) => new Date(Date.UTC(2026, 9, 3, 0, 0, second));

test("a ticker poll turns the trades since the last poll into one candle entry", () => {
  const before = polled({});
  assert.equal(tradeSinceTicker(before, before, at(5)), null);

  const since = tradeSinceTicker(before, polled({
    last_price: "12.5", trade_count: 7, volume_shares: "6.25", volume_credit: "70",
  }), at(5));
  assert.equal(since?.count, 3);
  assert.equal(since?.trade.price, "12.5");
  assert.equal(since?.trade.quantity, "2.25");
  assert.equal(since?.trade.credit, "30");
  assert.equal(since?.trade.timestamp, at(5).toISOString());

  // A new day restarts the totals, so all of today's counts are new.
  const nextDay = tradeSinceTicker(before, polled({
    window_start: "2026-10-04T00:00:00+09:00", trade_count: 1, volume_shares: "1", volume_credit: "9",
  }), at(5));
  assert.equal(nextDay?.count, 1);
  assert.equal(nextDay?.trade.quantity, "1");
});

test("ticker updates move the loaded candle's close, range and volume without refetching", () => {
  const client = new QueryClient();
  const queryKey = ["candles", "AAA.M", "1m", 200];
  let fetches = 0;
  const page: CandlePage = {
    data: [{
      symbol: "AAA.M", interval: "1m", timestamp: "2026-10-03T00:00:00Z",
      open: "10", high: "10", low: "10", close: "10",
      volume_shares: "4", volume_credit: "40", trade_count: 4,
    }],
    page: { has_more: false, next_cursor: null },
    syncedThrough: at(1).toISOString(),
  };
  client.setQueryData(queryKey, page);
  // An observer makes the query active, as a mounted chart does.
  const unsubscribe = new QueryObserver(client, {
    queryKey,
    queryFn: async () => {
      fetches += 1;
      return page;
    },
    staleTime: Infinity,
  }).subscribe(() => {});

  const first = tradeSinceTicker(polled({}), polled({
    last_price: "12", trade_count: 6, volume_shares: "6", volume_credit: "64",
  }), at(10))!;
  updateCachedCandleQueries(client, "AAA.M", first.trade, first.count);
  const second = tradeSinceTicker(polled({ last_price: "12", trade_count: 6, volume_shares: "6" }), polled({
    last_price: "9", trade_count: 7, volume_shares: "7",
  }), at(20))!;
  updateCachedCandleQueries(client, "AAA.M", second.trade, second.count);

  const [candle] = client.getQueryData<CandlePage>(queryKey)!.data;
  assert.deepEqual(
    [candle.open, candle.high, candle.low, candle.close, candle.volume_shares, candle.trade_count],
    ["10", "12", "9", "9", "7", 7],
  );
  assert.equal(fetches, 0);
  unsubscribe();
});
