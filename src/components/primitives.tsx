"use client";

import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, Loader2 } from "lucide-react";

import { cn } from "cn";
import { fmtDecimal } from "@/lib/format";
import type { InstrumentState, OrderSide, OrderStatus, TransferStatus } from "@/lib/types";

export function Surface({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "section" | "article";
}) {
  return (
    <Tag
      className={cn(
        "min-w-0 rounded-2xl bg-card p-5 shadow-card",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function SectionHeader({
  title,
  action,
  description,
}: {
  title: string;
  action?: React.ReactNode;
  description?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 flex-1 basis-40">
        <h2 className="break-words text-[17px] font-bold tracking-[-0.02em] text-app-gray-900">{title}</h2>
        {description ? <p className="mt-0.5 break-words text-[13px] text-app-gray-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Page title row shared by every screen: optional back link, title, subtitle and actions. */
export function PageHeader({
  title,
  subtitle,
  back,
  action,
  icon,
}: {
  title: string;
  subtitle?: React.ReactNode;
  back?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <header className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
      {back}
      <div className="min-w-0 flex-1 basis-48">
        <h1 className="flex items-center gap-2 break-words text-[22px] leading-tight font-extrabold tracking-[-0.03em] text-app-gray-900 sm:text-[24px]">
          {icon}
          {title}
        </h1>
        {subtitle ? <p className="mt-1 break-words text-[13px] text-app-gray-500">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

/** Round icon link back to a parent screen, placed in PageHeader's `back` slot. */
export function BackLink({ href, label = "뒤로" }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={label}
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-app-gray-700 hover:bg-app-gray-100"
    >
      <ArrowLeft className="size-5" />
    </Link>
  );
}

export function DataRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="max-w-[45%] shrink-0 text-[14px] text-app-gray-500">{label}</span>
      <span
        className={cn(
          "numeric min-w-0 break-all text-right text-[14px] text-app-gray-900",
          emphasis && "text-[15px] font-bold",
        )}
      >
        {value}
      </span>
    </div>
  );
}

const INSTRUMENT_STATE_LABEL: Record<InstrumentState, string> = {
  TRADING: "거래중",
  HALTED: "거래정지",
  DELIST_PENDING: "상폐예정",
  DELISTED: "상장폐지",
};

const INSTRUMENT_STATE_CLASS: Record<InstrumentState, string> = {
  TRADING: "bg-app-blue-light text-app-blue-dark",
  HALTED: "bg-app-red-light text-app-red",
  DELIST_PENDING: "bg-app-orange-light text-app-orange",
  DELISTED: "bg-app-gray-200 text-app-gray-600",
};

export function InstrumentStateChip({ state }: { state: InstrumentState }) {
  if (state === "TRADING") return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold whitespace-nowrap",
        INSTRUMENT_STATE_CLASS[state],
      )}
    >
      {INSTRUMENT_STATE_LABEL[state]}
    </span>
  );
}

const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  FILLED: "체결완료",
  PARTIALLY_FILLED: "부분체결",
  REJECTED: "거절됨",
  PENDING: "예약중",
  ACTIVATED: "발동됨",
  CANCELED: "취소됨",
  EXPIRED: "만료됨",
  FAILED: "실패",
};

const ORDER_STATUS_CLASS: Record<OrderStatus, string> = {
  FILLED: "bg-app-blue-light text-app-blue-dark",
  PARTIALLY_FILLED: "bg-app-blue-light text-app-blue-dark",
  REJECTED: "bg-app-red-light text-app-red",
  PENDING: "bg-app-gray-100 text-app-gray-700",
  ACTIVATED: "bg-app-green-light text-app-green",
  CANCELED: "bg-app-gray-100 text-app-gray-500",
  EXPIRED: "bg-app-gray-100 text-app-gray-500",
  FAILED: "bg-app-red-light text-app-red",
};

export function OrderStatusChip({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold whitespace-nowrap",
        ORDER_STATUS_CLASS[status],
      )}
    >
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}

const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  PENDING: "대기중",
  REJECTED: "거절됨",
  CANCELED: "취소됨",
  EXPIRED: "만료됨",
  COMPLETED: "완료",
};

const TRANSFER_STATUS_CLASS: Record<TransferStatus, string> = {
  PENDING: "bg-app-orange-light text-app-orange",
  REJECTED: "bg-app-red-light text-app-red",
  CANCELED: "bg-app-gray-100 text-app-gray-500",
  EXPIRED: "bg-app-gray-100 text-app-gray-500",
  COMPLETED: "bg-app-blue-light text-app-blue-dark",
};

export function TransferStatusChip({ status }: { status: TransferStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold whitespace-nowrap",
        TRANSFER_STATUS_CLASS[status],
      )}
    >
      {TRANSFER_STATUS_LABEL[status]}
    </span>
  );
}

export function SideBadge({ side, size = "default" }: { side: OrderSide; size?: "default" | "lg" }) {
  const buy = side === "BUY";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-semibold whitespace-nowrap",
        size === "lg" ? "h-6 px-2 text-[12px]" : "h-5 px-1.5 text-[11px]",
        buy ? "bg-app-red-light text-app-red" : "bg-app-blue-light text-app-blue-dark",
      )}
    >
      {buy ? "매수" : "매도"}
    </span>
  );
}

export function ChangeIndicator({
  value,
  maxFrac = 2,
  suffix = "%",
}: {
  value: number | null;
  maxFrac?: number;
  suffix?: string;
}) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-[13px] text-app-gray-400">-</span>;
  }
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[13px] font-semibold numeric",
        up ? "text-app-red" : "text-app-blue",
      )}
    >
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {fmtDecimal(Math.abs(value), maxFrac)}
      {suffix}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-card px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-app-gray-300">{icon}</div> : null}
      <p className="text-[15px] font-semibold text-app-gray-800">{title}</p>
      {description ? <p className="text-[13px] text-app-gray-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ className, label = "불러오는 중" }: { className?: string; label?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("flex items-center justify-center py-12", className)}>
      <Loader2 aria-hidden="true" className="size-5 animate-spin text-app-gray-400" />
    </div>
  );
}

export function SkeletonRows({ rows = 4, label = "불러오는 중" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} aria-hidden="true" className="h-14 animate-pulse rounded-xl bg-app-gray-100" />
      ))}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl bg-card px-6 py-10 text-center">
      <p className="text-[14px] text-app-gray-700">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-9 rounded-lg px-3 text-[13px] font-semibold text-app-blue underline underline-offset-4"
        >
          다시 시도
        </button>
      ) : null}
    </div>
  );
}

/**
 * Next-page button for cursor lists. Render it even when the loaded rows are
 * filtered out, so a filter that matches nothing yet can still reach older pages.
 */
export function LoadMoreButton({
  hasMore,
  loading,
  onLoad,
  label = "더보기",
  className,
}: {
  hasMore: boolean | undefined;
  loading?: boolean;
  onLoad: () => void;
  label?: string;
  className?: string;
}) {
  if (!hasMore) return null;
  return (
    <button
      type="button"
      onClick={onLoad}
      disabled={loading}
      className={cn(
        "flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-card text-[13px] font-semibold text-app-gray-600 shadow-card hover:bg-app-gray-50 disabled:opacity-60",
        className,
      )}
    >
      {loading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
      {loading ? "불러오는 중…" : label}
    </button>
  );
}

/**
 * Expands and collapses its content by height. The content stays mounted but
 * inert while closed, so pass spacing such as mt-2 on the child, not here.
 */
export function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
