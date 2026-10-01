import test from "node:test";
import assert from "node:assert/strict";
import { formatUnreadBadge } from "../src/lib/notifications";
import { pinChangeNeedsRefetch, updateNotificationCache } from "../src/lib/notification-cache";
import type { Notification, Page } from "../src/lib/types";

const notification = (id: number): Notification => ({
  notification_id: `ntf_${id}`, kind: "USER", title: "Notice", body: "Notice",
  version: 1, pinned: false, read: false, expires_at: null,
  created_at: new Date(1700000000000 + id * 1000).toISOString(),
  updated_at: new Date(1700000000000 + id * 1000).toISOString(),
});

test("REST and private updates keep the same 50+ badge, including repeated frames", () => {
  let cache: Page<Notification> = { data: Array.from({ length: 50 }, (_, i) => notification(i)), page: { has_more: true, next_cursor: "cursor" } };
  assert.equal(formatUnreadBadge(cache.data.length, cache.page.has_more), "50+");
  for (const id of [50, 51, 51]) cache = updateNotificationCache(cache, notification(id), true) as Page<Notification>;
  assert.equal(cache.data.length, 52);
  assert.equal(formatUnreadBadge(cache.data.length, cache.page.has_more), "50+");
  cache = updateNotificationCache(cache, { ...notification(51), read: true }, true) as Page<Notification>;
  assert.equal(cache.data.length, 51);
  assert.equal(formatUnreadBadge(cache.data.length, cache.page.has_more), "50+");
});

test("complete unread pages cross the cap without requiring a REST refresh", () => {
  assert.equal(formatUnreadBadge(0, false), null);
  assert.equal(formatUnreadBadge(1, false), "1");
  assert.equal(formatUnreadBadge(50, false), "50");
  assert.equal(formatUnreadBadge(51, false), "50+");
  assert.equal(formatUnreadBadge(49, true), "50+");
});

const ids = (page: Page<Notification>) => page.data.map((row) => row.notification_id);
const pinned = (id: number, version = 1): Notification => ({ ...notification(id), pinned: true, version });

test("private updates keep the pinned sort order", () => {
  // Server order: ntf_1 pinned most recently, then ntf_9, then unpinned newest first.
  let cache: Page<Notification> = {
    data: [pinned(1), pinned(9), notification(8), notification(5), notification(2)],
    page: { has_more: false, next_cursor: null },
  };
  cache = updateNotificationCache(cache, notification(6), false) as Page<Notification>;
  assert.deepEqual(ids(cache), ["ntf_1", "ntf_9", "ntf_8", "ntf_6", "ntf_5", "ntf_2"]);
  cache = updateNotificationCache(cache, pinned(3), false) as Page<Notification>;
  assert.deepEqual(ids(cache), ["ntf_3", "ntf_1", "ntf_9", "ntf_8", "ntf_6", "ntf_5", "ntf_2"]);
  // Editing a pinned notice keeps its place.
  cache = updateNotificationCache(cache, { ...pinned(9, 2), title: "Edited" }, false) as Page<Notification>;
  assert.deepEqual(ids(cache), ["ntf_3", "ntf_1", "ntf_9", "ntf_8", "ntf_6", "ntf_5", "ntf_2"]);
  // Pinning moves to the top; unpinning goes back by creation time.
  cache = updateNotificationCache(cache, pinned(5, 2), false) as Page<Notification>;
  assert.deepEqual(ids(cache), ["ntf_5", "ntf_3", "ntf_1", "ntf_9", "ntf_8", "ntf_6", "ntf_2"]);
  cache = updateNotificationCache(cache, { ...pinned(1, 2), pinned: false }, false) as Page<Notification>;
  assert.deepEqual(ids(cache), ["ntf_5", "ntf_3", "ntf_9", "ntf_8", "ntf_6", "ntf_2", "ntf_1"]);
});

test("pin changes refetch lists that are only partly loaded", () => {
  const complete: Page<Notification> = { data: [notification(2)], page: { has_more: false, next_cursor: null } };
  const partial: Page<Notification> = { ...complete, page: { has_more: true, next_cursor: "cursor" } };
  const pages = { pages: [complete, { ...complete, data: [notification(1)] }], pageParams: [null, "cursor"] };
  assert.equal(pinChangeNeedsRefetch(complete, pinned(2, 2)), false);
  assert.equal(pinChangeNeedsRefetch(partial, pinned(2, 2)), true);
  assert.equal(pinChangeNeedsRefetch(pages, pinned(1, 2)), true);
  assert.equal(pinChangeNeedsRefetch(partial, { ...notification(2), version: 2 }), false);
  assert.equal(pinChangeNeedsRefetch(partial, pinned(7)), false);
});
