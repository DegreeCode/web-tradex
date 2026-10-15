import test from "node:test";
import assert from "node:assert/strict";
import { buildHolding } from "../src/lib/holdings";
import type { Instrument, Position } from "../src/lib/types";

const position: Position = {
  symbol: "AAA.M",
  name: "AAA",
  available_quantity: "8",
  locked_quantity: "0",
  total_quantity: "8",
  average_cost_basis: "1",
  cost_basis: "8",
  realized_pnl: "0",
};

test("missing and placeholder quotes do not report a complete investment loss", () => {
  for (const price of [undefined, "0", "0.00000000", "invalid"]) {
    const instruments = new Map<string, Instrument>();
    if (price !== undefined) instruments.set(position.symbol, { curve_spot_price: price } as Instrument);
    const holding = buildHolding(position, instruments);
    assert.equal(holding.value, null);
    assert.equal(holding.changePct, null);
  }
});

test("available quotes value all holdings while profit rates need a cost basis", () => {
  const instrument = { curve_spot_price: "1.25" } as Instrument;
  const instruments = new Map([[position.symbol, instrument]]);
  const holding = buildHolding(position, instruments);
  assert.equal(holding.value, 10);
  assert.equal(holding.changePct, 25);
  assert.equal(holding.instrument, instrument);
  assert.equal(buildHolding({ ...position, cost_basis: "0" }, instruments).changePct, null);
});
