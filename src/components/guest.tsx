"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Eye, LogIn } from "lucide-react";
import { cn } from "cn";

import { fmtPrice } from "@/lib/format";
import { loginHref } from "@/lib/routes";
import type { Instrument } from "@/lib/types";

type LinkProps = Omit<React.ComponentProps<typeof Link>, "href">;

function LoginLinkHere(props: LinkProps) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return <Link {...props} href={loginHref(search ? `${pathname}?${search}` : pathname)} prefetch={false} />;
}

/** A sign-in link that comes back to this page, query (e.g. the symbol) included. */
export function LoginLink(props: LinkProps) {
  const pathname = usePathname();
  return (
    <Suspense fallback={<Link {...props} href={loginHref(pathname)} prefetch={false} />}>
      <LoginLinkHere {...props} />
    </Suspense>
  );
}

/** Tells a guest they are browsing, and why prices move in steps. */
export function GuestBanner() {
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2.5 rounded-xl bg-app-blue-light px-3.5 py-2.5 text-[12px] leading-relaxed text-app-gray-700"
    >
      <Eye aria-hidden="true" className="size-4 shrink-0 text-app-blue" />
      <p className="min-w-0 flex-1 break-keep">
        <span className="font-semibold text-app-gray-900">로그인 없이 둘러보는 중</span>
        {" · "}
        시세는 5초마다 갱신돼요
      </p>
      <LoginLink className="shrink-0 rounded-lg bg-card px-2.5 py-1.5 text-[12px] font-bold text-app-blue shadow-raised focus-visible:outline-2 focus-visible:outline-app-blue">
        로그인
      </LoginLink>
    </div>
  );
}

/** Stands in for the order form: a guest is sent to sign in and brought back. */
export function GuestOrderPrompt({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl bg-card p-5 shadow-card", className)}>
      <h2 className="text-[17px] font-bold tracking-[-0.02em] text-app-gray-900">주문</h2>
      <p className="mt-1 text-[13px] break-keep text-app-gray-500">
        로그인하면 이 종목을 바로 사고팔 수 있어요.
      </p>
      <LoginLink className="mt-4 flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-app-blue text-[15px] font-bold text-white hover:bg-app-blue-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-blue">
        <LogIn aria-hidden="true" className="size-4" />
        로그인하고 주문하기
      </LoginLink>
      <p className="mt-3 text-center text-[13px] text-app-gray-500">
        아직 계정이 없나요?{" "}
        <Link href="/signup" prefetch={false} className="font-semibold text-app-blue">
          가입하기
        </Link>
      </p>
    </div>
  );
}

/** The mobile order bar for a guest: same place as 매수·매도, leading to sign-in. */
export function GuestOrderBar({ instrument }: { instrument: Instrument }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(61px+env(safe-area-inset-bottom))] z-20 border-t border-app-gray-200 bg-card/95 px-4 py-2.5 backdrop-blur">
      <div className="mx-auto flex max-w-[1280px] items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold text-app-gray-500">{instrument.symbol}</p>
          <p className="numeric truncate text-[15px] font-bold text-app-gray-900">{fmtPrice(instrument.curve_spot_price)}</p>
        </div>
        <LoginLink className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-app-blue px-4 text-[15px] font-bold text-white">
          <LogIn aria-hidden="true" className="size-4" />
          로그인하고 주문
        </LoginLink>
      </div>
    </div>
  );
}
