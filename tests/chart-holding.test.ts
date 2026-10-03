import test from "node:test";
import assert from "node:assert/strict";
import { buildChartHolding } from "../src/lib/chart-holding";
import type { Position } from "../src/lib/types";

const position = (overrides: Partial<Position> = {}): Position => ({
  symbol: "AAA.M", name: "A", available_quantity: "2", locked_quantity: "1",
  total_quantity: "3", average_cost_basis: "10", cost_basis: "30", realized_pnl: "0",
  ...overrides,
});

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
