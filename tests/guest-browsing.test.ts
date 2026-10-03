import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { applyPolledTrades, applyTickers, fetchMe } from "../src/lib/hooks";
import { isGuestRoute } from "../src/lib/navigation";
import { loginHref } from "../src/lib/routes";
import type { CandlePage } from "../src/lib/candle-data";
import type { Instrument, PublicTrade, Ticker } from "../src/lib/types";

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

const trade = (symbol: string, sequence: number, second: number): PublicTrade => ({
  symbol, side: "BUY", price: "10", quantity: "1", credit: "10", fee: "0",
  timestamp: new Date(Date.UTC(2026, 9, 3, 0, 0, second)).toISOString(), sequence,
});

function candleQuery(symbol: string) {
  const client = new QueryClient();
  const queryKey = ["candles", symbol, "1m", 200];
  let fetches = 0;
  const page: CandlePage = {
    data: [{
      symbol, interval: "1m", timestamp: "2026-10-03T00:00:00Z",
      open: "10", high: "10", low: "10", close: "10",
      volume_shares: "1", volume_credit: "10", trade_count: 1,
    }],
    page: { has_more: false, next_cursor: null },
    syncedThrough: "2026-10-03T00:00:10Z",
  };
  client.setQueryData(queryKey, page);
  // An observer makes the query active, as a mounted chart does.
  const observer = new QueryObserver(client, {
    queryKey,
    queryFn: async () => {
      fetches += 1;
      return page;
    },
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  const count = () => client.getQueryData<CandlePage>(queryKey)?.data[0].trade_count;
  return { client, count, fetches: () => fetches, unsubscribe };
}

test("polled trades extend the candle once, skipping ones the candles were fetched after", () => {
  const symbol = "POLL.M";
  const { client, count, fetches, unsubscribe } = candleQuery(symbol);

  // Trade 1 predates the candle fetch; trade 2 came after it.
  applyPolledTrades(client, symbol, [trade(symbol, 2, 20), trade(symbol, 1, 5)]);
  assert.equal(count(), 2);

  applyPolledTrades(client, symbol, [trade(symbol, 3, 30), trade(symbol, 2, 20), trade(symbol, 1, 5)]);
  applyPolledTrades(client, symbol, [trade(symbol, 3, 30), trade(symbol, 2, 20)]);
  assert.equal(count(), 3);
  assert.equal(fetches(), 0);
  unsubscribe();
});

test("a polled page that skips past the last applied trade refetches the candles", async () => {
  const symbol = "GAP.M";
  const { client, count, fetches, unsubscribe } = candleQuery(symbol);

  applyPolledTrades(client, symbol, [trade(symbol, 2, 20)]);
  assert.equal(count(), 2);
  // Trades 3 and 4 fell off the page before it was polled again.
  applyPolledTrades(client, symbol, [trade(symbol, 6, 40), trade(symbol, 5, 35)]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(fetches(), 1);
  assert.equal(count(), 1);
  unsubscribe();
});
