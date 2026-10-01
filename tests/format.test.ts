import test from "node:test";
import assert from "node:assert/strict";
import { accountLabel } from "../src/lib/accounts";
import { decimalPrecision, fmtCredit, fmtPrice, fmtQuantity, scaleDecimal } from "../src/lib/format";
import { hasDistinctLastTrade, isAtCurveCeiling } from "../src/lib/instruments";

test("price, share and Credit units keep their full precision without number coercion", () => {
  assert.equal(fmtPrice("0.00000001"), "0.00000001");
  assert.equal(fmtQuantity("123456789.12345678"), "123,456,789.12345678");
  assert.equal(fmtCredit("9007199254740993.1234567890123456"), "9,007,199,254,740,993.1234567890123456");
  assert.equal(fmtCredit("-1.9999999999999999", 2), "-2");
  assert.equal(decimalPrecision("0.00000001"), 8);
  // Maximum order shortcuts keep the whole balance.
  assert.equal(scaleDecimal("1.1234567890123456", 1, 16), "1.1234567890123456");
  assert.equal(scaleDecimal("0.00000003", 0.5, 8), "0.00000001");
});

test("the last trade line only appears for a real trade that differs from spot", () => {
  // No trade yet: the ticker reports 0 and must not read "최근 체결 0".
  assert.equal(hasDistinctLastTrade({ last_price: "0", curve_spot_price: "1.5" }), false);
  assert.equal(hasDistinctLastTrade({ last_price: "1.50", curve_spot_price: "1.5" }), false);
  assert.equal(hasDistinctLastTrade({ last_price: "1.4", curve_spot_price: "1.5" }), true);
  assert.equal(isAtCurveCeiling({ curve_spot_price: "2.00", curve_ceiling_price: "2" }), true);
  assert.equal(isAtCurveCeiling({ curve_spot_price: "0", curve_ceiling_price: "0" }), false);
  assert.equal(isAtCurveCeiling({ curve_spot_price: "1", curve_ceiling_price: null }), false);
});

test("extra accounts are numbered only when there is more than one", () => {
  const primary = { account_id: "acc_p", is_primary: true };
  const first = { account_id: "acc_1", is_primary: false };
  const second = { account_id: "acc_2", is_primary: false };
  assert.equal(accountLabel(primary, [primary, first]), "대표 계좌");
  assert.equal(accountLabel(first, [primary, first]), "추가 계좌");
  assert.equal(accountLabel(second, [primary, first, second]), "추가 계좌 2");
});
