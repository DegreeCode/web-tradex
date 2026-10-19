import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/lib/api";
import {
  isMarginCapacityHiddenError,
  normalizeMarginCapacity,
  retryMarginCapacity,
  shouldShowMarginCapacityRow,
} from "../src/lib/margin-capacity";

// The documented HTTP 200 example from core.market.margin_status.
const levelExample = {
  data: {
    symbol: "ALPHA.M",
    display: "LEVEL",
    as_of: "2026-09-12T00:00:00Z",
    long: { available: true, level: "HIGH", reason: null },
    short: { available: false, level: "UNAVAILABLE", reason: "POOL_EMPTY" },
  },
};

const detailed = (long: Record<string, unknown> = {}, short: Record<string, unknown> = {}) => ({
  ...levelExample.data,
  display: "DETAILED",
  long: {
    ...levelExample.data.long,
    remaining_borrow_credit: "1234.1234567890123456",
    borrow_capacity_credit: "2000.0000000000000000",
    remaining_ratio_ppm: 617061,
    ...long,
  },
  short: {
    ...levelExample.data.short,
    remaining_quantity: "12.12345678",
    capacity_quantity: "20.00000000",
    remaining_notional_credit: "42.0000000000000001",
    remaining_ratio_ppm: 606172,
    ...short,
  },
});

test("BINARY shows only availability even if richer fields are accidentally present", () => {
  const model = normalizeMarginCapacity({ ...detailed(), display: "BINARY" })!;
  assert.equal(model.long?.label, "가능");
  assert.equal(model.short?.label, "불가");
  for (const side of [model.long!, model.short!]) {
    assert.equal(side.level, null);
    assert.equal(side.levelLabel, null);
    assert.equal(side.reason, null);
    assert.equal(side.reasonLabel, null);
    assert.equal(side.detail, null);
  }
});

test("the documented LEVEL envelope and apiData payload normalize identically", () => {
  const model = normalizeMarginCapacity(levelExample)!;
  assert.deepEqual(model, normalizeMarginCapacity(levelExample.data));
  assert.equal(model.symbol, "ALPHA.M");
  assert.equal(model.asOf, "2026-09-12T00:00:00Z");
  assert.equal(model.long?.available, true);
  assert.equal(model.long?.levelLabel, "여유");
  assert.equal(model.long?.reasonLabel, null);
  assert.equal(model.long?.tone, "available");
  assert.equal(model.short?.available, false);
  assert.equal(model.short?.label, "불가");
  assert.equal(model.short?.reasonLabel, "빌릴 주식이 없어요");
  assert.equal(model.short?.tone, "unavailable");
  assert.equal(model.long?.detail, null);
});

test("LEVEL labels use the server thresholds rather than guessing them locally", () => {
  for (const [level, label, tone] of [["LOW", "적음", "low"], ["NORMAL", "보통", "available"], ["HIGH", "여유", "available"]]) {
    const model = normalizeMarginCapacity({ display: "LEVEL", long: { available: true, level } })!;
    assert.equal(model.long?.label, label);
    assert.equal(model.long?.tone, tone);
  }
});

test("DETAILED keeps Credit precision and formats both sides and PPM percentages", () => {
  const model = normalizeMarginCapacity(detailed())!;
  assert.deepEqual(model.long?.detail, {
    remainingText: "1,234.1234567890123456 Credit",
    capacityText: "2,000 Credit",
    notionalText: null,
    ratioPercent: 61.7061,
    ratioText: "61.71%",
  });
  assert.deepEqual(model.short?.detail, {
    remainingText: "12.12345678주",
    capacityText: "20주",
    notionalText: "42.0000000000000001 Credit",
    ratioPercent: 60.6172,
    ratioText: "60.62%",
  });
  // State may forbid entry while the snapshot still has remaining capacity.
  assert.equal(model.short?.reasonLabel, "빌릴 주식이 없어요");
  assert.equal(model.short?.label, "불가");
});

test("ratios above 100% are preserved and zero differs from an unknown ratio", () => {
  const model = normalizeMarginCapacity(detailed({ remaining_ratio_ppm: 0 }, { remaining_ratio_ppm: 2500000 }))!;
  assert.equal(model.long?.detail?.ratioPercent, 0);
  assert.equal(model.long?.detail?.ratioText, "0%");
  assert.equal(model.short?.detail?.ratioPercent, 250);
  assert.equal(model.short?.detail?.ratioText, "250%");
});

test("null, missing, non-finite and malformed ratios stay unknown", () => {
  for (const remaining_ratio_ppm of [null, undefined, NaN, Infinity, -Infinity, -1, 1.5, "500000"]) {
    const model = normalizeMarginCapacity(detailed({ remaining_ratio_ppm }))!;
    assert.equal(model.long?.detail?.ratioPercent, null);
    assert.equal(model.long?.detail?.ratioText, null);
    assert.equal(model.long?.label, "여유");
  }
});

test("finite arbitrary precision JSON integers are accepted for display", () => {
  const remaining_ratio_ppm = JSON.parse("12345678901234567890") as number;
  const model = normalizeMarginCapacity(detailed({}, { remaining_ratio_ppm }))!;
  assert.equal(model.short?.detail?.ratioPercent, remaining_ratio_ppm / 10000);
  assert.ok(!model.short?.detail?.ratioText?.includes("Infinity"));
});

test("omitted sides and fields do not become zero or unavailable", () => {
  const model = normalizeMarginCapacity({ display: "DETAILED", long: {} })!;
  assert.equal(model.symbol, null);
  assert.equal(model.asOf, null);
  assert.equal(model.short, null);
  assert.equal(model.long?.available, null);
  assert.equal(model.long?.label, "확인 불가");
  assert.equal(model.long?.tone, "unknown");
  assert.deepEqual(model.long?.detail, {
    remainingText: null, capacityText: null, notionalText: null, ratioPercent: null, ratioText: null,
  });
});

test("unknown enums, including object prototype names, never invent labels", () => {
  for (const unknown of ["FUTURE", "__proto__", "constructor", "toString", null, 123, {}]) {
    const model = normalizeMarginCapacity({
      display: "LEVEL",
      long: { available: true, level: unknown, reason: unknown },
      short: { available: false, level: unknown, reason: unknown },
    })!;
    assert.equal(model.long?.level, null);
    assert.equal(model.long?.levelLabel, null);
    assert.equal(model.long?.label, "가능");
    assert.equal(model.short?.label, "불가");
    assert.equal(model.short?.reason, null);
    assert.equal(model.short?.reasonLabel, "현재 진입할 수 없어요");
  }
});

test("unknown/disabled display policies and malformed payloads stay hidden", () => {
  for (const raw of [null, undefined, [], false, "LEVEL", {}, { data: null }, { display: "DISABLED" }, { display: "FUTURE" }]) {
    assert.equal(normalizeMarginCapacity(raw), null);
  }
  const malformedSides = normalizeMarginCapacity({ display: "BINARY", long: [], short: "invalid" });
  assert.equal(malformedSides?.long, null);
  assert.equal(malformedSides?.short, null);
});

test("availability and the server's priority reason take precedence over numeric capacity", () => {
  const reasons = [
    ["SYMBOL_HALTED", "거래가 일시 정지된 종목이에요"],
    ["SYMBOL_DELIST_PENDING", "상장폐지가 예정된 종목이에요"],
    ["SYMBOL_DELISTED", "상장폐지된 종목이에요"],
    ["MARGIN_DISABLED", "마진이 꺼진 종목이에요"],
    ["POOL_EMPTY", "빌릴 주식이 없어요"],
    ["CAP_REACHED", "한도에 도달했어요"],
  ];
  for (const [reason, reasonLabel] of reasons) {
    const model = normalizeMarginCapacity(detailed({ available: false, level: "UNAVAILABLE", reason }))!;
    assert.equal(model.long?.label, "불가");
    assert.equal(model.long?.tone, "unavailable");
    assert.equal(model.long?.reason, reason);
    assert.equal(model.long?.reasonLabel, reasonLabel);
    assert.equal(model.long?.detail?.remainingText, "1,234.1234567890123456 Credit");
  }
});

test("available sides never show a stale unavailability reason", () => {
  const model = normalizeMarginCapacity(detailed({ reason: "CAP_REACHED" }))!;
  assert.equal(model.long?.reason, null);
  assert.equal(model.long?.reasonLabel, null);
});

test("missing or contradictory metadata cannot override the availability verdict", () => {
  const model = normalizeMarginCapacity({
    display: "LEVEL",
    long: { available: true, level: "UNAVAILABLE" },
    short: { available: false, level: "HIGH" },
  })!;
  assert.equal(model.long?.label, "가능");
  assert.equal(model.short?.label, "불가");
  for (const available of [undefined, null, "false", 0]) {
    const partial = normalizeMarginCapacity({ display: "LEVEL", long: { available, level: "HIGH" } })!;
    assert.equal(partial.long?.available, null);
    assert.equal(partial.long?.label, "확인 불가");
    assert.equal(partial.long?.tone, "unknown");
  }
});

test("malformed amounts and wrong types are omitted rather than formatted as zero", () => {
  for (const invalid of [null, undefined, "", "NaN", "Infinity", "-1", "1e3", 0, {}, "0.12345678901234567"]) {
    const model = normalizeMarginCapacity(detailed({ remaining_borrow_credit: invalid }, { remaining_quantity: invalid }))!;
    assert.equal(model.long?.detail?.remainingText, null);
    assert.equal(model.short?.detail?.remainingText, null);
  }
  assert.equal(normalizeMarginCapacity(detailed({}, { remaining_quantity: "0.123456789" }))?.short?.detail?.remainingText, null);
  assert.equal(normalizeMarginCapacity(detailed({ remaining_borrow_credit: "0" }))?.long?.detail?.remainingText, "0 Credit");
});

test("404 and disabled 403 are hidden; transient and other authorization failures stay distinguishable", () => {
  for (const error of [new ApiError(404, "NOT_FOUND", "missing symbol"), new ApiError(404, "", "missing route"), new ApiError(403, "MARGIN_STATUS_DISABLED", "disabled")]) {
    assert.equal(isMarginCapacityHiddenError(error), true);
  }
  for (const error of [new ApiError(503, "SERVICE_NOT_READY", "not ready"), new ApiError(403, "ACCESS_DENIED", "forbidden"), new Error("offline"), null]) {
    assert.equal(isMarginCapacityHiddenError(error), false);
  }
});

test("all 4xx stop retries, while transient errors get at most one retry", () => {
  for (const status of [400, 401, 403, 404, 409, 429, 499]) {
    assert.equal(retryMarginCapacity(0, new ApiError(status, "ERROR", "error")), false);
  }
  for (const error of [new ApiError(503, "SERVICE_NOT_READY", "not ready"), new ApiError(500, "INTERNAL_ERROR", "error"), new Error("offline")]) {
    assert.equal(retryMarginCapacity(0, error), true);
    assert.equal(retryMarginCapacity(1, error), false);
  }
});

test("the link reserves a chip row for the first load and renders it when either side exists", () => {
  assert.equal(shouldShowMarginCapacityRow({ capacity: null, hidden: false, status: "pending" }), true);
  for (const raw of [levelExample, { display: "BINARY", long: { available: true } }, { display: "BINARY", short: { available: false } }]) {
    assert.equal(shouldShowMarginCapacityRow({ capacity: normalizeMarginCapacity(raw), hidden: false, status: "success" }), true);
  }
});

test("hidden, failed and empty capacity responses restore the link's single line", () => {
  const capacity = normalizeMarginCapacity(levelExample);
  for (const error of [new ApiError(404, "NOT_FOUND", "missing"), new ApiError(403, "MARGIN_STATUS_DISABLED", "disabled"), new ApiError(503, "SERVICE_NOT_READY", "not ready"), new Error("offline")]) {
    assert.equal(shouldShowMarginCapacityRow({ capacity, hidden: isMarginCapacityHiddenError(error), status: "error" }), false);
  }
  assert.equal(shouldShowMarginCapacityRow({ capacity, hidden: true, status: "success" }), false);
  assert.equal(shouldShowMarginCapacityRow({ capacity: null, hidden: true, status: "pending" }), false);
  for (const raw of [null, { display: "BINARY" }, { display: "LEVEL", long: null, short: [] }, { display: "FUTURE" }]) {
    assert.equal(shouldShowMarginCapacityRow({ capacity: normalizeMarginCapacity(raw), hidden: false, status: "success" }), false);
  }
});
