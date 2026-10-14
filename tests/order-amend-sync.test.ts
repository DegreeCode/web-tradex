import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOrderAmendment,
  orderAmendValues,
  rebaseAmendForm,
} from "../src/lib/advanced-order";
import { ppmFromPercent } from "../src/lib/format";
import type { Order } from "../src/lib/types";

const base: Order = {
  order_id: "ord_sync",
  account_id: "acc_a",
  symbol: "ALPHA.M",
  side: "SELL",
  order_type: "TRIGGER",
  status: "PENDING",
  revision: 4,
  requested_quantity: "100",
  remaining_quantity: "100",
  filled_quantity: "0",
  principal: "0",
  fee: "0",
  average_price: "0",
  trigger_price: "2",
  slippage_ppm: 50_000,
  created_at: "2026-10-05T00:00:00Z",
};

function amendment(synced: ReturnType<typeof rebaseAmendForm>) {
  return buildOrderAmendment(synced.base, {
    ...synced.values,
    expiryMode: "KEEP",
    expiresAt: "",
    slippage: synced.values.slippage
      ? ppmFromPercent(synced.values.slippage)
      : undefined,
  });
}

test("untouched quantity, price and slippage follow live values and revision", () => {
  const live = {
    ...base,
    revision: 7,
    remaining_quantity: "60",
    filled_quantity: "40",
    trigger_price: "3",
    slippage_ppm: 60_000,
  };
  const synced = rebaseAmendForm(base, live, orderAmendValues(base));
  assert.equal(synced.base, live);
  assert.deepEqual(synced.values, {
    amount: "60",
    price: "3",
    trailingPercent: "",
    slippage: "6",
  });
  assert.equal(synced.amountEdited, false);
  assert.match(synced.notice, /^방금 일부 체결돼 잔여 수량이 100주 → 60주/);
  assert.match(synced.notice, /목표 가격이 2 Credit → 3 Credit/);
  assert.match(synced.notice, /슬리피지가 5% → 6%/);
  assert.doesNotMatch(synced.notice, /입력한 값/);
  assert.deepEqual(amendment(synced), { expected_revision: 7, quantity: "60" });
});

test("edited fields retain raw user input while the baseline and revision advance", () => {
  const live = {
    ...base,
    revision: 8,
    remaining_quantity: "60",
    filled_quantity: "40",
    trigger_price: "3",
    slippage_ppm: 60_000,
  };
  const values = {
    ...orderAmendValues(base),
    amount: "80",
    price: "2.5",
    slippage: "",
  };
  const synced = rebaseAmendForm(base, live, values);
  assert.deepEqual(synced.values, values);
  assert.equal(synced.amountEdited, true);
  assert.equal(synced.base.revision, 8);
  assert.match(synced.notice, /잔여 수량이 100주 → 60주/);
  assert.match(synced.notice, /입력한 값은 그대로 뒀어요\. 확인 후 정정해주세요\.$/);
  assert.deepEqual(amendment(synced), {
    expected_revision: 8,
    quantity: "80",
    trigger_price: "2.5",
  });
});

test("successive fills keep price edits and keep rebasing an untouched amount", () => {
  const first = rebaseAmendForm(
    base,
    { ...base, revision: 5, remaining_quantity: "60", filled_quantity: "40" },
    { ...orderAmendValues(base), price: "2.5" },
  );
  const second = rebaseAmendForm(
    first.base,
    { ...first.base, revision: 6, remaining_quantity: "20", filled_quantity: "80" },
    first.values,
  );
  assert.equal(second.amountEdited, false);
  assert.equal(second.values.amount, "20");
  assert.equal(second.values.price, "2.5");
  assert.match(second.notice, /60주 → 20주/);
  assert.deepEqual(amendment(second), {
    expected_revision: 6,
    quantity: "20",
    trigger_price: "2.5",
  });
});

test("an amount edit stays edited across successive fills until restored to the baseline", () => {
  const first = rebaseAmendForm(
    base,
    { ...base, revision: 5, remaining_quantity: "60" },
    { ...orderAmendValues(base), amount: "80" },
  );
  const live = { ...first.base, revision: 6, remaining_quantity: "40" };
  const second = rebaseAmendForm(first.base, live, first.values);
  assert.equal(second.amountEdited, true);
  assert.equal(second.values.amount, "80");
  const restored = rebaseAmendForm(first.base, live, {
    ...first.values,
    amount: "60",
  });
  assert.equal(restored.amountEdited, false);
  assert.equal(restored.values.amount, "40");
});

test("an edit that matches the new baseline follows subsequent live changes", () => {
  const first = rebaseAmendForm(
    base,
    { ...base, revision: 5, trigger_price: "2.5" },
    { ...orderAmendValues(base), price: "2.5" },
  );
  const second = rebaseAmendForm(
    first.base,
    { ...first.base, revision: 6, trigger_price: "3" },
    first.values,
  );
  assert.equal(second.values.price, "3");
  assert.deepEqual(amendment(second), { expected_revision: 6, quantity: "100" });
  assert.doesNotMatch(second.notice, /입력한 값/);
});

test("credit mode uses the remaining budget and preserves all 16 decimal places in its notice", () => {
  const credit = {
    ...base,
    side: "BUY" as const,
    requested_credit: "100.0000000000000001",
    remaining_credit: "100.0000000000000001",
  };
  const live = {
    ...credit,
    revision: 9,
    remaining_credit: "60.0000000000000001",
    filled_quantity: "20",
  };
  const synced = rebaseAmendForm(credit, live, orderAmendValues(credit));
  assert.equal(synced.values.amount, "60.0000000000000001");
  assert.match(synced.notice, /잔여 금액이 100\.0000000000000001 Credit → 60\.0000000000000001 Credit/);
  assert.deepEqual(amendment(synced), {
    expected_revision: 9,
    credit_amount: "60.0000000000000001",
  });
});

test("amount derivation falls back to requested intent and margin always uses quantity", () => {
  assert.equal(orderAmendValues({ ...base, remaining_quantity: undefined }).amount, "100");
  assert.equal(orderAmendValues({ ...base, requested_credit: "200" }).amount, "200");
  const margin = {
    ...base,
    margin_position_id: "mgn_a",
    requested_credit: "200",
    remaining_credit: "150",
  };
  const synced = rebaseAmendForm(
    margin,
    { ...margin, remaining_quantity: "60", revision: 5 },
    orderAmendValues(margin),
  );
  assert.equal(synced.values.amount, "60");
  assert.match(synced.notice, /잔여 수량이 100주 → 60주/);
  assert.deepEqual(amendment(synced), { expected_revision: 5, quantity: "60" });
  assert.equal(orderAmendValues({
    ...base,
    remaining_quantity: undefined,
    requested_quantity: undefined,
    trigger_price: undefined,
    slippage_ppm: undefined,
  }).amount, "");
});

test("trailing trigger price follows the market without a revision bump or notice", () => {
  const trailing = { ...base, trailing_ppm: 50_000 };
  const live = { ...trailing, trigger_price: "2.1" };
  const synced = rebaseAmendForm(trailing, live, orderAmendValues(trailing));
  assert.equal(synced.base, live);
  assert.equal(synced.values.price, "2.1");
  assert.equal(synced.values.trailingPercent, "5");
  assert.equal(synced.notice, "");
  assert.deepEqual(amendment(synced), { expected_revision: 4, quantity: "100" });
});

test("trailing distance syncs when untouched and remains when edited", () => {
  const trailing = { ...base, trailing_ppm: 50_000 };
  const live = { ...trailing, revision: 5, trailing_ppm: 60_000, trigger_price: "2.1" };
  const synced = rebaseAmendForm(trailing, live, orderAmendValues(trailing));
  assert.equal(synced.values.trailingPercent, "6");
  assert.equal(synced.notice, "추적 거리가 5% → 6%로 바뀌었어요.");
  const edited = rebaseAmendForm(trailing, live, {
    ...orderAmendValues(trailing),
    trailingPercent: "7",
  });
  assert.equal(edited.values.trailingPercent, "7");
  assert.match(edited.notice, /입력한 값은 그대로 뒀어요/);
  assert.deepEqual(amendment(edited), {
    expected_revision: 5,
    quantity: "100",
    trailing_ppm: 70_000,
  });
});

test("price changes without a revision bump still rebase and report kept edits", () => {
  const synced = rebaseAmendForm(base, { ...base, trigger_price: "3" }, {
    ...orderAmendValues(base),
    price: "2.5",
  });
  assert.equal(synced.base.revision, base.revision);
  assert.equal(synced.values.price, "2.5");
  assert.match(synced.notice, /목표 가격이 2 Credit → 3 Credit/);
  assert.match(synced.notice, /입력한 값은 그대로 뒀어요/);
});

test("revision-only and status-only updates advance the baseline without changing inputs", () => {
  const values = orderAmendValues(base);
  const revised = rebaseAmendForm(base, { ...base, revision: 5 }, values);
  assert.deepEqual(revised.values, values);
  assert.equal(revised.notice, "주문이 바뀌어 최신 정보로 맞췄어요.");
  const activated = rebaseAmendForm(base, { ...base, revision: 5, status: "ACTIVATED" }, values);
  assert.equal(activated.base.status, "ACTIVATED");
  assert.equal(activated.base.revision, 5);
  assert.equal(activated.notice, "");
  const filled = rebaseAmendForm(base, { ...base, status: "FILLED" }, values);
  assert.equal(filled.base.status, "FILLED");
  const unchanged = rebaseAmendForm(base, { ...base }, values);
  assert.equal(unchanged.notice, "");
});
