import test from "node:test";
import assert from "node:assert/strict";
import { isMarketSymbol, withTagList } from "../src/lib/symbol-metadata";
import type { MarketSymbol } from "../src/lib/types";

const listed = {
  symbol: "ABC",
  name: "ABC Corp",
  description: "",
  tags: null,
  state: "TRADING",
  total_supply: "1000",
  circulating_supply: "900",
  locked_supply: "100",
  listing_sequence: 1,
  listed_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
  halt_reason: null,
  halted_at: null,
  halted_until: null,
  version: "1",
} as unknown as MarketSymbol;

test("a listing response without tags gets an empty tag list", () => {
  const symbol = withTagList(listed);
  assert.deepEqual(symbol.tags, []);
  assert.ok(isMarketSymbol(symbol));
});

test("tags already present are kept", () => {
  const symbol = { ...listed, tags: ["game"] };
  assert.equal(withTagList(symbol), symbol);
});
