import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider, InfiniteQueryObserver, QueryObserver } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { canonicalSymbol, applySymbolMetadataDelta, applySymbolMetadataCache, applyTradePriceOverlay, updateTradePriceOverlay, lastTradingEventTimestamps, refreshSymbolMetadata } from "../src/lib/market-cache";
import { useCreateAccount, useDeleteAccount } from "../src/lib/hooks/accounts";
import { useCreateTransfer, useTransferAction, useTransfers } from "../src/lib/hooks/transfers";
import { useInstrument } from "../src/lib/hooks/market";
import { usePolledSymbolTicker } from "../src/lib/hooks/trades";
import { useCreateListing, useCreateIssuance } from "../src/lib/hooks/symbols";
import { clearSymbolMetadataCache, readSymbolMetadataCache, writeSymbolMetadataCache } from "../src/lib/symbol-metadata";
import { applyTickers } from "../src/lib/hooks/tickers";
import type { Instrument, MarketSymbol, Ticker } from "../src/lib/types";

const symbol: MarketSymbol = {
  symbol: "ABC.M", name: "ABC", description: "", tags: [], state: "TRADING", total_supply: "1000",
  circulating_supply: "900", locked_supply: "100", listing_sequence: 1,
  listed_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  halt_reason: null, halted_at: null, halted_until: null, version: "1",
};
const cache = (symbols = [symbol]) => ({ schema_version: 3 as const, symbols, next_since_version: "1", saved_at: 1 });

function renderHook<T>(client: QueryClient, hook: () => T): T {
  let result!: T;
  function Probe() { result = hook(); return null; }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  return result;
}

test("market symbols match backend casing, suffix and base validation", () => {
  for (const input of ["abc", " abc.m ", "ABC.M", "AbC.M"]) assert.equal(canonicalSymbol(input), "ABC.M");
  assert.equal(canonicalSymbol("abcdefgh"), "ABCDEFGH.M");
  for (const input of [undefined, "", " ", "abcdefghi", "AB1", "A.M.M", "../ABC", "A B", "한글", ".M"]) {
    assert.equal(canonicalSymbol(input), undefined, String(input));
  }
});

test("lowercase missing-symbol links request and accept canonical batch metadata", async (t) => {
  clearSymbolMetadataCache();
  t.after(clearSymbolMetadataCache);
  writeSymbolMetadataCache(cache([]));
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requests.push(new URL(url).searchParams.get("symbols")!);
    return Response.json({ data: [symbol] });
  });
  const client = new QueryClient();
  t.after(() => client.clear());
  await refreshSymbolMetadata(client, "abc.m");
  assert.deepEqual(requests, ["ABC.M"]);
  assert.equal(readSymbolMetadataCache()!.symbols[0].symbol, "ABC.M");
});

test("metadata deletion clears tickers, details, trade overlays and event watermarks", () => {
  const client = new QueryClient();
  const before = cache();
  const after = cache([]);
  const instrument = { ...symbol, last_price: "1" } as Instrument;
  client.setQueryData(["ticker-cache"], [{ symbol: symbol.symbol }]);
  client.setQueryData(["instrument", symbol.symbol], instrument);
  client.setQueryData(["instruments"], [instrument]);
  updateTradePriceOverlay(symbol.symbol, { sequence: 1, price: "99" } as never);
  lastTradingEventTimestamps.set(symbol.symbol, 100);
  lastTradingEventTimestamps.set("UNLISTED.M", 100);
  lastTradingEventTimestamps.set("__GLOBAL__", 200);
  applySymbolMetadataDelta(client, before, after);
  applySymbolMetadataCache(client, after);
  assert.deepEqual(client.getQueryData(["ticker-cache"]), []);
  assert.equal(client.getQueryData(["instrument", symbol.symbol]), undefined);
  assert.deepEqual(client.getQueryData(["instruments"]), []);
  assert.equal(applyTradePriceOverlay(instrument).last_price, "1");
  assert.equal(lastTradingEventTimestamps.has(symbol.symbol), false);
  assert.equal(lastTradingEventTimestamps.has("UNLISTED.M"), false);
  assert.equal(lastTradingEventTimestamps.get("__GLOBAL__"), 200);
  lastTradingEventTimestamps.clear();
  client.clear();
});

for (const action of ["create account", "delete account", "create transfer", "accept transfer", "reject transfer", "cancel transfer", "create listing", "create issuance"]) {
  test(`${action} invalidates all balance views without a socket echo`, async (t) => {
    clearSymbolMetadataCache();
    t.after(clearSymbolMetadataCache);
    const client = new QueryClient();
    t.after(() => client.clear());
    for (const key of [["accounts"], ["portfolio", "a"], ["nav"]]) client.setQueryData(key, { balance: "old" });
    t.mock.method(globalThis, "fetch", async () => Response.json({ data: symbol }));
    switch (action) {
      case "create account": await renderHook(client, useCreateAccount).mutateAsync(); break;
      case "delete account": await renderHook(client, useDeleteAccount).mutateAsync("a"); break;
      case "create transfer": await renderHook(client, useCreateTransfer).mutateAsync({ account_id: "a", recipient_account_id: "b", asset: "CREDIT", amount: "1" }); break;
      case "accept transfer": case "reject transfer": case "cancel transfer":
        await renderHook(client, useTransferAction).mutateAsync({ transferId: "t", action: action === "accept transfer" ? "acceptance" : action === "reject transfer" ? "rejection" : "cancellation" }); break;
      case "create listing": await renderHook(client, useCreateListing).mutateAsync({} as never); break;
      case "create issuance": await renderHook(client, () => useCreateIssuance("ABC.M")).mutateAsync("1"); break;
    }
    for (const key of [["accounts"], ["portfolio", "a"], ["nav"]]) assert.equal(client.getQueryState(key)?.isInvalidated, true, JSON.stringify(key));
  });
}

test("ticker updates preserve unaffected row identities and remove tombstones", () => {
  const client = new QueryClient();
  const first = { ...symbol, last_price: "1" } as Instrument;
  const second = { ...first, symbol: "DEF.M" };
  client.setQueryData(["instruments"], [first, second]);
  client.setQueryData(["ticker-cache"], [first, second]);
  const before = client.getQueryData<Instrument[]>(["instruments"])!;
  applyTickers(client, [{ ...first, last_price: "2" }] as Ticker[]);
  assert.equal(client.getQueryData<Instrument[]>(["instruments"])![1], before[1]);
  lastTradingEventTimestamps.set(first.symbol, 100);
  applyTickers(client, [{ ...first, deleted: true }] as never);
  assert.equal(lastTradingEventTimestamps.has(first.symbol), false);
  assert.deepEqual(client.getQueryData<Instrument[]>(["instruments"])!.map(row => row.symbol), ["DEF.M"]);
  client.clear();
});

test("transfer outage polling fetches one page with three pages loaded", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    requests++;
    const cursor = new URL(input).searchParams.get("cursor");
    const index = cursor ? Number(cursor) : 0;
    return Response.json({ data: [{ transfer_id: `t${index}`, status: "PENDING" }], page: { has_more: index < 2, next_cursor: index < 2 ? String(index + 1) : null } });
  });
  renderHook(client, () => useTransfers());
  const query = client.getQueryCache().find({ queryKey: ["transfers", "mine", 50] })!;
  const observer = new InfiniteQueryObserver(client, { ...query.options, enabled: false } as never);
  const unsubscribe = observer.subscribe(() => {});
  t.after(unsubscribe);
  await observer.refetch();
  await observer.fetchNextPage();
  await observer.fetchNextPage();
  assert.equal(requests, 3);
  requests = 0;
  // Render again with the loaded history, as the mounted hook does.
  renderHook(client, () => useTransfers());
  const head = client.getQueryCache().find({ queryKey: ["transfer-head", "mine", 50] });
  if (head) await client.fetchQuery({ ...head.options, staleTime: 0 } as never);
  else await observer.refetch();
  assert.equal(requests, 1);
  assert.equal((client.getQueryData(query.queryKey) as { pages: unknown[] }).pages.length, 3);
});

test("identical ticker frames keep list identities and snapshots reuse reordered ticker objects", () => {
  const client = new QueryClient();
  const first = { ...symbol, last_price: "1" } as Instrument;
  const second = { ...first, symbol: "DEF.M" };
  applyTickers(client, [first, second], true);
  client.setQueryData(["instruments"], [first, second]);
  const tickers = client.getQueryData<Ticker[]>(["ticker-cache"])!;
  const instruments = client.getQueryData<Instrument[]>(["instruments"])!;
  applyTickers(client, [{ ...first }]);
  assert.equal(client.getQueryData(["ticker-cache"]), tickers);
  assert.equal(client.getQueryData(["instruments"]), instruments);
  applyTickers(client, [{ ...second }, { ...first }], true);
  const reordered = client.getQueryData<Ticker[]>(["ticker-cache"])!;
  assert.equal(reordered[0], tickers[1]);
  assert.equal(reordered[1], tickers[0]);
  client.clear();
});

test("transfer head polling merges IDs and retains the loaded history cursor", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const key = ["transfers", "mine", 50];
  client.setQueryData(key, { pages: [
    { data: [{ transfer_id: "a", status: "PENDING" }], page: { has_more: true, next_cursor: "first" } },
    { data: [{ transfer_id: "b", status: "PENDING" }], page: { has_more: true, next_cursor: "second" } },
    { data: [{ transfer_id: "c", status: "PENDING" }], page: { has_more: true, next_cursor: "third" } },
  ], pageParams: [null, "first", "second"] });
  t.mock.method(globalThis, "fetch", async () => Response.json({
    data: [{ transfer_id: "new", status: "PENDING" }, { transfer_id: "b", status: "COMPLETED" }],
    page: { has_more: true, next_cursor: "new-first" },
  }));
  renderHook(client, () => useTransfers());
  const head = client.getQueryCache().find({ queryKey: ["transfer-head", "mine", 50] })!;
  assert.equal((head.options as { refetchInterval?: number }).refetchInterval, 30_000);
  assert.equal((client.getQueryCache().find({ queryKey: key })!.options as { refetchInterval?: number }).refetchInterval, undefined);
  await client.fetchQuery({ ...head.options, staleTime: 0 } as never);
  const data = client.getQueryData<{ pages: { data: { transfer_id: string; status: string }[]; page: { next_cursor: string } }[]; pageParams: unknown[] }>(key)!;
  assert.deepEqual(data.pages.flatMap(page => page.data.map(row => row.transfer_id)), ["new", "b", "a", "c"]);
  assert.equal(data.pages[0].data[1].status, "COMPLETED");
  assert.equal(data.pages[2].page.next_cursor, "third");
  assert.deepEqual(data.pageParams, [null, "first", "second"]);
});

test("a completed full transfer refresh wins over an older in-flight head poll", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const key = ["transfers", "mine", 50];
  const first = { pages: [{ data: [{ transfer_id: "a", status: "PENDING" }], page: { has_more: false, next_cursor: null } }], pageParams: [null] };
  client.setQueryData(key, first);
  let release!: (response: Response) => void;
  let started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(globalThis, "fetch", () => { started(); return new Promise<Response>(resolve => { release = resolve; }); });
  renderHook(client, () => useTransfers());
  const head = client.getQueryCache().find({ queryKey: ["transfer-head", "mine", 50] })!;
  const refresh = client.fetchQuery({ ...head.options, staleTime: 0 } as never);
  await pending;
  const newer = { ...first, pages: [{ ...first.pages[0], data: [{ transfer_id: "a", status: "COMPLETED" }] }] };
  client.setQueryData(key, newer);
  release(Response.json(first.pages[0]));
  await refresh;
  assert.deepEqual(client.getQueryData(key), newer);
});

test("an exhaustive polled transfer head removes obsolete approval history", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const key = ["transfers", "approval", 50];
  const page = { data: [{ transfer_id: "old", status: "PENDING" }], page: { has_more: true, next_cursor: "next" } };
  client.setQueryData(key, { pages: [page, page, page], pageParams: [null, "a", "b"] });
  const fresh = { data: [], page: { has_more: false, next_cursor: null } };
  t.mock.method(globalThis, "fetch", async () => Response.json(fresh));
  renderHook(client, () => useTransfers("approval"));
  const head = client.getQueryCache().find({ queryKey: ["transfer-head", "approval", 50] })!;
  await client.fetchQuery({ ...head.options, staleTime: 0 } as never);
  assert.deepEqual(client.getQueryData(key), { pages: [fresh], pageParams: [null] });
});

test("manual transfer refresh recovers a failed head poll", async (t) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  t.after(() => client.clear());
  const key = ["transfers", "mine", 50];
  const headKey = ["transfer-head", "mine", 50];
  const page = { data: [{ transfer_id: "a", status: "PENDING" }], page: { has_more: false, next_cursor: null } };
  client.setQueryData(key, { pages: [page], pageParams: [null] });
  let failing = true;
  t.mock.method(globalThis, "fetch", async () => failing
    ? Response.json({ error: { code: "INTERNAL_ERROR", message: "failed" } }, { status: 500 })
    : Response.json(page));
  renderHook(client, () => useTransfers());
  const head = client.getQueryCache().find({ queryKey: headKey })!;
  await assert.rejects(client.fetchQuery({ ...head.options, staleTime: 0 } as never));
  assert.equal(client.getQueryState(headKey)?.status, "error");
  assert.equal(renderHook(client, () => useTransfers()).isError, true);
  client.setQueryData(key, { pages: [page], pageParams: [null] }, { updatedAt: Date.now() + 1 });
  assert.equal(renderHook(client, () => useTransfers()).isError, false);
  failing = false;
  await renderHook(client, () => useTransfers()).refetch();
  assert.equal(client.getQueryState(headKey)?.status, "success");
});

test("metadata updates retain unaffected instrument rows after ticker identity sharing is enabled", () => {
  const client = new QueryClient();
  const second = { ...symbol, symbol: "DEF.M" };
  applySymbolMetadataCache(client, cache([symbol, second]));
  applyTickers(client, []);
  const before = client.getQueryData<Instrument[]>(["instruments"])!;
  applySymbolMetadataCache(client, cache([{ ...symbol, tags: [] }, { ...second, name: "New name", version: "2" }]));
  const after = client.getQueryData<Instrument[]>(["instruments"])!;
  assert.equal(after[0], before[0]);
  assert.equal(after[1].name, "New name");
  client.clear();
});


test("undefined fee symbols disable instrument and ticker queries without sending requests", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json({ data: null }); });
  renderHook(client, () => {
    useInstrument(undefined);
    usePolledSymbolTicker(undefined);
  });
  for (const queryKey of [["instrument", undefined], ["ticker", undefined]]) {
    const query = client.getQueryCache().find({ queryKey, exact: true })!;
    assert.equal((query.options as { enabled: boolean }).enabled, false);
    const observer = new QueryObserver(client, { ...query.options, queryKey });
    t.after(observer.subscribe(() => {}));
  }
  await Promise.resolve();
  assert.equal(requests, 0);
});
