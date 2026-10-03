import test from "node:test";
import assert from "node:assert/strict";
import {
  SELF_ACTION_WINDOW_MS,
  clearSelfActions,
  liveToastFor,
  noteSelfAction,
} from "../src/lib/live-notifications";
import { sanitizePreferences } from "../src/lib/preferences";
import type { Notification } from "../src/lib/types";

const NOW = Date.parse("2026-10-03T00:00:00Z");

function notification(body: string, overrides: Partial<Notification> = {}): Notification {
  return {
    notification_id: "ntf_1",
    kind: "USER",
    title: "Notice",
    body,
    version: 1,
    pinned: false,
    read: false,
    expires_at: null,
    created_at: "2026-10-03T00:00:00Z",
    updated_at: "2026-10-03T00:00:00Z",
    ...overrides,
  };
}

test("a fill pops up with its sentence and a link to orders", (t) => {
  t.after(clearSelfActions);
  const toast = liveToastFor(notification("AAA.M: 2 trade(s) executed"), NOW);
  assert.deepEqual(toast, {
    id: "live:ntf_1",
    title: "주문이 체결됐어요",
    description: "AAA.M 거래 2건이 체결됐어요.",
    tone: "success",
    duration: 6_000,
    action: { label: "주문 보기", href: "/orders" },
  });
});

test("a fill this tab just ordered stays quiet, only for that symbol and only briefly", (t) => {
  t.after(clearSelfActions);
  noteSelfAction("TRADE_EXECUTED", "AAA.M", NOW);
  assert.equal(liveToastFor(notification("AAA.M: 1 trade(s) executed"), NOW + 1_000), null);
  assert.ok(liveToastFor(notification("BBB.M: 1 trade(s) executed"), NOW + 1_000));
  assert.ok(liveToastFor(notification("AAA.M: 1 trade(s) executed"), NOW + SELF_ACTION_WINDOW_MS + 1));
});

test("a self action without a symbol silences that event for any symbol", (t) => {
  t.after(clearSelfActions);
  noteSelfAction("AUTH_PASSKEY_DELETED", undefined, NOW);
  assert.equal(liveToastFor(notification("AUTH_PASSKEY_DELETED"), NOW), null);
  assert.ok(liveToastFor(notification("AUTH_SESSIONS_REVOKED"), NOW));
});

test("echoes of the user's own actions and read or expired rows don't pop up", () => {
  assert.equal(liveToastFor(notification("AUTH_LOGIN"), NOW), null);
  assert.equal(liveToastFor(notification("AAA.M TRIGGER_CREATED"), NOW), null);
  assert.equal(liveToastFor(notification("ACCOUNT_CREATED"), NOW), null);
  assert.equal(liveToastFor(notification("Plain announcement"), NOW), null);
  assert.equal(liveToastFor(notification("AAA.M SYMBOL_HALTED", { read: true }), NOW), null);
  assert.equal(
    liveToastFor(notification("AAA.M SYMBOL_HALTED", { expires_at: "2026-10-02T23:59:59Z" }), NOW),
    null,
  );
});

test("a resume replaces its halt instead of stacking beside it", () => {
  const halted = liveToastFor(notification("AAA.M SYMBOL_HALTED", { notification_id: "a" }), NOW);
  const resumed = liveToastFor(notification("AAA.M SYMBOL_RESUMED", { notification_id: "b" }), NOW);
  const other = liveToastFor(notification("BBB.M SYMBOL_HALTED", { notification_id: "c" }), NOW);
  assert.equal(halted?.id, "live:symbol:AAA.M");
  assert.equal(resumed?.id, halted?.id);
  assert.notEqual(other?.id, halted?.id);
  assert.deepEqual(halted?.action, { label: "종목 보기", href: "/market/symbol?symbol=AAA.M" });
  assert.equal(halted?.tone, "danger");

  const globalHalt = liveToastFor(notification("GLOBAL_MARKET_HALTED"), NOW);
  const globalResume = liveToastFor(notification("GLOBAL_MARKET_RESUMED"), NOW);
  assert.equal(globalHalt?.duration, Infinity);
  assert.equal(globalResume?.id, globalHalt?.id);
  assert.equal(globalResume?.duration, 6_000);
});

test("liquidation stays until closed and links to margin", () => {
  const toast = liveToastFor(notification("AAA.M margin.liquidation_started"), NOW);
  assert.equal(toast?.duration, Infinity);
  assert.deepEqual(toast?.action, { label: "마진 보기", href: "/margin" });
  assert.equal(liveToastFor(notification("AAA.M margin.warning"), NOW)?.duration, 10_000);
});

test("a trigger failure keeps its localized reason", () => {
  const toast = liveToastFor(notification("AAA.M TRIGGER_FAILED: INSUFFICIENT_CREDIT"), NOW);
  assert.match(toast?.description ?? "", /사유: Credit 잔액이 부족해요$/);
});

test("the live popup preference survives sanitizing", () => {
  assert.deepEqual(sanitizePreferences({ liveNotificationPopup: false }), { liveNotificationPopup: false });
  assert.deepEqual(sanitizePreferences({ liveNotificationPopup: "no" }), {});
});
