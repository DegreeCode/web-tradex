"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

import { RecoveryKeyGrid } from "@/components/recovery-keys";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiError, errorMessage, postData } from "@/lib/api";
import { createPasskey, webauthnErrorMessage } from "@/lib/webauthn";
import type { CeremonyEnvelope } from "@/lib/webauthn";
import { completePasskeyRegistration, type PasskeyRegistrationResult } from "../auth-contract";

export default function RecoverPage() {
  const router = useRouter();
  const { status, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [recoveryKeys, setRecoveryKeys] = useState<string[] | null>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && !recoveryKeys) router.replace("/");
  }, [status, router, recoveryKeys]);

  function finish() {
    router.replace("/");
  }

  async function registerNewPasskey() {
    if (busy) return;
    setBusy(true);
    try {
      const options = await postData<CeremonyEnvelope<PublicKeyCredentialCreationOptionsJSON>>(
        "/api/v1/me/passkeys/registration-options",
        {},
      );
      const registration = await createPasskey(options);
      const result = await postData<PasskeyRegistrationResult>("/api/v1/me/passkeys", {
        ceremony_id: registration.ceremonyId,
        credential: registration.credential,
      });
      toast.success("새 패스키를 등록했어요");
      refresh();
      completePasskeyRegistration(result, setRecoveryKeys, finish);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? errorMessage(error) : webauthnErrorMessage(error),
      );
    } finally {
      setBusy(false);
    }
  }

  if (recoveryKeys) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-5 text-center">
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-app-gray-900">
              복구키를 안전하게 보관해주세요
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-app-gray-500">
              이 화면을 벗어나면 다시 볼 수 없어요. 패스키를 잃어버렸을 때 복구키 중 하나로
              계정을 되찾을 수 있어요.
            </p>
          </div>
          <div className="rounded-2xl bg-card p-5 shadow-card">
            <RecoveryKeyGrid keys={recoveryKeys} />
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[13px] text-app-gray-700">
              <input
                type="checkbox"
                checked={savedConfirmed}
                onChange={(event) => setSavedConfirmed(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-app-blue"
              />
              복구키를 안전한 곳에 저장했어요
            </label>
            <Button
              type="button"
              onClick={finish}
              disabled={!savedConfirmed}
              className="mt-4 h-12 w-full rounded-xl bg-app-blue text-[15px] font-bold text-white hover:bg-app-blue-hover disabled:opacity-40 pressable"
            >
              시작하기
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px] text-center">
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-app-gray-900">
            계정 복구
          </h1>
          <p role="status" className="mt-2 text-[14px] text-app-gray-500">
            복구 상태를 확인하고 있어요…
          </p>
        </div>
      </div>
    );
  }

  if (status === "recovery") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-6 text-center">
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-app-gray-900">
              복구 모드
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-app-gray-500">
              본인 확인이 완료됐어요. 새 패스키를 등록하면 계정이 활성화되고 로그인됩니다.
            </p>
          </div>
          <div className="rounded-2xl bg-card p-5 shadow-card">
            <Alert className="mb-4 border-0 bg-app-orange-light text-app-orange">
              <AlertTitle>복구 모드는 제한돼 있어요</AlertTitle>
              <AlertDescription className="text-app-orange/90">
                패스키 등록만 가능하며, 송금·거래·복구키 재발급은 새로 로그인한 뒤에 할 수
                있어요.
              </AlertDescription>
            </Alert>
            <Button
              type="button"
              onClick={registerNewPasskey}
              disabled={busy}
              className="h-12 w-full rounded-xl bg-app-blue text-[15px] font-bold text-white hover:bg-app-blue-hover pressable"
            >
              {busy ? "패스키 생성 중…" : "새 패스키 등록하기"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-[400px] text-center">
        <h1 className="text-[20px] font-bold tracking-[-0.02em] text-app-gray-900">
          복구 모드가 아니에요
        </h1>
        <p className="mt-2 text-[14px] text-app-gray-500">
          로그인 화면에서 복구키를 입력해 복구 모드로 전환해주세요.
        </p>
        <Button
          render={<Link href="/login" prefetch={false} />}
          className="mt-5 h-11 w-full rounded-xl bg-app-blue text-[14px] font-bold text-white hover:bg-app-blue-hover pressable"
        >
          로그인으로 이동
        </Button>
      </div>
    </div>
  );
}
