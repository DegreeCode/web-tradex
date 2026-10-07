import test from "node:test";
import assert from "node:assert/strict";
import { buildChartOrderLines } from "../src/lib/chart-orders";
import type { Order, OrderStatus } from "../src/lib/types";

const order: Order = {
  order_id: "ord_buy",
  account_id: "acc_a",
  symbol: "ALPHA.M",
  side: "BUY",
  order_type: "TRIGGER",
  status: "PENDING",
  trigger_condition: "LTE",
  trigger_price: "1.23456789",
  filled_quantity: "0",
  principal: "0",
  fee: "0",
  average_price: "0",
  created_at: "2026-10-07T00:00:00Z",
};
const lines = (orders: Order[]) => buildChartOrderLines(orders, "acc_a", "ALPHA.M");

test("chart orders are confined to the selected account and canonical symbol", () => {
  const orders = [
    order,
    { ...order, order_id: "other_account", account_id: "acc_b" },
    { ...order, order_id: "other_symbol", symbol: "BETA.M" },
    { ...order, order_id: "market", order_type: "MARKET" as const },
  ];
  assert.deepEqual(lines(orders), [{
    id: "ord_buy", price: "1.23456789", side: "BUY", label: "예약 매수 ≤",
  }]);
  assert.deepEqual(buildChartOrderLines(orders, "", "ALPHA.M"), []);
  assert.deepEqual(buildChartOrderLines(orders, "acc_a", ""), []);
  assert.deepEqual(buildChartOrderLines(orders, "acc_b", "ALPHA.M").map((line) => line.id), ["other_account"]);
});

test("only waiting and activated triggers survive; terminal orders remove their lines", () => {
  for (const status of ["PENDING", "ACTIVATED"] satisfies OrderStatus[]) {
    assert.equal(lines([{ ...order, status }]).length, 1);
  }
  for (const status of ["FILLED", "PARTIALLY_FILLED", "CANCELED", "EXPIRED", "FAILED", "REJECTED"] satisfies OrderStatus[]) {
    assert.deepEqual(lines([{ ...order, status }]), []);
  }
  assert.equal(lines([{ ...order, filled_quantity: "3", remaining_quantity: "7", on_partial_fill: "KEEP" }]).length, 1);
});

test("OCO exit lines preserve both roles and distinguish margin exits", () => {
  const exits = lines([
    { ...order, order_id: "tp", side: "SELL", group_role: "TAKE_PROFIT", group_id: "oco", trigger_condition: "GTE", trigger_price: "2" },
    { ...order, order_id: "sl", side: "SELL", group_role: "STOP_LOSS", group_id: "oco", trigger_price: "1" },
    { ...order, order_id: "margin", group_role: "TAKE_PROFIT", margin_position_id: "mgn", margin_side: "SHORT" },
  ]);
  assert.deepEqual(exits.map((line) => line.label), ["익절 매도 ≥", "손절 매도 ≤", "마진 숏 익절 매수 ≤"]);
  assert.equal(lines([{ ...order, margin_position_id: "mgn" }])[0].label, "마진 예약 매수 ≤");
});

test("trailing and amended orders use the current server trigger without deriving a price", () => {
  const trailing: Order = {
    ...order, side: "SELL", group_role: "STOP_LOSS", trailing_ppm: 50000,
    trigger_price: "1.34567891", trailing_watermark_price: "1.5",
  };
  assert.equal(lines([trailing])[0].price, "1.34567891");
  assert.equal(lines([trailing])[0].label, "손절 매도 · 추적 ≤");
  assert.equal(lines([{ ...trailing, trigger_price: "1.4" }])[0].price, "1.4");
  assert.deepEqual(lines([{ ...trailing, trigger_price: undefined }]), []);
});

test("missing or invalid trigger prices never fabricate a line, and overlapping pages do not duplicate orders", () => {
  for (const trigger_price of [undefined, "", "0", "-1", "NaN", "Infinity", "1e3", " "]) {
    assert.deepEqual(lines([{ ...order, trigger_price }]), []);
  }
  assert.deepEqual(lines([order, order]), lines([order]));
  assert.equal(lines([{ ...order, trigger_price: "0.00000001" }])[0].price, "0.00000001");
});
