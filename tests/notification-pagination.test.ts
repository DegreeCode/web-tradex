import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InfiniteQueryObserver, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotificationsPage from "../src/app/(app)/notifications/page";
import { fetchNextNotificationPage, loadNotificationPage, markNotificationsReadInCaches, notificationCacheNeedsRefresh, updateNotificationCaches } from "../src/lib/notification-cache";
import type { Notification, Page } from "../src/lib/types";

const row: Notification = {
  notification_id: "ntf_1", kind: "USER", title: "Notice", body: "Notice", version: 1,
  pinned: false, read: false, expires_at: null, created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z",
};

test("an emptied loaded page still renders load-more and uses the unread badge's lower bound", () => {
  const client = new QueryClient();
  const page: Page<Notification> = { data: [row], page: { has_more: true, next_cursor: "older" } };
  client.setQueryData(["notifications", "list", "unread", 30], { pages: [page], pageParams: [null] });
  markNotificationsReadInCaches(client, new Set([row.notification_id]));
  const unread = client.getQueryData<{ pages: Page<Notification>[] }>(["notifications", "list", "unread", 30])!;
  assert.deepEqual(unread.pages[0].data, []);
  assert.equal(unread.pages[0].page.next_cursor, "older");
  // The load-more layout is shared by both tabs; render its empty cached state.
  client.setQueryData(["notifications", "list", "all", 30], unread);
  client.setQueryData(["notifications", "unread"], { data: [], page: { has_more: true, next_cursor: "older" } });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(NotificationsPage)));
  assert.match(html, /더보기/);
  assert.match(html, /안 읽음 50\+/);
  client.clear();
});


test("pagination refreshes a trimmed page before following its cursor, so displaced rows stay reachable", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const key = ["notifications", "list", "all", 2];
  const notice = (id: number) => ({ ...row, notification_id: `ntf_${id}`, created_at: new Date(id * 1000).toISOString() });
  const requests: Array<string | null> = [];
  t.mock.method(globalThis, "fetch", async (path: string) => {
    const cursor = new URL(path).searchParams.get("cursor");
    requests.push(cursor);
    return Response.json(cursor
      ? { data: [notice(1)], page: { has_more: false, next_cursor: null } }
      : { data: [notice(3), notice(2)], page: { has_more: true, next_cursor: "before2" } });
  });
  const observer = new InfiniteQueryObserver(client, {
    queryKey: key,
    queryFn: ({ pageParam }) => loadNotificationPage(client, `/api/v1/notifications?limit=2${pageParam ? `&cursor=${pageParam}` : ""}`, { unreadOnly: false, cursor: pageParam, queryKey: key }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.has_more ? last.page.next_cursor : null,
    initialData: { pages: [{ data: [notice(2), notice(1)], page: { has_more: false, next_cursor: null } }], pageParams: [null] },
  });
  updateNotificationCaches(client, notice(3));
  const result = await fetchNextNotificationPage({
    data: client.getQueryData(key),
    refetch: (options) => observer.refetch(options),
    fetchNextPage: () => observer.fetchNextPage(),
  });
  assert.deepEqual(requests, [null, "before2"]);
  assert.deepEqual(result.data?.pages.flatMap(page => page.data.map(row => row.notification_id)), ["ntf_3", "ntf_2", "ntf_1"]);
});

test("multi-page overflow collapses history to a contiguous head and refreshes before loading more", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const key = ["notifications", "list", "all", 3];
  const notice = (id: number) => ({ ...row, notification_id: `ntf_${id}`, created_at: new Date(id * 1000).toISOString() });
  const page = (ids: number[], cursor: string | null): Page<Notification> => ({
    data: ids.map(notice), page: { has_more: cursor !== null, next_cursor: cursor },
  });
  const requests: Array<string | null> = [];
  t.mock.method(globalThis, "fetch", async (path: string) => {
    const cursor = new URL(path).searchParams.get("cursor");
    requests.push(cursor);
    return Response.json(cursor === null ? page([8, 7, 6], "before6") : page([5, 4, 3], "before3"));
  });
  const observer = new InfiniteQueryObserver(client, {
    queryKey: key,
    queryFn: ({ pageParam }) => loadNotificationPage(client,
      `/api/v1/notifications?limit=3${pageParam ? `&cursor=${pageParam}` : ""}`,
      { unreadOnly: false, cursor: pageParam, queryKey: key }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.has_more ? last.page.next_cursor : null,
    initialData: {
      pages: [page([6, 5, 4], "before4"), page([3, 2, 1], null)],
      pageParams: [null, "before4"],
    },
  });
  for (const id of [7, 8]) {
    updateNotificationCaches(client, notice(id));
    const cached = client.getQueryData<{ pages: Page<Notification>[]; pageParams: unknown[] }>(key)!;
    assert.equal(cached.pages.length, 1);
    assert.equal(cached.pageParams.length, 1);
    assert.deepEqual(cached.pageParams, [null]);
    assert.deepEqual(cached.pages.flatMap(page => page.data.map(row => row.notification_id)),
      [id, id - 1, id - 2].map(id => `ntf_${id}`));
    assert.equal(cached.pages[0].page.has_more, true);
    assert.equal(notificationCacheNeedsRefresh(cached), true);
  }
  assert.deepEqual(requests, []);
  const result = await fetchNextNotificationPage({
    data: client.getQueryData(key),
    refetch: (options) => observer.refetch(options),
    fetchNextPage: () => observer.fetchNextPage(),
  });
  assert.deepEqual(requests, [null, "before6"]);
  assert.deepEqual(result.data?.pages.flatMap(page => page.data.map(row => row.notification_id)),
    [8, 7, 6, 5, 4, 3].map(id => `ntf_${id}`));
  assert.deepEqual(result.data?.pageParams, [null, "before6"]);
});
