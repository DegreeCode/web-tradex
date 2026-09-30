"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  EmptyState,
  ErrorBlock,
  OrderStatusChip,
  SideBadge,
  SkeletonRows,
} from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import { errorMessage } from "@/lib/api";
import {
  fmtCredit,
  fmtDeadline,
  fmtPrice,
  fmtQuantity,
  fmtRelative,
  fmtSigned,
  toNumber,
} from "@/lib/format";
import { useCancelOrder, useMyTrades, useOrders } from "@/lib/hooks";
import type { Order, OrderStatus } from "@/lib/types";

type Tab = "ORDERS" | "TRADES";
type Filter = "ALL" | "PENDING" | "DONE" | "CLOSED";

const FILTERS: Record<Filter, (status: OrderStatus) => boolean> = {
  ALL: () => true,
  PENDING: (status) => status === "PENDING" || status === "ACTIVATED",
  DONE: (status) => status === "FILLED" || status === "PARTIALLY_FILLED",
  CLOSED: (status) =>
    status === "CANCELED" || status === "EXPIRED" || status === "FAILED" || status === "REJECTED",
};

export default function OrdersPage() {
  const [tab, setTab] = useState<Tab>("ORDERS");
  const [filter, setFilter] = useState<Filter>("ALL");
  const ordersQuery = useOrders(undefined, tab === "ORDERS");
  const tradesQuery = useMyTrades(undefined, tab === "TRADES");
  const cancelOrder = useCancelOrder();

  const orders = useMemo(
    () => ordersQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [ordersQuery.data],
  );
  const filteredOrders = useMemo(
    () => orders.filter((order) => FILTERS[filter](order.status)),
    [orders, filter],
  );
  const trades = useMemo(
    () => tradesQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [tradesQuery.data],
  );

  function handleCancel(order: Order) {
    cancelOrder.mutate(order.order_id, {
      onSuccess: () => toast.success("예약주문을 취소했어요"),
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-[-0.03em] text-app-gray-900">주문</h1>
        <p className="mt-1 text-[13px] text-app-gray-500">주문과 체결 내역을 확인하세요</p>
      </div>

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
          <div className="flex gap-1.5 overflow-x-auto">
            {(Object.keys(FILTERS) as Filter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={
                  filter === key
                    ? "shrink-0 rounded-lg bg-app-gray-900 px-3 py-1.5 text-[12px] font-semibold text-app-gray-50"
                    : "shrink-0 rounded-lg bg-card px-3 py-1.5 text-[12px] font-semibold text-app-gray-600"
                }
              >
                {key === "ALL" ? "전체" : key === "PENDING" ? "예약중" : key === "DONE" ? "체결" : "종료"}
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
            <EmptyState
              title="주문 내역이 없어요"
              description="마켓에서 첫 주문을 넣어보세요"
            />
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {filteredOrders.map((order) => (
                <div
                  key={order.order_id}
                  className="rounded-2xl bg-card p-4 shadow-[0_1px_2px_0_rgba(25,31,40,0.03)]"
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
                    </div>
                    <OrderStatusChip status={order.status} />
                  </div>

                  <div className="mt-2.5 space-y-1 text-[13px]">
                    {order.order_type === "TRIGGER" ? (
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-app-gray-500">
                          {order.trigger_condition === "GTE" ? "이상 조건" : "이하 조건"}
                        </span>
                        <span className="numeric min-w-0 break-all text-right font-semibold text-app-gray-900">
                          {fmtPrice(order.trigger_price ?? "0")}
                        </span>
                      </div>
                    ) : null}
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-app-gray-500">
                        {order.filled_quantity && toNumber(order.filled_quantity) > 0
                          ? "체결 수량"
                          : "주문 수량"}
                      </span>
                      <span className="numeric min-w-0 break-all text-right font-semibold text-app-gray-900">
                        {fmtQuantity(
                          toNumber(order.filled_quantity) > 0
                            ? order.filled_quantity
                            : (order.requested_quantity ?? "0"),
                        )}
                        주
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-app-gray-500">
                        {toNumber(order.principal) > 0 ? "체결 금액" : "주문 금액"}
                      </span>
                      <span className="numeric min-w-0 break-all text-right font-semibold text-app-gray-900">
                        {fmtCredit(
                          toNumber(order.principal) > 0
                            ? order.principal
                            : (order.requested_credit ?? order.max_credit_amount ?? "0"),
                          order.trigger_price ? 6 : 2,
                        )}{" "}
                        Credit
                      </span>
                    </div>
                    {toNumber(order.average_price) > 0 ? (
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-app-gray-500">평균 체결가</span>
                        <span className="numeric min-w-0 break-all text-right font-semibold text-app-gray-900">
                          {fmtPrice(order.average_price)}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-app-gray-100 pt-2.5">
                    <span className="text-[12px] text-app-gray-400">
                      {fmtRelative(order.created_at)}
                      {order.expires_at ? ` · ${fmtDeadline(order.expires_at)}` : ""}
                    </span>
                    {order.status === "PENDING" ? (
                      <button
                        type="button"
                        onClick={() => handleCancel(order)}
                        disabled={cancelOrder.isPending}
                        className="rounded-lg bg-app-gray-100 px-3 py-1.5 text-[12px] font-semibold text-app-gray-700 hover:bg-app-gray-200 disabled:opacity-50"
                      >
                        주문 취소
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              {ordersQuery.hasNextPage ? (
                <button
                  type="button"
                  onClick={() => void ordersQuery.fetchNextPage()}
                  disabled={ordersQuery.isFetchingNextPage}
                  className="h-11 w-full rounded-xl bg-card text-[13px] font-semibold text-app-gray-600 shadow-[0_1px_2px_0_rgba(25,31,40,0.03)]"
                >
                  {ordersQuery.isFetchingNextPage ? "불러오는 중…" : "더보기"}
                </button>
              ) : null}
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
            <div className="divide-y divide-app-gray-100 rounded-2xl bg-card px-4 shadow-[0_1px_2px_0_rgba(25,31,40,0.03)]">
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
              {tradesQuery.hasNextPage ? (
                <button
                  type="button"
                  onClick={() => void tradesQuery.fetchNextPage()}
                  className="h-11 w-full text-[13px] font-semibold text-app-gray-500"
                >
                  더보기
                </button>
              ) : null}
            </div>
          )}
          {trades.length > 0 ? (
            <p className="px-1 text-[12px] text-app-gray-400">
              합계 손익 참고: {fmtSigned(trades.reduce((sum, trade) => sum + toNumber(trade.fee), 0), 6)}{" "}
              Credit 수수료
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
