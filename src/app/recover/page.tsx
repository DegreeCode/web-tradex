"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiError, errorMessage, postData } from "@/lib/api";
import { createPasskey, webauthnErrorMessage } from "@/lib/webauthn";
import type { CeremonyEnvelope } from "@/lib/webauthn";

export default function RecoverPage() {
  const router = useRouter();
  const { status, refresh } = useAuth();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  async function registerNewPasskey() {
    setBusy(true);
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
      toast.success("새 패스키를 등록했어요");
      refresh();
      router.replace("/");
    } catch (error) {
      toast.error(
        error instanceof ApiError ? errorMessage(error) : webauthnErrorMessage(error),
      );
    } finally {
      setBusy(false);
    }
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
              className="h-12 w-full rounded-xl bg-app-blue text-[15px] font-bold text-white hover:bg-app-blue-hover"
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
          className="mt-5 h-11 w-full rounded-xl bg-app-blue text-[14px] font-bold text-white hover:bg-app-blue-hover"
        >
          로그인으로 이동
        </Button>
      </div>
    </div>
  );
}
