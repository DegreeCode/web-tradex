import test from "node:test";
import assert from "node:assert/strict";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { ApiError } from "../src/lib/api";
import { pnlQueryOptions } from "../src/lib/pnl-query";
import { invalidateBatched } from "../src/lib/query-batch";
import type { PnLSummary } from "../src/lib/pnl";

const filters = {
  market_type: "ALL" as const,
  account_id: "acc_a",
  symbol: "AAA.M",
};
const before = "2026-10-06T04:11:47.38228Z";
const after = "2026-10-06T04:12:47.382281Z";
const total = (as_of: string): PnLSummary => ({
  as_of,
  market_type: "ALL",
  realized_pnl: "1.2345678901234567",
  spot_realized_pnl: "1",
  margin_realized_pnl: "0.2345678901234567",
  entry_count: 1,
  accounts: [],
});
const history = (url: URL) =>
  Response.json({
    data: [],
    as_of: url.searchParams.get("as_of"),
    market_type: "ALL",
    page: {
      has_more: !url.searchParams.has("cursor"),
      next_cursor: url.searchParams.has("cursor") ? null : "next_page",
    },
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("pagination and background refresh use one summary cutoff for every page", async (t) => {
  let summaries = 0;
  const requests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/history")) {
      requests.push(url);
      return history(url);
    }
    return Response.json({ data: total(++summaries === 1 ? before : after) });
  });
  const client = new QueryClient();
  const observer = new InfiniteQueryObserver(client, {
    ...pnlQueryOptions(filters),
    enabled: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  t.after(() => {
    unsubscribe();
    client.clear();
  });

  await observer.refetch();
  await observer.fetchNextPage({ cancelRefetch: false });
  assert.equal(summaries, 1);
  assert.equal(requests[0].searchParams.get("as_of"), before);
  assert.equal(requests[1].searchParams.get("as_of"), before);
  assert.equal(requests[1].searchParams.get("cursor"), "next_page");

  await observer.refetch({ cancelRefetch: false });
  assert.equal(summaries, 2);
  assert.deepEqual(
    requests.slice(2).map((url) => url.searchParams.get("as_of")),
    [after, after],
  );
  const pages = observer.getCurrentResult().data!.pages;
  assert.equal(pages[0].summary!.as_of, after);
  assert(pages.every((page) => page.as_of === after));
  for (const url of requests) {
    assert.equal(url.searchParams.get("account_id"), "acc_a");
    assert.equal(url.searchParams.get("symbol"), "AAA.M");
  }
});

test(
  "overlapping refreshes and financial events never cancel or repeat an in-flight history request",
  { timeout: 5000 },
  async (t) => {
    let summaries = 0;
    let historyRequests = 0;
    let stalled = false;
    let historySignal: AbortSignal | undefined;
    let historyURL: URL | undefined;
    const started = deferred<void>();
    const pending = deferred<Response>();
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string, options: RequestInit) => {
        const url = new URL(input);
        if (!url.pathname.endsWith("/history"))
          return Response.json({
            data: total(++summaries === 1 ? before : after),
          });
        historyRequests++;
        if (!stalled) return history(url);
        historyURL = url;
        historySignal = options.signal as AbortSignal;
        historySignal.addEventListener(
          "abort",
          () => pending.reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        started.resolve(undefined);
        return pending.promise;
      },
    );
    const client = new QueryClient();
    const observer = new InfiniteQueryObserver(client, {
      ...pnlQueryOptions(filters),
      enabled: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    t.after(() => {
      unsubscribe();
      client.clear();
    });
    await observer.refetch();
    // Enabled observers are the same ones mounted by the investment screen.
    observer.setOptions(pnlQueryOptions(filters));
    stalled = true;
    const refresh = observer.refetch({ cancelRefetch: false });
    await started.promise;
    const repeated = observer.refetch({ cancelRefetch: false });
    invalidateBatched(client, [["pnl"], ["pnl-history"]]);
    invalidateBatched(client, [["pnl"]]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(historySignal!.aborted, false);
    assert.equal(historyRequests, 2);
    assert.equal(summaries, 2);
    assert.equal(historyURL!.searchParams.get("as_of"), after);
    pending.resolve(history(historyURL!));
    await Promise.all([refresh, repeated]);
    assert.equal(
      observer.getCurrentResult().data!.pages[0].summary!.as_of,
      after,
    );
  },
);

test("a failed first history page retains the summary and exposes its recovery boundary", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (input.includes("/history"))
      return Response.json(
        {
          error: {
            code: "PNL_HISTORY_UNAVAILABLE",
            message: "unavailable",
            details: { available_from: after },
          },
        },
        { status: 409 },
      );
    return Response.json({ data: total(before) });
  });
  const client = new QueryClient();
  t.after(() => client.clear());
  const result = await client.fetchInfiniteQuery(pnlQueryOptions(filters));
  const page = result.pages[0];
  assert.equal(page.summary!.realized_pnl, "1.2345678901234567");
  assert(page.historyError instanceof ApiError);
  assert.equal(page.historyError.details?.available_from, after);
  assert.equal(page.page.has_more, false);
});

test("filter and session cancellation still abort the underlying request", async (t) => {
  const started = deferred<AbortSignal>();
  t.mock.method(globalThis, "fetch", (input: string, options: RequestInit) => {
    if (!input.includes("/history"))
      return Promise.resolve(Response.json({ data: total(before) }));
    const signal = options.signal as AbortSignal;
    started.resolve(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  });
  const client = new QueryClient();
  t.after(() => client.clear());
  const options = pnlQueryOptions(filters);
  const pending = client.fetchInfiniteQuery(options);
  const rejected = assert.rejects(pending);
  const signal = await started.promise;
  await client.cancelQueries({ queryKey: options.queryKey });
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(client.getQueryData(options.queryKey), undefined);
});
