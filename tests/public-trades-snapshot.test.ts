import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { replaceSymbolTrades } from "../src/lib/hooks";
import type { Page, PublicTrade } from "../src/lib/types";

const trade = (sequence: number): PublicTrade => ({
  symbol: "AAA.M", side: "BUY", price: "1", quantity: "1", credit: "1", fee: "0",
  timestamp: new Date(sequence * 1_000).toISOString(), sequence,
});
const page = (data: PublicTrade[]): Page<PublicTrade> => ({ data, page: { has_more: false, next_cursor: null } });
const key = ["symbol-trades", "AAA.M", 150];

test("a socket snapshot wins over a REST bootstrap that resolves after it", async () => {
  const client = new QueryClient();
  let resolveRest!: (value: Page<PublicTrade>) => void;
  const rest = client.prefetchQuery({
    queryKey: key,
    queryFn: () => new Promise<Page<PublicTrade>>((resolve) => { resolveRest = resolve; }),
  });

  replaceSymbolTrades(client, "AAA.M", 150, [trade(2), trade(1)]);
  // A live update lands on top of the snapshot before REST returns.
  client.setQueryData<Page<PublicTrade>>(key, (old) => old && { ...old, data: [trade(3), ...old.data] });
  resolveRest(page([trade(1)]));
  await rest;

  assert.deepEqual(client.getQueryData<Page<PublicTrade>>(key)?.data.map((row) => row.sequence), [3, 2, 1]);
  assert.equal(client.getQueryState(key)?.fetchStatus, "idle");
});

test("a snapshot replaces an already loaded REST page and keeps its paging", async () => {
  const client = new QueryClient();
  const cursorPage = { data: [trade(1)], page: { has_more: true, next_cursor: "older" } };
  await client.prefetchQuery({ queryKey: key, queryFn: async () => cursorPage });

  replaceSymbolTrades(client, "AAA.M", 150, [trade(5)]);

  assert.deepEqual(client.getQueryData(key), { data: [trade(5)], page: cursorPage.page });
});
