import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_CONFIG,
  eventKeyFromTitle,
  localizeReason,
  parseNotificationBody,
  presentNotification,
} from "../src/lib/notifications";
import type { Notification } from "../src/lib/types";

function notification(body: string, title = "Notice"): Notification {
  return {
    notification_id: "ntf_trigger",
    kind: "USER",
    title,
    body,
    version: 1,
    pinned: false,
    read: false,
    expires_at: null,
    created_at: "2026-10-05T00:00:00Z",
    updated_at: "2026-10-05T00:00:00Z",
  };
}

test("an amended trigger preserves its symbol and uses the trigger notification style", () => {
  assert.deepEqual(parseNotificationBody("ALPHA.M TRIGGER_AMENDED"), {
    eventKey: "TRIGGER_AMENDED",
    symbol: "ALPHA.M",
    reason: undefined,
  });
  const view = presentNotification(notification("ALPHA.M TRIGGER_AMENDED", "Trigger amended"));
  assert.equal(view.title, "예약 주문을 정정했어요");
  assert.equal(view.body, "ALPHA.M 예약 주문을 정정했어요. 바뀐 조건에 따라 주문해요.");
  assert.equal(view.symbol, "ALPHA.M");
  assert.equal(view.label, "거래");
  assert.equal(view.icon, EVENT_CONFIG.TRIGGER_CREATED.icon);
  assert.equal(view.tone, "info");
});

test("the English amendment title resolves through the existing title fallback", () => {
  assert.equal(eventKeyFromTitle("Trigger amended"), "TRIGGER_AMENDED");
  assert.equal(eventKeyFromTitle("  TRIGGER   AMENDED  "), "TRIGGER_AMENDED");
  assert.equal(eventKeyFromTitle("예약 주문을 정정했어요"), "TRIGGER_AMENDED");
  const view = presentNotification(notification("", "Trigger amended"));
  assert.equal(view.title, "예약 주문을 정정했어요");
  assert.equal(view.body, "예약 주문을 정정했어요. 바뀐 조건에 따라 주문해요.");
  assert.equal(view.symbol, undefined);
});

for (const reason of ["paired OCO order executed", "OCO_PEER_EXECUTED"]) {
  test(`OCO peer cancellation localizes ${reason} with and without a symbol`, () => {
    for (const symbol of ["ALPHA.M", undefined]) {
      const prefix = symbol ? `${symbol} ` : "";
      const body = `${prefix}TRIGGER_CANCELED: ${reason}`;
      const parsed = parseNotificationBody(body);
      assert.equal(parsed.eventKey, "TRIGGER_CANCELED");
      assert.equal(parsed.symbol, symbol);
      assert.equal(parsed.reason, reason);
      const view = presentNotification(notification(body, "TRIGGER_CANCELED"));
      assert.equal(view.symbol, symbol);
      assert.equal(view.label, "거래");
      assert.equal(view.body, `${prefix}예약 주문이 반대쪽 익절·손절 주문 체결로 자동 취소됐어요.`);
    }
  });
}

test("an unscoped group cancellation keeps the reason out of the symbol", () => {
  assert.deepEqual(parseNotificationBody("TRIGGER_CANCELED: GROUP_CANCELED"), {
    eventKey: "TRIGGER_CANCELED",
    reason: "GROUP_CANCELED",
  });
  const view = presentNotification(notification("TRIGGER_CANCELED: GROUP_CANCELED"));
  assert.equal(view.symbol, undefined);
  assert.equal(view.title, "예약 주문을 취소했어요");
  assert.match(view.body, /사유: 묶음 주문을 취소했어요$/);
});

for (const [reason, label] of [
  ["GROUP_CANCELED", "묶음 주문을 취소했어요"],
  ["CREDIT_LIMIT_EXHAUSTED", "예산을 모두 사용했어요"],
  ["OCO_PEER_EXECUTED", "반대쪽 익절·손절 주문이 체결됐어요"],
  ["paired OCO order executed", "반대쪽 익절·손절 주문이 체결됐어요"],
]) {
  test(`the new reason ${reason} reads as Korean copy`, () => {
    assert.equal(localizeReason(reason), label);
  });
}

test("a depleted trigger budget is explained in the notification body", () => {
  const view = presentNotification(notification("ALPHA.M TRIGGER_FAILED: CREDIT_LIMIT_EXHAUSTED"));
  assert.equal(view.symbol, "ALPHA.M");
  assert.match(view.body, /사유: 예산을 모두 사용했어요$/);
});

test("ordinary trigger cancellation preserves its existing sentence", () => {
  const view = presentNotification(notification("ALPHA.M TRIGGER_CANCELED"));
  assert.equal(view.title, "예약 주문을 취소했어요");
  assert.equal(view.body, "ALPHA.M 예약 주문을 취소했어요. 묶여 있던 Credit이나 주식은 다시 쓸 수 있어요.");
});
