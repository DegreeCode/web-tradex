"use client";

import { MonitorSmartphone } from "lucide-react";

import { fmtDateTime } from "@/lib/format";
import { permissionSummary } from "@/lib/device-link";
import type { SessionScope } from "@/lib/types";

/**
 * Tells the person this browser was signed in by another device's approval and
 * what that approval allows, so a refused action doesn't come as a surprise.
 */
export function LinkedSessionBanner({ scope }: { scope: SessionScope }) {
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-2.5 rounded-xl bg-app-blue-light px-3.5 py-2.5 text-[12px] leading-relaxed text-app-gray-700"
    >
      <MonitorSmartphone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-app-blue" />
      <p className="min-w-0 break-keep">
        <span className="font-semibold text-app-gray-900">연결된 기기로 로그인 중</span>
        {" · "}
        {scope.name} · {permissionSummary(scope.permissions)} · {fmtDateTime(scope.expires_at)}까지
      </p>
    </div>
  );
}
