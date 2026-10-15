import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { invalidateBatched } from "../src/lib/query-batch";

test("a burst of overlapping invalidations refetches each active query once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
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
  invalidateBatched(client, [["portfolio", "primary"], ["portfolio"]]);
  assert.equal(client.getQueryState(["portfolio", "primary"])?.isInvalidated, true);
  assert.equal(fetches, 1);

  t.mock.timers.tick(300);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 2);

  invalidateBatched(client, [["portfolio"]]);
  await observer.refetch();
  t.mock.timers.tick(300);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 3, "a poll that refreshes the query cancels the need for a batched refetch");
  unsubscribe();
  client.clear();
});

test("passive keys are only marked stale", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
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
  t.mock.timers.tick(300);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.getQueryState(["nav-history", "user", "1mo"])?.isInvalidated, true);
  assert.equal(fetches, 1);
  unsubscribe();
  client.clear();
});
