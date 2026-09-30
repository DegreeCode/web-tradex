import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { reconcileDisclosures } from "../src/lib/hooks";
import type { Disclosure } from "../src/lib/types";

const row = (id: string, minute: number, symbol = "AAA.M", type = "SYMBOL_HALTED"): Disclosure => ({
  disclosure_id: id, occurred_at: new Date(minute * 60_000).toISOString(), symbol, type, payload: {},
});
const page = (data: Disclosure[], cursor: string | null = null) => ({ data, page: { has_more: !!cursor, next_cursor: cursor } });

test("public disclosures update matching caches, deduplicate snapshots and preserve history cursors", () => {
  const client = new QueryClient();
  const key = ["disclosures", "AAA.M", "all", 10];
  const older = page([row("old", 1)]);
  client.setQueryData(key, { pages: [page([row("initial", 3)], "older"), older], pageParams: [null, "older"] });
  const other = ["disclosures", "BBB.M", "all", 10];
  const filtered = ["disclosures", "AAA.M", "SYMBOL_RESUMED", 10];
  for (const k of [other, filtered]) client.setQueryData(k, { pages: [page([])], pageParams: [null] });
  const events = [row("new", 4), row("old", 1), row("other", 5, "BBB.M"), row("resumed", 6, "AAA.M", "SYMBOL_RESUMED")];
  reconcileDisclosures(client, events);
  reconcileDisclosures(client, events);
  const result = client.getQueryData<{ pages: ReturnType<typeof page>[]; pageParams: unknown[] }>(key)!;
  assert.deepEqual(result.pages[0].data.map(r => r.disclosure_id), ["resumed", "new", "initial"]);
  assert.deepEqual(result.pages[0].page, { has_more: true, next_cursor: "older" });
  assert.equal(result.pages[1], older);
  assert.deepEqual(result.pageParams, [null, "older"]);
  for (const [k, expected] of [[other, ["other"]], [filtered, ["resumed"]]] as const) {
    const value = client.getQueryData<{ pages: ReturnType<typeof page>[] }>(k)!;
    assert.deepEqual(value.pages[0].data.map(r => r.disclosure_id), expected);
  }
  assert.equal(client.getQueryState(key)?.isInvalidated, false);
  client.clear();
});

test("global market events without disclosure IDs do not create list entries", () => {
  const client = new QueryClient();
  reconcileDisclosures(client, [{ type: "GLOBAL_MARKET_HALTED", symbol: "", payload: {} } as Disclosure]);
  assert.deepEqual(client.getQueryData(["public-disclosures"]), []);
  client.clear();
});
