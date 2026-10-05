import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { ApiError, errorMessage } from "../src/lib/api";
import {
  presentNotification,
  parseTradingNotification,
} from "../src/lib/notifications";
import { reconcileNotificationData } from "../src/lib/hooks";
import type { Notification } from "../src/lib/types";

function notification(body: string, title = "Notice"): Notification {
  return {
    notification_id: "ntf_new",
    kind: "USER",
    title,
    body,
    version: 1,
    pinned: false,
    read: false,
    expires_at: null,
    created_at: "2026-09-16T00:00:00Z",
    updated_at: "2026-09-16T00:00:00Z",
  };
}

test("icon rejection preserves the symbol and exact moderation reason", () => {
  const notice = notification(
    "AAA.M ICON_REJECTED: IMAGE_POLICY",
    "종목 아이콘 승인 거절",
  );
  const view = presentNotification(notice);
  assert.equal(view.symbol, "AAA.M");
  assert.equal(view.label, "아이콘 심사");
  assert.match(view.body, /IMAGE_POLICY/);
  assert.equal(parseTradingNotification(notice), null);
  const client = new QueryClient();
  client.setQueryData(["icon-requests", "AAA.M"], { pages: [] });
  reconcileNotificationData(client, notice);
  assert.equal(
    client.getQueryState(["icon-requests", "AAA.M"])?.isInvalidated,
    true,
  );
  client.clear();
});

test("device-link security events read as sentences, not event codes", () => {
  for (const [code, title] of [
    ["AUTH_DEVICE_LINK_APPROVED", "기기 연결을 승인했어요"],
    ["AUTH_DEVICE_LINK_DENIED", "기기 연결 요청을 거부했어요"],
    ["AUTH_LINKED_SESSION_CREATED", "연결된 기기가 로그인했어요"],
  ]) {
    const view = presentNotification(notification(code, code));
    assert.equal(view.title, title);
    assert.equal(view.label, "보안");
    assert.doesNotMatch(view.body, /AUTH_/);
  }
});

test("trigger order lifecycle events read as sentences, not event codes", () => {
  // Bodies and titles exactly as the backend emits them: only creation and
  // activation carry a symbol, and the raw event type doubles as the title.
  const created = presentNotification(notification("TRDX.M TRIGGER_CREATED", "TRIGGER_CREATED"));
  assert.equal(created.title, "예약 주문을 등록했어요");
  assert.equal(created.symbol, "TRDX.M");
  assert.match(created.body, /^TRDX\.M 예약 주문을 등록했어요/);

  const canceled = presentNotification(notification("TRIGGER_CANCELED", "TRIGGER_CANCELED"));
  assert.equal(canceled.title, "예약 주문을 취소했어요");

  const failed = presentNotification(notification("TRIGGER_FAILED: INSUFFICIENT_CREDIT", "TRIGGER_FAILED"));
  assert.equal(failed.title, "예약 주문을 실행하지 못했어요");
  assert.equal(failed.symbol, undefined);
  assert.match(failed.body, /사유: Credit 잔액이 부족해요$/);

  const prose = presentNotification(notification("TRIGGER_FAILED: held shares are no longer available", "TRIGGER_FAILED"));
  assert.match(prose.body, /사유: 보유 수량이 부족해요$/);

  for (const body of ["TRIGGER_EXPIRED: DEADLINE_EXCEEDED", "TRIGGER_EXPIRED: deadline exceeded"]) {
    const expired = presentNotification(notification(body, "TRIGGER_EXPIRED"));
    assert.equal(expired.title, "예약 주문이 만료됐어요");
    assert.doesNotMatch(expired.body, /사유|deadline|DEADLINE/);
  }

  for (const view of [created, canceled, failed, prose]) {
    assert.equal(view.label, "거래");
    assert.doesNotMatch(view.body, /TRIGGER_|[A-Z]+_[A-Z]+/);
  }
});

test("ceiling notice is informational and cannot halt trading, including title-only fallback", () => {
  for (const notice of [
    notification("AAA.M CURVE_CEILING_REACHED"),
    notification("", "가격 밴드 상단 도달"),
  ]) {
    assert.equal(
      presentNotification(notice).title,
      "가격 밴드 상단에 도달했어요",
    );
    assert.equal(parseTradingNotification(notice), null);
  }
});

test("private trade notifications refresh finances without a private trade.executed stream", () => {
  const client = new QueryClient();
  const keys = [
    "orders",
    "my-trades",
    "portfolio",
    "accounts",
    "nav",
    "nav-history",
    "realized-pnl",
  ];
  for (const key of keys)
    client.setQueryData([key, "account"], { value: "old" });
  reconcileNotificationData(
    client,
    notification("AAA.M: 3 trade(s) executed", "Trade executed"),
  );
  for (const key of keys)
    assert.equal(
      client.getQueryState([key, "account"])?.isInvalidated,
      true,
      key,
    );
  client.clear();
});

test("margin and manager notifications refresh their relevant private records", () => {
  const client = new QueryClient();
  client.setQueryData(["nav-history"], []);
  client.setQueryData(["margin-positions", "all"], []);
  client.setQueryData(["manager-requests", "AAA.M"], []);
  // A warning changes risk only; balances and history stay as they are.
  reconcileNotificationData(client, notification("margin.warning"));
  assert.equal(client.getQueryState(["margin-positions", "all"])?.isInvalidated, true);
  assert.equal(client.getQueryState(["nav-history"])?.isInvalidated, false);
  reconcileNotificationData(client, notification("margin.liquidation_completed"));
  assert.equal(client.getQueryState(["nav-history"])?.isInvalidated, true);
  reconcileNotificationData(client, notification("MANAGER_CHANGED"));
  assert.equal(
    client.getQueryState(["manager-requests", "AAA.M"])?.isInvalidated,
    true,
  );
  client.clear();
});

test("notification sentences weave the symbol in and hide unknown reason codes", () => {
  assert.equal(
    presentNotification(notification("AAA.M SYMBOL_LISTED")).body,
    "AAA.M 종목이 새로 상장됐어요. 지금 거래할 수 있어요.",
  );
  assert.equal(
    presentNotification(notification("SYMBOL_LISTED")).body,
    "종목이 새로 상장됐어요. 지금 거래할 수 있어요.",
  );
  assert.equal(
    presentNotification(notification("AAA.M SYMBOL_HALTED: MANUAL")).body,
    "AAA.M 종목의 거래가 일시 중지됐어요. 사유: 관리자 조치",
  );
  assert.equal(
    presentNotification(notification("AAA.M SYMBOL_HALTED: UNKNOWN_CODE")).body,
    "AAA.M 종목의 거래가 일시 중지됐어요.",
  );
  assert.equal(
    presentNotification(notification("AAA.M: 3 trade(s) executed", "Trade executed")).body,
    "AAA.M 거래 3건이 체결됐어요.",
  );
  // Titles shown by earlier app versions still resolve to their event.
  assert.equal(presentNotification(notification("", "종목 거래가 중지됐어요")).title, "거래가 일시 중지됐어요");
});

for (const [code, message] of [
  ["ORDER_REVISION_CONFLICT", "다른 곳에서 주문이 바뀌었어요. 새로고침 후 다시 시도해주세요"],
  ["ORDER_NOT_AMENDABLE", "지금은 정정할 수 없는 주문이에요"],
  ["ORDER_GROUP_NOT_CANCELABLE", "이미 끝나 취소할 수 없는 묶음 주문이에요"],
]) {
  test(`the trigger v4 conflict ${code} has a localized error message`, () => {
    assert.equal(errorMessage(new ApiError(409, code, "server error")), message);
  });
}
