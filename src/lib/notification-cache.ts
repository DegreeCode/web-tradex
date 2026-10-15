/**
 * Applies notification changes (private frames and read mutations) to every
 * cached notification list without refetching what is already complete.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { apiPage } from "./api";
import type { Notification, Page, WsFrame } from "./types";

type NotificationChange = (
  page: Page<Notification>, allowInsert: boolean, laterPageIds: ReadonlySet<string>,
) => Page<Notification>;
const pendingReads = new WeakMap<QueryClient, Set<(change: NotificationChange) => void>>();

/** Preserve events and read actions received while an older REST page is loading. */
export async function loadNotificationPage(
  queryClient: QueryClient,
  path: string,
  options: { unreadOnly: boolean; cursor?: string | null; signal?: AbortSignal; queryKey?: QueryKey },
): Promise<Page<Notification>> {
  let listeners = pendingReads.get(queryClient);
  if (!listeners) {
    listeners = new Set();
    pendingReads.set(queryClient, listeners);
  }
  const changes: NotificationChange[] = [];
  const recordChange = (change: NotificationChange) => { changes.push(change); };
  listeners.add(recordChange);
  try {
    let page = await apiPage<Notification>(path, { signal: options.signal });
    const cached = options.queryKey
      ? queryClient.getQueryData<{ pages?: Page<Notification>[] }>(options.queryKey)
      : undefined;
    const laterPageIds = new Set(cached?.pages?.slice(1).flatMap((page) =>
      page.data.map((row) => row.notification_id)));
    for (const change of changes) page = change(page, !options.cursor, laterPageIds);
    return options.unreadOnly ? { ...page, data: page.data.filter((row) => !row.read) } : page;
  } finally {
    listeners.delete(recordChange);
    if (listeners.size === 0) pendingReads.delete(queryClient);
  }
}

function publishNotificationChange(queryClient: QueryClient, change: NotificationChange): void {
  for (const listener of pendingReads.get(queryClient) ?? []) listener(change);
}

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
  const incomingTime = createdTime(incoming);
  const index = incoming.pinned
    ? 0
    : rows.findIndex((row) => !row.pinned && createdTime(row) < incomingTime);
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
  if (unreadOnly && incoming.read) {
    return existing ? rows.filter((_, i) => i !== index) : rows;
  }
  let next = rows;
  if (existing && existing.pinned === incoming.pinned) {
    // Edits keep their place in the server order.
    next = rows.map((row, i) => (i === index ? incoming : row));
  } else if (existing || allowInsert) {
    next = insertNotification(rows.filter((row) => row !== existing), incoming);
  }
  return next;
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
  const existing = pages.map((page) => page.data.find((row) =>
    row.notification_id === incoming.notification_id)).find(Boolean);
  if (!existing || existing.pinned === incoming.pinned || incoming.version < existing.version) return false;
  return pages.length > 1 || Boolean(pages[0]?.page?.has_more);
}

export function updateNotificationCache(
  value: unknown,
  incoming: Notification,
  unreadOnly: boolean,
  allowInsert = true,
): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.pages)) {
    const pages = record.pages as unknown[];
    const existing = notificationPages(value).map((page) => page.data.find((row) =>
      row.notification_id === incoming.notification_id)).find(Boolean);
    // A row loaded on a later page must be edited there, never also inserted
    // into the first page. Its version guards the whole list against replay.
    if (existing && incoming.version < existing.version) return value;
    return {
      ...record,
      pages: pages.map((page, index) => updateNotificationCache(
        page, incoming, unreadOnly, allowInsert && index === 0 && !existing,
      )),
    };
  }
  if (Array.isArray(record.data) && record.page && typeof record.page === "object") {
    const rows = record.data as Notification[];
    const oldest = rows.at(-1);
    // An edit from beyond this cursor boundary belongs to a later page. Only
    // a genuinely newer row (or a new pin) may extend a truncated list head.
    const withinPage = !(record.page as Page<Notification>["page"]).has_more || !oldest ||
      incoming.pinned || createdTime(incoming) >= createdTime(oldest);
    return {
      ...record,
      data: mergeNotificationRows(rows, incoming, unreadOnly, allowInsert && withinPage),
    };
  }
  return value;
}

export function updateNotificationCaches(
  queryClient: QueryClient,
  incoming: Notification,
): void {
  publishNotificationChange(queryClient, (page, allowInsert, laterPageIds) =>
    updateNotificationCache(page, incoming, false, allowInsert && !laterPageIds.has(incoming.notification_id)) as Page<Notification>);
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
  publishNotificationChange(queryClient, (page) => ({
    ...page,
    data: page.data.map((row) => matches(row) && !row.read ? { ...row, read: true } : row),
  }));
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

/** Snapshot the rows known before a potentially slow read-all request begins. */
export function notificationIdsInCaches(queryClient: QueryClient): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [, current] of queryClient.getQueriesData({ queryKey: ["notifications"] })) {
    for (const page of notificationPages(current)) {
      for (const row of page.data) ids.add(row.notification_id);
    }
  }
  return ids;
}
