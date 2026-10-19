"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useSignedIn } from "../session-mode";
import type { WsFrame } from "../types";
import { getSocket, type WsKind, type WsStatus } from "../ws";

/** A guest never opens a socket, so its streams stay closed and REST stands in. */
export function useSocketStatus(kind: WsKind): WsStatus {
  const signedIn = useSignedIn();
  const socket = signedIn ? getSocket(kind) : null;
  const subscribe = useCallback(
    (notify: () => void) => socket?.onStatus(() => notify()) ?? (() => {}),
    [socket],
  );
  const getSnapshot = useCallback((): WsStatus => socket?.getStatus() ?? "closed", [socket]);
  const getServerSnapshot = useCallback((): WsStatus => "closed", []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Private events invalidate account data as it changes, so while that socket
// is open a focus or remount only re-asks the server once this has passed.
const PRIVATE_LIVE_STALE_MS = 60_000;

const PRIVATE_POLLED_STALE_MS = 10_000;

export function privateStaleTime(status: WsStatus): number {
  return status === "open" ? PRIVATE_LIVE_STALE_MS : PRIVATE_POLLED_STALE_MS;
}

export function usePrivateStaleTime(): number {
  return privateStaleTime(useSocketStatus("private"));
}

export function useChannelFrames(
  kind: WsKind,
  channel: string | null,
  handler: (frame: WsFrame) => void,
  onGap?: () => void,
) {
  const handlerRef = useRef(handler);
  const gapRef = useRef(onGap);
  const signedIn = useSignedIn();
  useEffect(() => {
    handlerRef.current = handler;
    gapRef.current = onGap;
  }, [handler, onGap]);

  useEffect(() => {
    if (!channel || !signedIn) return;
    const socket = getSocket(kind);
    const off = socket.onFrame((frame) => {
      if (frame.stream === channel) handlerRef.current(frame);
    });
    const offGap = socket.onGap((stream) => {
      if (stream === channel || stream === kind) gapRef.current?.();
    });
    socket.subscribe(channel);
    return () => {
      off();
      offGap();
      socket.unsubscribe(channel);
    };
  }, [kind, channel, signedIn]);
}
