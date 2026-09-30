import test from "node:test";
import assert from "node:assert/strict";
import {
  slippageError,
  tagPolicyError,
  iconPolicyError,
  transferAllowed,
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
