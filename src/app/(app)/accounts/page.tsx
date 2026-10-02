"use client";

import { useState } from "react";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, ErrorBlock, PageHeader, SkeletonRows, Surface } from "@/components/primitives";
import { ScopeNotice, useSessionAccess } from "@/components/session-access";
import { accountLabel } from "@/lib/accounts";
import { errorMessage } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { fmtCredit, fmtDate } from "@/lib/format";
import { useAccounts, useCreateAccount, useDeleteAccount } from "@/lib/hooks";

export default function AccountsPage() {
  const accountsQuery = useAccounts();
  const createAccount = useCreateAccount();
  const deleteAccount = useDeleteAccount();
  // Opening or closing accounts is account management, kept to passkey sessions.
  const manageAccess = useSessionAccess("FULL");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const accounts = accountsQuery.data ?? [];

  async function copyId(accountId: string) {
    if (!(await copyToClipboard(accountId, "계좌 ID를 복사했어요"))) return;
    setCopiedId(accountId);
    setTimeout(() => setCopiedId((current) => (current === accountId ? null : current)), 2000);
  }

  function handleCreate() {
    createAccount.mutate(undefined, {
      onSuccess: () => toast.success("새 계좌를 만들었어요"),
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  function handleDelete() {
    if (!pendingDelete) return;
    deleteAccount.mutate(pendingDelete, {
      onSuccess: () => {
        toast.success("계좌를 삭제했어요");
        setPendingDelete(null);
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="계좌"
        subtitle="계좌 ID를 상대방에게 알려주면 송금을 받을 수 있어요"
        action={
          manageAccess.allowed ? (
            <button
              type="button"
              onClick={handleCreate}
              disabled={createAccount.isPending}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-app-blue px-3.5 text-[14px] font-bold text-white hover:bg-app-blue-hover disabled:opacity-50"
            >
              <Plus aria-hidden="true" className="size-4" />
              {createAccount.isPending ? "만드는 중…" : "계좌 추가"}
            </button>
          ) : null
        }
      />

      {manageAccess.allowed ? null : <ScopeNotice reason={`계좌 추가·삭제는 ${manageAccess.reason}`} />}

      {accountsQuery.isError ? <ErrorBlock message={errorMessage(accountsQuery.error)} onRetry={() => void accountsQuery.refetch()} /> : null}
      {accountsQuery.isLoading ? (
        <SkeletonRows rows={2} />
      ) : accounts.length === 0 && !accountsQuery.isError ? (
        <EmptyState title="계좌가 없어요" description="계좌를 추가해보세요" />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {accounts.map((account) => (
            <Surface key={account.account_id} className="min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-[14px] font-bold text-app-gray-900">{accountLabel(account, accounts)}</h2>
                  {account.is_primary ? (
                    <span className="rounded-md bg-app-blue-light px-1.5 py-0.5 text-[11px] font-semibold text-app-blue-dark">
                      기본
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => copyId(account.account_id)}
                  className="flex min-h-8 items-center gap-1 rounded-lg bg-app-gray-100 px-2.5 text-[11px] font-semibold text-app-gray-600 hover:bg-app-gray-200"
                >
                  {copiedId === account.account_id ? (
                    <Check aria-hidden="true" className="size-3" />
                  ) : (
                    <Copy aria-hidden="true" className="size-3" />
                  )}
                  ID 복사
                </button>
              </div>

              <p className="numeric mt-3 break-all text-[clamp(1.25rem,6vw,1.5rem)] font-extrabold tracking-[-0.02em] text-app-gray-900">
                {fmtCredit(account.total_credit, 2)}
                <span className="ml-1 text-[13px] font-bold text-app-gray-500">Credit</span>
              </p>

              <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl bg-app-gray-50 p-3 min-[430px]:grid-cols-2">
                <div>
                  <p className="text-[12px] text-app-gray-500">사용 가능</p>
                  <p className="numeric mt-0.5 break-all text-[13px] font-semibold text-app-gray-900">
                    {fmtCredit(account.available_credit, 2)}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] text-app-gray-500">잠금</p>
                  <p className="numeric mt-0.5 break-all text-[13px] font-semibold text-app-gray-900">
                    {fmtCredit(account.locked_credit, 2)}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-start justify-between gap-2">
                <p className="min-w-0 break-all text-[11px] text-app-gray-400">
                  {account.account_id} · {fmtDate(account.created_at)} 개설
                </p>
                {!account.is_primary && manageAccess.allowed ? (
                  <button
                    type="button"
                    onClick={() => setPendingDelete(account.account_id)}
                    className="flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-app-red hover:bg-app-red-light"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                    삭제
                  </button>
                ) : null}
              </div>
            </Surface>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="계좌를 삭제할까요?"
        description="잔액이나 보유 주식이 남아 있으면 삭제할 수 없어요. 삭제한 계좌는 되돌릴 수 없어요."
        confirmLabel="삭제"
        pendingLabel="삭제 중…"
        pending={deleteAccount.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
