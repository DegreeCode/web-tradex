import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_CONFIG,
  eventKeyFromTitle,
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


test("trigger activation reports an attempt with an informational tone, including backend prose", () => {
  for (const [body, title] of [
    ["ALPHA.M TRIGGER_ACTIVATED", "TRIGGER_ACTIVATED"],
    ["ALPHA.M 발동 조건을 만족해 체결을 시도합니다. 체결 결과는 주문 상태에서 확인하세요.", "예약 주문 실행 시도"],
  ]) {
    const view = presentNotification(notification(body, title));
    assert.equal(view.title, "예약 주문 실행을 시도해요");
    assert.equal(view.symbol, "ALPHA.M");
    assert.equal(view.tone, "info");
    assert.equal(view.body, "ALPHA.M 예약 주문의 조건이 충족돼 체결을 시도해요. 체결 결과는 주문 상태에서 확인해주세요.");
  }
});

test("deferred trigger retries preserve the symbol and localize the reason in token and backend prose bodies", () => {
  for (const [body, title] of [
    ["ALPHA.M TRIGGER_RETRY_DEFERRED: SLIPPAGE_EXCEEDED", "TRIGGER_RETRY_DEFERRED"],
    ["ALPHA.M 허용 슬리피지를 초과해 체결을 기다립니다.: SLIPPAGE_EXCEEDED", "예약 주문 체결 대기"],
    ["ALPHA.M TRIGGER_RETRY_DEFERRED: SLIPPAGE_EXCEEDED", "Trigger retry deferred"],
  ]) {
    const view = presentNotification(notification(body, title));
    assert.equal(view.title, "예약 주문의 체결을 기다리고 있어요");
    assert.equal(view.symbol, "ALPHA.M");
    assert.equal(view.label, "거래");
    assert.equal(view.tone, "info");
    assert.match(view.body, /사유: 허용한 슬리피지를 벗어났어요$/);
  }
  assert.equal(eventKeyFromTitle("예약 주문 체결 대기"), "TRIGGER_RETRY_DEFERRED");
  assert.equal(eventKeyFromTitle("Trigger retry deferred"), "TRIGGER_RETRY_DEFERRED");
  assert.equal(presentNotification(notification("", "TRIGGER_RETRY_DEFERRED")).title, "예약 주문의 체결을 기다리고 있어요");
  const unscoped = presentNotification(notification("TRIGGER_RETRY_DEFERRED: SLIPPAGE_EXCEEDED"));
  assert.equal(unscoped.symbol, undefined);
  assert.match(unscoped.body, /사유: 허용한 슬리피지를 벗어났어요$/);
});

test("administrator-opened inquiries have a localized presentation", () => {
  for (const body of ["inquiry.opened", "An administrator opened an inquiry for you."]) {
    const view = presentNotification(notification(body, "Inquiry opened"));
    assert.equal(view.title, "상담원이 문의를 시작했어요");
    assert.equal(view.body, "상담원이 문의를 시작했어요. 고객센터에서 내용을 확인하고 답변해주세요.");
    assert.equal(view.label, "고객센터");
    assert.equal(view.tone, "info");
  }
});
