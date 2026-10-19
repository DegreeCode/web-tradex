"use client";

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invalidateMarginQueries } from "../margin";
import {
  applySymbolMetadataCache,
  applySymbolMetadataDelta,
  applyTradingNotification,
  refreshSymbolMetadata,
} from "../market-cache";
import { notificationFromPrivateFrame, updateNotificationCaches } from "../notification-cache";
import { eventKeyFromTitle, parseNotificationBody } from "../notifications";
import { invalidateBatched } from "../query-batch";
import { readSymbolMetadataCache, runSymbolMetadataSync } from "../symbol-metadata";
import { triggerEventQueryRoots, triggerNotificationQueryRoots } from "../trigger-events";
import type { Notification, WsFrame } from "../types";
import { getSocket, type StreamSocket } from "../ws";

/** Notifications are also the authoritative private delivery path for trade events. */
export function reconcileNotificationData(
  queryClient: QueryClient,
  notification: Notification,
) {
  const parsed = parseNotificationBody(notification.body);
  const event = parsed.eventKey ?? eventKeyFromTitle(notification.title);
  const keys = new Set<string>(triggerNotificationQueryRoots(event));
  if (["TRADE_EXECUTED", "transfer.updated", "ISSUANCE_CREATED", "LOCKUP_RELEASE"].includes(event ?? "")) {
    for (const key of ["orders", "my-trades", "portfolio", "accounts", "nav", "nav-history", "realized-pnl", "pnl", "pnl-history", "order-groups"]) keys.add(key);
  }
  if (event === "transfer.updated") keys.add("transfers");
  // Delisting settles remaining holdings into Credit.
  if (event === "DELISTED") {
    for (const key of ["portfolio", "accounts", "nav", "nav-history", "realized-pnl", "pnl", "pnl-history", "order-groups"]) keys.add(key);
  }
  if (event?.startsWith("margin.")) {
    // A warning only changes risk; settlements and liquidations move balances too.
    invalidateMarginQueries(queryClient, { balances: event !== "margin.warning" });
  }
  if (event === "MANAGER_CHANGED" || event === "MANAGER_FORCED_CHANGE") keys.add("manager-requests");
  if (event === "AUTH_PASSKEY_ADDED" || event === "AUTH_PASSKEY_DELETED") keys.add("passkeys");
  if (event === "AUTH_SESSIONS_REVOKED" || event === "AUTH_LOGIN" || event === "AUTH_LOGOUT") keys.add("sessions");
  if (event === "ICON_REJECTED" || event === "ICON_REVOKED") keys.add("icon-requests");
  if (event === "CURVE_CEILING_REACHED") keys.add("issuance-preview");
  if ([
    "SYMBOL_METADATA_CHANGED", "SYMBOL_LISTED", "ICON_REVOKED", "ISSUANCE_CREATED", "LOCKUP_RELEASE",
    "CURVE_CEILING_REACHED", "MANAGER_CHANGED", "MANAGER_FORCED_CHANGE",
  ].includes(event ?? "")) {
    // applyTradingNotification already refreshes these metadata events.
    if (parsed.symbol && event !== "SYMBOL_METADATA_CHANGED" && event !== "SYMBOL_LISTED" && event !== "ICON_REVOKED") {
      void refreshSymbolMetadata(queryClient, parsed.symbol);
    }
    keys.add("icon-requests");
  }
  if (event === "inquiry.replied") {
    keys.add("inquiries");
    keys.add("inquiry");
  }
  if (event === "ACCOUNT_CREATED" || event === "ACCOUNT_DELETED") keys.add("accounts");
  invalidateNotificationKeys(queryClient, keys);
}

// NAV history is a period series: refresh it when a chart next mounts or regains
// focus instead of refetching up to 500 points for every event.
const PASSIVE_REFRESH_KEYS = new Set(["nav-history"]);

function invalidateNotificationKeys(
  queryClient: QueryClient,
  keys: Iterable<string>,
): void {
  const active: string[][] = [];
  const passive: string[][] = [];
  for (const key of keys) (PASSIVE_REFRESH_KEYS.has(key) ? passive : active).push([key]);
  invalidateBatched(queryClient, active);
  invalidateBatched(queryClient, passive, { passive: true });
}

/**
 * Private streams have no replay/resume, so a gap is reconciled over REST:
 * once when it happens, and again when the next connection opens, because
 * changes made between that refetch and the reconnect were never delivered.
 * Repeated failed reconnects must not turn this into a poller.
 */
export function resyncPrivateStreamGaps(
  socket: Pick<StreamSocket, "onFrame" | "onGap" | "onStatus">,
  reconcile: () => void,
): () => void {
  let reconciliationRequested = false;
  let resyncOnOpen = false;
  const offFrame = socket.onFrame((frame) => {
    if (frame.type === "update") reconciliationRequested = false;
  });
  const offGap = socket.onGap(() => {
    resyncOnOpen = true;
    if (reconciliationRequested) return;
    reconciliationRequested = true;
    reconcile();
  });
  const offStatus = socket.onStatus((status) => {
    if (status !== "open" || !resyncOnOpen) return;
    resyncOnOpen = false;
    reconciliationRequested = false;
    reconcile();
  });
  return () => {
    offFrame();
    offGap();
    offStatus();
  };
}

export function usePrivateStream(enabled: boolean) {
  const queryClient = useQueryClient();
  const handlerRef = useRef<(frame: WsFrame) => void>(() => {});

  useEffect(() => {
    handlerRef.current = (frame) => {
      const stream = frame.stream;
      if (!stream) return;
      if (stream === "notification.created" || stream === "notification.updated") {
        const notification = notificationFromPrivateFrame(frame);
        if (!notification) return;
        updateNotificationCaches(queryClient, notification);
        // Updates (e.g. read state) carry no new domain event to reconcile.
        if (stream === "notification.created") {
          applyTradingNotification(queryClient, notification);
          reconcileNotificationData(queryClient, notification);
        }
        return;
      }
      // Private trade.executed is not delivered; fills arrive as notifications.
      // Domain streams below share one batched refetch with their notification.
      if (stream === "trigger.activated" || stream === "trigger.updated" || stream === "trigger.group_updated") {
        invalidateNotificationKeys(queryClient, triggerEventQueryRoots(stream, frame.data));
        return;
      }
      if (stream === "transfer.updated") {
        invalidateNotificationKeys(queryClient, ["transfers", "transfer", "portfolio", "accounts", "nav"]);
        return;
      }
      if (stream.startsWith("margin.")) {
        const marginData = frame.data as { position_id?: string } | undefined;
        invalidateMarginQueries(queryClient, {
          positionId: marginData?.position_id,
          balances: stream !== "margin.warning",
        });
        return;
      }
      if (stream === "listing.updated" || stream === "issuance.created") {
        const symbol = (frame.data as { symbol?: string } | undefined)?.symbol;
        if (symbol) {
          void refreshSymbolMetadata(queryClient, symbol);
        } else {
          const cache = readSymbolMetadataCache();
          // Apply the result too: the periodic sync would see an already
          // fresh cache and never push this delta into mounted queries.
          if (cache) {
            void runSymbolMetadataSync(cache).then((next) => {
              applySymbolMetadataDelta(queryClient, cache, next);
              applySymbolMetadataCache(queryClient, next);
            }, () => undefined);
          }
        }
        return;
      }
      if (stream === "inquiry.replied") {
        invalidateNotificationKeys(queryClient, ["inquiries", "inquiry"]);
      }
    };
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket("private");
    const release = socket.retain();
    const off = socket.onFrame((frame) => handlerRef.current(frame));
    const offResync = resyncPrivateStreamGaps(socket, () => {
      invalidateMarginQueries(queryClient);
      invalidateNotificationKeys(queryClient, [
        "notifications",
        "orders",
        "order-groups",
        "my-trades",
        "portfolio",
        "accounts",
        "nav",
        "nav-history",
        "pnl",
        "pnl-history",
        "realized-pnl",
        "transfers",
        "transfer",
        "inquiries",
        "inquiry",
        "sessions",
        "passkeys",
        "manager-requests",
        "icon-requests",
      ]);
    });
    return () => {
      off();
      offResync();
      release();
    };
  }, [enabled, queryClient]);
}
