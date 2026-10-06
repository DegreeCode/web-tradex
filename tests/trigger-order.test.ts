import test from "node:test";
import assert from "node:assert/strict";
import {
  hasTriggerOrderFields,
  triggerCancelWarning,
  triggerGroupRoleLabel,
  triggerOrderDisplayRows,
  triggerPartialFillPolicyLabel,
  triggerSlippagePolicyLabel,
  triggerTerminalReasonLabel,
  triggerWaitReasonLabel,
} from "../src/lib/trigger-order";
import type { Order } from "../src/lib/types";

const legacy: Order = {
  order_id: "ord_legacy",
  symbol: "ALPHA.M",
  account_id: "acc_test",
  side: "BUY",
  order_type: "TRIGGER",
  status: "PENDING",
  requested_quantity: "10.00000000",
  max_credit_amount: "15.0000000000000001",
  filled_quantity: "0",
  principal: "0",
  fee: "0",
  average_price: "0",
  trigger_condition: "GTE",
  trigger_price: "1.50000000",
  created_at: "2026-10-05T00:00:00Z",
};

const rows = (fields: Partial<Order>, options?: { compact?: boolean }) =>
  triggerOrderDisplayRows({ ...legacy, ...fields }, options);

test("old responses add no rows, including existing budget and hold-limit fields", () => {
  for (const order of [legacy, { ...legacy, requested_credit: "100" }]) {
    assert.equal(hasTriggerOrderFields(order), false);
    assert.deepEqual(triggerOrderDisplayRows(order), []);
    assert.deepEqual(triggerOrderDisplayRows(order, { compact: true }), []);
  }
  assert.equal(hasTriggerOrderFields({ ...legacy, revision: 0 }), true);
  assert.equal(hasTriggerOrderFields({ ...legacy, held_credit: "0" }), true);
});

test("market orders do not acquire trigger rows", () => {
  const order: Order = { ...legacy, order_type: "MARKET", status: "FILLED", fill_count: 1 };
  assert.equal(hasTriggerOrderFields(order), false);
  assert.deepEqual(triggerOrderDisplayRows(order), []);
});

test("KEEP pending orders expose cumulative fills and the remaining quantity", () => {
  const display = rows({
    on_partial_fill: "KEEP",
    fill_count: 2,
    activation_count: 3,
    filled_quantity: "3.12345678",
    principal: "4.25",
    remaining_quantity: "6.87654322",
    remaining_credit: "10.7499999999999999",
    held_credit: "8.5000000000000001",
    wait_reason: "PARTIAL_FILL",
  });
  assert.deepEqual(display.find((row) => row.key === "fills"), {
    key: "fills", label: "체결 상태", value: "체결 2회 · 잔여 대기",
  });
  assert.equal(display.find((row) => row.key === "cumulative-quantity")?.value, "3.12345678주");
  assert.equal(display.find((row) => row.key === "remaining-quantity")?.value, "6.87654322주");
  assert.equal(display.find((row) => row.key === "remaining-credit")?.value, "10.7499999999999999 Credit");
  assert.equal(display.find((row) => row.key === "held-credit")?.value, "8.5000000000000001 Credit");
  assert.equal(display.find((row) => row.key === "wait-reason")?.value, "부분 체결 후 남은 수량 대기");
  assert.equal(display.find((row) => row.key === "activations")?.value, "3회");
  assert.equal(display.find((row) => row.key === "partial-fill-policy")?.value, "남은 주문 계속 대기");
});

test("budget intent and computed hold limit keep distinct labels and exact decimals", () => {
  const display = rows({
    revision: 0,
    requested_credit: "9007199254740993.0000000000000001",
    held_credit: "0.00750075",
  });
  assert.deepEqual(display.find((row) => row.key === "budget"), {
    key: "budget", label: "주문 예산", value: "9,007,199,254,740,993.0000000000000001 Credit",
  });
  assert.deepEqual(display.find((row) => row.key === "hold-limit"), {
    key: "hold-limit", label: "보류 한도", value: "15.0000000000000001 Credit",
  });
  assert.equal(display.find((row) => row.key === "held-credit")?.label, "묶인 금액");
});

test("credit-mode remaining amount does not fabricate a remaining quantity", () => {
  const display = rows({
    requested_quantity: undefined,
    max_credit_amount: undefined,
    requested_credit: "50",
    fill_count: 1,
    remaining_credit: "40.0000000000000001",
    held_credit: "1.5",
  });
  assert.equal(display.some((row) => row.key === "remaining-quantity"), false);
  assert.deepEqual(display.find((row) => row.key === "remaining-credit"), {
    key: "remaining-credit", label: "잔여 금액", value: "40.0000000000000001 Credit", secondary: "수수료 포함",
  });
});

test("RETRY without a fill shows the next-price wait without a fill summary", () => {
  const display = rows({
    fill_count: 0,
    activation_count: 4,
    on_slippage_exceeded: "RETRY",
    wait_reason: "SLIPPAGE_EXCEEDED",
    slippage_ppm: 15000,
  });
  assert.equal(display.some((row) => row.key === "fills" || row.key === "cumulative-quantity"), false);
  assert.equal(display.find((row) => row.key === "wait-reason")?.value, "슬리피지 초과로 다음 가격 변동 대기");
  assert.equal(display.find((row) => row.key === "slippage-policy")?.value, "다음 가격 변동에 재시도");
  assert.equal(display.find((row) => row.key === "slippage")?.value, "1.5%");
});

test("each OCO leg displays the same shared hold without adding its peer", () => {
  const group = { ...legacy, side: "SELL" as const, group_id: "ogr_oco", hold_scope: "GROUP" as const, held_quantity: "7.12345678" };
  const takeProfit: Order = { ...group, group_role: "TAKE_PROFIT" };
  const stopLoss: Order = { ...group, order_id: "ord_stop", group_role: "STOP_LOSS" };
  const expected = { key: "held-quantity", label: "묶인 수량", value: "7.12345678주", secondary: "익절·손절 공동" };
  assert.deepEqual(triggerOrderDisplayRows(takeProfit).find((row) => row.key === "held-quantity"), expected);
  assert.deepEqual(triggerOrderDisplayRows(stopLoss).find((row) => row.key === "held-quantity"), expected);
  assert.equal(takeProfit.held_quantity, "7.12345678");
  assert.equal(stopLoss.held_quantity, "7.12345678");
  assert.equal(rows({ side: "SELL", group_role: "TAKE_PROFIT", held_quantity: "7" })
    .find((row) => row.key === "held-quantity")?.secondary, "익절·손절 공동");
});

test("standalone positive holds are not marked shared", () => {
  assert.deepEqual(rows({ held_credit: "1.5", hold_scope: "ORDER" }).find((row) => row.key === "held-credit"), {
    key: "held-credit", label: "묶인 금액", value: "1.5 Credit",
  });
  assert.deepEqual(rows({ side: "SELL", held_quantity: "1.23456789", hold_scope: "ORDER" }).find((row) => row.key === "held-quantity"), {
    key: "held-quantity", label: "묶인 수량", value: "1.23456789주",
  });
});

test("compact cards omit default policies, slippage and activations matching fills", () => {
  const order: Partial<Order> = {
    on_partial_fill: "TERMINATE",
    on_slippage_exceeded: "FAIL",
    slippage_ppm: 50000,
    activation_count: 1,
    fill_count: 1,
  };
  const compact = rows(order, { compact: true });
  const detail = rows(order);
  for (const key of ["partial-fill-policy", "slippage-policy", "slippage", "activations"]) {
    assert.equal(compact.some((row) => row.key === key), false, key);
    assert.equal(detail.some((row) => row.key === key), true, key);
  }
  assert.deepEqual(rows(order, { compact: false }), detail);
  assert.equal(compact.find((row) => row.key === "fills")?.value, "체결 1회 · 잔여 대기");
});

test("compact cards keep KEEP and RETRY independently without adding slippage", () => {
  for (const on_partial_fill of ["TERMINATE", "KEEP"] as const) {
    for (const on_slippage_exceeded of ["FAIL", "RETRY"] as const) {
      const compact = rows({ on_partial_fill, on_slippage_exceeded, slippage_ppm: 15000 }, { compact: true });
      assert.equal(compact.some((row) => row.key === "partial-fill-policy"), on_partial_fill === "KEEP");
      assert.equal(compact.some((row) => row.key === "slippage-policy"), on_slippage_exceeded === "RETRY");
      assert.equal(compact.some((row) => row.key === "slippage"), false);
      if (on_partial_fill === "KEEP") {
        assert.equal(compact.find((row) => row.key === "partial-fill-policy")?.value, "남은 주문 계속 대기");
      }
      if (on_slippage_exceeded === "RETRY") {
        assert.equal(compact.find((row) => row.key === "slippage-policy")?.value, "다음 가격 변동에 재시도");
      }
    }
  }
});

test("compact activation counts appear only when activations exceed fills, defaulting missing fills to zero", () => {
  for (const [activation_count, fill_count, expected] of [
    [undefined, undefined, false],
    [0, undefined, false],
    [0, 0, false],
    [1, undefined, true],
    [1, 0, true],
    [1, 1, false],
    [3, 2, true],
    [2, 3, false],
  ] as const) {
    const fields = { activation_count, fill_count };
    const compact = rows(fields, { compact: true });
    assert.equal(compact.some((row) => row.key === "activations"), expected);
    if (expected) assert.equal(compact.find((row) => row.key === "activations")?.value, `${activation_count}회`);
    assert.equal(rows(fields).some((row) => row.key === "activations"), (activation_count ?? 0) > 0);
  }
});

test("zero remaining and held amounts add no rows for pending, activated or terminal orders", () => {
  for (const compact of [false, true]) {
    for (const status of ["PENDING", "ACTIVATED", "FILLED", "PARTIALLY_FILLED", "CANCELED"] as const) {
      for (const side of ["BUY", "SELL"] as const) {
        for (const zero of ["0", "0.00000000", "0.0000000000000000"]) {
          const display = rows({ status, side, remaining_quantity: zero, remaining_credit: zero,
            held_credit: zero, held_quantity: zero }, { compact });
          for (const key of ["remaining-quantity", "remaining-credit", "held-credit", "held-quantity"]) {
            assert.equal(display.some((row) => row.key === key), false, `${status} ${side} ${zero} ${key}`);
          }
        }
      }
    }
  }
});

test("positive remaining and held amounts retain exact precision in both variants", () => {
  for (const compact of [false, true]) {
    const pending = rows({ remaining_quantity: "0.00000001", remaining_credit: "0.0000000000000001",
      held_credit: "0.0000000000000001" }, { compact });
    assert.equal(pending.find((row) => row.key === "remaining-quantity")?.value, "0.00000001주");
    assert.equal(pending.find((row) => row.key === "remaining-credit")?.value, "0.0000000000000001 Credit");
    assert.equal(pending.find((row) => row.key === "held-credit")?.value, "0.0000000000000001 Credit");
    const sell = rows({ side: "SELL", held_quantity: "0.00000001" }, { compact });
    assert.equal(sell.find((row) => row.key === "held-quantity")?.value, "0.00000001주");
    const terminal = rows({ status: "CANCELED", remaining_quantity: "0.00000001",
      remaining_credit: "0.0000000000000001", held_credit: "0" }, { compact });
    assert.equal(terminal.find((row) => row.key === "remaining-quantity")?.label, "미사용 수량");
    assert.equal(terminal.find((row) => row.key === "remaining-credit")?.label, "미사용 금액");
  }
});

test("terminal orders distinguish unused intent from active held assets", () => {
  const display = rows({
    status: "PARTIALLY_FILLED",
    fill_count: 1,
    remaining_quantity: "4",
    remaining_credit: "6.0000000000000001",
    held_credit: "0",
    wait_reason: "PARTIAL_FILL",
    terminal_reason: "CREDIT_LIMIT_EXHAUSTED",
  });
  assert.equal(display.find((row) => row.key === "remaining-quantity")?.label, "미사용 수량");
  assert.equal(display.find((row) => row.key === "remaining-credit")?.label, "미사용 금액");
  assert.equal(display.find((row) => row.key === "fills")?.value, "체결 1회");
  assert.equal(display.find((row) => row.key === "terminal-reason")?.value, "예산 소진");
  assert.equal(display.some((row) => row.key === "held-credit" || row.key === "wait-reason"), false);
});

test("known terminal reasons appear only for terminal statuses", () => {
  for (const [reason, label] of [
    ["CREDIT_LIMIT_EXHAUSTED", "예산 소진"],
    ["OCO_PEER_EXECUTED", "반대쪽 주문 체결로 자동 취소"],
    ["GROUP_CANCELED", "묶음 주문 취소"],
    ["SLIPPAGE_EXCEEDED", "슬리피지 초과"],
    ["CANCELED", "주문 취소"],
    ["EXPIRED", "예약 기간 만료"],
  ]) {
    assert.equal(triggerTerminalReasonLabel(reason), label);
    assert.equal(rows({ status: "CANCELED", terminal_reason: reason })
      .find((row) => row.key === "terminal-reason")?.value, label);
    for (const status of ["PENDING", "ACTIVATED"] as const) {
      assert.equal(rows({ status, terminal_reason: reason }).some((row) => row.key === "terminal-reason"), false);
    }
  }
});

test("unknown tokens, including object-property names, produce no misleading labels", () => {
  for (const token of [undefined, "NEW_TOKEN", "constructor", "__proto__", "toString"]) {
    for (const label of [triggerTerminalReasonLabel, triggerWaitReasonLabel, triggerGroupRoleLabel,
      triggerPartialFillPolicyLabel, triggerSlippagePolicyLabel, triggerCancelWarning]) {
      assert.equal(label(token), null);
    }
  }
  const display = rows({ status: "FAILED", terminal_reason: "NEW_REASON", on_partial_fill: "NEW_POLICY" });
  assert.equal(display.some((row) => row.key === "terminal-reason" || row.key === "partial-fill-policy"), false);
});

test("SELL trailing shows its current trigger and high watermark, preserving price precision", () => {
  assert.deepEqual(rows({ side: "SELL", trailing_ppm: 12345, trigger_price: "1.23456789", trailing_watermark_price: "1.34567891" })
    .find((row) => row.key === "trailing"), {
    key: "trailing", label: "추적 1.2345%", value: "1.23456789 Credit", secondary: "추적 최고가 1.34567891 Credit",
  });
});

test("BUY trailing shows its low watermark and the full documented ppm range", () => {
  for (const [ppm, percent] of [[1, "0.0001%"], [999999, "99.9999%"]] as const) {
    const trailing = rows({ trailing_ppm: ppm, trailing_watermark_price: "1.25" }).find((row) => row.key === "trailing");
    assert.equal(trailing?.label, `추적 ${percent}`);
    assert.equal(trailing?.secondary, "추적 최저가 1.25 Credit");
  }
  const missing = rows({ trailing_ppm: 10000, trigger_price: undefined }).find((row) => row.key === "trailing");
  assert.equal(missing?.value, "-");
  assert.equal(missing?.secondary, undefined);
});

test("optional watermark and invalid trailing values do not fabricate trigger prices", () => {
  assert.deepEqual(rows({ trailing_watermark_price: "1.25" }).find((row) => row.key === "watermark"), {
    key: "watermark", label: "추적 최저가", value: "1.25 Credit",
  });
  for (const trailing_ppm of [0, -1, 1000000, 1.5, NaN]) {
    assert.equal(rows({ trailing_ppm }).some((row) => row.key === "trailing"), false);
  }
});

test("group roles and policies have consistent known labels", () => {
  assert.equal(triggerGroupRoleLabel("ENTRY"), "진입");
  assert.equal(triggerGroupRoleLabel("TAKE_PROFIT"), "익절");
  assert.equal(triggerGroupRoleLabel("STOP_LOSS"), "손절");
  assert.equal(triggerPartialFillPolicyLabel("TERMINATE"), "남은 주문 종료");
  assert.equal(triggerPartialFillPolicyLabel("KEEP"), "남은 주문 계속 대기");
  assert.equal(triggerSlippagePolicyLabel("FAIL"), "주문 종료");
  assert.equal(triggerSlippagePolicyLabel("RETRY"), "다음 가격 변동에 재시도");
});

test("cancel warnings cover both OCO legs and preserve bracket exits for ENTRY", () => {
  assert.equal(triggerCancelWarning("TAKE_PROFIT"), "함께 걸린 익절·손절 주문도 같이 취소돼요.");
  assert.equal(triggerCancelWarning("STOP_LOSS"), "함께 걸린 익절·손절 주문도 같이 취소돼요.");
  assert.equal(triggerCancelWarning("ENTRY"), "이미 만들어진 익절·손절 주문은 유지돼요.");
  assert.equal(triggerCancelWarning(undefined), null);
  assert.equal(triggerCancelWarning("FUTURE_ROLE"), null);
});


test("margin exit orders identify their fee policy and position termination", () => {
  const display = rows({ margin_position_id: "mgn_test", margin_side: "SHORT", side: "BUY", hold_scope: "NONE", revision: 1, status: "PARTIALLY_FILLED", terminal_reason: "POSITION_EXHAUSTED" });
  assert.equal(display.find((row) => row.key === "margin")?.value, "숏 포지션 매수 종료");
  assert.equal(display.find((row) => row.key === "terminal-reason")?.value, "포지션 잔여 수량 없음");
  assert.equal(triggerTerminalReasonLabel("MARGIN_POSITION_NOT_OPEN"), "포지션 종료 또는 거래 불가");
  assert.equal(triggerTerminalReasonLabel("MARGIN_RISK_LIMIT"), "마진 위험 기준 초과");
});
