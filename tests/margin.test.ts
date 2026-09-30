import test from "node:test";
import assert from "node:assert/strict";

import {
  getLeverageOptions,
  estimateMarginReturnPercent,
  validateCollateralAmount,
  validateLeverage,
  validateReductionQuantity,
  marginErrorMessage,
} from "../src/lib/margin";
import { ApiError } from "../src/lib/api";

test("estimated return uses funded LONG margin and current SHORT collateral", () => {
  const long = { status: "OPEN", side: "LONG", equity: "125", collateral: "0", borrowed_credit: "200", leverage: "3" } as const;
  assert.equal(estimateMarginReturnPercent(long), "25");
  assert.equal(estimateMarginReturnPercent({ ...long, collateral: "25", equity: "150" }), "20");
  const short = { ...long, side: "SHORT", collateral: "100", equity: "75" } as const;
  assert.equal(estimateMarginReturnPercent(short), "-25");
  assert.equal(estimateMarginReturnPercent({ ...short, equity: "100" }), "0");
  assert.equal(estimateMarginReturnPercent({ ...short, equity: "-25" }), "-125");
  assert.equal(estimateMarginReturnPercent({ ...short, collateral: "0.0000000000000001", equity: "0.0000000000000002" }), "100");
});

test("estimated return is unavailable without a valid open-position basis", () => {
  const position = { status: "OPEN", side: "LONG", equity: "1", collateral: "0", borrowed_credit: "2", leverage: "3" } as const;
  assert.equal(estimateMarginReturnPercent({ ...position, status: "CLOSED" }), null);
  assert.equal(estimateMarginReturnPercent({ ...position, leverage: "1" }), null);
  assert.equal(estimateMarginReturnPercent({ ...position, borrowed_credit: "0" }), null);
  assert.equal(estimateMarginReturnPercent({ ...position, equity: "" }), null);
  assert.equal(estimateMarginReturnPercent({ ...position, side: "SHORT", collateral: "0" }), null);
  assert.equal(estimateMarginReturnPercent({ ...position, side: "SHORT", collateral: "-1" }), null);
});

test("getLeverageOptions generates 0.1 step options capped by eligibility", () => {
  // LONG: minimum is 1.1, capped by max_long_leverage
  const longOptions = getLeverageOptions("LONG", "1.5");
  assert.deepEqual(longOptions, ["1.1", "1.2", "1.3", "1.4", "1.5"]);

  const longLowCap = getLeverageOptions("LONG", "1.0");
  assert.deepEqual(longLowCap, []);

  const longHigherCap = getLeverageOptions("LONG", "2.0");
  assert.equal(longHigherCap.length, 10);
  assert.equal(longHigherCap[0], "1.1");
  assert.equal(longHigherCap[longHigherCap.length - 1], "2.0");

  // SHORT: minimum is 1.0, capped by max_short_leverage
  const shortOptions = getLeverageOptions("SHORT", "1.0");
  assert.deepEqual(shortOptions, ["1.0"]);

  const shortOptionsHigher = getLeverageOptions("SHORT", "1.5");
  assert.deepEqual(shortOptionsHigher, ["1.0", "1.1", "1.2", "1.3", "1.4", "1.5"]);
});

test("validateCollateralAmount enforces positive decimal <= 16 decimals and balance check", () => {
  // Empty
  assert.match(validateCollateralAmount("") ?? "", /입력/);

  // Negative / Zero
  assert.match(validateCollateralAmount("0") ?? "", /0보다 큰 양수/);
  assert.match(validateCollateralAmount("-1.5") ?? "", /0보다 큰 양수/);

  // Decimal > 16 places
  assert.match(validateCollateralAmount("1.12345678901234567") ?? "", /최대 16자리/);

  // Valid 16 decimals
  assert.equal(validateCollateralAmount("1.1234567890123456", "100"), null);

  // Exceeding available credit
  assert.match(validateCollateralAmount("50.5", "50.0") ?? "", /Credit이 부족해요/);

  // Within available credit
  assert.equal(validateCollateralAmount("50.0", "50.0"), null);
  assert.equal(validateCollateralAmount("49.999", "50.0"), null);
});

test("validateLeverage checks bounds and 0.1 increment", () => {
  // Valid LONG
  assert.equal(validateLeverage("1.5", "LONG", "1.5"), null);
  assert.equal(validateLeverage("1.1", "LONG", "1.5"), null);

  // LONG <= 1.0 rejected
  assert.match(validateLeverage("1.0", "LONG", "1.5") ?? "", /1.0을 초과/);

  // Step violation (more than 1 decimal place)
  assert.match(validateLeverage("1.25", "LONG", "2.0") ?? "", /0.1 단위/);

  // Exceeding max leverage
  assert.match(validateLeverage("1.6", "LONG", "1.5") ?? "", /허용된 최대 레버리지/);

  // SHORT validation
  assert.equal(validateLeverage("1.0", "SHORT", "1.0"), null);
  assert.match(validateLeverage("0.9", "SHORT", "1.0") ?? "", /1.0 이상/);
  assert.match(validateLeverage("1.5", "SHORT", "1.0") ?? "", /허용된 최대 레버리지/);
});

test("validateReductionQuantity ensures quantity < position quantity and <= 8 decimals", () => {
  const positionQty = "10.000000";

  // Valid reduction
  assert.equal(validateReductionQuantity("5.000000", positionQty), null);
  assert.equal(validateReductionQuantity("9.999999", positionQty), null);

  // Equal to or greater than position quantity must be rejected (must use full closure instead)
  assert.match(validateReductionQuantity("10.000000", positionQty) ?? "", /엄격히 작아야/);
  assert.match(validateReductionQuantity("11", positionQty) ?? "", /엄격히 작아야/);

  // Invalid decimals (> 8)
  assert.match(validateReductionQuantity("1.123456789", positionQty) ?? "", /최대 8자리/);

  assert.equal(validateReductionQuantity("0.00000001", positionQty), null);

  // Non-positive
  assert.match(validateReductionQuantity("0", positionQty) ?? "", /0보다 큰 양수/);
});

test("marginErrorMessage translates margin-specific error codes", () => {
  const err1 = new ApiError(409, "MARGIN_NOT_ELIGIBLE", "margin eligibility not met");
  assert.equal(marginErrorMessage(err1), "마진 거래 자격(거래일 수 등)을 충족하지 않아요");

  const err2 = new ApiError(409, "MARGIN_BLOCKED", "blocked");
  assert.equal(marginErrorMessage(err2), "마진 포지션 생성이 제한되어 있어요");

  const err3 = new ApiError(503, "MARGIN_INTEREST_PENDING", "interest pending");
  assert.equal(marginErrorMessage(err3), "이자 정산 작업이 진행 중이에요. 잠시 후 다시 시도해주세요");

  const err4 = new ApiError(409, "MARGIN_BORROW_LIMIT", "limit exceeded");
  assert.equal(marginErrorMessage(err4), "차입 가능 한도를 초과했어요");

  const err5 = new ApiError(409, "MARGIN_LIQUIDITY", "liquidity");
  assert.equal(marginErrorMessage(err5), "정산 유동성이 부족하여 주문을 체결할 수 없어요");

  // Fallback to standard messages
  const err6 = new ApiError(409, "INSUFFICIENT_CREDIT", "insufficient credit");
  assert.equal(marginErrorMessage(err6), "Credit 잔액이 부족해요");
});
