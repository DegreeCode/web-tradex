import { isApiError } from "./api";
import { fmtCredit, fmtPercentFromPPM, fmtQuantity } from "./format";

export type MarginCapacityDisplay = "BINARY" | "LEVEL" | "DETAILED";
export type MarginCapacityLevel = "LOW" | "NORMAL" | "HIGH" | "UNAVAILABLE";
export type MarginCapacitySide = "LONG" | "SHORT";
export type MarginCapacityTone = "available" | "low" | "unavailable" | "unknown";

const LEVEL_LABELS = {
  LOW: "적음",
  NORMAL: "보통",
  HIGH: "여유",
  UNAVAILABLE: "불가",
} as const;

const REASON_LABELS = {
  SYMBOL_HALTED: "거래가 일시 정지된 종목이에요",
  SYMBOL_DELIST_PENDING: "상장폐지가 예정된 종목이에요",
  SYMBOL_DELISTED: "상장폐지된 종목이에요",
  MARGIN_DISABLED: "마진이 꺼진 종목이에요",
  POOL_EMPTY: "빌릴 주식이 없어요",
  CAP_REACHED: "한도에 도달했어요",
} as const;

export type MarginCapacityReason = keyof typeof REASON_LABELS;

export interface MarginCapacityDetail {
  remainingText: string | null;
  capacityText: string | null;
  notionalText: string | null;
  ratioPercent: number | null;
  ratioText: string | null;
}

export interface MarginCapacitySideModel {
  available: boolean | null;
  level: MarginCapacityLevel | null;
  levelLabel: string | null;
  label: string;
  reason: MarginCapacityReason | null;
  reasonLabel: string | null;
  tone: MarginCapacityTone;
  detail: MarginCapacityDetail | null;
}

export interface MarginCapacity {
  symbol: string | null;
  display: MarginCapacityDisplay;
  asOf: string | null;
  long: MarginCapacitySideModel | null;
  short: MarginCapacitySideModel | null;
}

export function shouldShowMarginCapacityRow({
  capacity,
  hidden,
  status,
}: {
  capacity: MarginCapacity | null;
  hidden: boolean;
  status: "pending" | "error" | "success";
}): boolean {
  return !hidden && status !== "error" && (status === "pending" || Boolean(capacity?.long || capacity?.short));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function decimal(value: unknown, precision: number): string | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  return (value.split(".")[1]?.length ?? 0) <= precision ? value : null;
}

function normalizeSide(raw: unknown, display: MarginCapacityDisplay, side: MarginCapacitySide): MarginCapacitySideModel | null {
  const value = record(raw);
  if (!value) return null;
  const available = typeof value.available === "boolean" ? value.available : null;
  const level = display !== "BINARY" && typeof value.level === "string" && Object.hasOwn(LEVEL_LABELS, value.level)
    ? value.level as MarginCapacityLevel
    : null;
  // Availability owns the verdict; a future/partial level must not invent capacity.
  const levelLabel = level ? LEVEL_LABELS[level] : null;
  const label = available === null ? "확인 불가" : !available ? "불가" : level === "UNAVAILABLE" ? "가능" : levelLabel ?? "가능";
  const reason = display !== "BINARY" && available === false && typeof value.reason === "string" && Object.hasOwn(REASON_LABELS, value.reason)
    ? value.reason as MarginCapacityReason
    : null;
  const reasonLabel = available === false && display !== "BINARY"
    ? reason ? REASON_LABELS[reason] : "현재 진입할 수 없어요"
    : null;
  const tone: MarginCapacityTone = available === null ? "unknown" : !available ? "unavailable" : level === "LOW" ? "low" : "available";
  let detail: MarginCapacityDetail | null = null;
  if (display === "DETAILED") {
    const long = side === "LONG";
    const remaining = decimal(value[long ? "remaining_borrow_credit" : "remaining_quantity"], long ? 16 : 8);
    const capacity = decimal(value[long ? "borrow_capacity_credit" : "capacity_quantity"], long ? 16 : 8);
    const notional = long ? null : decimal(value.remaining_notional_credit, 16);
    const ppm = typeof value.remaining_ratio_ppm === "number" && Number.isFinite(value.remaining_ratio_ppm) && Number.isInteger(value.remaining_ratio_ppm) && value.remaining_ratio_ppm >= 0
      ? value.remaining_ratio_ppm
      : null;
    const amountText = (amount: string) => long ? `${fmtCredit(amount)} Credit` : `${fmtQuantity(amount)}주`;
    detail = {
      remainingText: remaining === null ? null : amountText(remaining),
      capacityText: capacity === null ? null : amountText(capacity),
      notionalText: notional === null ? null : `${fmtCredit(notional)} Credit`,
      ratioPercent: ppm === null ? null : ppm / 10_000,
      ratioText: ppm === null ? null : fmtPercentFromPPM(ppm),
    };
  }
  return { available, level, levelLabel, label, reason, reasonLabel, tone, detail };
}

/** Accepts apiData's payload or the documented envelope. Unknown display policies stay hidden. */
export function normalizeMarginCapacity(raw: unknown): MarginCapacity | null {
  const envelope = record(raw);
  const value = record(envelope?.data) ?? envelope;
  if (!value || (value.display !== "BINARY" && value.display !== "LEVEL" && value.display !== "DETAILED")) return null;
  return {
    symbol: typeof value.symbol === "string" ? value.symbol : null,
    display: value.display,
    asOf: typeof value.as_of === "string" ? value.as_of : null,
    long: normalizeSide(value.long, value.display, "LONG"),
    short: normalizeSide(value.short, value.display, "SHORT"),
  };
}

export function isMarginCapacityHiddenError(error: unknown): boolean {
  return isApiError(error) && (error.status === 404 || (error.status === 403 && error.code === "MARGIN_STATUS_DISABLED"));
}

export function isMarginCapacityClientError(error: unknown): boolean {
  return isApiError(error) && error.status >= 400 && error.status < 500;
}

export function retryMarginCapacity(failureCount: number, error: unknown): boolean {
  return !isMarginCapacityClientError(error) && failureCount < 1;
}
