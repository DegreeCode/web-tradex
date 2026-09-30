"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "cn";

export function RecoveryKeyGrid({ keys, className }: { keys: string[]; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(keys.join("\n"));
      setCopied(true);
      toast.success("복구키를 복사했어요");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("복사에 실패했어요. 직접 저장해주세요");
    }
  }

  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {keys.map((key, index) => (
          <div
            key={key}
            className="flex min-w-0 items-start gap-2 rounded-lg bg-app-gray-100 px-3 py-2"
          >
            <span className="w-4 shrink-0 text-[11px] font-semibold text-app-gray-400">
              {index + 1}
            </span>
            <code className="numeric min-w-0 break-all text-[12px] text-app-gray-800">{key}</code>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={copyAll}
        className={cn("mt-3 h-10 w-full gap-2 rounded-xl text-[14px]")}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        전체 복사
      </Button>
    </div>
  );
}
