"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

import { useAuth } from "@/components/auth-provider";
import { ApiError, errorMessage, postData } from "@/lib/api";
import { getPasskeyAssertion, supportsPasskeys, webauthnErrorMessage } from "@/lib/webauthn";
import type { CeremonyEnvelope } from "@/lib/webauthn";
import type { User } from "@/lib/types";
import { SiteDisclaimer } from "@/components/site-disclaimer";
import { safeRedirectPath } from "@/lib/routes";

function LoginScreen() {
  const router = useRouter();
  const { status, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [recovering, setRecovering] = useState(false);

  const next =
    typeof window === "undefined"
      ? "/"
      : safeRedirectPath(new URLSearchParams(window.location.search).get("next"));

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
    if (status === "recovery") router.replace("/recover");
  }, [status, router, next]);

  async function handleLogin() {
    if (!supportsPasskeys()) {
      toast.error("이 브라우저에서는 패스키를 사용할 수 없어요");
      return;
    }
    setBusy(true);
    try {
      const options = await postData<CeremonyEnvelope<PublicKeyCredentialRequestOptionsJSON>>(
        "/api/v1/auth/login/options",
        {},
      );
      const assertion = await getPasskeyAssertion(options);
      await postData<{ user: User; csrf_token: string }>("/api/v1/auth/login/verify", {
        ceremony_id: assertion.ceremonyId,
        credential: assertion.credential,
      });
      refresh();
      router.replace(next);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? errorMessage(error) : webauthnErrorMessage(error),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRecovery() {
    if (!username.trim() || !recoveryKey.trim()) {
      toast.error("아이디와 복구키를 입력해주세요");
      return;
    }
    setRecovering(true);
    try {
      await postData<{ session_type: string }>("/api/v1/auth/recovery/verify", {
        username: username.trim(),
        recovery_key: recoveryKey.trim(),
      });
      toast.success("복구 모드로 전환했어요. 새 패스키를 등록해주세요");
      refresh();
      router.replace("/recover");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRecovering(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <p className="text-[26px] font-extrabold tracking-[-0.04em] text-app-gray-900">
            Trade<span className="text-app-blue">X</span>
          </p>
          <h1 className="mt-6 text-[22px] leading-tight font-bold tracking-[-0.02em] text-app-gray-900">
            패스키로 안전하게
            <br />
            시작하세요
          </h1>
          <p className="mt-2 text-[14px] text-app-gray-500">
            비밀번호 없이 생체 인증으로 로그인해요
          </p>
        </div>

        <div className="rounded-2xl bg-card p-5 shadow-[0_1px_2px_0_rgba(25,31,40,0.03)]">
          <Button
            type="button"
            onClick={handleLogin}
            disabled={busy || status === "loading"}
            className="h-12 w-full rounded-xl bg-app-blue text-[15px] font-bold text-white hover:bg-app-blue-hover"
          >
            {busy ? "확인 중…" : status === "loading" ? "로그인 상태 확인 중…" : "패스키로 로그인"}
          </Button>
          <button
            type="button"
            onClick={() => setRecoveryOpen(true)}
            className="mt-3 min-h-11 w-full rounded-xl py-2 text-[13px] font-semibold text-app-gray-500 hover:bg-app-gray-50 hover:text-app-gray-700"
          >
            복구키로 로그인
          </button>
        </div>

        <p className="mt-5 text-center text-[13px] text-app-gray-500">
          <Link href="/invite" prefetch={false} className="mb-3 block font-semibold text-app-blue">초대 토큰으로 가입하기</Link>
          아직 계정이 없나요?{" "}
          <Link href="/signup" prefetch={false} className="font-semibold text-app-blue">
            가입하기
          </Link>
        </p>
      </div>

      <SiteDisclaimer stacked className="mt-10 w-full max-w-[400px]" />

      <Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>복구키로 로그인</DialogTitle>
            <DialogDescription>
              가입할 때 저장해둔 복구키 8개 중 하나를 입력해주세요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="recovery-username">아이디</Label>
              <Input
                id="recovery-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="아이디"
                autoComplete="username"
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recovery-key">복구키</Label>
              <Input
                id="recovery-key"
                value={recoveryKey}
                onChange={(event) => setRecoveryKey(event.target.value)}
                placeholder="rck_..."
                className="numeric h-11 rounded-xl"
              />
            </div>
            <Button
              type="button"
              onClick={handleRecovery}
              disabled={recovering}
              className="h-11 w-full rounded-xl bg-app-blue text-[14px] font-bold text-white hover:bg-app-blue-hover"
            >
              {recovering ? "확인 중…" : "복구키 사용"}
            </Button>
            <p className="text-[12px] leading-relaxed text-app-gray-500">
              복구 모드에서는 새 패스키를 등록한 뒤 다시 로그인할 수 있어요. 사용한 복구키는
              즉시 폐기됩니다.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginScreen />
    </Suspense>
  );
}
