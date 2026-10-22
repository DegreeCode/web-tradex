import test from "node:test";
import assert from "node:assert/strict";
import {
  slippageError,
  tagPolicyError,
  iconPolicyError,
  transferAllowed,
  estimateTransferCost,
  transferCreditError,
  transferErrorMessage,
  managerMarginSideBlocked,
  lockedSupplyPpmFromPercent,
  type ExchangeInfo,
} from "../src/lib/exchange-info";

const metadata: ExchangeInfo["metadata"] = {
  icon_requests_per_minute_per_user: 2,
  max_tags: 2,
  tag_max_bytes: 6,
  tag_encoding: "UTF-8",
  icon_allowed_hosts: ["images.example.com"],
  icon_max_bytes: 32768,
  icon_max_width: 256,
  icon_max_height: 256,
  icon_formats: ["PNG", "JPEG"],
  icon_requires_approval: true,
};

test("custom slippage follows the current server maximum while blank uses the server default", () => {
  const trade = {
    fee_ppm: 100,
    default_slippage_ppm: 50000,
    max_slippage_ppm: 10000,
  };
  assert.equal(slippageError("", trade), null);
  assert.equal(slippageError(" ", trade), null);
  assert.equal(slippageError("0", trade), null);
  assert.equal(slippageError("1", trade), null);
  assert.ok(slippageError("1.0001", trade));
  assert.equal(
    slippageError("1.0001", { ...trade, max_slippage_ppm: 10001 }),
    null,
  );
  for (const invalid of ["-1", "NaN", ".", "1e2", "1.00001"])
    assert.ok(slippageError(invalid, trade));
  for (const invalid of ["9".repeat(400), "9007199254741"]) {
    assert.ok(slippageError(invalid), "unsafe ppm values must be rejected before settings load");
  }
});

test("tag limits count UTF-8 bytes including Korean and emoji", () => {
  assert.equal(tagPolicyError(["한글", "ab"], metadata), null);
  assert.ok(tagPolicyError(["가나다"], metadata));
  assert.ok(tagPolicyError(["😀😀"], metadata));
  assert.ok(tagPolicyError(["a", "b", "c"], metadata));
  assert.equal(
    tagPolicyError(["a", "b", "c"], { ...metadata, max_tags: 3 }),
    null,
  );
});

test("icon host policy supports empty allowlists and does not imply wildcard subdomains", () => {
  assert.equal(
    iconPolicyError("", { ...metadata, icon_allowed_hosts: [] }),
    null,
  );
  assert.ok(
    iconPolicyError("https://images.example.com/icon.png", {
      ...metadata,
      icon_allowed_hosts: [],
    }),
  );
  assert.equal(
    iconPolicyError("https://images.example.com/icon.png", metadata),
    null,
  );
  assert.ok(
    iconPolicyError("https://other.images.example.com/icon.png", metadata),
  );
  assert.ok(iconPolicyError("http://images.example.com/icon.png", metadata));
  assert.ok(iconPolicyError("https://name:password@images.example.com/icon.png", metadata));
});

test("external transfer restrictions preserve the own-account exception", () => {
  for (const asset of ["CREDIT", "STOCK"] as const) {
    assert.equal(transferAllowed(asset, false, "BOTH"), true);
    assert.equal(transferAllowed(asset, false, "DISABLED"), false);
    for (const policy of ["CREDIT_ONLY", "STOCK_ONLY", "DISABLED"] as const)
      assert.equal(transferAllowed(asset, true, policy), true);
  }
  assert.equal(transferAllowed("STOCK", false, "CREDIT_ONLY"), false);
  assert.equal(transferAllowed("STOCK", false, "STOCK_ONLY"), true);
  assert.equal(transferAllowed("CREDIT", false, "CREDIT_ONLY"), true);
});

test("manager own-symbol margin block follows the configured side", () => {
  assert.equal(managerMarginSideBlocked("SHORT", "SHORT"), true);
  assert.equal(managerMarginSideBlocked("LONG", "SHORT"), false);
  assert.equal(managerMarginSideBlocked("LONG", "BOTH"), true);
  // Older servers omit the setting; the API still rejects if it applies.
  assert.equal(managerMarginSideBlocked("SHORT", undefined), false);
});

test("typed locked ratio snaps to 0.1% steps inside the published range", () => {
  const within = (text: string) => lockedSupplyPpmFromPercent(text, 50_000, 900_000);
  assert.equal(within("25"), 250_000);
  assert.equal(within("10.3"), 103_000);
  assert.equal(within(" 7.5 "), 75_000);
  assert.equal(within("1"), 50_000);
  assert.equal(within("95"), 900_000);
  for (const text of ["", ".", "10.25", "abc", "-5", "1e1"]) {
    assert.equal(within(text), null, text);
  }
});


test("credit transfer costs include ceiling-rounded fees at Credit precision", () => {
  assert.deepEqual(estimateTransferCost("CREDIT", "100", false, 10_000), { fee: "1", requiredCredit: "101" });
  assert.deepEqual(estimateTransferCost("CREDIT", "0.0000000000000001", false, 1), {
    fee: "0.0000000000000001", requiredCredit: "0.0000000000000002",
  });
  const cost = estimateTransferCost("CREDIT", "9007199254740993.0000000000000001", false, 1)!;
  assert.equal(cost.fee, "9007199254.7409930000000001");
  assert.equal(cost.requiredCredit, "9007208261940247.7409930000000002");
  assert.ok(transferCreditError("100", estimateTransferCost("CREDIT", "100", false, 10_000), "CREDIT", "100"));
  assert.equal(transferCreditError("101", estimateTransferCost("CREDIT", "100", false, 10_000), "CREDIT", "100"), null);
});

test("stock transfers require Credit for the estimated fee and own-account transfers are free", () => {
  const cost = estimateTransferCost("STOCK", "2.5", false, 10_000, "12.34567891")!;
  assert.equal(cost.fee, "0.30864197275");
  assert.equal(cost.requiredCredit, cost.fee);
  assert.ok(transferCreditError("0", cost, "STOCK", ""));
  assert.equal(transferCreditError(cost.fee, cost, "STOCK", ""), null);
  assert.deepEqual(estimateTransferCost("STOCK", "1", true, undefined), { fee: "0", requiredCredit: "0" });
  assert.deepEqual(estimateTransferCost("CREDIT", "100", true, 10_000), { fee: "0", requiredCredit: "100" });
  assert.deepEqual(estimateTransferCost("STOCK", "1", false, 0), { fee: "0", requiredCredit: "0" });
  assert.equal(estimateTransferCost("CREDIT", "100", false, undefined), null);
  for (const price of [undefined, "0", "invalid"]) assert.equal(estimateTransferCost("STOCK", "1", false, 1, price), null);
  for (const value of ["", ".", "-1", "NaN"]) assert.equal(estimateTransferCost("CREDIT", value, false, 10), null);
  assert.equal(estimateTransferCost("CREDIT", "1", false, -1), null);
});

test("transfer insufficient-credit errors explain the fee requirement", async () => {
  const { ApiError } = await import("../src/lib/api");
  assert.match(transferErrorMessage(new ApiError(409, "INSUFFICIENT_CREDIT", "insufficient")), /수수료/);
  assert.equal(transferErrorMessage(new ApiError(409, "INSUFFICIENT_SHARES", "insufficient")), "보유 수량이 부족해요");
});


test("unknown stock transfer fees leave the Credit decision to the server", () => {
  assert.equal(transferCreditError("0", null, "STOCK", ""), null);
});

test("unknown Credit transfer fees fall back to the original amount-only check", () => {
  assert.equal(transferCreditError("100", null, "CREDIT", "100"), null);
  assert.equal(transferCreditError("101", null, "CREDIT", "100"), null);
  assert.equal(transferCreditError("99", null, "CREDIT", "100"), "Credit 잔액이 부족해요");
  assert.equal(transferCreditError("9007199254740993", null, "CREDIT", "9007199254740993.0000000000000001"), "Credit 잔액이 부족해요");
});
