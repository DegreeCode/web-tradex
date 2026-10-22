import test from "node:test";
import assert from "node:assert/strict";

import { ApiError, clearIdempotencyKeys, postIdempotentData } from "../src/lib/api";
import { estimateMarginReturnPercent, type MarginPosition, type MarginPositionsData } from "../src/lib/margin";
import {
  canRetryMarginClosure,
  classifyMarginClosureReturn,
  executeMarginClosures,
  MAX_MARGIN_CLOSURE_ROUNDS,
  marginClosureFailureState,
  marginClosureFromPosition,
  marginClosureSummary,
  prepareMarginClosures,
  reconcileMarginClosures,
  type MarginClosureAttempt,
} from "../src/lib/margin-close-all";

const accountId = "acc_selected";
const current = () => true;
const position = (id: string, status: MarginPosition["status"] = "OPEN"): MarginPosition => ({
  position_id: `mgn_${id}`,
  account_id: accountId,
  symbol: "ALPHA.M",
  side: "LONG",
  status,
  quantity: "10.00000000",
  leverage: "2.0",
} as MarginPosition);
const page = (positions: MarginPosition[], cursor: string | null = null): Pick<MarginPositionsData, "positions" | "page"> => ({
  positions, page: { has_more: cursor !== null, next_cursor: cursor },
});
const attempt = (id: string): MarginClosureAttempt => ({ position: position(id), state: "pending" });
const unknownAttempt = (id: string, error: unknown = new Error("unconfirmed closure")): MarginClosureAttempt => ({
  ...attempt(id), state: "unknown", error,
});

test("close all classifies positive, negative, zero and unknown estimates", () => {
  assert.equal(classifyMarginClosureReturn("25.125"), "PROFIT");
  assert.equal(classifyMarginClosureReturn("-25.125"), "LOSS");
  assert.equal(classifyMarginClosureReturn("0"), "NEUTRAL");
  assert.equal(classifyMarginClosureReturn("-0.0000000000000000"), "NEUTRAL");
  assert.equal(classifyMarginClosureReturn(null), "UNKNOWN");
});

test("close all matches displayed zero at two decimals using exact rounding boundaries", () => {
  for (const percent of ["0.0000000000000001", "-0.0000000000000001", "0.0049999999999999", "-0.0049999999999999"]) {
    assert.equal(classifyMarginClosureReturn(percent), "NEUTRAL", percent);
  }
  assert.equal(classifyMarginClosureReturn("0.0050000000000000"), "PROFIT");
  assert.equal(classifyMarginClosureReturn("-0.0050000000000000"), "LOSS");
});

test("close all derives LONG returns from funded margin plus remaining collateral", () => {
  const long = { ...position("long"), leverage: "3", borrowed_credit: "200", collateral: "0", equity: "125" };
  assert.equal(estimateMarginReturnPercent(long), "25");
  assert.equal(classifyMarginClosureReturn(estimateMarginReturnPercent(long)), "PROFIT");
  assert.equal(classifyMarginClosureReturn(estimateMarginReturnPercent({ ...long, equity: "75" })), "LOSS");
  assert.equal(classifyMarginClosureReturn(estimateMarginReturnPercent({ ...long, equity: "100" })), "NEUTRAL");
  assert.equal(classifyMarginClosureReturn(estimateMarginReturnPercent({ ...long, collateral: "25" })), "NEUTRAL");
  assert.equal(classifyMarginClosureReturn(estimateMarginReturnPercent({ ...long, equity: "100.0000000000000001" })), "NEUTRAL");
});

test("close all derives SHORT returns from current collateral", () => {
  const short = { ...position("short"), side: "SHORT" as const, collateral: "100", equity: "125" };
  assert.equal(estimateMarginReturnPercent(short), "25");
  assert.equal(classifyMarginClosureReturn(estimateMarginReturnPercent(short)), "PROFIT");
  assert.equal(classifyMarginClosureReturn(estimateMarginReturnPercent({ ...short, equity: "75" })), "LOSS");
  assert.equal(classifyMarginClosureReturn(estimateMarginReturnPercent({ ...short, equity: "100" })), "NEUTRAL");
  assert.equal(classifyMarginClosureReturn(estimateMarginReturnPercent({ ...short, collateral: "0" })), "UNKNOWN");
});

test("close all keeps non-OPEN positions and invalid return bases unknown", () => {
  const long = { ...position("a"), borrowed_credit: "100", collateral: "0", equity: "125" };
  for (const status of ["CLOSED", "LIQUIDATING", "CUSTODY", "LIQUIDATED", "DELISTED"] as const) {
    assert.equal(classifyMarginClosureReturn(estimateMarginReturnPercent({ ...long, status })), "UNKNOWN");
  }
  assert.equal(classifyMarginClosureReturn(estimateMarginReturnPercent({ ...long, leverage: "1" })), "UNKNOWN");
  assert.equal(classifyMarginClosureReturn(estimateMarginReturnPercent({ ...long, equity: "" })), "UNKNOWN");
});

test("close all scans every page for the selected account, filters OPEN and deduplicates", async () => {
  const a = position("a"), b = position("b");
  const calls: [string, string | null][] = [];
  const pages = [
    page([a, position("liquidating", "LIQUIDATING"), position("custody", "CUSTODY")], "next"),
    page([a, b, position("closed", "CLOSED"), position("liquidated", "LIQUIDATED"), position("delisted", "DELISTED")]),
  ];
  const targets = await prepareMarginClosures(async (account, cursor) => {
    calls.push([account, cursor]);
    return pages[calls.length - 1];
  }, accountId, current);
  assert.deepEqual(targets, [{ position: a, state: "pending" }, { position: b, state: "pending" }]);
  assert.deepEqual(calls, [[accountId, null], [accountId, "next"]]);
});

test("close all uses the latest duplicate status before selecting OPEN positions", async () => {
  let calls = 0;
  const targets = await prepareMarginClosures(async () => ++calls === 1
    ? page([position("a"), position("b", "CLOSED")], "next")
    : page([position("a", "CLOSED"), position("b")]), accountId, current);
  assert.deepEqual(targets.map(({ position }) => position.position_id), ["mgn_b"]);
});

for (const reason of ["failure", "missing cursor", "repeated cursor", "empty cursor"] as const) {
  test(`close all rejects an incomplete scan: ${reason}`, async () => {
    let calls = 0;
    await assert.rejects(prepareMarginClosures(async () => {
      if (++calls === 1) return page([position("a")], "next");
      if (reason === "failure") throw new Error("offline");
      return { positions: [], page: { has_more: true, next_cursor: reason === "missing cursor" ? null : reason === "empty cursor" ? "" : "next" } };
    }, accountId, current));
    assert.equal(calls, 2);
  });
}

test("close all rejects longer cursor cycles", async () => {
  let calls = 0;
  await assert.rejects(prepareMarginClosures(async () => page([], ["a", "b", "a"][calls++]), accountId, current));
  assert.equal(calls, 3);
});

test("close all refuses a missing account without scanning", async () => {
  await assert.rejects(prepareMarginClosures(async () => assert.fail("must not scan"), "", current), /계좌/);
});

test("close all rejects positions outside the selected account", async () => {
  await assert.rejects(prepareMarginClosures(async () => page([{ ...position("a"), account_id: "acc_other" }]), accountId, current), /계좌/);
});

test("close all rejects malformed page data instead of offering an incomplete confirmation", async () => {
  for (const value of [null, { positions: [] }, { positions: [], page: {} }, { positions: null, page: { has_more: false } }]) {
    await assert.rejects(prepareMarginClosures(async () => value as unknown as MarginPositionsData, accountId, current));
  }
});

test("close all stops a scan after context changes without requesting the next page", async () => {
  let valid = true;
  let calls = 0;
  await assert.rejects(prepareMarginClosures(async () => {
    calls++;
    valid = false;
    return page([position("a")], "next");
  }, accountId, () => valid), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("close all executes sequentially, continues after rejection and stops a partial with no progress", async () => {
  const targets = [attempt("a"), attempt("b"), attempt("c"), attempt("d")];
  const calls: string[] = [];
  const progress: MarginClosureAttempt[][] = [];
  let resolveFirst!: (value: MarginPosition) => void;
  const first = new Promise<MarginPosition>((resolve) => { resolveFirst = resolve; });
  const work = executeMarginClosures(async (target) => {
    calls.push(target.position_id);
    if (calls.length === 1) return first;
    if (calls.length === 2) throw new ApiError(409, "SYMBOL_HALTED", "거래 정지");
    if (calls.length === 3) return { ...position("c"), quantity: "0.00000001" };
    if (calls.length === 4) return { ...position("c"), quantity: "0.00000001" };
    return { ...position("d", "CLOSED"), quantity: "0" };
  }, targets, current, (results) => progress.push(results));
  assert.deepEqual(calls, ["mgn_a"]);
  resolveFirst({ ...position("a", "CLOSED"), quantity: "0" });
  const results = await work;
  assert.deepEqual(calls, ["mgn_a", "mgn_b", "mgn_c", "mgn_c", "mgn_d"]);
  assert.deepEqual(results.map(({ state }) => state), ["closed", "failed", "partial", "closed"]);
  assert.equal(results[2].result?.quantity, "0.00000001");
  assert.equal(results[2].rounds, 2);
  assert.equal(progress.length, 5);
  assert.deepEqual(progress[0].map(({ state }) => state), ["closed", "pending", "pending", "pending"]);
  assert.deepEqual(progress[1].map(({ state }) => state), ["closed", "failed", "pending", "pending"]);
  assert.deepEqual(progress[2].map(({ state }) => state), ["closed", "failed", "partial", "pending"]);
  assert.deepEqual(progress[3].map(({ state }) => state), ["closed", "failed", "partial", "pending"]);
  assert.deepEqual(progress[4].map(({ state }) => state), ["closed", "failed", "partial", "closed"]);
  assert.ok(targets.every(({ state }) => state === "pending"));
});

test("close all retries a partial closure until closed and reports every round", async () => {
  const progress: MarginClosureAttempt[][] = [];
  const quantities = ["6.00000000", "2.50000000"];
  let calls = 0;
  const results = await executeMarginClosures(async () => {
    calls++;
    return calls <= quantities.length
      ? { ...position("a"), quantity: quantities[calls - 1] }
      : { ...position("a", "CLOSED"), quantity: "0" };
  }, [attempt("a")], current, (attempts) => progress.push(attempts));
  assert.equal(calls, 3);
  assert.equal(results[0].state, "closed");
  assert.equal(results[0].rounds, 3);
  assert.equal(results[0].result?.status, "CLOSED");
  assert.deepEqual(progress.map(([result]) => result.state), ["partial", "partial", "closed"]);
  assert.deepEqual(progress.map(([result]) => result.rounds), [1, 2, 3]);
  assert.equal(progress[0][0].result?.quantity, "6.00000000");
});

test("close all stops a partial closure when the leftover quantity does not decrease", async () => {
  const progress: MarginClosureAttempt[][] = [];
  let calls = 0;
  const results = await executeMarginClosures(async () => {
    calls++;
    return { ...position("a"), quantity: "6.00000000" };
  }, [attempt("a")], current, (attempts) => progress.push(attempts));
  assert.equal(calls, 2);
  assert.equal(results[0].state, "partial");
  assert.equal(results[0].rounds, 2);
  assert.equal(results[0].result?.quantity, "6.00000000");
  assert.equal(progress.length, 2);
  assert.equal(progress[1][0].state, "partial");
});

test("close all stops automatic retries exactly at the round cap", async () => {
  const progress: MarginClosureAttempt[][] = [];
  let calls = 0;
  const results = await executeMarginClosures(async () => {
    calls++;
    return {
      ...position("a"),
      quantity: `0.${String(MAX_MARGIN_CLOSURE_ROUNDS - calls + 1).padStart(8, "0")}`,
    };
  }, [attempt("a")], current, (attempts) => progress.push(attempts));
  assert.equal(calls, MAX_MARGIN_CLOSURE_ROUNDS);
  assert.equal(results[0].state, "partial");
  assert.equal(results[0].rounds, MAX_MARGIN_CLOSURE_ROUNDS);
  assert.equal(results[0].result?.quantity, "0.00000001");
  assert.equal(progress.length, MAX_MARGIN_CLOSURE_ROUNDS);
});

test("close all keeps a follow-up network failure unknown with the last partial result", async () => {
  const error = new ApiError(0, "NETWORK_ERROR", "offline");
  let calls = 0;
  const results = await executeMarginClosures(async () => {
    calls++;
    if (calls === 1) return { ...position("a"), quantity: "6.00000000" };
    throw error;
  }, [attempt("a")], current, () => {});
  assert.equal(calls, 2);
  assert.equal(results[0].state, "unknown");
  assert.equal(results[0].rounds, 2);
  assert.equal(results[0].result?.quantity, "6.00000000");
  assert.equal(results[0].error, error);
  assert.equal(canRetryMarginClosure(results[0]), true);
});

test("close all retries an unknown follow-up through the loop from its last partial quantity", async () => {
  const error = new ApiError(0, "NETWORK_ERROR", "offline");
  let calls = 0;
  const close = async () => {
    calls++;
    if (calls === 1) return { ...position("a"), quantity: "6.00000000" };
    if (calls === 2) throw error;
    return { ...position("a", "CLOSED"), quantity: "0" };
  };
  const first = await executeMarginClosures(close, [attempt("a")], current, () => {});
  assert.equal(first[0].state, "unknown");
  assert.equal(first[0].result?.quantity, "6.00000000");
  const retried = await executeMarginClosures(close, first.map((result) => canRetryMarginClosure(result)
    ? { ...result, state: "pending", error: undefined } : result), current, () => {});
  assert.equal(calls, 3);
  assert.equal(retried[0].state, "closed");
  assert.equal(retried[0].rounds, 3);
});

test("close all keeps a definitive follow-up failure partial with the last result and error", async () => {
  const error = new ApiError(400, "REJECTED", "rejected");
  let calls = 0;
  const results = await executeMarginClosures(async () => {
    calls++;
    if (calls === 1) return { ...position("a"), quantity: "6.00000000" };
    throw error;
  }, [attempt("a")], current, () => {});
  assert.equal(calls, 2);
  assert.equal(results[0].state, "partial");
  assert.equal(results[0].rounds, 2);
  assert.equal(results[0].result?.quantity, "6.00000000");
  assert.equal(results[0].error, error);
  assert.equal(canRetryMarginClosure(results[0]), false);
});

test("close all stops after a follow-up 429 and skips remaining positions", async () => {
  const error = new ApiError(429, "RATE_LIMITED", "slow down");
  const progress: MarginClosureAttempt[][] = [];
  let calls = 0;
  await assert.rejects(executeMarginClosures(async () => {
    calls++;
    if (calls === 1) return { ...position("a"), quantity: "6.00000000" };
    throw error;
  }, [attempt("a"), attempt("b")], current, (attempts) => progress.push(attempts)), (caught) => caught === error);
  assert.equal(calls, 2);
  assert.equal(progress.length, 2);
  assert.deepEqual(progress[1].map(({ state }) => state), ["partial", "skipped"]);
  assert.equal(progress[1][0].result?.quantity, "6.00000000");
  assert.equal(progress[1][0].error, error);
  assert.equal(progress[1][1].error, error);
});

for (const error of [
  new ApiError(0, "NETWORK_ERROR", "offline"),
  new ApiError(500, "INTERNAL_ERROR", "server failure"),
  new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "busy"),
  new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "busy"),
  new ApiError(400, "INVALID_RESPONSE", "bad response"),
  new ApiError(200, "INVALID_RESPONSE", "bad response"),
  new Error("unrecognised transport error"),
]) {
  test(`close all marks ${error instanceof ApiError ? `${error.status} ${error.code}` : error.message} unknown and retries only unknown attempts`, async () => {
    const targets = [attempt("a"), attempt("b")];
    const calls: string[] = [];
    const close = async (target: MarginPosition) => {
      calls.push(target.position_id);
      if (calls.length === 1) throw error;
      return target.position_id === "mgn_b" ? { ...target } : { ...target, status: "CLOSED" as const, quantity: "0" };
    };
    const results = await executeMarginClosures(close, targets, current, () => {});
    assert.deepEqual(results.map(({ state }) => state), ["unknown", "partial"]);
    assert.equal(results[0].error, error);
    const retried = await executeMarginClosures(close, results.map((result) => result.state === "unknown"
      ? { ...result, state: "pending" } : result), current, () => {});
    assert.deepEqual(calls, ["mgn_a", "mgn_b", "mgn_a"]);
    assert.deepEqual(retried.map(({ state }) => state), ["closed", "partial"]);
    assert.equal(retried[0].error, undefined);
  });
}

test("close all classifies only definitive 4xx errors as failures", () => {
  for (const status of [400, 404, 409, 422, 499]) {
    assert.equal(marginClosureFailureState(new ApiError(status, "REJECTED", "rejected")), "failed");
  }
  for (const error of [null, undefined, "offline", { status: 409 }, new ApiError(503, "MARGIN_INTEREST_PENDING", "pending")]) {
    assert.equal(marginClosureFailureState(error), "unknown");
  }
});

test("close all offers retries only when the existing API helper retains the idempotency key", () => {
  for (const error of [
    new ApiError(0, "NETWORK_ERROR", "offline"),
    new ApiError(500, "INTERNAL_ERROR", "failure"),
    new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "reused"),
    new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "busy"),
    new ApiError(200, "INVALID_RESPONSE", "missing data envelope"),
  ]) {
    assert.equal(canRetryMarginClosure({ ...attempt("a"), state: "unknown", error }), true);
    assert.equal(canRetryMarginClosure({ ...attempt("a"), state: "failed", error }), false);
  }
  for (const error of [
    new ApiError(400, "INVALID_RESPONSE", "bad response"),
    new Error("malformed successful position response"),
  ]) {
    assert.equal(canRetryMarginClosure({ ...attempt("a"), state: "unknown", error }), false);
  }
});

for (const [status, code] of [
  [0, "NETWORK_ERROR"],
  [500, "INTERNAL_ERROR"],
  [409, "IDEMPOTENCY_KEY_REUSED"],
  [409, "IDEMPOTENCY_IN_PROGRESS"],
  [200, "INVALID_RESPONSE"],
] as const) {
  test(`close all reuses the shared client's exact request and key after ${status} ${code}`, async (t) => {
    t.after(clearIdempotencyKeys);
    const requests: { url: string; method?: string; body: BodyInit | null | undefined; key: string }[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
      requests.push({ url, method: options.method, body: options.body, key: (options.headers as Record<string, string>)["Idempotency-Key"] });
      if (requests.length === 1) {
        if (status === 0) throw new TypeError("connection lost");
        return status === 200 ? Response.json({ unexpected: true }) : Response.json({ error: { code } }, { status });
      }
      return Response.json({ data: { ...position("a", "CLOSED"), quantity: "0" } });
    });
    const close = (position: MarginPosition) => postIdempotentData<MarginPosition>(
      `/api/v1/margin/positions/${position.position_id}/closure`, {},
    );
    const first = await executeMarginClosures(close, [attempt("a")], current, () => {});
    assert.equal(canRetryMarginClosure(first[0]), true);
    const retried = await executeMarginClosures(close, first.map((attempt) => canRetryMarginClosure(attempt)
      ? { ...attempt, state: "pending" } : attempt), current, () => {});
    assert.equal(retried[0].state, "closed");
    assert.equal(requests.length, 2);
    assert.ok(requests[0].key);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].body, "{}");
    assert.ok(requests[0].url.endsWith("/api/v1/margin/positions/mgn_a/closure"));
    assert.deepEqual(requests[1], requests[0]);
  });
}

for (const status of [401, 403, 429]) {
  test(`close all stops on ${status} and reports pending positions as skipped`, async () => {
    const error = new ApiError(status, "ACCESS_DENIED", "blocked");
    const progress: MarginClosureAttempt[][] = [];
    const targets = [attempt("a"), attempt("b"), { ...attempt("already"), state: "closed" as const }];
    let calls = 0;
    await assert.rejects(executeMarginClosures(async () => { calls++; throw error; }, targets, current,
      (results) => progress.push(results)), (caught) => caught === error);
    assert.equal(calls, 1);
    assert.equal(progress.length, 1);
    assert.deepEqual(progress[0].map(({ state }) => state), ["failed", "skipped", "closed"]);
    assert.equal(progress[0][1].error, error);
  });
}

test("close all treats mismatched position IDs and statuses outside OPEN/CLOSED as unknown", async () => {
  for (const result of [undefined, null, position("other", "CLOSED"), position("a", "LIQUIDATING"), position("a", "CUSTODY"), {}]) {
    const results = await executeMarginClosures(async () => result as MarginPosition, [attempt("a")], current, () => {});
    assert.equal(results[0].state, "unknown");
    assert.equal(results[0].result, undefined);
    assert.match((results[0].error as Error).message, /결과/);
  }
});

test("close all sends no requests when the operation is already stale", async () => {
  await assert.rejects(executeMarginClosures(async () => assert.fail("must not close"), [attempt("a")], () => false,
    () => assert.fail("must not publish")), { name: "AbortError" });
});

for (const rejects of [false, true]) {
  test(`close all stops after context changes during an in-flight ${rejects ? "rejection" : "success"} without publishing or making another call`, async () => {
    let valid = true;
    let calls = 0;
    await assert.rejects(executeMarginClosures(async () => {
      calls++;
      valid = false;
      if (rejects) throw new ApiError(500, "INTERNAL_ERROR", "late error");
      return position("a", "CLOSED");
    }, [attempt("a"), attempt("b")], () => valid, () => assert.fail("must not publish")), { name: "AbortError" });
    assert.equal(calls, 1);
  });
}

test("close all stops if context changes after a progress callback", async () => {
  let valid = true;
  let calls = 0;
  await assert.rejects(executeMarginClosures(async (position) => {
    calls++;
    return { ...position, status: "CLOSED" };
  }, [attempt("a"), attempt("b")], () => valid, () => { valid = false; }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("close all summary counts closed, partial, failed, unknown and both kinds of unexecuted positions", () => {
  const states: MarginClosureAttempt["state"][] = ["closed", "closed", "partial", "failed", "unknown", "pending", "skipped"];
  assert.equal(marginClosureSummary(states.map((state, index) => ({ ...attempt(String(index)), state }))),
    "전체 종료 2건 · 일부 종료 1건 · 실패 1건 · 결과 미확인 1건 · 미실행 2건");
  assert.equal(marginClosureSummary([]), "전체 종료 0건 · 일부 종료 0건 · 실패 0건 · 결과 미확인 0건 · 미실행 0건");
});

for (const [status, state] of [
  ["CLOSED", "closed"],
  ["OPEN", "open"],
  ["LIQUIDATING", "system"],
  ["CUSTODY", "system"],
  ["LIQUIDATED", "system"],
  ["DELISTED", "system"],
] as const) {
  test(`close all reconciles current ${status} as ${state} without claiming a partial fill`, () => {
    const original = { ...unknownAttempt("a"), reconciliationError: new Error("old read failure") };
    const fetched = { ...position("a", status), quantity: status === "OPEN" ? "0.00000001" : "0" };
    const reconciled = marginClosureFromPosition(original, fetched);
    assert.equal(reconciled.state, state);
    assert.equal(reconciled.result, fetched);
    assert.equal(reconciled.error, undefined);
    assert.equal(reconciled.reconciliationError, undefined);
    assert.equal(canRetryMarginClosure(reconciled), false);
    assert.equal(original.state, "unknown");
    if (status === "OPEN") assert.equal(reconciled.result?.quantity, "0.00000001");
  });
}

test("close all refuses to reconcile malformed results or another account's position", () => {
  const original = unknownAttempt("a");
  for (const value of [
    null, undefined, {}, position("other"), { ...position("a"), account_id: "acc_other" },
    { ...position("a"), status: "UNKNOWN_STATUS" }, { ...position("a"), quantity: undefined },
    { ...position("a"), quantity: 1 }, { ...position("a"), quantity: "invalid" },
  ]) {
    assert.throws(() => marginClosureFromPosition(original, value as MarginPosition));
  }
});

test("close all checks only unknown positions sequentially, continues after failed reads and allows checking again", async () => {
  const originalError = new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "busy");
  const readError = new ApiError(500, "INTERNAL_ERROR", "read failed");
  const targets: MarginClosureAttempt[] = [
    unknownAttempt("a"), { ...attempt("known"), state: "closed" },
    unknownAttempt("b", originalError), unknownAttempt("c"), { ...attempt("partial"), state: "partial" },
  ];
  const calls: string[] = [];
  const progress: MarginClosureAttempt[][] = [];
  let resolveFirst!: (position: MarginPosition) => void;
  const first = new Promise<MarginPosition>((resolve) => { resolveFirst = resolve; });
  const work = reconcileMarginClosures(async (target) => {
    calls.push(target.position_id);
    if (calls.length === 1) return first;
    if (calls.length === 2) throw readError;
    return position("c", "CUSTODY");
  }, targets, current, (results) => progress.push(results));
  assert.deepEqual(calls, ["mgn_a"]);
  resolveFirst(position("a", "CLOSED"));
  const checked = await work;
  assert.deepEqual(calls, ["mgn_a", "mgn_b", "mgn_c"]);
  assert.deepEqual(checked.map(({ state }) => state), ["closed", "closed", "unknown", "system", "partial"]);
  assert.equal(progress.length, 3);
  assert.deepEqual(progress[0].map(({ state }) => state), ["closed", "closed", "unknown", "unknown", "partial"]);
  assert.equal(checked[2].error, originalError);
  assert.equal(checked[2].reconciliationError, readError);
  assert.equal(canRetryMarginClosure(checked[2]), true);
  assert.equal(targets[0].state, "unknown");
  assert.equal(targets[2].reconciliationError, undefined);

  const checkedAgain = await reconcileMarginClosures(async (target) => {
    calls.push(target.position_id);
    return { ...target, quantity: "1.00000001" };
  }, checked, current, () => {});
  assert.deepEqual(calls, ["mgn_a", "mgn_b", "mgn_c", "mgn_b"]);
  assert.equal(checkedAgain[2].state, "open");
  assert.equal(checkedAgain[2].result?.quantity, "1.00000001");
  assert.equal(checkedAgain[2].reconciliationError, undefined);
  assert.equal(checkedAgain.some(({ state }) => state === "unknown"), false);
});

test("a failed state check preserves retryable closure errors without replacing their eligibility", async () => {
  const closureError = new ApiError(0, "NETWORK_ERROR", "closure offline");
  const readError = new ApiError(400, "INVALID_RESPONSE", "bad read response");
  const checked = await reconcileMarginClosures(async () => { throw readError; },
    [unknownAttempt("a", closureError)], current, () => {});
  assert.equal(checked[0].state, "unknown");
  assert.equal(checked[0].error, closureError);
  assert.equal(checked[0].reconciliationError, readError);
  assert.equal(canRetryMarginClosure(checked[0]), true);
});

test("a malformed state-check response stays unknown and can be checked again", async () => {
  const checked = await reconcileMarginClosures(async () => position("other"), [unknownAttempt("a")], current, () => {});
  assert.equal(checked[0].state, "unknown");
  assert.ok(checked[0].reconciliationError instanceof Error);
  assert.equal(canRetryMarginClosure(checked[0]), false);
  const retried = await reconcileMarginClosures(async () => position("a", "CLOSED"), checked, current, () => {});
  assert.equal(retried[0].state, "closed");
});

for (const status of [401, 403, 429]) {
  test(`close all stops state checks after ${status} and leaves unchecked positions unknown`, async () => {
    const error = new ApiError(status, "ACCESS_DENIED", "blocked");
    const progress: MarginClosureAttempt[][] = [];
    let calls = 0;
    await assert.rejects(reconcileMarginClosures(async () => { calls++; throw error; },
      [unknownAttempt("a"), unknownAttempt("b")], current, (results) => progress.push(results)), (caught) => caught === error);
    assert.equal(calls, 1);
    assert.equal(progress.length, 1);
    assert.deepEqual(progress[0].map(({ state }) => state), ["unknown", "unknown"]);
    assert.equal(progress[0][0].reconciliationError, error);
    assert.equal(progress[0][1].reconciliationError, undefined);
  });
}

test("close all sends no state checks when the operation is already stale", async () => {
  await assert.rejects(reconcileMarginClosures(async () => assert.fail("must not read"),
    [unknownAttempt("a")], () => false, () => assert.fail("must not publish")), { name: "AbortError" });
});

for (const rejects of [false, true]) {
  test(`close all discards a late state-check ${rejects ? "failure" : "success"} after context changes`, async () => {
    let valid = true;
    let calls = 0;
    await assert.rejects(reconcileMarginClosures(async () => {
      calls++;
      valid = false;
      if (rejects) throw new ApiError(500, "INTERNAL_ERROR", "late read failure");
      return position("a", "CLOSED");
    }, [unknownAttempt("a"), unknownAttempt("b")], () => valid,
    () => assert.fail("must not publish")), { name: "AbortError" });
    assert.equal(calls, 1);
  });
}

test("close all stops state checks when context changes in a progress callback", async () => {
  let valid = true;
  let calls = 0;
  await assert.rejects(reconcileMarginClosures(async (target) => {
    calls++;
    return { ...target, status: "CLOSED" };
  }, [unknownAttempt("a"), unknownAttempt("b")], () => valid, () => { valid = false; }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("close all summary distinguishes current holdings and system settlement from partial fills", () => {
  const checked = [
    marginClosureFromPosition(unknownAttempt("a"), position("a", "OPEN")),
    marginClosureFromPosition(unknownAttempt("b"), position("b", "LIQUIDATING")),
    marginClosureFromPosition(unknownAttempt("c"), position("c", "LIQUIDATED")),
  ];
  assert.equal(marginClosureSummary(checked),
    "전체 종료 0건 · 일부 종료 0건 · 보유 중 1건 · 시스템 정산 중/완료 2건 · 실패 0건 · 결과 미확인 0건 · 미실행 0건");
});

test("close all treats a closure response from another account as unknown", async () => {
  const results = await executeMarginClosures(async () => ({ ...position("a", "CLOSED"), account_id: "acc_other" }),
    [attempt("a")], current, () => {});
  assert.equal(results[0].state, "unknown");
  assert.equal(results[0].result, undefined);
});
