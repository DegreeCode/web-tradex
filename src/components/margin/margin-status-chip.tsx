"use client";

import { cn } from "cn";
import type { MarginRiskLevel, MarginStatus } from "@/lib/margin";

const STATUS_LABEL: Record<MarginStatus, string> = {
  OPEN: "보유중",
  LIQUIDATING: "청산진행중",
  CUSTODY: "보호보관",
  CLOSED: "종료됨",
  LIQUIDATED: "강제청산",
  DELISTED: "상폐정산",
};

const STATUS_CLASS: Record<MarginStatus, string> = {
  OPEN: "bg-app-blue-light text-app-blue-dark",
  LIQUIDATING: "bg-app-red-light text-app-red animate-pulse",
  CUSTODY: "bg-app-orange-light text-app-orange",
  CLOSED: "bg-app-gray-100 text-app-gray-500",
  LIQUIDATED: "bg-app-red-light text-app-red font-bold",
  DELISTED: "bg-app-gray-200 text-app-gray-600",
};

export function MarginStatusChip({
  status,
  className,
}: {
  status: MarginStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold",
        STATUS_CLASS[status] ?? "bg-app-gray-100 text-app-gray-600",
        className,
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function MarginSideBadge({
  side,
  size = "default",
}: {
  side: "LONG" | "SHORT";
  size?: "default" | "lg";
}) {
  const isLong = side === "LONG";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md font-bold tracking-tight",
        size === "lg" ? "h-6 px-2 text-[12px]" : "h-5 px-1.5 text-[11px]",
        isLong
          ? "bg-app-red-light text-app-red"
          : "bg-app-blue-light text-app-blue-dark",
      )}
    >
      {isLong ? "롱" : "숏"}
    </span>
  );
}

const RISK_LABEL: Record<MarginRiskLevel, string> = {
  SAFE: "안전",
  WARNING: "경고",
  MAINTENANCE: "청산 위험",
};

const RISK_CLASS: Record<MarginRiskLevel, string> = {
  SAFE: "bg-app-gray-100 text-app-gray-600",
  WARNING: "bg-app-orange-light text-app-orange",
  MAINTENANCE: "bg-app-red-light text-app-red font-bold",
};

export function MarginRiskBadge({ level }: { level: MarginRiskLevel | null }) {
  if (!level) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold",
        RISK_CLASS[level],
      )}
    >
      {RISK_LABEL[level]}
    </span>
  );
}
