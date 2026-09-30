import test from "node:test";
import assert from "node:assert/strict";
import { formatUnreadBadge } from "../src/lib/notifications";
import { updateNotificationCache } from "../src/lib/hooks";
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
