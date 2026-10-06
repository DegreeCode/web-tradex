"use client";

import { useId } from "react";
import type { TriggerPolicy, OrderWarning } from "@/lib/types";
import { fmtPrice } from "@/lib/format";

export function TriggerPolicyFields({
  value,
  onChange,
}: {
  value: TriggerPolicy;
  onChange: (value: TriggerPolicy) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 text-xs">
      <label className="space-y-1">
        <span className="text-app-gray-500">일부 체결 후</span>
        <select
          aria-label="부분 체결 정책"
          value={value.on_partial_fill ?? "TERMINATE"}
          onChange={(e) =>
            onChange({
              ...value,
              on_partial_fill: e.target.value as "KEEP" | "TERMINATE",
            })
          }
          className="w-full rounded-lg bg-card p-2.5"
        >
          <option value="TERMINATE">남은 주문 종료</option>
          <option value="KEEP">남은 주문 계속 대기</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-app-gray-500">슬리피지 초과로 미체결 시</span>
        <select
          aria-label="슬리피지 초과 정책"
          value={value.on_slippage_exceeded ?? "FAIL"}
          onChange={(e) =>
            onChange({
              ...value,
              on_slippage_exceeded: e.target.value as "FAIL" | "RETRY",
            })
          }
          className="w-full rounded-lg bg-card p-2.5"
        >
          <option value="FAIL">주문 종료</option>
          <option value="RETRY">조건 재평가 때 재시도</option>
        </select>
      </label>
    </div>
  );
}

export function OrderInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-semibold text-app-gray-500">
        {label}
      </label>
      <input
        id={id}
        type={type}
        inputMode={type === "text" ? "decimal" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="numeric min-w-0 w-full rounded-xl border border-app-gray-200 bg-card p-3 text-sm"
      />
    </div>
  );
}

export function OrderWarnings({ warnings }: { warnings?: OrderWarning[] }) {
  if (!warnings?.length) return null;
  return (
    <div
      role="status"
      className="space-y-2 rounded-xl bg-app-gray-100 p-3 text-sm text-app-red"
    >
      {warnings.map((warning, i) => (
        <p key={`${warning.code}-${i}`}>
          {warning.code === "STOP_BEYOND_LIQUIDATION"
            ? `주문은 접수됐지만 손절 전에 청산될 수 있어요.${warning.estimated_liquidation_price ? ` 예상 청산 경계 ${fmtPrice(warning.estimated_liquidation_price)} Credit.` : ""}`
            : warning.code === "LIQUIDATION_BOUNDARY_UNAVAILABLE"
              ? "주문은 접수됐지만 청산 경계를 추정하지 못했어요."
              : "주문에 위험 경고가 있어요."}{" "}
          평가 시점의 추정값이며 실행을 보장하지 않아요.
        </p>
      ))}
    </div>
  );
}
