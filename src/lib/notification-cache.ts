/**
 * Applies notification changes (private frames and read mutations) to every
 * cached notification list without refetching what is already complete.
 */
import type { QueryClient } from "@tanstack/react-query";

import type { Notification, Page, WsFrame } from "./types";

export function isNotification(value: unknown): value is Notification {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.notification_id === "string" &&
    typeof row.kind === "string" &&
    typeof row.title === "string" &&
    typeof row.body === "string" &&
    typeof row.version === "number" &&
    Number.isSafeInteger(row.version) &&
    typeof row.pinned === "boolean" &&
    typeof row.read === "boolean" &&
    typeof row.created_at === "string" &&
    typeof row.updated_at === "string" &&
    (row.expires_at === null || typeof row.expires_at === "string")
  );
}

export function notificationFromPrivateFrame(frame: WsFrame): Notification | null {
  if (!frame.data || typeof frame.data !== "object") return null;
  const outer = frame.data as Record<string, unknown>;
  return isNotification(outer.data) ? outer.data : null;
}

function createdTime(row: Notification): number {
  const time = Date.parse(row.created_at);
  return Number.isFinite(time) ? time : 0;
}

// Lists use sort=pinned: the most recently pinned rows first, then unpinned
// rows newest first. The pin time isn't exposed, so a row that becomes pinned
// is treated as the latest pin.
function insertNotification(rows: Notification[], incoming: Notification): Notification[] {
  const index = incoming.pinned
    ? 0
    : rows.findIndex((row) => !row.pinned && createdTime(row) < createdTime(incoming));
  return index < 0 ? [...rows, incoming] : [...rows.slice(0, index), incoming, ...rows.slice(index)];
}

function mergeNotificationRows(
  rows: Notification[],
  incoming: Notification,
  unreadOnly: boolean,
  allowInsert: boolean,
): Notification[] {
  const index = rows.findIndex((row) => row.notification_id === incoming.notification_id);
  const existing = index >= 0 ? rows[index] : undefined;
  if (existing && incoming.version < existing.version) return rows;
  let next = rows;
  if (existing && existing.pinned === incoming.pinned) {
    // Edits keep their place in the server order.
    next = rows.map((row, i) => (i === index ? incoming : row));
  } else if (existing || allowInsert) {
    next = insertNotification(rows.filter((row) => row !== existing), incoming);
  }
  return next.filter((row) => !unreadOnly || !row.read);
}

function notificationPages(value: unknown): Page<Notification>[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const pages = Array.isArray(record.pages) ? record.pages : [value];
  return pages.filter((page): page is Page<Notification> =>
    Boolean(page) && typeof page === "object" && Array.isArray((page as { data?: unknown }).data));
}

/**
 * A pin change moves a row to where the server's pin order puts it, which a
 * partially loaded list can't place, so such lists are refetched instead.
 */
export function pinChangeNeedsRefetch(value: unknown, incoming: Notification): boolean {
  const pages = notificationPages(value);
  const existing = pages
    .flatMap((page) => page.data)
    .find((row) => row.notification_id === incoming.notification_id);
  if (!existing || existing.pinned === incoming.pinned || incoming.version < existing.version) return false;
  return pages.length > 1 || Boolean(pages[0]?.page?.has_more);
}

export function updateNotificationCache(
  value: unknown,
  incoming: Notification,
  unreadOnly: boolean,
): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.pages)) {
    const pages = record.pages as unknown[];
    return {
      ...record,
      pages: pages.map((page, index) => {
        if (!page || typeof page !== "object" || !Array.isArray((page as { data?: unknown }).data)) {
          return page;
        }
        const pageRecord = page as Record<string, unknown>;
        return {
          ...pageRecord,
          data: mergeNotificationRows(
            pageRecord.data as Notification[],
            incoming,
            unreadOnly,
            index === 0,
          ),
        };
      }),
    };
  }
  if (Array.isArray(record.data) && record.page && typeof record.page === "object") {
    return {
      ...record,
      data: mergeNotificationRows(record.data as Notification[], incoming, unreadOnly, true),
    };
  }
  return value;
}

export function updateNotificationCaches(
  queryClient: QueryClient,
  incoming: Notification,
): void {
  for (const [queryKey, current] of queryClient.getQueriesData({ queryKey: ["notifications"] })) {
    if (!Array.isArray(queryKey)) continue;
    if (pinChangeNeedsRefetch(current, incoming)) {
      void queryClient.invalidateQueries({ queryKey, exact: true });
      continue;
    }
    const unreadOnly = queryKey[1] === "unread" || queryKey[2] === "unread";
    queryClient.setQueryData(queryKey, updateNotificationCache(current, incoming, unreadOnly));
  }
  // A truncated unread page cannot tell how many unseen rows remain after a read.
  const unread = queryClient.getQueryData<Page<Notification>>(["notifications", "unread"]);
  if (incoming.read && unread?.page.has_more) {
    void queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
  }
}

function mapNotificationRows(
  value: unknown,
  map: (rows: Notification[]) => Notification[],
  exhausted: boolean,
): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const mapPage = (page: unknown) => {
    if (!page || typeof page !== "object" || !Array.isArray((page as { data?: unknown }).data)) return page;
    const pageRecord = page as Page<Notification>;
    return {
      ...pageRecord,
      data: map(pageRecord.data),
      page: exhausted ? { has_more: false, next_cursor: null } : pageRecord.page,
    };
  };
  if (Array.isArray(record.pages)) return { ...record, pages: record.pages.map(mapPage) };
  return mapPage(value);
}

/**
 * Applies a successful read to cached lists instead of refetching them. `all`
 * means every notification was read, so unread lists become complete and empty.
 */
export function markNotificationsReadInCaches(
  queryClient: QueryClient,
  ids: ReadonlySet<string> | "all",
): void {
  const matches = (row: Notification) => ids === "all" || ids.has(row.notification_id);
  for (const [queryKey, current] of queryClient.getQueriesData({ queryKey: ["notifications"] })) {
    if (!Array.isArray(queryKey)) continue;
    const unreadOnly = queryKey[1] === "unread" || queryKey[2] === "unread";
    queryClient.setQueryData(queryKey, mapNotificationRows(
      current,
      (rows) => unreadOnly
        ? rows.filter((row) => !matches(row))
        : rows.map((row) => (matches(row) && !row.read ? { ...row, read: true } : row)),
      unreadOnly && ids === "all",
    ));
  }
  // Unread rows beyond a truncated page may now move into it.
  const unread = queryClient.getQueryData<Page<Notification>>(["notifications", "unread"]);
  if (ids !== "all" && unread?.page.has_more) {
    void queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
  }
}
