import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/lib/api";
import {
  FALLBACK_SCOPE_LIMITS,
  deviceLinkOutcome,
  formatMinutes,
  formatRemaining,
  idleChoices,
  normalizeUserCode,
  permissionLocked,
  permissionSummary,
  pickChoice,
  scopeLimits,
  togglePermission,
  ttlChoices,
  pollFailure,
  pollIntervalMs,
  remainingSeconds,
  verificationUrl,
} from "../src/lib/device-link";

test("each poll status maps to what the screen does next", () => {
  assert.equal(deviceLinkOutcome("PENDING"), "waiting");
  assert.equal(deviceLinkOutcome("APPROVED"), "signed-in");
  assert.equal(deviceLinkOutcome("CONSUMED"), "signed-in");
  assert.equal(deviceLinkOutcome("DENIED"), "denied");
  assert.equal(deviceLinkOutcome("EXPIRED"), "expired");
  assert.equal(deviceLinkOutcome("SOMETHING_NEW"), "failed");
});

test("the poll interval follows the server within sane bounds", () => {
  assert.equal(pollIntervalMs(5), 5_000);
  assert.equal(pollIntervalMs(undefined), 5_000);
  assert.equal(pollIntervalMs(0), 5_000);
  assert.equal(pollIntervalMs(Number.NaN), 5_000);
  assert.equal(pollIntervalMs(0.1), 1_000);
  assert.equal(pollIntervalMs(600), 60_000);
});

test("rate limiting widens the interval for good and honours Retry-After", () => {
  const limited = new ApiError(429, "DEVICE_LINK_RATE_LIMITED", "", "", undefined, 12_000);
  assert.deepEqual(pollFailure(limited, 5_000), { kind: "retry", intervalMs: 10_000, delayMs: 12_000 });
  const bare = new ApiError(429, "RATE_LIMITED", "");
  assert.deepEqual(pollFailure(bare, 58_000), { kind: "retry", intervalMs: 60_000, delayMs: 60_000 });
});

test("transient failures retry without changing the interval", () => {
  assert.deepEqual(pollFailure(new ApiError(0, "NETWORK_ERROR", ""), 5_000), {
    kind: "retry",
    intervalMs: 5_000,
    delayMs: 10_000,
  });
  assert.deepEqual(pollFailure(new ApiError(503, "SERVICE_NOT_READY", ""), 5_000), {
    kind: "retry",
    intervalMs: 5_000,
    delayMs: 10_000,
  });
  assert.equal(pollFailure(new TypeError("boom"), 5_000).kind, "retry");
});

test("a dead request stops polling", () => {
  assert.deepEqual(pollFailure(new ApiError(410, "DEVICE_LINK_EXPIRED", ""), 5_000), { kind: "stop", outcome: "expired" });
  assert.deepEqual(pollFailure(new ApiError(404, "DEVICE_LINK_INVALID", ""), 5_000), { kind: "stop", outcome: "failed" });
  assert.deepEqual(pollFailure(new ApiError(403, "ORIGIN_INVALID", ""), 5_000), { kind: "stop", outcome: "failed" });
});

test("only a same-origin /link path becomes the approval address", () => {
  const origin = "https://app.example.com";
  assert.equal(verificationUrl(origin, "/link?code=K7QM-2XRP"), "https://app.example.com/link?code=K7QM-2XRP");
  assert.equal(verificationUrl(origin, "/link"), "https://app.example.com/link");
  assert.equal(verificationUrl(origin, "//evil.example/link"), null);
  assert.equal(verificationUrl(origin, "https://evil.example/link"), null);
  assert.equal(verificationUrl(origin, "/linker"), null);
  assert.equal(verificationUrl(origin, "/link?code=a b"), null);
  assert.equal(verificationUrl(origin, "/link?\\evil"), null);
  assert.equal(verificationUrl(origin, ""), null);
  assert.equal(verificationUrl(origin, undefined), null);
});

test("the countdown rounds up and never goes negative", () => {
  const now = Date.parse("2026-10-02T00:00:00Z");
  assert.equal(remainingSeconds("2026-10-02T00:05:00Z", now), 300);
  assert.equal(remainingSeconds("2026-10-02T00:00:00.400Z", now), 1);
  assert.equal(remainingSeconds("2026-10-01T23:59:00Z", now), 0);
  assert.equal(remainingSeconds("not a date", now), 0);
  assert.equal(formatRemaining(300), "5:00");
  assert.equal(formatRemaining(59), "0:59");
  assert.equal(formatRemaining(-3), "0:00");
});

test("permissions keep the server's implications while toggling", () => {
  assert.deepEqual(togglePermission(["READ"], "MARGIN"), ["READ", "TRADE", "MARGIN"]);
  assert.deepEqual(togglePermission(["READ", "TRADE", "MARGIN"], "TRADE"), ["READ", "TRADE", "MARGIN"]);
  assert.deepEqual(togglePermission(["READ", "TRADE", "MARGIN"], "MARGIN"), ["READ", "TRADE"]);
  assert.deepEqual(togglePermission(["READ"], "READ"), ["READ"]);
  assert.deepEqual(togglePermission(["READ", "TRANSFER"], "TRANSFER"), ["READ"]);
  assert.equal(permissionLocked("READ", ["READ"]), true);
  assert.equal(permissionLocked("TRADE", ["READ", "TRADE"]), false);
  assert.equal(permissionLocked("TRADE", ["READ", "TRADE", "MARGIN"]), true);
});

test("permission summaries read naturally", () => {
  assert.equal(permissionSummary(["READ"]), "조회만");
  assert.equal(permissionSummary(["MARGIN", "READ", "TRADE"]), "조회·주문·마진");
  assert.equal(permissionSummary([]), "조회만");
});

test("duration choices follow the server's limits and keep idle under the TTL", () => {
  assert.deepEqual(ttlChoices(FALLBACK_SCOPE_LIMITS), [60, 480, 1440, 10080]);
  assert.deepEqual(idleChoices(FALLBACK_SCOPE_LIMITS, 1440), [30, 120, 480]);
  assert.deepEqual(idleChoices(FALLBACK_SCOPE_LIMITS, 60), [30]);
  const tight = { max_ttl_minutes: 30, max_idle_minutes: 15, default_ttl_minutes: 30, default_idle_minutes: 15 };
  assert.deepEqual(ttlChoices(tight), [30]);
  assert.deepEqual(idleChoices(tight, 30), [15]);
  assert.deepEqual(idleChoices({ ...tight, max_ttl_minutes: 5 }, 5), []);
  assert.equal(pickChoice([30, 120, 480], 120), 120);
  assert.equal(pickChoice([30, 120, 480], 200), 120);
  assert.equal(pickChoice([30, 120], 10), 30);
  assert.equal(pickChoice([], 10), null);
});

test("missing or malformed limits fall back to the documented defaults", () => {
  assert.equal(scopeLimits(undefined), FALLBACK_SCOPE_LIMITS);
  assert.equal(scopeLimits({}), FALLBACK_SCOPE_LIMITS);
  assert.equal(
    scopeLimits({ limits: { max_ttl_minutes: 0, max_idle_minutes: 1, default_ttl_minutes: 1, default_idle_minutes: 1 } }),
    FALLBACK_SCOPE_LIMITS,
  );
  const limits = { max_ttl_minutes: 480, max_idle_minutes: 120, default_ttl_minutes: 60, default_idle_minutes: 30 };
  assert.equal(scopeLimits({ limits }), limits);
});

test("minutes and typed codes are formatted for people", () => {
  assert.equal(formatMinutes(30), "30분");
  assert.equal(formatMinutes(120), "2시간");
  assert.equal(formatMinutes(1440), "1일");
  assert.equal(formatMinutes(10080), "7일");
  assert.equal(normalizeUserCode("k7qm2xrp"), "K7QM-2XRP");
  assert.equal(normalizeUserCode(" K7QM - 2XRP "), "K7QM-2XRP");
  assert.equal(normalizeUserCode("K7QM-2XR"), null);
  assert.equal(normalizeUserCode("K7QM-2XRP9"), null);
  assert.equal(normalizeUserCode("K7QM/2XRP"), null);
});
