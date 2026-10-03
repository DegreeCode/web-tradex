"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { BrandLogo } from "@/components/brand-logo";
import { LegalConsent } from "@/components/legal-consent";
import { SiteDisclaimer } from "@/components/site-disclaimer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, postData } from "@/lib/api";
import { clearSessionCache } from "@/lib/hooks";

export default function InvitationPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    if (!agreed || !token.trim()) return;
    setBusy(true);
    try {
      await postData("/api/v1/auth/invitations/redemption", {
        invitation_token: token.trim(),
      });
      setToken("");
      // The session now belongs to the invited account.
      await clearSessionCache(queryClient);
      void queryClient.resetQueries({ queryKey: ["me"], exact: true });
      router.replace("/recover");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <p className="text-[26px] font-extrabold tracking-[-0.04em] text-app-gray-900">
            <BrandLogo />
          </p>
          <h1 className="mt-6 text-[22px] font-bold tracking-[-0.02em] text-app-gray-900">초대 수락</h1>
          <p className="mt-2 text-[14px] leading-relaxed break-keep text-app-gray-500">
            전달받은 초대 토큰을 입력해주세요. 수락 후 10분 안에 패스키를 등록하면 계정이 활성화돼요.
          </p>
        </div>

        <form onSubmit={redeem} className="space-y-4 rounded-2xl bg-card p-5 shadow-card">
          <div className="space-y-1.5">
            <Label htmlFor="invitation-token">초대 토큰</Label>
            <Input
              id="invitation-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
              className="h-12 rounded-xl"
            />
            <p className="text-[12px] leading-5 text-app-gray-500">
              지금 로그인한 세션은 초대받은 계정의 등록 세션으로 바뀌어요.
            </p>
          </div>
          <LegalConsent checked={agreed} onChange={setAgreed} className="" />
          <Button
            type="submit"
            disabled={busy || !token.trim() || !agreed}
            className="h-auto min-h-12 w-full rounded-xl bg-app-blue py-3 text-[15px] font-bold whitespace-normal text-white hover:bg-app-blue-hover pressable"
          >
            {busy ? "확인 중…" : "초대 수락하고 패스키 등록"}
          </Button>
        </form>

        <p className="mt-5 text-center text-[13px] text-app-gray-500">
          <Link href="/login" prefetch={false} className="font-semibold text-app-blue">
            로그인으로 돌아가기
          </Link>
        </p>
      </div>

      <SiteDisclaimer stacked className="mt-10 w-full max-w-[400px]" />
    </div>
  );
}
