import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { invitationBody, registrationBody, completePasskeyRegistration } from "../src/app/(auth)/auth-contract";
import { sessionsQueryOptions } from "../src/lib/hooks/session";
import type { SessionInfo } from "../src/lib/types";

test("signup verification sends exactly the backend's two supported fields", () => {
  const credential = { id: "passkey", response: {} };
  assert.deepEqual(registrationBody({ ceremonyId: "ceremony", credential }), {
    ceremony_id: "ceremony", credential,
  });
  const page = readFileSync(new URL("../src/app/(auth)/signup/page.tsx", import.meta.url), "utf8");
  assert.match(page, /registrationBody\(registration\)/);
  assert.match(page, /if \(!agreed\)/);
});

test("invitation redemption sends only the invitation token, retaining consent gating", () => {
  assert.deepEqual(invitationBody("  invitation-secret  "), { invitation_token: "invitation-secret" });
  const page = readFileSync(new URL("../src/app/(auth)/invite/page.tsx", import.meta.url), "utf8");
  assert.match(page, /invitationBody\(token\)/);
  assert.match(page, /if \(busy \|\| !agreed/);
});

test("invited activation displays returned recovery keys without navigating", () => {
  const keys = ["secret-1", "secret-2"];
  let shown: string[] | null = null;
  let finished = false;
  completePasskeyRegistration({ recovery_keys: keys }, (value) => { shown = value; }, () => { finished = true; });
  assert.deepEqual(shown, keys);
  assert.equal(finished, false);
  const page = readFileSync(new URL("../src/app/(auth)/recover/page.tsx", import.meta.url), "utf8");
  assert.match(page, /completePasskeyRegistration\(/);
  assert.match(page, /<RecoveryKeyGrid keys=\{recoveryKeys\}/);
  assert.match(page, /disabled=\{!savedConfirmed\}/);
  assert.match(page, /status === "authenticated" && !recoveryKeys/);
});

test("ordinary recovery without newly issued keys finishes immediately", () => {
  for (const result of [{}, { recovery_keys: [] }]) {
    let finished = false;
    completePasskeyRegistration(result, () => assert.fail("no keys to display"), () => { finished = true; });
    assert.equal(finished, true);
  }
});

test("security sessions load 50 rows then follow the nested next_cursor", async (t) => {
  const urls: string[] = [];
  const first = Array.from({ length: 50 }, (_, i) => ({ session_id: `ses_${i}` } as SessionInfo));
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return Response.json({ data: {
      sessions: urls.length === 1 ? first : [{ session_id: "ses_50" }],
      next_cursor: urls.length === 1 ? "ses_49" : null,
    } });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  t.after(() => client.clear());
  const observer = new InfiniteQueryObserver(client, sessionsQueryOptions());
  await observer.refetch();
  assert.equal(observer.getCurrentResult().hasNextPage, true);
  await observer.fetchNextPage();
  const result = observer.getCurrentResult();
  assert.equal(result.data?.pages.flatMap((page) => page.sessions).length, 51);
  assert.equal(result.hasNextPage, false);
  assert.equal(new URL(urls[0]).search, "?limit=50");
  assert.equal(new URL(urls[1]).search, "?limit=50&cursor=ses_49");
  const page = readFileSync(new URL("../src/app/(app)/security/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<LoadMoreButton/);
  assert.match(page, /sessions.fetchNextPage\(\)/);
});
