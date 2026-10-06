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
import { ConfirmDialog } from "./confirm-dialog";
import {
  ErrorBlock,
  LoadMoreButton,
  OrderStatusChip,
  SkeletonRows,
} from "./primitives";
import {
  useCancelOrderGroup,
  useOrderGroup,
  useOrderGroupChildren,
} from "@/lib/advanced-order-hooks";
import { useSessionAccess } from "./session-access";
import { errorMessage } from "@/lib/api";
import { fmtCredit, fmtDeadline, fmtPrice, fmtQuantity } from "@/lib/format";
import {
  triggerGroupRoleLabel,
  triggerOrderDisplayRows,
} from "@/lib/trigger-order";

export function OrderGroupDialog({
  groupId,
  onClose,
  onSelect,
}: {
  groupId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const groupQuery = useOrderGroup(groupId);
  const group = groupQuery.data;
  const children = useOrderGroupChildren(
    groupId,
    group?.group_type === "BRACKET",
  );
  const cancel = useCancelOrderGroup();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const access = useSessionAccess(
    group?.margin_position_id ? "MARGIN" : "TRADE",
  );
  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => !next && !cancel.isPending && onClose()}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {group?.symbol}{" "}
              {group?.group_type === "BRACKET"
                ? "매수·익절·손절"
                : "익절·손절 OCO"}
            </DialogTitle>
            <DialogDescription>
              OCO는 한쪽이 체결되면 상대 주문을 취소해요. 그룹 취소는 해당
              그룹의 열린 주문과 자식 주문을 함께 취소해요.
            </DialogDescription>
          </DialogHeader>
          {groupQuery.isLoading ? (
            <SkeletonRows rows={2} />
          ) : groupQuery.isError ? (
            <ErrorBlock
              message={errorMessage(groupQuery.error)}
              onRetry={() => void groupQuery.refetch()}
            />
          ) : group ? (
            <div className="space-y-3">
              <p className="text-sm">
                {
                  {
                    ACTIVE: "대기 중",
                    CLAIMED: "한쪽 체결 후 진행 중",
                    CLOSED: "종료",
                  }[group.state]
                }
              </p>
              {group.parent_group_id ? (
                <button
                  type="button"
                  onClick={() => onSelect(group.parent_group_id!)}
                  className="text-sm font-semibold text-app-blue"
                >
                  상위 매수 그룹 보기
                </button>
              ) : null}
              <p className="text-xs text-app-gray-500">
                {group.margin_position_id
                  ? "마진 종료 주문은 추가 자산을 잠그지 않아요."
                  : "OCO 두 주문의 잠금 수량은 공유되므로 합산하지 않아요."}
              </p>
              {group.orders.map((order) => (
                <div
                  key={order.order_id}
                  className="space-y-2 rounded-xl bg-app-gray-50 p-3"
                >
                  <div className="flex justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {triggerGroupRoleLabel(order.group_role) ?? "예약 주문"}
                    </span>
                    <OrderStatusChip status={order.status} />
                  </div>
                  <p className="text-xs text-app-gray-500">
                    {order.remaining_credit !== undefined
                      ? `잔여 ${fmtCredit(order.remaining_credit)} Credit`
                      : `잔여 ${fmtQuantity(order.remaining_quantity ?? "0")}주`}
                  </p>
                  {order.trailing_ppm === undefined && order.trigger_price ? (
                    <p className="numeric text-sm">
                      {fmtPrice(order.trigger_price)} Credit{" "}
                      {order.trigger_condition === "GTE" ? "이상" : "이하"}
                    </p>
                  ) : null}
                  {order.expires_at ? (
                    <p className="text-xs text-app-gray-500">
                      {fmtDeadline(order.expires_at)}
                    </p>
                  ) : null}
                  {triggerOrderDisplayRows(order).map((row) => (
                    <div
                      key={row.key}
                      className="flex justify-between gap-3 text-xs"
                    >
                      <span className="text-app-gray-500">{row.label}</span>
                      <span className="numeric text-right break-all">
                        {row.value}
                        {row.secondary ? (
                          <span className="block text-app-gray-400">
                            {row.secondary}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              {group.group_type === "BRACKET" ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">
                    매수 체결마다 생성된 익절·손절
                  </p>
                  {children.isError ? (
                    <ErrorBlock
                      message={errorMessage(children.error)}
                      onRetry={() => void children.refetch()}
                    />
                  ) : children.isLoading ? (
                    <SkeletonRows rows={1} />
                  ) : null}
                  {children.data?.pages
                    .flatMap((page) => page.data)
                    .map((child) => (
                      <button
                        type="button"
                        key={child.group_id}
                        onClick={() => onSelect(child.group_id)}
                        className="w-full rounded-xl bg-app-gray-100 p-3 text-left text-sm"
                      >
                        {child.symbol} ·{" "}
                        {child.state === "CLOSED" ? "종료" : "진행 중"} · 자세히
                        보기
                      </button>
                    ))}
                  <LoadMoreButton
                    hasMore={children.hasNextPage}
                    loading={children.isFetchingNextPage}
                    onLoad={() => void children.fetchNextPage()}
                  />
                </div>
              ) : null}
              {group.state !== "CLOSED" ? (
                <button
                  type="button"
                  disabled={!access.allowed || cancel.isPending}
                  title={access.allowed ? undefined : access.reason}
                  onClick={() => setConfirmOpen(true)}
                  className="min-h-11 w-full rounded-xl bg-app-red font-semibold text-white disabled:opacity-50"
                >
                  그룹 전체 취소
                </button>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="주문 그룹을 취소할까요?"
        description="열린 주문과 자식 익절·손절 주문이 함께 취소돼요. 이미 체결한 내역은 유지돼요."
        confirmLabel="그룹 취소"
        pending={cancel.isPending}
        onConfirm={() => {
          if (!access.allowed || cancel.isPending) return;
          cancel.mutate(groupId, {
            onSuccess: () => {
              setConfirmOpen(false);
              toast.success("주문 그룹을 취소했어요");
            },
            onError: (error) => toast.error(errorMessage(error)),
          });
        }}
      />
    </>
  );
}
