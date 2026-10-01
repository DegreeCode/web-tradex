"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LegalConsent } from "@/components/legal-consent";
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
    if (!agreed) return;
    setBusy(true);
    try {
      await postData("/api/v1/auth/invitations/redemption", {
        invitation_token: token.trim(),
      });
      setToken("");
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
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <form
        onSubmit={redeem}
        className="w-full max-w-[400px] space-y-5 rounded-xl bg-card p-6"
      >
        <h1 className="text-[24px] font-bold">초대 수락</h1>
        <p className="text-[14px] leading-6 text-app-gray-500">
          전달받은 초대 토큰을 입력해주세요. 수락 후 10분 이내에 패스키를
          등록하면 계정이 활성화돼요. 현재 로그인한 세션은 초대받은 계정의 등록
          세션으로 전환됩니다.
        </p>
        <div className="space-y-2">
          <Label htmlFor="invitation-token">초대 토큰</Label>
          <Input
            id="invitation-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </div>
        <LegalConsent checked={agreed} onChange={setAgreed} className="" />
        <Button
          type="submit"
          disabled={busy || !token.trim() || !agreed}
          className="h-auto min-h-12 w-full whitespace-normal py-3"
        >
          {busy ? "확인 중…" : "초대 수락하고 패스키 등록"}
        </Button>
        <Link
          href="/login"
          className="block text-center text-[13px] text-app-blue"
        >
          로그인으로 돌아가기
        </Link>
      </form>
    </div>
  );
}
