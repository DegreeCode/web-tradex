"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { OrderAmendDialog } from "@/components/order-amend-dialog";
import { OrderGroupDialog } from "@/components/order-group-dialog";
import { accountLabel } from "@/lib/accounts";
import {
  EmptyState,
  ErrorBlock,
  LoadMoreButton,
  OrderStatusChip,
  PageHeader,
  SideBadge,
  SkeletonRows,
} from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import { errorMessage } from "@/lib/api";
import {
  fmtCredit,
  addDecimal,
  fmtDeadline,
  fmtPrice,
  fmtQuantity,
  fmtRelative,
  isPositiveDecimal,
} from "@/lib/format";
import { useAccounts, useCancelOrder, useMyTrades, useOrders } from "@/lib/hooks";
import { useSessionAccess } from "@/components/session-access";
import {
  hasTriggerOrderFields,
  triggerCancelWarning,
  triggerGroupRoleLabel,
  triggerOrderDisplayRows,
} from "@/lib/trigger-order";
import type { Order } from "@/lib/types";

type Tab = "ORDERS" | "TRADES";
type Filter = "ALL" | "PENDING" | "DONE" | "CLOSED";

const FILTER_LABEL: Record<Filter, string> = {
  ALL: "전체",
  PENDING: "예약중",
  DONE: "체결",
  CLOSED: "종료",
};

const FILTERS: Record<Filter, string | undefined> = {
  ALL: undefined,
  PENDING: "PENDING,ACTIVATED",
  DONE: "FILLED,PARTIALLY_FILLED",
  CLOSED: "CANCELED,EXPIRED,FAILED,REJECTED",
};

export default function OrdersPage() {
  const [tab, setTab] = useState<Tab>("ORDERS");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [pendingCancel, setPendingCancel] = useState<Order | null>(null);
  const [accountId, setAccountId] = useState("");
  const [amending, setAmending] = useState<Order | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const accounts = useAccounts();
  const ordersQuery = useOrders(undefined, tab === "ORDERS", { account_id: accountId || undefined, status: FILTERS[filter] });
  const tradesQuery = useMyTrades(undefined, tab === "TRADES");
  const cancelOrder = useCancelOrder();
  const tradeAccess = useSessionAccess("TRADE");
  const marginAccess = useSessionAccess("MARGIN");

  const orders = useMemo(
    () => ordersQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [ordersQuery.data],
  );
  const filteredOrders = orders;
  const trades = useMemo(
    () => tradesQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [tradesQuery.data],
  );

  const cancelingId = cancelOrder.isPending ? cancelOrder.variables : null;
  const cancelWarning = pendingCancel ? triggerCancelWarning(pendingCancel.group_role) : null;

  function handleCancel(order: Order) {
    if (cancelOrder.isPending || !(order.margin_position_id ? marginAccess : tradeAccess).allowed) return;
    cancelOrder.mutate(order.order_id, {
      onSuccess: () => {
        setPendingCancel((current) => current?.order_id === order.order_id ? null : current);
        toast.success("예약주문을 취소했어요");
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  function requestCancel(order: Order) {
    if (order.order_type === "TRIGGER" && triggerCancelWarning(order.group_role)) {
      setPendingCancel(order);
    } else {
      handleCancel(order);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="주문" subtitle="주문과 체결 내역을 확인하세요" />

      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: "ORDERS", label: "주문" },
          { value: "TRADES", label: "체결" },
        ]}
      />

      {tab === "ORDERS" ? (
        <>
          <label className="flex items-center gap-3 text-sm text-app-gray-500">주문 계좌<select aria-label="주문 계좌 필터" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="min-w-0 rounded-xl bg-card p-3"><option value="">전체 계좌</option>{accounts.data?.map((account) => <option key={account.account_id} value={account.account_id}>{accountLabel(account, accounts.data ?? [])}</option>)}</select></label>
          <div role="group" aria-label="주문 상태" className="flex gap-1.5 overflow-x-auto">
            {(Object.keys(FILTERS) as Filter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className="min-h-9 shrink-0 rounded-lg bg-card px-3 text-[12px] font-semibold text-app-gray-600 aria-pressed:bg-app-gray-900 aria-pressed:text-app-gray-50"
              >
                {FILTER_LABEL[key]}
              </button>
            ))}
          </div>

          {ordersQuery.isLoading ? (
            <SkeletonRows rows={4} />
          ) : ordersQuery.isError && orders.length === 0 ? (
            <ErrorBlock
              message={errorMessage(ordersQuery.error)}
              onRetry={() => void ordersQuery.refetch()}
            />
          ) : filteredOrders.length === 0 ? (
            <>
              <EmptyState
                title={filter === "ALL" ? "주문 내역이 없어요" : `'${FILTER_LABEL[filter]}' 주문이 없어요`}
                description={
                  filter === "ALL"
                    ? "마켓에서 첫 주문을 넣어보세요"
                    : undefined
                }
              />
              <LoadMoreButton
                hasMore={ordersQuery.hasNextPage}
                loading={ordersQuery.isFetchingNextPage}
                onLoad={() => void ordersQuery.fetchNextPage()}
                label="이전 주문 더 불러오기"
              />
            </>
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {filteredOrders.map((order) => {
                const access = order.margin_position_id ? marginAccess : tradeAccess;
                const triggerFields = hasTriggerOrderFields(order);
                const triggerRows = triggerOrderDisplayRows(order, { compact: true });
                const groupRole = order.order_type === "TRIGGER" ? triggerGroupRoleLabel(order.group_role) : null;
                const cumulative = triggerFields && (order.fill_count ?? 0) > 0;
                const hasFilledQuantity = isPositiveDecimal(order.filled_quantity);
                const hasPrincipal = isPositiveDecimal(order.principal);
                return (
                  <div
                    key={order.order_id}
                    className="rounded-2xl bg-card p-4 shadow-card"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <SideBadge side={order.side} />
                        <span className="text-[14px] font-bold text-app-gray-900">
                          {order.symbol}
                        </span>
                        {order.order_type === "TRIGGER" ? (
                          <span className="rounded-md bg-app-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-app-gray-600">
                            예약
                          </span>
                        ) : null}
                        {groupRole ? (
                          <span className="rounded-md bg-app-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-app-gray-600">
                            {groupRole}
                          </span>
                        ) : null}
                        {order.margin_position_id ? <span className="rounded-md bg-app-blue-light px-1.5 py-0.5 text-[11px] font-semibold text-app-blue">마진 {order.margin_side === "SHORT" ? "숏" : "롱"} 종료</span> : null}
                      </div>
                      <OrderStatusChip status={order.status} />
                    </div>

                    <div className="mt-2.5 space-y-1 text-[13px]">
                      {order.order_type === "TRIGGER" && !triggerRows.some((row) => row.key === "trailing") ? (
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-app-gray-500">
                            {order.trigger_condition === "GTE" ? "이상 조건" : "이하 조건"}
                          </span>
                          <span className="numeric min-w-0 break-all text-right font-semibold text-app-gray-900">
                            {fmtPrice(order.trigger_price ?? "0")}
                          </span>
                        </div>
                      ) : null}
                      {!triggerRows.some((row) => row.key === "cumulative-quantity") ? (
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-app-gray-500">
                            {hasFilledQuantity
                              ? cumulative ? "누적 체결 수량" : "체결 수량"
                              : "주문 수량"}
                          </span>
                          <span className="numeric min-w-0 break-all text-right font-semibold text-app-gray-900">
                            {fmtQuantity(
                              hasFilledQuantity
                                ? order.filled_quantity
                                : (order.requested_quantity ?? "0"),
                            )}
                            주
                          </span>
                        </div>
                      ) : null}
                      {!triggerFields || hasPrincipal ? (
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-app-gray-500">
                            {hasPrincipal ? cumulative ? "누적 체결 금액" : "체결 금액" : "주문 금액"}
                          </span>
                          <span className="numeric min-w-0 break-all text-right font-semibold text-app-gray-900">
                            {fmtCredit(
                              hasPrincipal
                                ? order.principal
                                : (order.requested_credit ?? order.max_credit_amount ?? "0"),
                              order.trigger_price ? 6 : 2,
                            )}{" "}
                            Credit
                          </span>
                        </div>
                      ) : null}
                      {isPositiveDecimal(order.average_price) ? (
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-app-gray-500">평균 체결가</span>
                          <span className="numeric min-w-0 break-all text-right font-semibold text-app-gray-900">
                            {fmtPrice(order.average_price)}
                          </span>
                        </div>
                      ) : null}
                      {triggerRows.map((row) => (
                        <div key={row.key} className="flex items-start justify-between gap-3">
                          <span className="shrink-0 text-app-gray-500">{row.label}</span>
                          <div className="min-w-0 break-all text-right">
                            <span className="numeric font-semibold text-app-gray-900">{row.value}</span>
                            {row.secondary ? (
                              <p className="text-[12px] text-app-gray-400">{row.secondary}</p>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-app-gray-100 pt-2.5">
                      <span className="text-[12px] text-app-gray-400">
                        {fmtRelative(order.created_at)}
                        {order.expires_at ? ` · ${fmtDeadline(order.expires_at)}` : ""}
                      </span>
                      <div className="flex flex-wrap gap-2">
                      {order.group_id ? <button type="button" onClick={() => setGroupId(order.group_id!)} className="min-h-9 rounded-lg bg-app-blue-light px-3 text-xs font-semibold text-app-blue">그룹 보기</button> : null}
                      {order.status === "PENDING" && order.order_type === "TRIGGER" ? <button type="button" disabled={!access.allowed || cancelOrder.isPending} title={access.allowed ? undefined : access.reason} onClick={() => setAmending(order)} className="min-h-9 rounded-lg bg-app-gray-100 px-3 text-xs font-semibold disabled:opacity-50">주문 정정</button> : null}
                      {order.status === "PENDING" ? (
                        <button
                          type="button"
                          onClick={() => requestCancel(order)}
                          disabled={!access.allowed || cancelOrder.isPending}
                          title={access.allowed ? undefined : access.reason}
                          className="min-h-9 rounded-lg bg-app-gray-100 px-3 text-[12px] font-semibold text-app-gray-700 hover:bg-app-gray-200 disabled:opacity-50"
                        >
                          {cancelingId === order.order_id ? "취소 중…" : "주문 취소"}
                        </button>
                      ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              <LoadMoreButton
                hasMore={ordersQuery.hasNextPage}
                loading={ordersQuery.isFetchingNextPage}
                onLoad={() => void ordersQuery.fetchNextPage()}
                className="xl:col-span-2"
              />
            </div>
          )}
        </>
      ) : (
        <>
          {tradesQuery.isLoading ? (
            <SkeletonRows rows={5} />
          ) : tradesQuery.isError && trades.length === 0 ? (
            <ErrorBlock message={errorMessage(tradesQuery.error)} onRetry={() => void tradesQuery.refetch()} />
          ) : trades.length === 0 ? (
            <EmptyState title="체결 내역이 없어요" description="주문이 체결되면 여기에 표시돼요" />
          ) : (
            <div className="divide-y divide-app-gray-100 rounded-2xl bg-card px-4 shadow-card">
              {trades.map((trade) => (
                <div key={trade.trade_id} className="grid min-w-0 gap-2 py-3 sm:grid-cols-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <SideBadge side={trade.side} />
                    <div className="min-w-0 break-all">
                      <p className="text-[14px] font-semibold text-app-gray-900">{trade.symbol}</p>
                      <p className="text-[12px] text-app-gray-500">
                        {fmtPrice(trade.price)} × {fmtQuantity(trade.quantity)}주
                      </p>
                    </div>
                  </div>
                  <div className="min-w-0 break-all pl-10 sm:pl-0 sm:text-right">
                    <p className="numeric text-[14px] font-bold text-app-gray-900">
                      {trade.side === "BUY" ? "-" : "+"}
                      {fmtCredit(trade.credit, 6)}
                    </p>
                    <p className="text-[11px] text-app-gray-400">{fmtRelative(trade.timestamp)}</p>
                  </div>
                </div>
              ))}
              <LoadMoreButton
                hasMore={tradesQuery.hasNextPage}
                loading={tradesQuery.isFetchingNextPage}
                onLoad={() => void tradesQuery.fetchNextPage()}
                className="shadow-none"
              />
            </div>
          )}
          {trades.length > 0 ? (
            <p className="px-1 text-[12px] text-app-gray-400">
              불러온 체결 {trades.length}건의 수수료 합계{" "}
              {fmtCredit(trades.reduce((sum, trade) => addDecimal(sum, trade.fee), "0"), 8)} Credit
            </p>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={Boolean(pendingCancel)}
        onOpenChange={(open) => !open && setPendingCancel(null)}
        title="예약주문을 취소할까요?"
        description={cancelWarning}
        confirmLabel="주문 취소"
        pendingLabel="취소 중…"
        pending={cancelOrder.isPending}
        onConfirm={() => {
          if (pendingCancel && !cancelOrder.isPending) {
            handleCancel(pendingCancel);
          }
        }}
      />
      {amending ? <OrderAmendDialog key={amending.order_id} order={amending} onClose={() => setAmending(null)} /> : null}
      {groupId ? <OrderGroupDialog key={groupId} groupId={groupId} onClose={() => setGroupId(null)} onSelect={setGroupId} /> : null}
    </div>
  );
}
