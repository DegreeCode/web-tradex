"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useCancelOrder, useOrders } from "@/lib/hooks";
import { errorMessage } from "@/lib/api";
import { fmtPrice, fmtQuantity } from "@/lib/format";
import type { MarginPosition } from "@/lib/margin";
import type { Order } from "@/lib/types";
import { ExitOrderDialog } from "../exit-order-dialog";
import { OrderAmendDialog } from "../order-amend-dialog";
import { OrderGroupDialog } from "../order-group-dialog";
import { ConfirmDialog } from "../confirm-dialog";
import { ErrorBlock, LoadMoreButton, OrderStatusChip } from "../primitives";
import { useSessionAccess } from "../session-access";

export function MarginExitOrders({ position }: { position: MarginPosition }) {
  const [creating, setCreating] = useState(false);
  const [amending, setAmending] = useState<Order | null>(null);
  const [canceling, setCanceling] = useState<Order | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const query = useOrders(50, true, {
    account_id: position.account_id,
    status: "PENDING,ACTIVATED",
  });
  const cancel = useCancelOrder();
  const access = useSessionAccess("MARGIN");
  const rows =
    query.data?.pages
      .flatMap((page) => page.data)
      .filter((order) => order.margin_position_id === position.position_id) ??
    [];
  return (
    <section className="space-y-2 rounded-xl bg-app-gray-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">익절·손절 예약</h3>
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={!access.allowed}
          title={access.allowed ? undefined : access.reason}
          className="min-h-9 rounded-lg bg-app-blue-light px-3 text-xs font-semibold text-app-blue disabled:opacity-50"
        >
          익절·손절 등록
        </button>
      </div>
      {query.isError ? (
        <ErrorBlock
          message={errorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : query.isLoading ? (
        <p className="text-xs text-app-gray-500">
          예약 주문을 확인하고 있어요…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-app-gray-500">
          불러온 주문에 이 포지션의 익절·손절이 없어요.
        </p>
      ) : null}
      {rows.map((order) => (
        <div key={order.order_id} className="space-y-2 rounded-xl bg-card p-3">
          <div className="flex justify-between gap-2 text-xs">
            <span>
              {order.trailing_ppm !== undefined
                ? `추적 ${order.trailing_ppm / 10_000}% · `
                : ""}
              {fmtPrice(order.trigger_price)}{" "}
              {order.trigger_condition === "GTE" ? "이상" : "이하"} · 잔여{" "}
              {fmtQuantity(order.remaining_quantity)}주
            </span>
            <OrderStatusChip status={order.status} />
          </div>
          <div className="flex flex-wrap gap-2">
            {order.group_id ? (
              <button
                type="button"
                onClick={() => setGroupId(order.group_id!)}
                className="min-h-8 rounded-lg bg-app-blue-light px-2 text-xs text-app-blue"
              >
                그룹 보기
              </button>
            ) : null}
            {order.status === "PENDING" ? (
              <>
                <button
                  type="button"
                  disabled={!access.allowed || cancel.isPending}
                  onClick={() => setAmending(order)}
                  className="min-h-8 rounded-lg bg-app-gray-100 px-2 text-xs disabled:opacity-50"
                >
                  정정
                </button>
                <button
                  type="button"
                  disabled={!access.allowed || cancel.isPending}
                  onClick={() => setCanceling(order)}
                  className="min-h-8 rounded-lg bg-app-gray-100 px-2 text-xs disabled:opacity-50"
                >
                  취소
                </button>
              </>
            ) : null}
          </div>
        </div>
      ))}
      <LoadMoreButton
        hasMore={query.hasNextPage}
        loading={query.isFetchingNextPage}
        onLoad={() => void query.fetchNextPage()}
        label="다른 예약 주문 더 확인"
      />
      <p className="text-xs text-app-gray-500">
        포지션 축소 시 실제 종료 수량이 줄 수 있어요. 전액 종료·청산·보관
        전환·상장폐지 시 예약도 자동 취소돼요.
      </p>
      {creating ? (
        <ExitOrderDialog
          open
          onOpenChange={setCreating}
          symbol={position.symbol}
          accountId={position.account_id}
          maxQuantity={position.quantity}
          marginPositionId={position.position_id}
          marginSide={position.side}
        />
      ) : null}
      {amending ? (
        <OrderAmendDialog
          key={amending.order_id}
          order={amending}
          onClose={() => setAmending(null)}
        />
      ) : null}
      {groupId ? (
        <OrderGroupDialog
          key={groupId}
          groupId={groupId}
          onClose={() => setGroupId(null)}
          onSelect={setGroupId}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(canceling)}
        onOpenChange={(open) => !open && setCanceling(null)}
        title="익절·손절 예약을 취소할까요?"
        description={
          canceling?.group_id
            ? "OCO 상대 주문도 함께 취소돼요. 포지션과 기존 체결은 유지돼요."
            : "포지션은 유지하고 종료 예약만 취소해요."
        }
        confirmLabel="예약 취소"
        pending={cancel.isPending}
        onConfirm={() => {
          if (!canceling || !access.allowed || cancel.isPending) return;
          cancel.mutate(canceling.order_id, {
            onSuccess: () => {
              setCanceling(null);
              toast.success("예약을 취소했어요");
            },
            onError: (error) => toast.error(errorMessage(error)),
          });
        }}
      />
    </section>
  );
}
