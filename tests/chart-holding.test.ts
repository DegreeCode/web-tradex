import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { buildChartHolding, cachedChartPortfolio, subscribeChartPortfolio } from "../src/lib/chart-holding";
import type { Account, Portfolio, Position } from "../src/lib/types";

const position = (overrides: Partial<Position> = {}): Position => ({
  symbol: "AAA.M", name: "A", available_quantity: "2", locked_quantity: "1",
  total_quantity: "3", average_cost_basis: "10", cost_basis: "30", realized_pnl: "0",
  ...overrides,
});

const portfolio = (accountId: string, positions = [position()]): Portfolio => ({
  account_id: accountId, available_credit: "0", locked_credit: "0", total_credit: "0",
  positions, updated_at: "2026-10-03T00:00:00Z",
});

const accounts: Account[] = [
  { account_id: "extra", is_primary: false, available_credit: "0", locked_credit: "0", total_credit: "0", created_at: "" },
  { account_id: "main", is_primary: true, available_credit: "0", locked_credit: "0", total_credit: "0", created_at: "" },
];

test("chart return uses total holdings including locked shares and their cost basis", () => {
  assert.deepEqual(buildChartHolding(position(), "12"), { averagePrice: "10", returnPercent: 20 });
  assert.equal(buildChartHolding(position(), "8")?.returnPercent, -20);
  assert.equal(buildChartHolding(position(), "0")?.returnPercent, -100);
  // The API's average can be rounded; calculate against the actual total cost.
  assert.equal(buildChartHolding(position({ average_cost_basis: "9.99999999" }), "10")?.returnPercent, 0);
});

test("missing or empty holdings are hidden and zero cost has no return percentage", () => {
  assert.equal(buildChartHolding(undefined, "10"), undefined);
  assert.equal(buildChartHolding(position({ total_quantity: "0" }), "10"), undefined);
  assert.deepEqual(buildChartHolding(position({ average_cost_basis: "0", cost_basis: "0" }), "10"), {
    averagePrice: "0", returnPercent: null,
  });
  assert.equal(buildChartHolding(position({ cost_basis: "invalid" }), "10"), undefined);
  assert.equal(buildChartHolding(position(), "NaN"), undefined);
});

test("chart selects the primary or the order's chosen account without mixing holdings", () => {
  const client = new QueryClient();
  try {
    const main = portfolio("main");
    const extra = portfolio("extra", [position({ average_cost_basis: "20", cost_basis: "60" })]);
    client.setQueryData(["accounts"], accounts);
    client.setQueryData(["portfolio", "main"], main);
    client.setQueryData(["portfolio", "extra"], extra);
    assert.equal(cachedChartPortfolio(client), main);
    assert.equal(cachedChartPortfolio(client, "extra"), extra);
    assert.equal(cachedChartPortfolio(client, "uncached"), undefined);
    client.removeQueries({ queryKey: ["portfolio", "main"], exact: true });
    client.setQueryData(["portfolio", "primary"], main);
    assert.equal(cachedChartPortfolio(client), main);
    assert.equal(cachedChartPortfolio(client, "uncached"), undefined);
  } finally {
    client.clear();
  }
});

test("chart cache subscription creates no query and never starts a portfolio request", async () => {
  const client = new QueryClient();
  const snapshots: (Portfolio | undefined)[] = [];
  const unsubscribe = subscribeChartPortfolio(client, () => snapshots.push(cachedChartPortfolio(client, "main")));
  let fetches = 0;
  try {
    assert.equal(client.getQueryCache().getAll().length, 0);
    assert.equal(cachedChartPortfolio(client, "main"), undefined);
    const initial = portfolio("main");
    const observer = new QueryObserver(client, {
      queryKey: ["portfolio", "main"],
      queryFn: async () => { fetches += 1; return initial; },
      staleTime: Infinity,
    });
    const closeOrder = observer.subscribe(() => {});
    await observer.refetch();
    assert.equal(fetches, 1);
    assert.equal(cachedChartPortfolio(client, "main"), initial);
    closeOrder();
    assert.equal(client.getQueryCache().find({ queryKey: ["portfolio", "main"], exact: true })?.getObserversCount(), 0);
    await client.invalidateQueries({ queryKey: ["portfolio"] });
    assert.equal(fetches, 1);
    const updated = portfolio("main", [position({ average_cost_basis: "12", cost_basis: "36" })]);
    client.setQueryData(["portfolio", "main"], updated);
    assert.deepEqual(snapshots.at(-1), updated);
    client.removeQueries({ queryKey: ["portfolio"] });
    assert.equal(snapshots.at(-1), undefined);
    assert.equal(fetches, 1);
  } finally {
    unsubscribe();
    client.clear();
  }
});
