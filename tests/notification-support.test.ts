import test from "node:test";
import assert from "node:assert/strict";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { inquiryMessagesOptions, mergeInquiryMessages } from "../src/lib/hooks/support";
import type { InquiryDetail, InquiryMessage } from "../src/lib/types";

const message = (id: number): InquiryMessage => ({
  id: `msg_${id}`, ticket: "ticket /?", author_user_id: "usr_1", author_acl: "USER",
  body: `message ${id}`, created_at: new Date(id * 1000).toISOString(),
});
const messages = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => message(from + i));
const detail: InquiryDetail = {
  ticket: "ticket /?", user_id: "usr_1", category: "OTHER", subject: "Long thread",
  status: "WAITING_ADMIN", created_at: message(1).created_at, updated_at: message(120).created_at,
  messages: messages(71, 120), messages_page: { has_more: true, next_cursor: "before 71/+" },
};

test("a 120-message inquiry prepends both older pages using the server cursor without reloading its newest 50", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const requests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (path: string, options: RequestInit) => {
    const url = new URL(path);
    requests.push(url);
    assert.equal(url.pathname, "/api/v1/inquiries/ticket%20%2F%3F/messages");
    assert.equal(url.searchParams.get("limit"), "50");
    assert.ok(options.signal);
    return Response.json(url.searchParams.get("cursor") === "before 71/+"
      ? { data: messages(21, 70), page: { has_more: true, next_cursor: "before21" } }
      : { data: messages(1, 20), page: { has_more: false, next_cursor: null } });
  });
  const observer = new InfiniteQueryObserver(client, inquiryMessagesOptions(detail));
  assert.equal(observer.getCurrentResult().data?.pages[0].data.length, 50);
  assert.equal(observer.getCurrentResult().hasNextPage, true);
  assert.equal(requests.length, 0);
  const first = await observer.fetchNextPage();
  assert.deepEqual(mergeInquiryMessages(detail.messages, first.data?.pages).map(row => row.id), messages(21, 120).map(row => row.id));
  const second = await observer.fetchNextPage();
  assert.deepEqual(mergeInquiryMessages(detail.messages, second.data?.pages).map(row => row.id), messages(1, 120).map(row => row.id));
  assert.equal(second.hasNextPage, false);
  assert.deepEqual(requests.map(url => url.searchParams.get("cursor")), ["before 71/+", "before21"]);
});

test("thread merging deduplicates a refreshed newest page and keeps new replies", () => {
  const pages = [
    { data: messages(70, 119), page: { has_more: true, next_cursor: "older" } },
    { data: messages(20, 69), page: { has_more: false, next_cursor: null } },
  ];
  const latest = messages(71, 121).map(row => row.id === "msg_80" ? { ...row, body: "updated" } : row);
  const result = mergeInquiryMessages(latest, pages);
  assert.deepEqual(result.map(row => row.id), messages(20, 121).map(row => row.id));
  assert.equal(result.find(row => row.id === "msg_80")?.body, "updated");
});
