import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  loadNotificationPage,
  markNotificationsReadInCaches,
  notificationIdsInCaches,
  updateNotificationCaches,
} from "../src/lib/notification-cache";
import type { Notification, Page } from "../src/lib/types";

const notification = (id: number, read = false): Notification => ({
  notification_id: `ntf_${id}`, kind: "USER", title: "Notice", body: "Notice",
  version: 1, pinned: false, read, expires_at: null,
  created_at: new Date(1700000000000 + id * 1000).toISOString(),
  updated_at: new Date(1700000000000 + id * 1000).toISOString(),
});
const page = (rows: Notification[], hasMore = false): Page<Notification> => ({
  data: rows, page: { has_more: hasMore, next_cursor: hasMore ? "next" : null },
});
const infinite = (...pages: Page<Notification>[]): InfiniteData<Page<Notification>> => ({ pages, pageParams: pages.map(() => null) });

function seed(unreadHasMore: boolean) {
  const client = new QueryClient();
  client.setQueryData(["notifications", "list", "all", 30], infinite(page([notification(3), notification(2, true), notification(1)])));
  client.setQueryData(["notifications", "list", "unread", 30], infinite(page([notification(3), notification(1)])));
  client.setQueryData(["notifications", "unread"], page([notification(3), notification(1)], unreadHasMore));
  return client;
}

test("a batch read updates every cached list without refetching complete pages", () => {
  const client = seed(false);
  markNotificationsReadInCaches(client, new Set(["ntf_3"]));

  const all = client.getQueryData<InfiniteData<Page<Notification>>>(["notifications", "list", "all", 30]);
  assert.deepEqual(all?.pages[0].data.map((row) => [row.notification_id, row.read]), [["ntf_3", true], ["ntf_2", true], ["ntf_1", false]]);
  const unreadList = client.getQueryData<InfiniteData<Page<Notification>>>(["notifications", "list", "unread", 30]);
  assert.deepEqual(unreadList?.pages[0].data.map((row) => row.notification_id), ["ntf_1"]);
  assert.deepEqual(client.getQueryData<Page<Notification>>(["notifications", "unread"])?.data.map((row) => row.notification_id), ["ntf_1"]);
  assert.equal(client.getQueryState(["notifications", "unread"])?.isInvalidated, false);
});

test("a truncated unread badge page is refreshed after a partial read", () => {
  const client = seed(true);
  markNotificationsReadInCaches(client, new Set(["ntf_3"]));
  assert.equal(client.getQueryState(["notifications", "unread"])?.isInvalidated, true);
});

test("read-all empties unread lists and marks them complete", () => {
  const client = seed(true);
  markNotificationsReadInCaches(client, "all");

  const unread = client.getQueryData<Page<Notification>>(["notifications", "unread"]);
  assert.deepEqual(unread, { data: [], page: { has_more: false, next_cursor: null } });
  const all = client.getQueryData<InfiniteData<Page<Notification>>>(["notifications", "list", "all", 30]);
  assert.ok(all?.pages[0].data.every((row) => row.read));
  assert.equal(client.getQueryState(["notifications", "unread"])?.isInvalidated, false);
});

test("editing a later page never duplicates its row into the first page, including stale replays", () => {
  const client = new QueryClient();
  const key = ["notifications", "list", "all", 30];
  client.setQueryData(key, infinite(page([notification(3)], true), page([notification(1)])));
  updateNotificationCaches(client, { ...notification(1), version: 2, title: "Edited" });
  updateNotificationCaches(client, notification(1));
  const result = client.getQueryData<InfiniteData<Page<Notification>>>(key)!;
  assert.deepEqual(result.pages.map((p) => p.data.map((row) => row.notification_id)), [["ntf_3"], ["ntf_1"]]);
  assert.equal(result.pages[1].data[0].title, "Edited");
  client.clear();
});

test("an older unseen notification edit never extends a truncated loaded prefix", () => {
  const client = new QueryClient();
  const key = ["notifications", "list", "all", 30];
  client.setQueryData(key, infinite(page([notification(3), notification(2)], true)));
  updateNotificationCaches(client, { ...notification(1), read: true, version: 2 });
  const result = client.getQueryData<InfiniteData<Page<Notification>>>(key)!;
  assert.deepEqual(result.pages[0].data.map((row) => row.notification_id), ["ntf_3", "ntf_2"]);
  client.clear();
});

test("a slow first REST page preserves new notifications and read actions received during the request", async (t) => {
  const client = new QueryClient();
  const responses: Array<(response: Response) => void> = [];
  t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => responses.push(resolve)));
  t.after(() => client.clear());
  const all = loadNotificationPage(client, "/api/v1/notifications", { unreadOnly: false });
  const unread = loadNotificationPage(client, "/api/v1/notifications", { unreadOnly: true });
  updateNotificationCaches(client, notification(4));
  markNotificationsReadInCaches(client, new Set(["ntf_3"]));
  for (const respond of responses) respond(Response.json(page([notification(3)], true)));
  assert.deepEqual((await all).data.map((row) => [row.notification_id, row.read]), [["ntf_4", false], ["ntf_3", true]]);
  assert.deepEqual((await unread).data.map((row) => row.notification_id), ["ntf_4"]);
});

test("a cursor page applies edits without inserting live arrivals that belong at the list head", async (t) => {
  const client = new QueryClient();
  let respond!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { respond = resolve; }));
  t.after(() => client.clear());
  const pending = loadNotificationPage(client, "/api/v1/notifications?cursor=older", { unreadOnly: false, cursor: "older" });
  updateNotificationCaches(client, notification(4));
  updateNotificationCaches(client, { ...notification(1), title: "Edited", version: 2 });
  respond(Response.json(page([notification(1)])));
  const result = await pending;
  assert.deepEqual(result.data.map((row) => row.notification_id), ["ntf_1"]);
  assert.equal(result.data[0].title, "Edited");
});

test("a first-page REST refresh never pulls an older edited row across its cursor boundary", async (t) => {
  const client = new QueryClient();
  let respond!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { respond = resolve; }));
  t.after(() => client.clear());
  const pending = loadNotificationPage(client, "/api/v1/notifications", { unreadOnly: false });
  updateNotificationCaches(client, { ...notification(1), read: true, version: 2 });
  respond(Response.json(page([notification(3), notification(2)], true)));
  assert.deepEqual((await pending).data.map((row) => row.notification_id), ["ntf_3", "ntf_2"]);
});

test("a pinned row edited on a later page stays there while an earlier REST page refreshes", async (t) => {
  const client = new QueryClient();
  const key = ["notifications", "list", "all", 30];
  const pinned = (id: number) => ({ ...notification(id), pinned: true });
  client.setQueryData(key, infinite(page([pinned(3), pinned(2)], true), page([pinned(1)])));
  let respond!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { respond = resolve; }));
  t.after(() => client.clear());
  const pending = loadNotificationPage(client, "/api/v1/notifications", { unreadOnly: false, queryKey: key });
  updateNotificationCaches(client, { ...pinned(1), title: "Edited", version: 2 });
  respond(Response.json(page([pinned(3), pinned(2)], true)));
  assert.deepEqual((await pending).data.map((row) => row.notification_id), ["ntf_3", "ntf_2"]);
});

test("a read-all snapshot preserves notifications that arrive after the request starts", () => {
  const client = seed(false);
  const ids = notificationIdsInCaches(client);
  updateNotificationCaches(client, notification(4));
  markNotificationsReadInCaches(client, ids);
  assert.deepEqual(client.getQueryData<Page<Notification>>(["notifications", "unread"])?.data.map((row) => row.notification_id), ["ntf_4"]);
  client.clear();
});
