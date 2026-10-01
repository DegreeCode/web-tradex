import test from "node:test";
import assert from "node:assert/strict";
import {
  liveReferencePrice,
  slippageRequestFields,
  slippageSettingsError,
  slippageSummary,
  type SlippageSettings,
} from "../src/lib/slippage";

const slippage = (value: string): SlippageSettings => ({ mode: "SLIPPAGE", slippage: value, limitPrice: "" });
const limit = (price: string): SlippageSettings => ({ mode: "PRICE_LIMIT", slippage: "3", limitPrice: price });
const trade = { fee_ppm: 100, default_slippage_ppm: 50000, max_slippage_ppm: 500000 };

test("slippage mode sends the typed percent and anchors it to the client's latest curve price", () => {
  assert.deepEqual(slippageRequestFields(slippage("1.5")), { slippage_ppm: 15000 });
  assert.deepEqual(slippageRequestFields(slippage(" ")), {});
  assert.equal(liveReferencePrice(slippage(""), "123.45000000"), "123.45000000");
  // An unusable cached price falls back to the server's price at execution.
  assert.equal(liveReferencePrice(slippage(""), "0"), undefined);
  assert.equal(liveReferencePrice(slippage(""), "1.123456789"), undefined);
  assert.equal(liveReferencePrice(slippage(""), undefined), undefined);
});

test("price-limit mode sends zero slippage around the typed price and no live reference", () => {
  assert.deepEqual(slippageRequestFields(limit(" 110.5 ")), { slippage_ppm: 0, slippage_reference_price: "110.5" });
  assert.equal(liveReferencePrice(limit("110.5"), "100"), undefined);
});

test("price-limit mode requires a positive price named for the fill direction", () => {
  assert.equal(slippageSettingsError(limit(""), "BUY", trade), "매수 상한가를 입력해주세요");
  assert.equal(slippageSettingsError(limit("0"), "SELL", trade), "매도 하한가를 입력해주세요");
  assert.equal(slippageSettingsError(limit("99.5"), "SELL", trade), null);
  // The percent left over from slippage mode is not validated or sent.
  assert.equal(slippageSettingsError({ ...limit("1"), slippage: "999" }, "BUY", trade), null);
  assert.ok(slippageSettingsError(slippage("51"), "BUY", trade));
});

test("the collapsed summary names the active bound", () => {
  const format = (price: string) => `<${price}>`;
  assert.equal(slippageSummary(slippage(""), "BUY", 50000, format), "슬리피지 5%");
  assert.equal(slippageSummary(slippage("0.5"), "BUY", 50000, format), "슬리피지 0.5%");
  assert.equal(slippageSummary(slippage(""), "BUY", undefined, format), null);
  assert.equal(slippageSummary(limit("110"), "BUY", 50000, format), "매수 상한가 <110>");
  assert.equal(slippageSummary(limit(""), "SELL", 50000, format), "매도 하한가");
});
