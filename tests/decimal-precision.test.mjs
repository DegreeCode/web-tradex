import assert from "node:assert/strict";
import test from "node:test";
import { decimalPrecision, fmtCredit, fmtPrice, fmtQuantity, scaleDecimal } from "../src/lib/format.ts";

test("documented price/share ticks and Credit units remain visible without number coercion", () => {
  assert.equal(fmtPrice("0.00000001"), "0.00000001");
  assert.equal(fmtQuantity("123456789.12345678"), "123,456,789.12345678");
  assert.equal(fmtCredit("9007199254740993.1234567890123456"), "9,007,199,254,740,993.1234567890123456");
  assert.equal(fmtCredit("0.0000000000000001"), "0.0000000000000001");
  assert.equal(fmtCredit("-1.9999999999999999", 2), "-2");
  assert.equal(decimalPrecision("0.00000001"), 8);
});

test("maximum order shortcuts preserve the full account balance and quantity", () => {
  assert.equal(scaleDecimal("1.1234567890123456", 1, 16), "1.1234567890123456");
  assert.equal(scaleDecimal("1.12345678", 1, 8), "1.12345678");
  assert.equal(scaleDecimal("0.00000003", 0.5, 8), "0.00000001");
});
