"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";

import { useAuth } from "@/components/auth-provider";
import { RecoveryKeyGrid } from "@/components/recovery-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, errorMessage, postData } from "@/lib/api";
import { createPasskey, supportsPasskeys, webauthnErrorMessage } from "@/lib/webauthn";
import type { CeremonyEnvelope } from "@/lib/webauthn";
import type { Account, User } from "@/lib/types";
import { LegalConsent } from "@/components/legal-consent";
import { SiteDisclaimer } from "@/components/site-disclaimer";
import { BrandLogo } from "@/components/brand-logo";

interface RegistrationResult {
  user: User;
  account: Account;
  recovery_keys: string[];
  csrf_token: string;
}

export default function SignupPage() {
  const router = useRouter();
  const { status, refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && !result) router.replace("/");
  }, [status, router, result]);

  async function handleSignup(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy || status === "loading") return;
    const trimmed = username.trim();
    if (!/^[A-Za-z0-9_]{3,32}$/.test(trimmed)) {
      toast.error("아이디는 영문·숫자·밑줄 3~32자로 입력해주세요");
      return;
    }
    if (!agreed) {
      toast.error("이용약관 동의가 필요해요");
      return;
    }
    if (!supportsPasskeys()) {
      toast.error("이 브라우저에서는 패스키를 사용할 수 없어요");
      return;
    }
    setBusy(true);
    try {
      const options = await postData<CeremonyEnvelope<PublicKeyCredentialCreationOptionsJSON>>(
        "/api/v1/auth/registration/options",
        { username: trimmed },
      );
      const registration = await createPasskey(options);
      const payload = await postData<RegistrationResult>("/api/v1/auth/registration/verify", {
        ceremony_id: registration.ceremonyId,
        credential: registration.credential,
      });
      setResult(payload);
      toast.success("패스키를 등록했어요");
    } catch (error) {
      toast.error(
        error instanceof ApiError ? errorMessage(error) : webauthnErrorMessage(error),
      );
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    refresh();
    router.replace("/");
  }

  if (result) {
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
            <RecoveryKeyGrid keys={result.recovery_keys} />
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

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <p className="text-[26px] font-extrabold tracking-[-0.04em] text-app-gray-900">
            <BrandLogo />
          </p>
          <h1 className="mt-6 text-[22px] font-bold tracking-[-0.02em] text-app-gray-900">
            아이디를 정해주세요
          </h1>
          <p className="mt-2 text-[14px] text-app-gray-500">
            가입과 동시에 패스키를 만들어 드려요
          </p>
        </div>

        <form onSubmit={handleSignup} className="rounded-2xl bg-card p-5 shadow-card">
          <div className="space-y-1.5">
            <Label htmlFor="signup-username">아이디</Label>
            <Input
              id="signup-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="영문·숫자·밑줄 3~32자"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={32}
              className="h-12 rounded-xl"
            />
          </div>
          <LegalConsent checked={agreed} onChange={setAgreed} />
          <Button
            type="submit"
            disabled={busy || status === "loading" || !agreed}
            className="mt-4 h-12 w-full rounded-xl bg-app-blue text-[15px] font-bold text-white hover:bg-app-blue-hover pressable"
          >
            {busy ? "패스키 생성 중…" : status === "loading" ? "로그인 상태 확인 중…" : "패스키로 가입하기"}
          </Button>
        </form>

        <p className="mt-5 text-center text-[13px] text-app-gray-500">
          이미 계정이 있나요?{" "}
          <Link href="/login" prefetch={false} className="font-semibold text-app-blue">
            로그인
          </Link>
        </p>
      </div>

      <SiteDisclaimer stacked className="mt-10 w-full max-w-[400px]" />
    </div>
  );
}
