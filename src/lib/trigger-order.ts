import { fmtCredit, fmtPercentFromPPM, fmtPrice, fmtQuantity, isPositiveDecimal } from "./format";
import type { Order } from "./types";

export interface TriggerOrderRow {
  key: string;
  label: string;
  value: string;
  secondary?: string;
}

const TRIGGER_FIELDS = [
  "revision", "on_partial_fill", "on_slippage_exceeded", "slippage_ppm",
  "fill_count", "activation_count", "remaining_quantity", "remaining_credit",
  "held_credit", "held_quantity", "hold_scope", "group_id", "group_role",
  "parent_group_id", "wait_reason", "terminal_reason", "trailing_ppm",
  "trailing_watermark_price",
] as const satisfies readonly (keyof Order)[];

/** Existing budget/hold-limit fields alone do not identify a v4 response. */
export function hasTriggerOrderFields(order: Order): boolean {
  return order.order_type === "TRIGGER" &&
    TRIGGER_FIELDS.some((field) => order[field] !== undefined && order[field] !== null);
}

export function triggerWaitReasonLabel(reason?: string): string | null {
  switch (reason) {
    case "PARTIAL_FILL": return "부분 체결 후 남은 수량 대기";
    case "SLIPPAGE_EXCEEDED": return "슬리피지 초과로 다음 가격 변동 대기";
    case "MARGIN_INTEREST_PENDING": return "마진 이자 정산 대기";
    default: return null;
  }
}

export function triggerTerminalReasonLabel(reason?: string): string | null {
  switch (reason) {
    case "POSITION_EXHAUSTED": return "포지션 잔여 수량 없음";
    case "MARGIN_POSITION_NOT_OPEN": return "포지션 종료 또는 거래 불가";
    case "MARGIN_RISK_LIMIT": return "마진 위험 기준 초과";
    case "MARGIN_LIQUIDITY": return "마진 정산 지급 여력 부족";
    case "SYMBOL_DELISTED": return "종목 상장폐지";
    case "ACCOUNT_DELETED": return "연결 계좌 삭제";
    case "CREDIT_LIMIT_EXHAUSTED": return "예산 소진";
    case "OCO_PEER_EXECUTED": return "반대쪽 주문 체결로 자동 취소";
    case "GROUP_CANCELED": return "묶음 주문 취소";
    case "SLIPPAGE_EXCEEDED": return "슬리피지 초과";
    case "CANCELED": return "주문 취소";
    case "EXPIRED": return "예약 기간 만료";
    default: return null;
  }
}

export function triggerGroupRoleLabel(role?: string): string | null {
  switch (role) {
    case "ENTRY": return "진입";
    case "TAKE_PROFIT": return "익절";
    case "STOP_LOSS": return "손절";
    default: return null;
  }
}

export function triggerPartialFillPolicyLabel(policy?: string): string | null {
  switch (policy) {
    case "TERMINATE": return "남은 주문 종료";
    case "KEEP": return "남은 주문 계속 대기";
    default: return null;
  }
}

export function triggerSlippagePolicyLabel(policy?: string): string | null {
  switch (policy) {
    case "FAIL": return "주문 종료";
    case "RETRY": return "다음 가격 변동에 재시도";
    default: return null;
  }
}

export function triggerCancelWarning(role?: string): string | null {
  switch (role) {
    case "TAKE_PROFIT":
    case "STOP_LOSS": return "함께 걸린 익절·손절 주문도 같이 취소돼요.";
    case "ENTRY": return "이미 만들어진 익절·손절 주문은 유지돼요.";
    default: return null;
  }
}

/** Extra rows are derived per order; a shared OCO hold is never aggregated. */
export function triggerOrderDisplayRows(
  order: Order,
  { compact = false }: { compact?: boolean } = {},
): TriggerOrderRow[] {
  if (!hasTriggerOrderFields(order)) return [];

  const rows: TriggerOrderRow[] = [];
  const pending = order.status === "PENDING";
  const terminal = order.status !== "PENDING" && order.status !== "ACTIVATED";
  const add = (key: string, label: string, value: string, secondary?: string) => {
    rows.push({ key, label, value, ...(secondary ? { secondary } : {}) });
  };
  if (order.margin_position_id) add("margin", "마진 종료", order.margin_side === "SHORT" ? "숏 포지션 매수 종료" : "롱 포지션 매도 종료", "추가 자산 잠금 없음 · 마진 정산 수수료 적용");

  if (order.requested_credit != null) {
    add("budget", "주문 예산", `${fmtCredit(order.requested_credit)} Credit`);
  }
  if (order.max_credit_amount != null) {
    add("hold-limit", "보류 한도", `${fmtCredit(order.max_credit_amount)} Credit`);
  }
  if (Number.isInteger(order.fill_count) && order.fill_count! > 0) {
    add("fills", "체결 상태", pending
      ? `체결 ${order.fill_count}회 · 잔여 대기`
      : `체결 ${order.fill_count}회`);
    if (pending) {
      add("cumulative-quantity", "누적 체결 수량", `${fmtQuantity(order.filled_quantity)}주`);
    }
  }
  const activationCount = order.activation_count ?? 0;
  if (Number.isInteger(activationCount) && activationCount > 0 &&
    (!compact || activationCount > (order.fill_count ?? 0))) {
    add("activations", "발동 횟수", `${activationCount}회`);
  }
  if (order.remaining_quantity != null && isPositiveDecimal(order.remaining_quantity)) {
    add("remaining-quantity", terminal ? "미사용 수량" : "잔여 수량",
      `${fmtQuantity(order.remaining_quantity)}주`);
  }
  if (order.remaining_credit != null && isPositiveDecimal(order.remaining_credit) && order.side === "BUY") {
    add("remaining-credit", terminal ? "미사용 금액" : "잔여 금액",
      `${fmtCredit(order.remaining_credit)} Credit`, "수수료 포함");
  }

  if (pending) {
    const shared = order.hold_scope === "GROUP" ||
      order.group_role === "TAKE_PROFIT" || order.group_role === "STOP_LOSS";
    const secondary = shared ? "익절·손절 공동" : undefined;
    if (order.side === "BUY" && order.held_credit != null && isPositiveDecimal(order.held_credit)) {
      add("held-credit", "묶인 금액", `${fmtCredit(order.held_credit)} Credit`, secondary);
    }
    if (order.side === "SELL" && order.held_quantity != null && isPositiveDecimal(order.held_quantity)) {
      add("held-quantity", "묶인 수량", `${fmtQuantity(order.held_quantity)}주`, secondary);
    }
    const reason = triggerWaitReasonLabel(order.wait_reason);
    if (reason) add("wait-reason", "대기 사유", reason);
  }
  if (terminal) {
    const reason = triggerTerminalReasonLabel(order.terminal_reason);
    if (reason) add("terminal-reason", "종료 사유", reason);
  }

  const partialFill = triggerPartialFillPolicyLabel(order.on_partial_fill);
  if (partialFill && (!compact || order.on_partial_fill === "KEEP")) {
    add("partial-fill-policy", "부분 체결 시", partialFill);
  }
  const slippage = triggerSlippagePolicyLabel(order.on_slippage_exceeded);
  if (slippage && (!compact || order.on_slippage_exceeded === "RETRY")) {
    add("slippage-policy", "슬리피지 초과 시", slippage);
  }
  if (!compact && Number.isInteger(order.slippage_ppm) && order.slippage_ppm! >= 0) {
    add("slippage", "슬리피지", fmtPercentFromPPM(order.slippage_ppm, 4));
  }

  const watermarkLabel = order.side === "SELL" ? "추적 최고가" : "추적 최저가";
  if (Number.isInteger(order.trailing_ppm) && order.trailing_ppm! >= 1 && order.trailing_ppm! <= 999999) {
    add("trailing", `추적 ${fmtPercentFromPPM(order.trailing_ppm, 4)}`,
      order.trigger_price != null ? `${fmtPrice(order.trigger_price)} Credit` : "-",
      order.trailing_watermark_price != null
        ? `${watermarkLabel} ${fmtPrice(order.trailing_watermark_price)} Credit`
        : undefined);
  } else if (order.trailing_watermark_price != null) {
    add("watermark", watermarkLabel, `${fmtPrice(order.trailing_watermark_price)} Credit`);
  }
  return rows;
}
