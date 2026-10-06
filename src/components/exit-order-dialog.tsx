"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  OrderInput,
  OrderWarnings,
  TriggerPolicyFields,
} from "./trigger-controls";
import { ScopeNotice, useSessionAccess } from "./session-access";
import { useCreateOrderGroup } from "@/lib/advanced-order-hooks";
import { usePlaceOrder } from "@/lib/hooks";
import { buildExitOrder, type ExitOrderInput } from "@/lib/advanced-order";
import { errorMessage } from "@/lib/api";
import { compareDecimal, fmtQuantity, ppmFromPercent } from "@/lib/format";
import { slippageError, useExchangeInfo } from "@/lib/exchange-info";
import type { OrderWarning, TriggerPolicy } from "@/lib/types";

export function ExitOrderDialog({
  open,
  onOpenChange,
  symbol,
  accountId,
  maxQuantity,
  marginPositionId,
  marginSide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  accountId: string;
  maxQuantity: string;
  marginPositionId?: string;
  marginSide?: "LONG" | "SHORT";
}) {
  const [quantity, setQuantity] = useState("");
  const [mode, setMode] = useState<ExitOrderInput["mode"]>("OCO");
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [trailing, setTrailing] = useState(false);
  const [distance, setDistance] = useState("");
  const [expiry, setExpiry] = useState("");
  const [slippage, setSlippage] = useState("");
  const [policy, setPolicy] = useState<TriggerPolicy>({});
  const [warnings, setWarnings] = useState<OrderWarning[]>();
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const access = useSessionAccess(marginPositionId ? "MARGIN" : "TRADE");
  const groupMutation = useCreateOrderGroup();
  const orderMutation = usePlaceOrder();
  const exchange = useExchangeInfo();
  const pending = groupMutation.isPending || orderMutation.isPending;
  function submit() {
    if (!access.allowed || pending || submitted) return;
    setError("");
    try {
      const slipError = slippageError(slippage, exchange.data?.trade);
      if (slipError) throw new Error(slipError);
      const expires = expiry ? new Date(expiry) : null;
      if (
        expires &&
        (!Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now())
      )
        throw new Error("만료 시각은 지금 이후로 정해주세요");
      const body = buildExitOrder({
        symbol,
        account_id: accountId,
        quantity: quantity.trim(),
        mode,
        takeProfit: takeProfit.trim(),
        stopLoss: stopLoss.trim(),
        ...(trailing && mode !== "TAKE_PROFIT"
          ? { trailingPercent: distance }
          : {}),
        ...(expires ? { expires_at: expires.toISOString() } : {}),
        margin_position_id: marginPositionId,
        margin_side: marginSide,
        policy: {
          ...policy,
          ...(slippage.trim()
            ? { slippage_ppm: ppmFromPercent(slippage.trim()) }
            : {}),
        },
      });
      if (compareDecimal(quantity, maxQuantity) > 0)
        throw new Error("주문 수량이 현재 주문 가능한 수량을 넘어요");
      const options = {
        onSuccess: (data: { warnings?: OrderWarning[] }) => {
          setSubmitted(true);
          setWarnings(data.warnings);
          toast.success("익절·손절 주문을 접수했어요");
          if (!data.warnings?.length) onOpenChange(false);
        },
        onError: (err: unknown) => setError(errorMessage(err)),
      };
      if ("group_type" in body) groupMutation.mutate(body, options);
      else orderMutation.mutate(body, options);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{symbol} 익절·손절</DialogTitle>
          <DialogDescription>
            {marginPositionId
              ? `${marginSide === "SHORT" ? "숏 매수" : "롱 매도"} 종료 주문이에요. 추가 자산 잠금 없이 대기하며 실제 종료 수량은 실행 시점에 줄어들 수 있어요.`
              : "익절·손절 두 예약 매도가 수량을 한 번만 잠가요. 한쪽이 체결되면 다른 쪽은 취소돼요."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!access.allowed ? <ScopeNotice reason={access.reason} /> : null}
          {!submitted ? (
            <>
              {marginPositionId ? (
                <label className="block text-xs">
                  주문 방식
                  <select
                    value={mode}
                    onChange={(e) =>
                      setMode(e.target.value as ExitOrderInput["mode"])
                    }
                    className="mt-1 w-full rounded-xl bg-app-gray-100 p-3"
                  >
                    <option value="OCO">익절 + 손절 (OCO)</option>
                    <option value="TAKE_PROFIT">익절만</option>
                    <option value="STOP_LOSS">손절만</option>
                  </select>
                </label>
              ) : null}
              <OrderInput
                label={`주문 수량 (최대 ${fmtQuantity(maxQuantity)}주)`}
                value={quantity}
                onChange={setQuantity}
              />
              {mode !== "STOP_LOSS" ? (
                <OrderInput
                  label={`익절가 (${marginSide === "SHORT" ? "이하" : "이상"})`}
                  value={takeProfit}
                  onChange={setTakeProfit}
                />
              ) : null}
              {mode !== "TAKE_PROFIT" ? (
                <>
                  {marginPositionId ? (
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={trailing}
                        onChange={(e) => setTrailing(e.target.checked)}
                      />
                      가격을 따라가는 추적 손절
                    </label>
                  ) : null}
                  {trailing ? (
                    <OrderInput
                      label="추적 거리 (%)"
                      value={distance}
                      onChange={setDistance}
                      placeholder="0.0001~99.9999"
                    />
                  ) : (
                    <OrderInput
                      label={`손절가 (${marginSide === "SHORT" ? "이상" : "이하"})`}
                      value={stopLoss}
                      onChange={setStopLoss}
                    />
                  )}
                </>
              ) : null}
              <OrderInput
                label="만료 (선택)"
                type="datetime-local"
                value={expiry}
                onChange={setExpiry}
              />
              <OrderInput
                label="슬리피지 (%) · 비워두면 거래소 기본값"
                value={slippage}
                onChange={setSlippage}
              />
              <TriggerPolicyFields value={policy} onChange={setPolicy} />
              <p className="text-xs text-app-gray-500">
                현재 가격이 이미 조건을 만족하면 바로 실행될 수 있어요. 일부
                체결과 슬리피지 정책은 두 주문에 함께 적용돼요.
              </p>
              {error ? (
                <p role="alert" className="text-sm text-app-red">
                  {error}
                </p>
              ) : null}
              <button
                type="button"
                disabled={pending || !access.allowed}
                onClick={submit}
                className="min-h-11 w-full rounded-xl bg-app-blue font-bold text-white disabled:opacity-50"
              >
                {pending ? "등록 중…" : "익절·손절 등록"}
              </button>
            </>
          ) : null}
          <OrderWarnings warnings={warnings} />
          {submitted ? (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="min-h-11 w-full rounded-xl bg-app-gray-100 font-semibold"
            >
              확인
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
