import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExitOrder,
  buildOrderAmendment,
  orderExpiry,
  trailingDistance,
  triggerLimitPriceError,
  type ExitOrderInput,
} from "../src/lib/advanced-order";
import { fmtSigned } from "../src/lib/format";
import { pnlSourceLabel } from "../src/lib/pnl";
import type { Order, OrderGroup } from "../src/lib/types";
import { QueryClient } from "@tanstack/react-query";
import { orderGroupChildrenQueryOptions, orderGroupQueryOptions } from "../src/lib/advanced-order-hooks";

test("group and child queries poll during a private socket outage and stop when live or terminal", () => {
  const client = new QueryClient();
  for (const state of [undefined, "ACTIVE", "CLAIMED", "CLOSED"] as const) {
    for (const socket of ["open", "closed", "connecting"] as const) {
      const options = orderGroupQueryOptions("grp_a", socket);
      const query = client.getQueryCache().build<OrderGroup, Error, OrderGroup, string[]>(client, options);
      if (state) query.setData({ state } as NonNullable<typeof query.state.data>);
      const interval = options.refetchInterval;
      assert.equal(typeof interval === "function" ? interval(query) : interval,
        socket === "open" || state === "CLOSED" ? false : 15_000);
      const children = orderGroupChildrenQueryOptions("grp_a", true, socket, state);
      assert.equal(children.refetchInterval, socket === "open" || state === "CLOSED" ? false : 15_000);
      assert.equal(orderGroupChildrenQueryOptions("grp_a", false, socket, state).enabled, false);
    }
  }
  client.clear();
});

const input: ExitOrderInput = {
  symbol: "ALPHA.M",
  account_id: "acc_a",
  quantity: "1.00000001",
  mode: "OCO",
  takeProfit: "2",
  stopLoss: "1",
  policy: {
    on_partial_fill: "KEEP",
    on_slippage_exceeded: "RETRY",
    slippage_ppm: 50000,
  },
};

test("spot OCO holds one quantity and only sends supported leg fields", () => {
  const body = buildExitOrder(input);
  assert.deepEqual(body, {
    symbol: "ALPHA.M",
    account_id: "acc_a",
    quantity: "1.00000001",
    group_type: "OCO",
    take_profit: { trigger_price: "2", ...input.policy },
    stop_loss: { trigger_price: "1", ...input.policy },
  });
  assert.throws(() => buildExitOrder({ ...input, trailingPercent: "5" }));
  assert.throws(() => buildExitOrder({ ...input, stopLoss: "2" }));
  assert.throws(() => buildExitOrder({ ...input, quantity: "1.000000001" }));
});

for (const side of ["LONG", "SHORT"] as const) {
  test(`${side} exits use the reduce direction and appropriate price conditions`, () => {
    const margin = { ...input, margin_position_id: "mgn_p", margin_side: side };
    for (const mode of ["TAKE_PROFIT", "STOP_LOSS"] as const) {
      const body = buildExitOrder({ ...margin, mode });
      assert.ok("side" in body);
      assert.equal(body.side, side === "SHORT" ? "BUY" : "SELL");
      assert.equal(
        body.trigger_condition,
        (side === "SHORT") === (mode === "TAKE_PROFIT") ? "LTE" : "GTE",
      );
      assert.equal(body.margin_position_id, "mgn_p");
      assert.equal(body.quantity, "1.00000001");
      assert.equal("credit_amount" in body, false);
    }
    const trailing = buildExitOrder({
      ...margin,
      mode: "STOP_LOSS",
      trailingPercent: "5",
    });
    assert.ok("side" in trailing);
    assert.equal(trailing.trailing_ppm, 50000);
    assert.equal("trigger_price" in trailing, false);
    assert.equal("slippage_reference_price" in trailing, false);
  });
}

test("SHORT OCO checks reversed price bounds and only the stop can trail", () => {
  const margin = {
    ...input,
    margin_position_id: "mgn_short",
    margin_side: "SHORT" as const,
  };
  assert.throws(() => buildExitOrder(margin));
  const body = buildExitOrder({
    ...margin,
    takeProfit: "0.8",
    stopLoss: "1.2",
  });
  assert.ok("group_type" in body);
  assert.equal(body.take_profit.trigger_price, "0.8");
  const trailing = buildExitOrder({ ...margin, trailingPercent: "0.0001" });
  assert.ok("group_type" in trailing);
  assert.deepEqual(trailing.stop_loss, { trailing_ppm: 1, ...input.policy });
  assert.equal("trailing_ppm" in trailing.take_profit, false);
  assert.throws(() =>
    buildExitOrder({ ...margin, mode: "TAKE_PROFIT", trailingPercent: "5" }),
  );
});

test("trailing distance is precise to one ppm and excludes zero and 100 percent", () => {
  assert.equal(trailingDistance("0.0001"), 1);
  assert.equal(trailingDistance("99.9999"), 999999);
  for (const value of ["", "0", "100", "-1", "0.00001", "NaN"])
    assert.equal(trailingDistance(value), null);
});

test("trigger expiry rejects invalid or past dates and sends normalized future dates", () => {
  for (const expiry of ["", "invalid", "2020-01-01"])
    assert.throws(() => orderExpiry(expiry), /만료 시각/);
  const expiry = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(orderExpiry(expiry), expiry);
  assert.equal(buildExitOrder({ ...input, expires_at: expiry }).expires_at, expiry);
  assert.throws(() => buildExitOrder({ ...input, expires_at: "invalid" }), /만료 시각/);
});

const order: Order = {
  order_id: "ord_a",
  account_id: "acc_a",
  symbol: "ALPHA.M",
  side: "BUY",
  order_type: "TRIGGER",
  status: "PENDING",
  revision: 4,
  requested_quantity: "10",
  remaining_quantity: "6",
  filled_quantity: "4",
  principal: "4",
  fee: "0.1",
  average_price: "1",
  trigger_price: "2",
  created_at: "2026-10-05T00:00:00Z",
};
const amendment = {
  amount: "3",
  price: "2",
  trailingPercent: "",
  expiryMode: "KEEP" as const,
  expiresAt: "",
};

test("exit and amendment decimals use the backend decimal grammar", () => {
  const exit = buildExitOrder({ ...input, quantity: ".5", takeProfit: "2.", stopLoss: ".5" });
  assert.ok("group_type" in exit);
  assert.equal(exit.quantity, "0.5");
  assert.equal(exit.take_profit.trigger_price, "2");
  assert.ok("trigger_price" in exit.stop_loss);
  assert.equal(exit.stop_loss.trigger_price, "0.5");
  const single = buildExitOrder({ ...input, margin_position_id: "mgn_a", mode: "STOP_LOSS", quantity: "1.", stopLoss: ".5" });
  assert.ok("side" in single);
  assert.equal(single.quantity, "1");
  assert.equal(single.trigger_price, "0.5");
  assert.deepEqual(buildOrderAmendment(order, { ...amendment, amount: ".5", price: "3." }), {
    expected_revision: 4, quantity: "0.5", trigger_price: "3",
  });
  assert.equal(buildOrderAmendment({ ...order, requested_credit: "2" }, { ...amendment, amount: ".0000000000000001" }).credit_amount, "0.0000000000000001");
  assert.throws(() => buildExitOrder({ ...input, quantity: "." }));
  assert.throws(() => buildOrderAmendment(order, { ...amendment, price: "." }));
});

test("trigger price limits allow a better price beyond an LTE buy or GTE sell target", () => {
  assert.equal(triggerLimitPriceError("BUY", "LTE", "100", "90"), null);
  assert.equal(triggerLimitPriceError("SELL", "GTE", "100", "110"), null);
  assert.ok(triggerLimitPriceError("BUY", "GTE", "100", "90"));
  assert.ok(triggerLimitPriceError("SELL", "LTE", "100", "110"));
  for (const side of ["BUY", "SELL"] as const) {
    for (const condition of ["LTE", "GTE"] as const) {
      assert.equal(triggerLimitPriceError(side, condition, "100", "100"), null);
      assert.equal(triggerLimitPriceError(side, condition, "100", side === "BUY" ? "110" : "90"), null);
    }
  }
});

test("amendment sends residual intent and revision without changing mode, policies or expiry", () => {
  assert.deepEqual(buildOrderAmendment(order, amendment), {
    expected_revision: 4,
    quantity: "3",
  });
  assert.deepEqual(
    buildOrderAmendment(
      { ...order, requested_credit: "20" },
      { ...amendment, amount: "1.0000000000000001", expiryMode: "REMOVE" },
    ),
    {
      expected_revision: 4,
      credit_amount: "1.0000000000000001",
      expires_at: null,
    },
  );
  const margin = buildOrderAmendment(
    { ...order, margin_position_id: "mgn_a", trailing_ppm: 50000 },
    { ...amendment, trailingPercent: "6" },
  );
  assert.deepEqual(margin, {
    expected_revision: 4,
    quantity: "3",
    trailing_ppm: 60000,
  });
  assert.throws(() =>
    buildOrderAmendment(order, {
      ...amendment,
      expiryMode: "CHANGE",
      expiresAt: "2020-01-01",
    }),
  );
});

test("cumulative PnL retains decimals beyond single-balance bounds and labels baselines", () => {
  assert.equal(
    fmtSigned("9007199254740993.0000000000000001", 16),
    "+9,007,199,254,740,993.0000000000000001",
  );
  assert.equal(
    fmtSigned("-9007199254740993.0000000000000001", 16),
    "-9,007,199,254,740,993.0000000000000001",
  );
  assert.equal(
    pnlSourceLabel({ is_baseline: true, source_type: "MARGIN_OPENING_BALANCE" }),
    "이전 누적 손익",
  );
  assert.equal(
    pnlSourceLabel({ is_baseline: false, source_type: "MARGIN_INTEREST" }),
    "이자",
  );
});
