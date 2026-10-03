"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** Shown by error boundaries instead of a blank screen when rendering fails. */
export function ErrorFallback({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-center rounded-2xl bg-card px-6 py-12 text-center shadow-card">
      <span className="flex size-12 items-center justify-center rounded-full bg-app-red-light text-app-red">
        <AlertTriangle aria-hidden="true" className="size-6" />
      </span>
      <h2 className="mt-4 text-[17px] font-bold text-app-gray-900">화면을 표시하지 못했어요</h2>
      <p className="mt-1.5 max-w-[320px] text-[13px] leading-relaxed break-keep text-app-gray-500">
        일시적인 문제일 수 있어요. 다시 시도해도 계속되면 새로고침하거나 고객센터에 알려주세요.
      </p>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="h-11 rounded-xl bg-app-blue px-5 text-[14px] font-bold text-white hover:bg-app-blue-hover pressable"
        >
          다시 시도
        </button>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-xl bg-app-gray-100 px-5 text-[14px] font-semibold text-app-gray-700 hover:bg-app-gray-200 pressable"
        >
          홈으로
        </Link>
      </div>
    </div>
  );
}
