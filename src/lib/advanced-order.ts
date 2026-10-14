import {
  compareDecimal,
  fmtDecimal,
  isDecimalInput,
  isPositiveDecimal,
  ppmFromPercent,
} from "./format";
import type {
  OrderAmendment,
  Order,
  OrderGroupRequest,
  OrderRequest,
  TriggerPolicy,
} from "./types";

export function trailingDistance(value: string): number | null {
  if (!isDecimalInput(value.trim(), 4) || !isPositiveDecimal(value.trim()))
    return null;
  const ppm = ppmFromPercent(value.trim());
  return Number.isInteger(ppm) && ppm >= 1 && ppm <= 999_999 ? ppm : null;
}

export function exitPriceError(
  takeProfit: string,
  stopLoss: string,
  side: "LONG" | "SHORT" = "LONG",
): string | null {
  if (
    ![takeProfit, stopLoss].every(
      (value) => isDecimalInput(value, 8) && isPositiveDecimal(value),
    )
  )
    return "익절·손절 가격을 양수로 입력해주세요";
  if (compareDecimal(stopLoss, takeProfit) * (side === "LONG" ? 1 : -1) >= 0)
    return side === "LONG"
      ? "손절가는 익절가보다 낮아야 해요"
      : "숏 손절가는 익절가보다 높아야 해요";
  return null;
}

export interface ExitOrderInput {
  symbol: string;
  account_id: string;
  margin_position_id?: string;
  margin_side?: "LONG" | "SHORT";
  quantity: string;
  mode: "OCO" | "TAKE_PROFIT" | "STOP_LOSS";
  takeProfit: string;
  stopLoss: string;
  trailingPercent?: string;
  expires_at?: string;
  policy: TriggerPolicy;
}
export function buildExitOrder(
  input: ExitOrderInput,
): OrderRequest | OrderGroupRequest {
  const margin = Boolean(input.margin_position_id);
  const short = margin && input.margin_side === "SHORT";
  const trailing =
    input.trailingPercent !== undefined
      ? trailingDistance(input.trailingPercent)
      : null;
  if (input.trailingPercent !== undefined && (!margin || trailing === null))
    throw new Error("추적 거리는 0.0001~99.9999%로 입력해주세요");
  if (!isDecimalInput(input.quantity, 8) || !isPositiveDecimal(input.quantity))
    throw new Error("주문 수량을 입력해주세요");
  const base = {
    symbol: input.symbol,
    account_id: input.account_id,
    quantity: input.quantity,
    ...(margin ? { margin_position_id: input.margin_position_id } : {}),
    ...(input.expires_at ? { expires_at: input.expires_at } : {}),
  };
  if (input.mode === "OCO") {
    if (
      !isDecimalInput(input.takeProfit, 8) ||
      !isPositiveDecimal(input.takeProfit)
    )
      throw new Error("익절 가격을 입력해주세요");
    if (trailing === null) {
      const error = exitPriceError(
        input.takeProfit,
        input.stopLoss,
        short ? "SHORT" : "LONG",
      );
      if (error) throw new Error(error);
    }
    return {
      ...base,
      group_type: "OCO",
      take_profit: { trigger_price: input.takeProfit, ...input.policy },
      stop_loss: {
        ...(trailing === null
          ? { trigger_price: input.stopLoss }
          : { trailing_ppm: trailing }),
        ...input.policy,
      },
    };
  }
  if (!margin) throw new Error("현물은 익절·손절 OCO로 등록해주세요");
  const takeProfit = input.mode === "TAKE_PROFIT";
  if (takeProfit && trailing !== null)
    throw new Error("익절은 고정 가격만 지원해요");
  const price = takeProfit ? input.takeProfit : input.stopLoss;
  if (
    trailing === null &&
    (!isDecimalInput(price, 8) || !isPositiveDecimal(price))
  )
    throw new Error("목표 가격을 입력해주세요");
  return {
    ...base,
    ...input.policy,
    side: short ? "BUY" : "SELL",
    order_type: "TRIGGER",
    trigger_condition: short === takeProfit ? "LTE" : "GTE",
    ...(trailing === null
      ? { trigger_price: price }
      : { trailing_ppm: trailing }),
  };
}

/** Only mutable intent fields are sent; omission keeps expiry, null removes it. */
export function buildOrderAmendment(
  order: Order,
  values: {
    amount: string;
    price: string;
    trailingPercent: string;
    expiryMode: "KEEP" | "REMOVE" | "CHANGE";
    expiresAt: string;
    slippage?: number;
  },
): OrderAmendment {
  const creditMode =
    !order.margin_position_id && order.requested_credit !== undefined;
  if (
    !isDecimalInput(values.amount, creditMode ? 16 : 8) ||
    !isPositiveDecimal(values.amount)
  )
    throw new Error("새 잔여 금액·수량을 입력해주세요");
  const body: OrderAmendment = {
    ...(order.revision !== undefined
      ? { expected_revision: order.revision }
      : {}),
    ...(creditMode
      ? { credit_amount: values.amount }
      : { quantity: values.amount }),
  };
  if (order.trailing_ppm !== undefined) {
    const trailing = trailingDistance(values.trailingPercent);
    if (trailing === null)
      throw new Error("추적 거리는 0.0001~99.9999%로 입력해주세요");
    if (trailing !== order.trailing_ppm) body.trailing_ppm = trailing;
  } else if (values.price !== order.trigger_price) {
    if (!isDecimalInput(values.price, 8) || !isPositiveDecimal(values.price))
      throw new Error("목표 가격을 입력해주세요");
    body.trigger_price = values.price;
  }
  if (values.slippage !== undefined && values.slippage !== order.slippage_ppm)
    body.slippage_ppm = values.slippage;
  if (values.expiryMode === "REMOVE") body.expires_at = null;
  if (values.expiryMode === "CHANGE") {
    const date = new Date(values.expiresAt);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
      throw new Error("만료 시각은 지금 이후로 정해주세요");
    body.expires_at = date.toISOString();
  }
  return body;
}

export interface AmendFormValues {
  amount: string;
  price: string;
  trailingPercent: string;
  slippage: string;
}

export function orderAmendValues(order: Order): AmendFormValues {
  const creditMode =
    !order.margin_position_id && order.requested_credit !== undefined;
  return {
    amount: creditMode
      ? (order.remaining_credit ?? order.requested_credit ?? "")
      : (order.remaining_quantity ?? order.requested_quantity ?? ""),
    price: order.trigger_price ?? "",
    trailingPercent:
      order.trailing_ppm !== undefined ? String(order.trailing_ppm / 10_000) : "",
    slippage:
      order.slippage_ppm !== undefined ? String(order.slippage_ppm / 10_000) : "",
  };
}

/** Compare with the previous baseline, then adopt live intent without losing edits. */
export function rebaseAmendForm(
  base: Order,
  live: Order,
  values: AmendFormValues,
) {
  const before = orderAmendValues(base);
  const after = orderAmendValues(live);
  const edited = {
    amount: values.amount !== before.amount,
    price: values.price !== before.price,
    trailingPercent: values.trailingPercent !== before.trailingPercent,
    slippage: values.slippage !== before.slippage,
  };
  const next = { ...values };
  const changes: string[] = [];
  let keptInput = false;
  const creditMode =
    !live.margin_position_id && live.requested_credit !== undefined;
  const amountUnit = creditMode ? " Credit" : "주";
  const labels: Record<keyof AmendFormValues, string> = {
    amount: creditMode ? "잔여 금액이" : "잔여 수량이",
    price: "목표 가격이",
    trailingPercent: "추적 거리가",
    slippage: "슬리피지가",
  };
  function display(field: keyof AmendFormValues, value: string) {
    if (!value) return "미설정";
    const unit =
      field === "amount" ? amountUnit : field === "price" ? " Credit" : "%";
    return `${fmtDecimal(value, creditMode && field === "amount" ? 16 : 8)}${unit}`;
  }
  for (const field of Object.keys(before) as (keyof AmendFormValues)[]) {
    if (!edited[field]) next[field] = after[field];
    if (before[field] === after[field]) continue;
    // A trailing trigger moves with the market, independently of revision.
    if (field === "price" && live.trailing_ppm !== undefined) continue;
    changes.push(
      `${labels[field]} ${display(field, before[field])} → ${display(field, after[field])}`,
    );
    keptInput ||= edited[field];
  }
  const partialFill =
    before.amount !== after.amount &&
    compareDecimal(live.filled_quantity, base.filled_quantity) > 0;
  const summary = changes.length
    ? `${partialFill ? "방금 일부 체결돼 " : ""}${changes.join(", ")}로 바뀌었어요.`
    : base.revision !== live.revision && base.status === live.status
      ? "주문이 바뀌어 최신 정보로 맞췄어요."
      : "";
  return {
    base: live,
    values: next,
    amountEdited: edited.amount,
    notice: summary
      ? `${summary}${keptInput ? " 입력한 값은 그대로 뒀어요. 확인 후 정정해주세요." : ""}`
      : "",
  };
}
