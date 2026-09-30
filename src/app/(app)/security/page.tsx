"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RecoveryKeyGrid } from "@/components/recovery-keys";
import { ErrorBlock, SkeletonRows, Surface } from "@/components/primitives";
import { ApiError, errorMessage, postData } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtRelative, shortId } from "@/lib/format";
import {
  useDeletePasskey,
  useLogout,
  usePasskeys,
  useRevokeAllSessions,
  useRevokeSessions,
  useRotateRecoveryKeys,
  useSessions,
} from "@/lib/hooks";
import { createPasskey, webauthnErrorMessage } from "@/lib/webauthn";
import type { CeremonyEnvelope } from "@/lib/webauthn";

export default function SecurityPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const passkeys = usePasskeys();
  const sessions = useSessions();
  const deletePasskey = useDeletePasskey();
  const revokeSessions = useRevokeSessions();
  const revokeAll = useRevokeAllSessions();
  const rotate = useRotateRecoveryKeys();
  const logout = useLogout();

  const [addBusy, setAddBusy] = useState(false);
  const [recoveryKeys, setRecoveryKeys] = useState<string[] | null>(null);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);

  async function handleAddPasskey() {
    setAddBusy(true);
    try {
      const options = await postData<CeremonyEnvelope<PublicKeyCredentialCreationOptionsJSON>>(
        "/api/v1/me/passkeys/registration-options",
        {},
      );
      const registration = await createPasskey(options);
      await postData("/api/v1/me/passkeys", {
        ceremony_id: registration.ceremonyId,
        credential: registration.credential,
      });
      toast.success("패스키를 추가했어요");
      void passkeys.refetch();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? errorMessage(error) : webauthnErrorMessage(error),
      );
    } finally {
      setAddBusy(false);
    }
  }

  function handleRotate() {
    rotate.mutate(undefined, {
      onSuccess: (result) => setRecoveryKeys(result.recovery_keys),
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  function handleLogout() {
    logout.mutate(undefined, {
      onSettled: () => {
        router.replace("/login");
      },
    });
  }

  function handleSessionExpired() {
    queryClient.setQueryData(["me"], null);
    router.replace("/login");
  }

  const sessionRows = sessions.data?.sessions ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-[-0.03em] text-app-gray-900">보안</h1>
        <p className="mt-1 text-[13px] text-app-gray-500">
          패스키와 로그인 세션, 복구키를 관리하세요
        </p>
      </div>

      <Surface>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-app-blue" />
            <h2 className="text-[16px] font-bold text-app-gray-900">패스키</h2>
          </div>
          <button
            type="button"
            onClick={handleAddPasskey}
            disabled={addBusy}
            className="flex h-9 items-center gap-1 rounded-xl bg-app-gray-100 px-3 text-[13px] font-semibold text-app-gray-700 hover:bg-app-gray-200 disabled:opacity-50"
          >
            <Plus className="size-3.5" />
            {addBusy ? "등록 중…" : "추가"}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {passkeys.isError ? (
            <ErrorBlock message={errorMessage(passkeys.error)} onRetry={() => void passkeys.refetch()} />
          ) : null}
          {passkeys.isLoading ? (
            <SkeletonRows rows={1} />
          ) : !passkeys.data ? null : passkeys.data.length === 0 ? (
            <p className="text-[13px] text-app-gray-500">등록된 패스키가 없어요</p>
          ) : (
            (passkeys.data ?? []).map((passkey) => (
              <div
                key={passkey.passkey_id}
                className="flex items-center justify-between gap-2 rounded-xl bg-app-gray-50 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <KeyRound className="size-4 shrink-0 text-app-gray-500" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-app-gray-900">
                      {fmtDate(passkey.created_at)} 등록
                    </p>
                    <p className="text-[11px] text-app-gray-500">
                      {passkey.last_used_at
                        ? `최근 사용 ${fmtRelative(passkey.last_used_at)}`
                        : "사용 기록 없음"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    deletePasskey.mutate(passkey.passkey_id, {
                      onSuccess: () => toast.success("패스키를 삭제했어요"),
                      onError: (error) => toast.error(errorMessage(error)),
                    })
                  }
                  disabled={deletePasskey.isPending}
                  className="shrink-0 rounded-lg p-2 text-app-gray-400 hover:bg-card hover:text-app-red disabled:opacity-50"
                  aria-label="패스키 삭제"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </Surface>

      <Surface>
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-app-gray-900">로그인 세션</h2>
          <button
            type="button"
            onClick={() => setConfirmRevokeAll(true)}
            className="text-[13px] font-semibold text-app-gray-500"
          >
            전체 로그아웃
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {sessions.isError ? (
            <ErrorBlock message={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
          ) : null}
          {sessions.isLoading ? (
            <SkeletonRows rows={2} />
          ) : !sessions.data ? null : sessionRows.length === 0 ? (
            <p className="text-[13px] text-app-gray-500">활성 세션이 없어요</p>
          ) : (
            sessionRows.map((session) => (
              <div
                key={session.session_id}
                className="flex items-center justify-between gap-2 rounded-xl bg-app-gray-50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[13px] font-semibold text-app-gray-900">
                      {session.is_current ? "현재 기기" : shortId(session.session_id)}
                    </p>
                    {session.scope === "RECOVERY" ? (
                      <span className="rounded-md bg-app-orange-light px-1.5 py-0.5 text-[10px] font-semibold text-app-orange">
                        복구 모드
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-app-gray-500">
                    최근 활동 {fmtRelative(session.last_seen_at)} · 만료 {fmtDateTime(session.expires_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    revokeSessions.mutate([session.session_id], {
                      onSuccess: (result) =>
                        result.current_revoked
                          ? handleSessionExpired()
                          : toast.success("세션을 해지했어요"),
                      onError: (error) => toast.error(errorMessage(error)),
                    })
                  }
                  disabled={revokeSessions.isPending}
                  className="shrink-0 rounded-lg bg-card px-2.5 py-1.5 text-[12px] font-semibold text-app-gray-700 hover:bg-app-gray-100 disabled:opacity-50"
                >
                  로그아웃
                </button>
              </div>
            ))
          )}
        </div>
      </Surface>

      <Surface>
        <h2 className="text-[16px] font-bold text-app-gray-900">복구키</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-app-gray-500">
          복구키를 재발급하면 기존 복구키는 모두 사용할 수 없게 돼요. 새 복구키 8개를 안전한
          곳에 저장해주세요.
        </p>
        <button
          type="button"
          onClick={handleRotate}
          disabled={rotate.isPending}
          className="mt-3 h-11 w-full rounded-xl bg-app-gray-100 text-[14px] font-bold text-app-gray-800 hover:bg-app-gray-200 disabled:opacity-50"
        >
          {rotate.isPending ? "재발급 중…" : "복구키 재발급"}
        </button>
      </Surface>

      <Surface>
        <h2 className="text-[16px] font-bold text-app-gray-900">로그아웃</h2>
        <p className="mt-1.5 text-[13px] text-app-gray-500">
          현재 기기에서 로그아웃하고 로그인 화면으로 이동해요.
        </p>
        <button
          type="button"
          onClick={handleLogout}
          disabled={logout.isPending}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-app-red-light text-[14px] font-bold text-app-red hover:opacity-90 disabled:opacity-50"
        >
          <LogOut className="size-4" />
          {logout.isPending ? "로그아웃 중…" : "로그아웃"}
        </button>
      </Surface>

      <Dialog open={Boolean(recoveryKeys)} onOpenChange={(open) => !open && setRecoveryKeys(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>새 복구키가 발급됐어요</DialogTitle>
            <DialogDescription>
              이 화면을 닫으면 다시 볼 수 없어요. 지금 안전한 곳에 저장해주세요.
            </DialogDescription>
          </DialogHeader>
          {recoveryKeys ? <RecoveryKeyGrid keys={recoveryKeys} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRevokeAll} onOpenChange={setConfirmRevokeAll}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>모든 기기에서 로그아웃할까요?</DialogTitle>
            <DialogDescription>
              현재 기기를 포함한 모든 세션이 해지돼요. 다시 패스키로 로그인해야 해요.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmRevokeAll(false)}
              className="h-11 flex-1 rounded-xl bg-app-gray-100 text-[14px] font-semibold text-app-gray-700"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() =>
                revokeAll.mutate(undefined, {
                  onSuccess: () => {
                    handleSessionExpired();
                  },
                  onError: (error) => toast.error(errorMessage(error)),
                })
              }
              disabled={revokeAll.isPending}
              className="h-11 flex-1 rounded-xl bg-app-red text-[14px] font-bold text-white disabled:opacity-50"
            >
              {revokeAll.isPending ? "처리 중…" : "전체 로그아웃"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
