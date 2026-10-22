"use client";

import { useLayoutEffect, useRef, useState } from "react";
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
import { useAmendOrder, useOrder, useOrderRetry } from "@/lib/advanced-order-hooks";
import {
  buildOrderAmendment,
  orderAmendValues,
  rebaseAmendForm,
  type AmendFormValues,
} from "@/lib/advanced-order";
import { ApiError, errorMessage } from "@/lib/api";
import { ppmFromPercent } from "@/lib/format";
import { slippageError, useExchangeInfo } from "@/lib/exchange-info";
import type { Order, OrderAmendment } from "@/lib/types";

interface AmendForm {
  base: Order;
  values: AmendFormValues;
  notice: string;
}

function orderStatusNotice(status: Order["status"]): string {
  switch (status) {
    case "PENDING":
      return "";
    case "ACTIVATED":
      return "지금 체결되고 있어서 잠깐 정정할 수 없어요. 체결이 멈추면 바로 정정할 수 있어요.";
    case "FILLED":
      return "주문이 모두 체결됐어요.";
    case "CANCELED":
      return "주문이 취소됐어요.";
    case "EXPIRED":
      return "주문이 만료됐어요.";
    case "FAILED":
      return "주문 체결에 실패했어요.";
    case "REJECTED":
      return "주문이 거절됐어요.";
    case "PARTIALLY_FILLED":
      return "주문이 일부 체결된 뒤 종료됐어요.";
    default:
      return "주문이 종료돼 정정할 수 없어요.";
  }
}

export function OrderAmendDialog({
  order,
  onClose,
}: {
  order: Order;
  onClose: () => void;
}) {
  const orderQuery = useOrder(order.order_id, order);
  const live = orderQuery.data ?? order;
  const [seenOrder, setSeenOrder] = useState(live);
  const [form, setForm] = useState<AmendForm>(() =>
    rebaseAmendForm(order, live, orderAmendValues(order)),
  );
  const latestForm = useRef(form);
  useLayoutEffect(() => {
    latestForm.current = form;
  }, [form]);
  // Adjust before committing the render so fields and revision always agree.
  if (seenOrder !== live) {
    setSeenOrder(live);
    setForm((current) => {
      const synced = rebaseAmendForm(current.base, live, current.values);
      return { ...synced, notice: synced.notice || current.notice };
    });
  }
  const { base, values } = form;
  const creditMode =
    !base.margin_position_id && base.requested_credit !== undefined;
  const [expiryMode, setExpiryMode] = useState<"KEEP" | "REMOVE" | "CHANGE">(
    "KEEP",
  );
  const [expiry, setExpiry] = useState("");
  // Live rebases update the displayed values, but do not create a new intent.
  const [editVersion, setEditVersion] = useState(0);
  const retry = useOrderRetry<{ orderId: string; body: OrderAmendment }>({
    orderId: base.order_id, accountId: base.account_id, symbol: base.symbol,
    editVersion, expiryMode, expiry,
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const mutation = useAmendOrder();
  const access = useSessionAccess(
    base.margin_position_id ? "MARGIN" : "TRADE",
  );
  const exchange = useExchangeInfo();
  const executing = base.status === "ACTIVATED";
  const terminal = base.status !== "PENDING" && !executing;
  const closeOnly = terminal && !retry.hasPayload;
  const canAmend = retry.hasPayload || base.status === "PENDING";
  const statusNotice = orderStatusNotice(base.status);

  function setValue(field: keyof AmendFormValues, value: string) {
    setEditVersion((version) => version + 1);
    setForm((current) => ({
      ...current,
      values: { ...current.values, [field]: value },
    }));
  }

  async function submit() {
    if (
      !access.allowed ||
      submitting ||
      mutation.isPending ||
      (!retry.hasPayload && base.status !== "PENDING")
    )
      return;
    const amountEdited = values.amount !== orderAmendValues(base).amount;
    async function amend(current: AmendForm) {
      const request = retry.prepare(() => {
        const { values } = current;
        const slipError = slippageError(values.slippage, exchange.data?.trade);
        if (slipError) throw new Error(slipError);
        const body = buildOrderAmendment(current.base, {
          amount: values.amount.trim(),
          price: values.price.trim(),
          trailingPercent: values.trailingPercent.trim(),
          expiryMode,
          expiresAt: expiry,
          slippage: values.slippage.trim()
            ? ppmFromPercent(values.slippage.trim())
            : undefined,
        });
        return { orderId: current.base.order_id, body };
      });
      try {
        const data = await mutation.mutateAsync(request);
        retry.success(request);
        return data;
      } catch (error) {
        retry.failure(request, error);
        throw error;
      }
    }
    async function syncConflict(err: unknown) {
      if (
        !(err instanceof ApiError) ||
        !["ORDER_REVISION_CONFLICT", "ORDER_NOT_AMENDABLE"].includes(err.code)
      )
        throw err;
      const result = await orderQuery.refetch({ throwOnError: true });
      const updated = result.data;
      if (!updated) throw new Error("최신 주문 정보를 확인하지 못했어요");
      // Live updates may have rebased the displayed fields during the request.
      const current = latestForm.current;
      const synced = rebaseAmendForm(current.base, updated, current.values);
      const notice =
        synced.notice ||
        (amountEdited
          ? "최신 주문 정보를 확인했어요. 입력한 값은 그대로 뒀어요. 확인 후 정정해주세요."
          : "최신 주문 정보를 확인했어요. 입력값을 확인 후 다시 정정해주세요.");
      const next = { ...synced, notice };
      latestForm.current = next;
      setForm(next);
      return next;
    }
    setError("");
    setSubmitting(true);
    try {
      let data;
      try {
        data = await amend(form);
      } catch (err) {
        const synced = await syncConflict(err);
        if (synced.base.status !== "PENDING" || amountEdited) return;
        try {
          data = await amend(synced);
        } catch (retryError) {
          await syncConflict(retryError);
          return;
        }
      }
      toast.success(
        data.amended
          ? "예약주문을 정정했어요"
          : data.order.status === "EXPIRED"
            ? "주문이 이미 만료됐어요"
            : "변경 사항이 없어요",
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && !submitting && onClose()}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{base.symbol} 예약주문 정정</DialogTitle>
          <DialogDescription>
            금액·수량은 앞으로 체결할 새 잔여량이에요. 기존 체결은 유지돼요.
            {base.group_role === "TAKE_PROFIT" ||
            base.group_role === "STOP_LOSS"
              ? " OCO 수량·만료 변경은 상대 주문에도 적용돼요."
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <fieldset
            disabled={terminal || submitting}
            className="min-w-0 space-y-3 disabled:opacity-60"
          >
            <OrderInput
              label={creditMode ? "새 잔여 금액 (Credit)" : "새 잔여 수량 (주)"}
              value={values.amount}
              onChange={(value) => setValue("amount", value)}
            />
            {base.trailing_ppm !== undefined ? (
              <OrderInput
                label="추적 거리 (%)"
                value={values.trailingPercent}
                onChange={(value) => setValue("trailingPercent", value)}
              />
            ) : (
              <OrderInput
                label="목표 가격 (Credit)"
                value={values.price}
                onChange={(value) => setValue("price", value)}
              />
            )}
            <OrderInput
              label="슬리피지 (%) · 비워두면 유지"
              value={values.slippage}
              onChange={(value) => setValue("slippage", value)}
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
          </fieldset>
          <p className="text-xs text-app-gray-500">
            가격 변경·잔여량 증가에 따라 자산이 추가로 잠기거나 체결 순서가 뒤로
            이동할 수 있어요.
          </p>
          {statusNotice || form.notice ? (
            <div
              role="status"
              aria-live="polite"
              className="space-y-1 rounded-xl bg-app-blue/5 p-3 text-sm text-app-blue"
            >
              {form.notice && !terminal ? <p>{form.notice}</p> : null}
              {statusNotice ? <p>{statusNotice}</p> : null}
            </div>
          ) : null}
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
            disabled={submitting || (!closeOnly && (!canAmend || !access.allowed))}
            title={closeOnly || access.allowed ? undefined : access.reason}
            onClick={closeOnly ? onClose : submit}
            className="min-h-11 w-full rounded-xl bg-app-blue font-bold text-white disabled:opacity-50"
          >
            {submitting
              ? "정정 중…"
              : retry.hasPayload
                ? "같은 내용으로 다시 정정"
                : terminal
                  ? "닫기"
                  : executing
                    ? "체결 중…"
                    : "주문 정정"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
