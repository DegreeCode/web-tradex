"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, KeyRound, MonitorSmartphone } from "lucide-react";
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
import { useLogout } from "@/lib/hooks";
import { getPasskeyAssertion, supportsPasskeys, webauthnErrorMessage } from "@/lib/webauthn";
import type { CeremonyEnvelope } from "@/lib/webauthn";
import type { User } from "@/lib/types";
import { SiteDisclaimer } from "@/components/site-disclaimer";
import { safeRedirectPath } from "@/lib/routes";
import { BrandLogo } from "@/components/brand-logo";
import { DeviceLinkLogin } from "@/components/device-link-login";

type AdvancedMethod = "choose" | "device-link" | "recovery";

const ADVANCED_TITLES: Record<AdvancedMethod, { title: string; description: string }> = {
  choose: { title: "고급 로그인", description: "패스키로 로그인할 수 없을 때 쓸 방법을 골라주세요." },
  "device-link": {
    title: "다른 기기로 승인받기",
    description: "로그인된 기기에서 승인하면 이 브라우저가 로그인돼요.",
  },
  recovery: { title: "복구키로 로그인", description: "가입할 때 저장해둔 복구키 8개 중 하나를 입력해주세요." },
};

function LoginScreen() {
  const router = useRouter();
  const { status, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [method, setMethod] = useState<AdvancedMethod>("choose");
  const [username, setUsername] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [recovering, setRecovering] = useState(false);
  // A linked session whose network changed: sign it out, then reopen the
  // device-link flow. "stuck" means the sign-out request itself failed.
  const [reconnect, setReconnect] = useState<"idle" | "ready" | "stuck">("idle");
  const reconnectAttempted = useRef(false);
  const signOut = useLogout().mutate;

  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const next = safeRedirectPath(params?.get("next"));
  const reconnectRequested = params?.get("reconnect") === "1";

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
    if (status === "recovery") router.replace("/recover");
  }, [status, router, next]);

  useEffect(() => {
    if (status !== "linked-blocked" || reconnectAttempted.current) return;
    reconnectAttempted.current = true;
    signOut(undefined, {
      onSuccess: () => {
        setReconnect("ready");
        setMethod("device-link");
        setAdvancedOpen(true);
      },
      onError: () => setReconnect("stuck"),
    });
  }, [status, signOut]);

  const notice =
    reconnect === "stuck"
      ? "stuck"
      : reconnect === "ready" || status === "linked-blocked" || reconnectRequested
        ? "reconnect"
        : null;

  function openAdvanced() {
    setMethod("choose");
    setAdvancedOpen(true);
  }

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

  async function handleRecovery(event: React.FormEvent) {
    event.preventDefault();
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
            <BrandLogo />
          </p>
          <h1 className="mt-6 text-[22px] leading-tight font-bold tracking-[-0.02em] break-keep text-app-gray-900">
            패스키로 안전하게
            <br />
            시작하세요
          </h1>
          <p className="mt-2 text-[14px] text-app-gray-500">
            비밀번호 없이 생체 인증으로 로그인해요
          </p>
        </div>

        {notice ? (
          <div role="alert" className="mb-3 rounded-2xl bg-app-orange-light px-4 py-3.5 text-[13px] leading-relaxed break-keep text-app-gray-800">
            <p className="font-semibold text-app-gray-900">접속 위치가 바뀌어 연결이 끊겼어요</p>
            <p className="mt-1">
              {notice === "stuck"
                ? "이전 연결을 정리하지 못했어요. 잠시 후 새로고침해주세요."
                : "고급 로그인의 다른 기기로 승인받기에서 다시 연결해주세요."}
            </p>
          </div>
        ) : null}

        <div className="rounded-2xl bg-card p-5 shadow-card">
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
            onClick={openAdvanced}
            className="mt-3 min-h-11 w-full rounded-xl py-2 text-[13px] font-semibold text-app-gray-500 hover:bg-app-gray-50 hover:text-app-gray-700"
          >
            고급 로그인
          </button>
        </div>

        <p className="mt-5 text-center text-[13px] text-app-gray-500">
          아직 계정이 없나요?{" "}
          <Link href="/signup" prefetch={false} className="font-semibold text-app-blue">
            가입하기
          </Link>
          <Link href="/invite" prefetch={false} className="mt-3 block font-semibold text-app-gray-500 hover:text-app-gray-700">
            초대 토큰이 있나요?
          </Link>
        </p>

        <Link
          href="/market"
          className="mt-6 flex min-h-11 items-center justify-center gap-1 rounded-xl border border-app-gray-200 text-[14px] font-semibold text-app-gray-700 hover:bg-app-gray-50"
        >
          로그인 없이 마켓 둘러보기
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      </div>

      <SiteDisclaimer stacked className="mt-10 w-full max-w-[400px]" />

      <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            {method !== "choose" ? (
              <button
                type="button"
                onClick={() => setMethod("choose")}
                className="-ml-1 flex min-h-8 w-fit items-center gap-1 rounded-lg px-1 text-[13px] font-semibold text-app-gray-500 hover:text-app-gray-700"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                다른 방법 선택
              </button>
            ) : null}
            <DialogTitle>{ADVANCED_TITLES[method].title}</DialogTitle>
            <DialogDescription>{ADVANCED_TITLES[method].description}</DialogDescription>
          </DialogHeader>
          {method === "choose" ? (
            <div className="space-y-2">
              <MethodOption
                icon={<MonitorSmartphone aria-hidden="true" className="size-5" />}
                title="다른 기기로 승인받기"
                description="패스키를 쓸 수 없는 브라우저에서, 로그인된 기기의 승인을 받아 로그인해요"
                onSelect={() => setMethod("device-link")}
              />
              <MethodOption
                icon={<KeyRound aria-hidden="true" className="size-5" />}
                title="복구키로 로그인"
                description="패스키를 잃어버렸을 때 복구 모드로 들어가 새 패스키를 등록해요"
                onSelect={() => setMethod("recovery")}
              />
            </div>
          ) : method === "device-link" ? (
            <DeviceLinkLogin onSignedIn={refresh} />
          ) : (
            <form onSubmit={handleRecovery} className="space-y-3">
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
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="numeric h-11 rounded-xl"
                />
              </div>
              <Button
                type="submit"
                disabled={recovering}
                className="h-11 w-full rounded-xl bg-app-blue text-[14px] font-bold text-white hover:bg-app-blue-hover"
              >
                {recovering ? "확인 중…" : "복구키 사용"}
              </Button>
              <p className="text-[12px] leading-relaxed text-app-gray-500">
                복구 모드에서는 새 패스키를 등록한 뒤 다시 로그인할 수 있어요. 사용한 복구키는
                즉시 폐기돼요.
              </p>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MethodOption({
  icon,
  title,
  description,
  onSelect,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-xl bg-app-gray-50 px-4 py-3 text-left hover:bg-app-gray-100"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-app-gray-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-app-gray-900">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed break-keep text-app-gray-500">{description}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-app-gray-400" />
    </button>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginScreen />
    </Suspense>
  );
}
