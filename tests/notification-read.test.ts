import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { markNotificationsReadInCaches } from "../src/lib/hooks";
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
