"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";

function downloadKeys(keys: string[]) {
  const text = [
    "TradeX 복구키",
    "패스키를 잃어버렸을 때 아래 키 중 하나로 계정을 되찾을 수 있어요. 각 키는 한 번만 쓸 수 있어요.",
    "",
    ...keys.map((key, index) => `${index + 1}. ${key}`),
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "tradex-recovery-keys.txt";
  link.click();
  URL.revokeObjectURL(url);
}

export function RecoveryKeyGrid({ keys, className }: { keys: string[]; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    if (!(await copyToClipboard(keys.join("\n"), "복구키를 복사했어요"))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={className}>
      <ol aria-label="복구키" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {keys.map((key, index) => (
          <li key={key} className="flex min-w-0 items-start gap-2 rounded-lg bg-app-gray-100 px-3 py-2">
            <span aria-hidden="true" className="w-4 shrink-0 text-[11px] font-semibold text-app-gray-400">
              {index + 1}
            </span>
            <code className="numeric min-w-0 break-all text-[12px] text-app-gray-800 select-all">{key}</code>
          </li>
        ))}
      </ol>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={copyAll} className="h-10 gap-2 rounded-xl text-[14px]">
          {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
          전체 복사
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => downloadKeys(keys)}
          className="h-10 gap-2 rounded-xl text-[14px]"
        >
          <Download aria-hidden="true" className="size-4" />
          파일로 저장
        </Button>
      </div>
    </div>
  );
}
