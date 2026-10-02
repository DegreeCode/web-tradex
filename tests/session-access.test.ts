import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, errorMessage, scopeDenialReason } from "../src/lib/api";
import { sessionAllows } from "../src/lib/session-access";
import type { SessionScope } from "../src/lib/types";

const scope: SessionScope = {
  name: "Chrome · Linux",
  permissions: ["READ", "TRADE"],
  account_ids: ["acc_1"],
  network_bound: true,
  idle_timeout_minutes: 120,
  expires_at: "2026-10-03T00:00:00Z",
};

test("a passkey session may do everything", () => {
  for (const need of ["READ", "TRADE", "TRANSFER", "MARGIN", "FULL"] as const) {
    assert.equal(sessionAllows(null, need), true);
  }
});

test("a linked session may do only what its scope grants, never FULL actions", () => {
  assert.equal(sessionAllows(scope, "READ"), true);
  assert.equal(sessionAllows(scope, "TRADE"), true);
  assert.equal(sessionAllows(scope, "TRANSFER"), false);
  assert.equal(sessionAllows(scope, "MARGIN"), false);
  assert.equal(sessionAllows(scope, "FULL"), false);
});

test("scope refusals are told apart by their reason", () => {
  const refusal = (reason?: string) =>
    new ApiError(403, "SESSION_SCOPE_FORBIDDEN", "", "", reason ? { reason } : undefined);
  assert.equal(scopeDenialReason(refusal("NETWORK_MISMATCH")), "NETWORK_MISMATCH");
  assert.equal(scopeDenialReason(refusal("PERMISSION")), "PERMISSION");
  assert.equal(scopeDenialReason(refusal("ROUTE")), "ROUTE");
  // Servers before the reason field, or an unknown one, read as a plain refusal.
  assert.equal(scopeDenialReason(refusal()), "ROUTE");
  assert.equal(scopeDenialReason(refusal("SOMETHING_NEW")), "ROUTE");
  assert.equal(scopeDenialReason(new ApiError(403, "ACCESS_DENIED", "")), null);
  assert.equal(errorMessage(refusal("NETWORK_MISMATCH")), "접속 위치가 바뀌어 이 연결을 더 이상 쓸 수 없어요");
  assert.equal(errorMessage(refusal("PERMISSION")), "이 연결된 기기에 허용되지 않은 기능이에요");
});
