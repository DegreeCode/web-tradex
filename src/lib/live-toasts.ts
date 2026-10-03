"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast, type ExternalToast } from "sonner";

import { useMarkNotificationRead } from "./hooks";
import { liveToastFor, type LiveToast } from "./live-notifications";
import { notificationFromPrivateFrame } from "./notification-cache";
import { shouldShowLiveNotificationPopup } from "./preferences";
import { getSocket } from "./ws";

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function showToast(content: LiveToast, options: ExternalToast): void {
  const merged: ExternalToast = {
    id: content.id,
    description: content.description,
    duration: content.duration,
    closeButton: content.duration === Infinity,
    ...options,
  };
  switch (content.tone) {
    case "success": toast.success(content.title, merged); break;
    case "info": toast.info(content.title, merged); break;
    case "warning": toast.warning(content.title, merged); break;
    case "danger": toast.error(content.title, merged); break;
    default: toast(content.title, merged);
  }
}

/**
 * Pops up important notifications the moment they arrive. Every tab receives
 * the shared private stream, so only a tab the user can see shows them.
 */
export function useLiveNotificationToasts(enabled: boolean): void {
  const router = useRouter();
  const pathname = usePathname();
  const markRead = useMarkNotificationRead();
  const contextRef = useRef({ router, pathname, markRead: markRead.mutate });

  useEffect(() => {
    contextRef.current = { router, pathname, markRead: markRead.mutate };
  }, [router, pathname, markRead.mutate]);

  useEffect(() => {
    if (!enabled) return;
    return getSocket("private").onFrame((frame) => {
      if (frame.stream !== "notification.created") return;
      // The list on this page already shows it as it arrives.
      if (contextRef.current.pathname === "/notifications") return;
      if (!isVisible() || !shouldShowLiveNotificationPopup()) return;
      const notification = notificationFromPrivateFrame(frame);
      const content = notification ? liveToastFor(notification) : null;
      if (!notification || !content) return;
      const { action } = content;
      showToast(content, action
        ? {
            action: {
              label: action.label,
              onClick: () => {
                contextRef.current.markRead(notification.notification_id);
                contextRef.current.router.push(action.href);
              },
            },
          }
        : {});
    });
  }, [enabled]);
}

const CONNECTION_TOAST_ID = "connection";
// Reconnects usually finish within a few seconds; only a lasting outage is worth a word.
const CONNECTION_GRACE_MS = 8_000;

/**
 * Tells the user when live updates stop: the browser went offline, or the
 * private stream dropped and hasn't come back. Prices and balances then fall
 * back to polling, so what's on screen may lag.
 */
export function useConnectionToast(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const socket = getSocket("private");
    let shown = false;
    let everOpen = socket.getStatus() === "open";
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const warn = (title: string, description: string) => {
      shown = true;
      toast.warning(title, { id: CONNECTION_TOAST_ID, description, duration: Infinity });
    };
    const recover = (title: string) => {
      clearTimer();
      if (!shown) return;
      shown = false;
      toast.success(title, { id: CONNECTION_TOAST_ID, description: undefined, duration: 3_000 });
    };

    const onOffline = () => {
      clearTimer();
      warn("인터넷 연결이 끊겼어요", "다시 연결되면 최신 정보로 맞춰드릴게요.");
    };
    const onOnline = () => {
      // The stream may still be reconnecting; let the status handler decide.
      if (socket.getStatus() === "open") recover("다시 연결됐어요");
      else if (shown) warn("실시간 연결을 다시 잇는 중이에요", "잠시 후 자동으로 연결돼요.");
    };
    const offStatus = socket.onStatus((status) => {
      if (status === "open") {
        everOpen = true;
        recover("실시간 연결이 복구됐어요");
        return;
      }
      // A stream that never opened (e.g. refused for this session) polls by design.
      if (!everOpen || timer || shown) return;
      timer = setTimeout(() => {
        timer = null;
        if (socket.getStatus() === "open" || !navigator.onLine || !isVisible()) return;
        warn("실시간 연결이 끊겼어요", "다시 연결하는 동안 화면 정보가 조금 늦게 바뀔 수 있어요.");
      }, CONNECTION_GRACE_MS);
    });

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (!navigator.onLine) onOffline();
    return () => {
      clearTimer();
      offStatus();
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (shown) toast.dismiss(CONNECTION_TOAST_ID);
    };
  }, [enabled]);
}
