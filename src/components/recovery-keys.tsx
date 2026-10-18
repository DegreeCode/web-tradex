"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { copyToClipboard } from "@/lib/clipboard";

export function RecoveryKeyGrid({ keys, className }: { keys: string[]; className?: string }) {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy(key: string) {
    if (!(await copyToClipboard(key, "복구키를 복사했어요"))) return;
    setCopied(key);
  }

  return (
    <div className={className}>
      <ol aria-label="복구키" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {keys.map((key, index) => (
          <li key={key} className="flex min-w-0 items-start gap-2 rounded-lg bg-app-gray-100 px-3 py-2">
            <span aria-hidden="true" className="w-4 shrink-0 text-[11px] font-semibold text-app-gray-400">
              {index + 1}
            </span>
            <code className="numeric min-w-0 flex-1 break-all text-[12px] text-app-gray-800 select-all">{key}</code>
            <button
              type="button"
              onClick={() => void copy(key)}
              aria-label={`${index + 1}번째 복구키 복사`}
              className="shrink-0 rounded-md p-1.5 text-app-gray-400 hover:bg-card hover:text-app-gray-700"
            >
              {copied === key ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-3 rounded-xl bg-app-orange-light px-3.5 py-3 text-[12px] leading-relaxed break-keep text-app-gray-800">
        복구키는 비밀번호 관리자처럼 안전한 곳에 한 개씩 저장하세요. 평문 파일로 내려받거나
        클립보드에 오래 두지 마세요.
      </p>
    </div>
  );
}
