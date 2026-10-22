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

for (const seeded of [false, true]) {
  for (const finishBeforeDeadline of [true, false]) {
    test(`an older ${seeded ? "refetch" : "initial fetch"} finishing ${finishBeforeDeadline ? "before" : "after"} the batch cannot consume an event`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const client = new QueryClient();
      if (seeded) client.setQueryData(["accounts"], "previous-balance");
      const resolvers: Array<(value: string) => void> = [];
      const observer = new QueryObserver(client, {
        queryKey: ["accounts"],
        queryFn: () => new Promise<string>((resolve) => resolvers.push(resolve)),
        staleTime: Infinity,
      });
      const unsubscribe = observer.subscribe(() => {});
      if (seeded) void observer.refetch();
      try {
        assert.equal(resolvers.length, 1);
        invalidateBatched(client, [["accounts"]]);
        if (finishBeforeDeadline) {
          resolvers[0]("pre-event");
          await new Promise((resolve) => setImmediate(resolve));
        }
        t.mock.timers.tick(300);
        await new Promise((resolve) => setImmediate(resolve));
        if (!finishBeforeDeadline) {
          assert.equal(resolvers.length, 1, "the in-flight request is allowed to finish");
          resolvers[0]("pre-event");
          await new Promise((resolve) => setImmediate(resolve));
        }
        assert.equal(resolvers.length, 2, "a post-event fetch follows the tainted response");
        resolvers[1]("post-event");
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(client.getQueryData(["accounts"]), "post-event");
      } finally {
        unsubscribe();
        client.clear();
      }
    });
  }
}

test("continuous events complete bounded fetches without cancelling requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new QueryClient();
  let revision = 0;
  let started = 0;
  let completed = 0;
  let cancelled = 0;
  const observer = new QueryObserver(client, {
    queryKey: ["accounts"],
    staleTime: Infinity,
    queryFn: ({ signal }) => {
      started += 1;
      const value = revision;
      return new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => { completed += 1; resolve(value); }, 250);
        signal.addEventListener("abort", () => {
          cancelled += 1;
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      });
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  const advance = async () => {
    t.mock.timers.tick(100);
    await new Promise((resolve) => setImmediate(resolve));
  };
  try {
    for (let event = 1; event <= 30; event += 1) {
      await advance();
      revision = event;
      invalidateBatched(client, [["accounts"]]);
    }
    const completedDuringEvents = completed;
    // Drain the last batch and any fetch waiting for its predecessor.
    for (let step = 0; step < 10; step += 1) await advance();
    const metrics = JSON.stringify({ started, completed, completedDuringEvents, cancelled });
    t.diagnostic(metrics);
    assert.equal(cancelled, 0, metrics);
    assert.ok(completedDuringEvents > 0, metrics);
    assert.ok(started <= 30 / 2 + 2, metrics);
    assert.equal(completed, started, metrics);
    assert.equal(client.getQueryData(["accounts"]), 30);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("an untainted poll started after the event makes the batch refetch unnecessary", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new QueryClient();
  client.setQueryData(["accounts"], "cached");
  let fetches = 0;
  let resolvePoll!: (value: string) => void;
  const observer = new QueryObserver(client, {
    queryKey: ["accounts"],
    staleTime: Infinity,
    queryFn: () => {
      fetches += 1;
      return new Promise<string>(resolve => { resolvePoll = resolve; });
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    invalidateBatched(client, [["accounts"]]);
    t.mock.timers.tick(100);
    const poll = observer.refetch({ cancelRefetch: false });
    t.mock.timers.tick(100);
    resolvePoll("post-event");
    await poll;
    t.mock.timers.tick(100);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fetches, 1);
    assert.equal(client.getQueryData(["accounts"]), "post-event");
    assert.equal(client.getQueryState(["accounts"])?.isInvalidated, false);
  } finally {
    unsubscribe();
    client.clear();
  }
});
