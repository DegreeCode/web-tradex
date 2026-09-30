import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { invalidateBatched } from "../src/lib/query-batch";

test("a burst of invalidations refetches each active query once", async () => {
  const client = new QueryClient();
  let fetches = 0;
  const observer = new QueryObserver(client, {
    queryKey: ["portfolio", "primary"],
    queryFn: async () => ++fetches,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  assert.equal(fetches, 1);

  // e.g. a trigger.activated stream frame and its notification
  invalidateBatched(client, [["portfolio"], ["nav"]]);
  invalidateBatched(client, [["portfolio"]]);
  assert.equal(client.getQueryState(["portfolio", "primary"])?.isInvalidated, true);
  assert.equal(fetches, 1);

  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(fetches, 2);
  unsubscribe();
  client.clear();
});

test("passive keys are only marked stale", async () => {
  const client = new QueryClient();
  let fetches = 0;
  const observer = new QueryObserver(client, {
    queryKey: ["nav-history", "user", "1mo"],
    queryFn: async () => ++fetches,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  invalidateBatched(client, [["nav-history"]], { passive: true });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(client.getQueryState(["nav-history", "user", "1mo"])?.isInvalidated, true);
  assert.equal(fetches, 1);
  unsubscribe();
  client.clear();
});
