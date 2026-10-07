import { isPositiveDecimal } from "./format";
import { triggerGroupRoleLabel } from "./trigger-order";
import type { Order, OrderSide } from "./types";

export interface ChartOrderLine {
  id: string;
  price: string;
  side: OrderSide;
  label: string;
}

export function buildChartOrderLines(
  orders: Order[],
  accountId: string,
  symbol: string,
): ChartOrderLine[] {
  if (!accountId || !symbol) return [];
  const lines = new Map<string, ChartOrderLine>();
  for (const order of orders) {
    if (
      order.account_id !== accountId || order.symbol !== symbol ||
      order.order_type !== "TRIGGER" ||
      (order.status !== "PENDING" && order.status !== "ACTIVATED") ||
      !order.trigger_price || !isPositiveDecimal(order.trigger_price) ||
      !Number.isFinite(Number(order.trigger_price)) ||
      lines.has(order.order_id)
    ) continue;
    const role = triggerGroupRoleLabel(order.group_role) ?? "예약";
    const side = order.side === "BUY" ? "매수" : "매도";
    const marginSide = order.margin_side === "SHORT" ? " 숏" : order.margin_side === "LONG" ? " 롱" : "";
    const margin = order.margin_position_id ? `마진${marginSide} ` : "";
    const trailing = (order.trailing_ppm ?? 0) > 0 ? " · 추적" : "";
    const condition = order.trigger_condition === "GTE" ? " ≥" : order.trigger_condition === "LTE" ? " ≤" : "";
    lines.set(order.order_id, {
      id: order.order_id,
      price: order.trigger_price,
      side: order.side,
      label: `${margin}${role} ${side}${trailing}${condition}`,
    });
  }
  return [...lines.values()];
}
