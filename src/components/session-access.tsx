"use client";

import { Lock } from "lucide-react";
import { cn } from "cn";

import { useAuth } from "@/components/auth-provider";
import { SESSION_DENIED, sessionAllows, type SessionNeed } from "@/lib/session-access";

export type { SessionNeed };

/**
 * Whether this session may take an action, and the sentence to show when it
 * can't. A full (passkey) session may do everything; the server enforces the
 * same rules, this only spares the person a refused request.
 */
export function useSessionAccess(need: SessionNeed): { allowed: boolean; reason: string } {
  const { linkedScope } = useAuth();
  return { allowed: sessionAllows(linkedScope, need), reason: SESSION_DENIED[need] };
}

export function ScopeNotice({ reason, className }: { reason: string; className?: string }) {
  return (
    <p
      role="note"
      className={cn(
        "flex items-center gap-1.5 rounded-lg bg-app-gray-100 px-3 py-2 text-[12px] font-medium break-keep text-app-gray-600",
        className,
      )}
    >
      <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      {reason}
    </p>
  );
}
