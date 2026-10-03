import type { Metadata } from "next";
import Link from "next/link";

import { BrandLogo } from "@/components/brand-logo";

export const metadata: Metadata = { title: "페이지를 찾을 수 없어요" };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-10 text-center">
      <p className="text-[24px] font-extrabold tracking-[-0.04em] text-app-gray-900">
        <BrandLogo />
      </p>
      <h1 className="mt-8 text-[22px] font-bold tracking-[-0.02em] text-app-gray-900">페이지를 찾을 수 없어요</h1>
      <p className="mt-2 max-w-[320px] text-[14px] leading-relaxed break-keep text-app-gray-500">
        주소가 바뀌었거나 없는 페이지예요. 홈에서 다시 찾아보세요.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-11 items-center rounded-xl bg-app-blue px-5 text-[14px] font-bold text-white hover:bg-app-blue-hover pressable"
      >
        홈으로 가기
      </Link>
    </main>
  );
}
