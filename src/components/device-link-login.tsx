"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiData, errorMessage, postData } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import {
  DEVICE_LINK_CURRENT_PATH,
  DEVICE_LINKS_PATH,
  deviceLinkOutcome,
  formatRemaining,
  pollFailure,
  pollIntervalMs,
  remainingSeconds,
  verificationUrl,
  type DeviceLinkPoll,
  type DeviceLinkStart,
} from "@/lib/device-link";

type Phase = "starting" | "waiting" | "signed-in" | "denied" | "expired" | "failed";

const ENDED: Record<"denied" | "expired" | "failed", { title: string; body: string }> = {
  denied: { title: "승인이 거부됐어요", body: "다시 시도하려면 새 코드를 받아주세요." },
  expired: { title: "코드가 만료됐어요", body: "제한 시간 안에 승인되지 않았어요. 새 코드를 받아주세요." },
  failed: { title: "연결하지 못했어요", body: "" },
};

/**
 * Requests a sign-in code and waits for a signed-in device to approve it. The
 * whole flow is clicks and reading, so it works in a browser that can't run a
 * passkey ceremony. The server binds the request to this browser with an
 * HttpOnly cookie, so the code alone can't claim the session. By the time
 * `onSignedIn` runs the session cookies are set; the caller only re-reads /me.
 */
export function DeviceLinkLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [link, setLink] = useState<DeviceLinkStart | null>(null);
  const [failure, setFailure] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // The parent's callback changes identity whenever /me re-resolves; polling
  // must not restart for that.
  const onSignedInRef = useRef(onSignedIn);
  useEffect(() => {
    onSignedInRef.current = onSignedIn;
  }, [onSignedIn]);

  // Bumped by "새 코드 받기"; each value asks the server for one code.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    postData<DeviceLinkStart>(DEVICE_LINKS_PATH, {}).then(
      (created) => {
        if (cancelled) return;
        setLink(created);
        setNow(Date.now());
        setPhase("waiting");
      },
      (error: unknown) => {
        if (cancelled) return;
        setFailure(errorMessage(error));
        setPhase("failed");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function restart() {
    setPhase("starting");
    setLink(null);
    setFailure("");
    setAttempt((value) => value + 1);
  }

  useEffect(() => {
    if (phase !== "waiting" || !link) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (remainingSeconds(link.expires_at, current) === 0) setPhase("expired");
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, link]);

  useEffect(() => {
    if (phase !== "waiting" || !link) return;
    const controller = new AbortController();
    let cancelled = false;
    let paused = false;
    let timer: number | undefined;
    let interval = pollIntervalMs(link.poll_interval_seconds);

    const schedule = (delay: number) => {
      timer = window.setTimeout(() => void poll(), delay);
    };

    async function poll() {
      timer = undefined;
      if (cancelled) return;
      // A hidden tab stops asking; becoming visible asks again right away.
      if (document.hidden) {
        paused = true;
        return;
      }
      try {
        const result = await apiData<DeviceLinkPoll>(DEVICE_LINK_CURRENT_PATH, { signal: controller.signal });
        if (cancelled) return;
        const outcome = deviceLinkOutcome(result.status);
        if (outcome === "waiting") {
          schedule(interval);
        } else if (outcome === "signed-in") {
          setPhase("signed-in");
          onSignedInRef.current();
        } else {
          setPhase(outcome);
        }
      } catch (error) {
        if (cancelled) return;
        const next = pollFailure(error, interval);
        if (next.kind === "retry") {
          interval = next.intervalMs;
          schedule(next.delayMs);
        } else {
          if (next.outcome === "failed") setFailure(errorMessage(error));
          setPhase(next.outcome);
        }
      }
    }

    const resume = () => {
      if (document.hidden || !paused) return;
      paused = false;
      void poll();
    };

    schedule(interval);
    document.addEventListener("visibilitychange", resume);
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [phase, link]);

  if (phase === "starting") {
    return (
      <div className="flex min-h-40 items-center justify-center gap-2 text-[13px] text-app-gray-500">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        코드를 만드는 중…
      </div>
    );
  }

  if (phase === "signed-in") {
    return (
      <div className="flex min-h-40 items-center justify-center gap-2 text-[13px] text-app-gray-500">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        승인됐어요. 로그인하는 중…
      </div>
    );
  }

  if (phase !== "waiting" || !link) {
    const ended = ENDED[phase === "waiting" ? "failed" : phase];
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-app-gray-50 px-4 py-3">
          <p className="text-[14px] font-semibold text-app-gray-900">{ended.title}</p>
          <p className="mt-1 text-[13px] leading-relaxed break-keep text-app-gray-500">
            {phase === "failed" && failure ? failure : ended.body}
          </p>
        </div>
        <Button
          type="button"
          onClick={restart}
          className="h-11 w-full rounded-xl bg-app-blue text-[14px] font-bold text-white hover:bg-app-blue-hover"
        >
          새 코드 받기
        </Button>
      </div>
    );
  }

  const url = verificationUrl(window.location.origin, link.verification_path);
  const remaining = remainingSeconds(link.expires_at, now);

  return (
    <div className="space-y-3">
      <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed break-keep text-app-gray-600">
        <li>이미 로그인된 기기에서 아래 주소를 열거나, 보안 메뉴의 기기 연결 승인으로 들어가요.</li>
        <li>이 화면의 코드를 입력하고, 줄 권한과 사용 시간을 정해 패스키로 승인해요.</li>
        <li>승인되면 이 화면이 자동으로 로그인돼요.</li>
      </ol>

      <CopyRow label="연결 코드" value={link.user_code} copiedMessage="코드를 복사했어요" large />
      {url ? <CopyRow label="승인 주소" value={url} copiedMessage="주소를 복사했어요" /> : null}

      <div className="flex items-center justify-between rounded-xl bg-app-gray-50 px-4 py-3 text-[13px]">
        <span className="flex items-center gap-2 text-app-gray-600">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          승인을 기다리는 중
        </span>
        <span className="numeric font-semibold text-app-gray-900" aria-label={`${formatRemaining(remaining)} 남음`}>
          {formatRemaining(remaining)}
        </span>
      </div>

      <p className="text-[12px] leading-relaxed break-keep text-app-gray-500">
        승인은 본인 기기에서만 하세요. 다른 사람이 알려준 코드는 승인하지 마세요.
      </p>
    </div>
  );
}

function CopyRow({
  label,
  value,
  copiedMessage,
  large = false,
}: {
  label: string;
  value: string;
  copiedMessage: string;
  large?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!(await copyToClipboard(value, copiedMessage))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-app-gray-100 py-2 pr-2 pl-4">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-app-gray-500">{label}</p>
        <code
          className={
            large
              ? "numeric block text-[24px] font-bold tracking-[0.12em] text-app-gray-900 select-all"
              : "numeric block truncate text-[12px] text-app-gray-800 select-all"
          }
          title={large ? undefined : value}
        >
          {value}
        </code>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={copy}
        aria-label={`${label} 복사`}
        className="size-10 shrink-0 rounded-xl"
      >
        {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
      </Button>
    </div>
  );
}
