import test from "node:test";
import assert from "node:assert/strict";
import { authStatus } from "../src/lib/auth-status";
import type { User } from "../src/lib/types";

const user: User = { user_id: "usr_1", username: "alice", role: "USER", status: "ACTIVE", created_at: "2026-09-30T00:00:00Z" };

test("a recovery restriction wins over the anonymous value kept from the login page", () => {
  assert.equal(authStatus(null, true, "RECOVERY_RESTRICTED"), "recovery");
  assert.equal(authStatus(user, true, "RECOVERY_RESTRICTED"), "recovery");
  assert.equal(authStatus(undefined, true, "RECOVERY_RESTRICTED"), "recovery");
});

test("a linked session refused on /me is blocked, not signed in", () => {
  assert.equal(authStatus(user, true, "SESSION_SCOPE_FORBIDDEN"), "linked-blocked");
  assert.equal(authStatus(undefined, true, "SESSION_SCOPE_FORBIDDEN"), "linked-blocked");
});

test("other states keep their meaning", () => {
  assert.equal(authStatus(undefined, false), "loading");
  assert.equal(authStatus(user, false), "authenticated");
  assert.equal(authStatus(user, true, "INTERNAL"), "authenticated");
  assert.equal(authStatus(null, false), "anonymous");
  assert.equal(authStatus(undefined, true, "SESSION_INVALID"), "anonymous");
  assert.equal(authStatus(user, true, "SESSION_INVALID"), "anonymous");
});

test("ending a session drops the previous account's cached data", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const { clearSessionCache } = await import("../src/lib/hooks/session");
  const queryClient = new QueryClient();
  queryClient.setQueryData(["me"], null);
  queryClient.setQueryData(["notifications", "unread"], { data: [{ notification_id: "ntf_a" }], page: { has_more: false, next_cursor: null } });
  queryClient.setQueryData(["portfolio"], { total: "1" });
  await clearSessionCache(queryClient);
  assert.equal(queryClient.getQueryData(["notifications", "unread"]), undefined);
  assert.equal(queryClient.getQueryData(["portfolio"]), undefined);
  assert.equal(queryClient.getQueryData(["me"]), null, "the observed auth query stays");
  queryClient.clear();
});

test("switching accounts clears old private data while preserving and refreshing mounted queries", async () => {
  const { QueryClient, QueryObserver } = await import("@tanstack/react-query");
  const { resetSessionCache } = await import("../src/lib/hooks/session");
  const queryClient = new QueryClient();
  const queryKey = ["portfolio"];
  queryClient.setQueryData(["me"], user);
  queryClient.setQueryData(queryKey, { total: "old" });
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => ({ total: "new" }),
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  const previousQuery = queryClient.getQueryCache().find({ queryKey });
  const resetting = resetSessionCache(queryClient);
  assert.equal(queryClient.getQueryData(queryKey), undefined, "old account data disappears synchronously");
  assert.equal(queryClient.getQueryCache().find({ queryKey }), previousQuery, "the mounted observer keeps its query");
  await resetting;
  assert.deepEqual(observer.getCurrentResult().data, { total: "new" });
  assert.deepEqual(queryClient.getQueryData(["me"]), user);
  unsubscribe();
  queryClient.clear();
});
