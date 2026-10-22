import test from "node:test";
import assert from "node:assert/strict";
import { InfiniteQueryObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { marginPositionQueryOptions, marginPositionsQueryOptions, type MarginPosition, type MarginPositionsData } from "../src/lib/margin";
import { marginCapacityQueryOptions } from "../src/lib/hooks/margin-capacity";
import { ApiError } from "../src/lib/api";

test("margin keeps live valuation polling even with an open socket and pauses the list for details", () => {
  const client = new QueryClient();
  try {
    for (const socket of ["open", "closed"] as const) {
      for (const status of ["OPEN", "LIQUIDATING", "CLOSED"] as const) {
        const position = { position_id: "mgn_a", status } as MarginPosition;
        const detail = marginPositionQueryOptions("mgn_a", socket);
        client.setQueryData(detail.queryKey, position);
        const query = new QueryObserver(client, detail).getCurrentQuery();
        assert.equal(typeof detail.refetchInterval, "function");
        if (typeof detail.refetchInterval !== "function") assert.fail("missing interval");
        assert.equal(detail.refetchInterval(query), status !== "CLOSED" ? 5_000 : false);
        assert.equal(detail.staleTime, socket === "open" ? 60_000 : 10_000);
        const list = marginPositionsQueryOptions({ accountId: "acc_a" }, socket);
        client.setQueryData(list.queryKey, { pages: [{ positions: [position], page: { has_more: false, next_cursor: null }, eligibility: {} } as MarginPositionsData], pageParams: [null] });
        const listQuery = new InfiniteQueryObserver(client, list).getCurrentQuery();
        if (typeof list.refetchInterval !== "function") assert.fail("missing interval");
        assert.equal(list.refetchInterval(listQuery), status !== "CLOSED" ? 10_000 : false);
        const paused = marginPositionsQueryOptions({ poll: false }, socket);
        if (typeof paused.refetchInterval !== "function") assert.fail("missing interval");
        assert.equal(paused.refetchInterval(listQuery), false);
      }
    }
    assert.equal(marginPositionQueryOptions(null, "closed").enabled, false);
  } finally { client.clear(); }
});

test("hidden margin capacity observers are disabled and terminal 4xx stop automatic refresh traffic", () => {
  const client = new QueryClient();
  try {
    assert.equal(marginCapacityQueryOptions("ALPHA.M", false).enabled, false);
    assert.equal(marginCapacityQueryOptions(undefined).enabled, false);
    const options = marginCapacityQueryOptions("ALPHA.M");
    const query = new QueryObserver(client, options).getCurrentQuery();
    const { refetchInterval, refetchOnWindowFocus, refetchOnMount, refetchOnReconnect } = options;
    if (typeof refetchInterval !== "function" || typeof refetchOnWindowFocus !== "function" ||
        typeof refetchOnMount !== "function" || typeof refetchOnReconnect !== "function") assert.fail("missing refresh policy");
    for (const status of [403, 404, 429]) {
      query.setState({ error: new ApiError(status, "DISABLED", "unavailable") });
      assert.equal(refetchInterval(query), false);
      assert.equal(refetchOnWindowFocus(query), false);
      assert.equal(refetchOnReconnect(query), false);
      assert.equal(refetchOnMount(query), false);
    }
    query.setState({ error: new ApiError(503, "UNAVAILABLE", "offline") });
    assert.equal(refetchInterval(query), 60_000);
    assert.equal(refetchOnWindowFocus(query), true);
    assert.equal(refetchOnMount(query), true);
  } finally { client.clear(); }
});

test("hidden capacity observers make no request until the form becomes visible", async (t) => {
  const client = new QueryClient();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({ data: { symbol: "ALPHA.M", display: "BINARY", long: { available: true } } });
  });
  const observer = new QueryObserver(client, marginCapacityQueryOptions("ALPHA.M", false));
  const off = observer.subscribe(() => {});
  t.after(() => { off(); client.clear(); });
  assert.equal(requests, 0);
  observer.setOptions(marginCapacityQueryOptions("ALPHA.M", true));
  await observer.refetch();
  assert.equal(requests, 1);
});

test("remounting a disabled capacity endpoint does not repeat its 4xx request", async (t) => {
  const client = new QueryClient();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({ error: { code: "MARGIN_STATUS_DISABLED" } }, { status: 403 });
  });
  const options = marginCapacityQueryOptions("ALPHA.M");
  const first = new QueryObserver(client, options);
  const offFirst = first.subscribe(() => {});
  await first.refetch();
  offFirst();
  const second = new QueryObserver(client, options);
  const offSecond = second.subscribe(() => {});
  t.after(() => { offSecond(); client.clear(); });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
});
