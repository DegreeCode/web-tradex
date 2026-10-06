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
import { OrderInput } from "./trigger-controls";
import { useSessionAccess } from "./session-access";
import { useAmendOrder } from "@/lib/advanced-order-hooks";
import { buildOrderAmendment } from "@/lib/advanced-order";
import { errorMessage } from "@/lib/api";
import { ppmFromPercent } from "@/lib/format";
import { slippageError, useExchangeInfo } from "@/lib/exchange-info";
import type { Order } from "@/lib/types";

export function OrderAmendDialog({
  order,
  onClose,
}: {
  order: Order;
  onClose: () => void;
}) {
  const creditMode =
    !order.margin_position_id && order.requested_credit !== undefined;
  const [amount, setAmount] = useState(
    creditMode
      ? (order.remaining_credit ?? order.requested_credit ?? "")
      : (order.remaining_quantity ?? order.requested_quantity ?? ""),
  );
  const [price, setPrice] = useState(order.trigger_price ?? "");
  const [distance, setDistance] = useState(
    order.trailing_ppm !== undefined ? String(order.trailing_ppm / 10_000) : "",
  );
  const [slippage, setSlippage] = useState(
    order.slippage_ppm !== undefined ? String(order.slippage_ppm / 10_000) : "",
  );
  const [expiryMode, setExpiryMode] = useState<"KEEP" | "REMOVE" | "CHANGE">(
    "KEEP",
  );
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState("");
  const mutation = useAmendOrder();
  const access = useSessionAccess(
    order.margin_position_id ? "MARGIN" : "TRADE",
  );
  const exchange = useExchangeInfo();
  function submit() {
    if (!access.allowed || mutation.isPending) return;
    try {
      const slipError = slippageError(slippage, exchange.data?.trade);
      if (slipError) throw new Error(slipError);
      const body = buildOrderAmendment(order, {
        amount: amount.trim(),
        price: price.trim(),
        trailingPercent: distance.trim(),
        expiryMode,
        expiresAt: expiry,
        slippage: slippage.trim() ? ppmFromPercent(slippage.trim()) : undefined,
      });
      setError("");
      mutation.mutate(
        { orderId: order.order_id, body },
        {
          onSuccess: (data) => {
            toast.success(
              data.amended
                ? "예약주문을 정정했어요"
                : data.order.status === "EXPIRED"
                  ? "주문이 이미 만료됐어요"
                  : "변경 사항이 없어요",
            );
            onClose();
          },
          onError: (err) => setError(errorMessage(err)),
        },
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && !mutation.isPending && onClose()}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{order.symbol} 예약주문 정정</DialogTitle>
          <DialogDescription>
            금액·수량은 앞으로 체결할 새 잔여량이에요. 기존 체결은 유지돼요.
            {order.group_role === "TAKE_PROFIT" ||
            order.group_role === "STOP_LOSS"
              ? " OCO 수량·만료 변경은 상대 주문에도 적용돼요."
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <OrderInput
            label={creditMode ? "새 잔여 금액 (Credit)" : "새 잔여 수량 (주)"}
            value={amount}
            onChange={setAmount}
          />
          {order.trailing_ppm !== undefined ? (
            <OrderInput
              label="추적 거리 (%)"
              value={distance}
              onChange={setDistance}
            />
          ) : (
            <OrderInput
              label="목표 가격 (Credit)"
              value={price}
              onChange={setPrice}
            />
          )}
          <OrderInput
            label="슬리피지 (%) · 비워두면 유지"
            value={slippage}
            onChange={setSlippage}
          />
          <label className="block text-xs">
            만료
            <select
              value={expiryMode}
              onChange={(e) =>
                setExpiryMode(e.target.value as typeof expiryMode)
              }
              className="mt-1 w-full rounded-xl bg-app-gray-100 p-3"
            >
              <option value="KEEP">현재 설정 유지</option>
              <option value="REMOVE">만료 해제</option>
              <option value="CHANGE">새 만료 시각 지정</option>
            </select>
          </label>
          {expiryMode === "CHANGE" ? (
            <OrderInput
              label="새 만료 시각"
              type="datetime-local"
              value={expiry}
              onChange={setExpiry}
            />
          ) : null}
          <p className="text-xs text-app-gray-500">
            가격 변경·잔여량 증가에 따라 자산이 추가로 잠기거나 체결 순서가 뒤로
            이동할 수 있어요.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-app-red">
              {error}
              <button
                type="button"
                onClick={onClose}
                className="ml-2 font-semibold text-app-blue"
              >
                닫고 최신 주문 확인
              </button>
            </p>
          ) : null}
          <button
            type="button"
            disabled={mutation.isPending || !access.allowed}
            title={access.allowed ? undefined : access.reason}
            onClick={submit}
            className="min-h-11 w-full rounded-xl bg-app-blue font-bold text-white disabled:opacity-50"
          >
            {mutation.isPending ? "정정 중…" : "주문 정정"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
