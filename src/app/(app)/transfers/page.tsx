"use client";

import { useMemo, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth-provider";
import {
  EmptyState,
  ErrorBlock,
  LoadMoreButton,
  PageHeader,
  SkeletonRows,
  TransferStatusChip,
} from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import { TransferDialog } from "@/components/transfer-dialog";
import { errorMessage } from "@/lib/api";
import { fmtCredit, fmtDeadline, fmtQuantity, fmtRelative, shortId } from "@/lib/format";
import { useTransferAction, useTransferDetails, useTransfers } from "@/lib/hooks";
import type { Transfer } from "@/lib/types";

type Tab = "INBOX" | "SENT" | "ALL";

interface MergedTransfer {
  base: Transfer;
  detail: Transfer | undefined;
  direction: "SENT" | "RECEIVED" | null;
}

export default function TransfersPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("INBOX");
  const [sendOpen, setSendOpen] = useState(false);
  const transfersQuery = useTransfers("mine", 50);
  const action = useTransferAction();
  const actingId = action.isPending ? action.variables?.transferId : undefined;

  const items = useMemo(
    () => transfersQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [transfersQuery.data],
  );
  // The list omits party IDs, so direction needs the detail. Pending transfers
  // need it for the inbox/sent tabs and actions; settled ones only for "ALL".
  const detailTargets = useMemo(
    () => (tab === "ALL" ? items : items.filter((item) => item.status === "PENDING")),
    [items, tab],
  );
  const details = useTransferDetails(detailTargets);

  const merged = useMemo<MergedTransfer[]>(() => {
    const detailById = new Map(
      detailTargets.map((item, index) => [item.transfer_id, details[index]?.data]),
    );
    return items.map((item) => {
      const detail = detailById.get(item.transfer_id);
      const direction = detail
        ? detail.sender_user_id === user?.user_id
          ? "SENT"
          : "RECEIVED"
        : null;
      return { base: item, detail, direction };
    });
  }, [items, details, detailTargets, user?.user_id]);

  const inbox = merged.filter(
    (entry) => entry.direction === "RECEIVED" && entry.base.status === "PENDING",
  );
  const sent = merged.filter(
    (entry) => entry.direction === "SENT" && entry.base.status === "PENDING",
  );
  const visible = tab === "INBOX" ? inbox : tab === "SENT" ? sent : merged;
  const detailsLoading = details.some((detail) => detail.isLoading);
  const detailsError = details.find((detail) => detail.isError)?.error;

  function runAction(transferId: string, kind: "acceptance" | "rejection" | "cancellation") {
    action.mutate(
      { transferId, action: kind },
      {
        onSuccess: () =>
          toast.success(
            kind === "acceptance"
              ? "송금을 수락했어요"
              : kind === "rejection"
                ? "송금을 거절했어요"
                : "송금을 취소했어요",
          ),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="송금"
        subtitle="Credit과 주식을 주고받고 요청을 처리하세요"
        action={
          <button
            type="button"
            onClick={() => setSendOpen(true)}
            className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-app-blue px-4 text-[14px] font-bold text-white hover:bg-app-blue-hover"
          >
            <Send aria-hidden="true" className="size-4" />
            송금하기
          </button>
        }
      />

      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: "INBOX", label: `받은 요청 ${inbox.length > 0 ? inbox.length : ""}`.trim() },
          { value: "SENT", label: `보낸 요청 ${sent.length > 0 ? sent.length : ""}`.trim() },
          { value: "ALL", label: "전체" },
        ]}
      />

      {transfersQuery.isError ? <ErrorBlock message={errorMessage(transfersQuery.error)} onRetry={() => void transfersQuery.refetch()} /> : null}
      {detailsError ? <ErrorBlock message={errorMessage(detailsError)} onRetry={() => { for (const detail of details) if (detail.isError) void detail.refetch(); }} /> : null}
      {transfersQuery.isLoading || (detailsLoading && visible.length === 0) ? (
        <SkeletonRows rows={4} />
      ) : visible.length === 0 && !detailsError && !transfersQuery.isError ? (
        <>
          <EmptyState
            title={
              tab === "INBOX"
                ? "처리할 요청이 없어요"
                : tab === "SENT"
                  ? "보낸 요청이 없어요"
                  : "송금 내역이 없어요"
            }
            description={
              transfersQuery.hasNextPage
                ? "이전 송금 내역을 더 불러와 확인해보세요"
                : "송금하기 버튼으로 Credit이나 주식을 보내보세요"
            }
          />
          <LoadMoreButton
            hasMore={transfersQuery.hasNextPage}
            loading={transfersQuery.isFetchingNextPage}
            onLoad={() => void transfersQuery.fetchNextPage()}
            label="이전 내역 더 불러오기"
          />
        </>
      ) : (
        <div className="grid gap-2 xl:grid-cols-2">
          {visible.map((entry) => {
            const transfer = entry.detail ?? entry.base;
            const pending = transfer.status === "PENDING";
            const incoming = entry.direction === "RECEIVED";
            return (
              <div
                key={transfer.transfer_id}
                className="rounded-2xl bg-card p-4 shadow-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 max-w-full">
                    <p className="numeric flex flex-wrap items-baseline gap-x-1 text-[17px] font-bold text-app-gray-900">
                      <span className="min-w-0 break-all">{transfer.asset === "CREDIT"
                        ? fmtCredit(transfer.amount ?? "0", 4)
                        : fmtQuantity(transfer.quantity ?? "0")}</span>
                      <span className="shrink-0">{transfer.asset === "CREDIT" ? "Credit" : "주"}</span>
                      {transfer.asset === "STOCK" ? (
                        <span className="ml-1 text-[13px] font-semibold text-app-gray-500">
                          {transfer.symbol}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[12px] text-app-gray-500">
                      {entry.direction === "SENT"
                        ? `보냄 · ${shortId(transfer.recipient_account_id)}`
                        : entry.direction === "RECEIVED"
                          ? `받음 · ${shortId(transfer.sender_account_id)}`
                          : "송금"}
                    </p>
                  </div>
                  <TransferStatusChip status={transfer.status} />
                </div>

                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-app-gray-100 pt-2.5">
                  <span className="text-[12px] text-app-gray-400">
                    {fmtRelative(transfer.created_at)}
                    {pending ? ` · ${fmtDeadline(transfer.deadline)}` : ""}
                  </span>
                  {pending && entry.direction !== null ? (
                    <div className="flex gap-1.5">
                      {incoming ? (
                        <>
                          <button
                            type="button"
                            onClick={() => runAction(transfer.transfer_id, "rejection")}
                            disabled={actingId === transfer.transfer_id}
                            className="min-h-9 rounded-lg bg-app-gray-100 px-3 text-[12px] font-semibold text-app-gray-700 hover:bg-app-gray-200 disabled:opacity-50"
                          >
                            거절
                          </button>
                          <button
                            type="button"
                            onClick={() => runAction(transfer.transfer_id, "acceptance")}
                            disabled={actingId === transfer.transfer_id}
                            className="min-h-9 rounded-lg bg-app-blue px-3 text-[12px] font-bold text-white hover:bg-app-blue-hover disabled:opacity-50"
                          >
                            수락
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => runAction(transfer.transfer_id, "cancellation")}
                          disabled={actingId === transfer.transfer_id}
                          className="min-h-9 rounded-lg bg-app-gray-100 px-3 text-[12px] font-semibold text-app-gray-700 hover:bg-app-gray-200 disabled:opacity-50"
                        >
                          취소
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          <LoadMoreButton
            hasMore={transfersQuery.hasNextPage}
            loading={transfersQuery.isFetchingNextPage}
            onLoad={() => void transfersQuery.fetchNextPage()}
            className="xl:col-span-2"
          />
        </div>
      )}

      <TransferDialog open={sendOpen} onOpenChange={setSendOpen} />
    </div>
  );
}
