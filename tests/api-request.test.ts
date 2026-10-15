import test from "node:test";
import assert from "node:assert/strict";
import { apiData, ApiError, clearIdempotencyKeys, errorMessage, postIdempotentData } from "../src/lib/api";

test("a longer request timeout survives the default cutoff and still aborts at its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null = null;
  t.mock.method(
    globalThis,
    "fetch",
    (_url: string, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        signal = options.signal as AbortSignal;
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  const pending = apiData("/api/v1/notifications/read-all", {
    method: "POST",
    timeoutMs: 65000,
  });
  const rejected = assert.rejects(
    pending,
    (err) => err instanceof ApiError && err.code === "NETWORK_ERROR",
  );
  t.mock.timers.tick(10000);
  assert.equal((signal as unknown as AbortSignal).aborted, false);
  t.mock.timers.tick(55000);
  assert.equal((signal as unknown as AbortSignal).aborted, true);
  await rejected;
});

test("external cancellation preserves its reason instead of becoming a retryable network error", async (t) => {
  t.mock.method(globalThis, "fetch", (_url: string, options: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = options.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  );
  const controller = new AbortController();
  const reason = new Error("the page was closed");
  const pending = apiData("/api/v1/me", { signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
});

test("concurrent copies of one mutation share a request, while a completed action can be repeated", async (t) => {
  t.after(clearIdempotencyKeys);
  let calls = 0;
  const keys: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    calls += 1;
    keys.push((options.headers as Record<string, string>)["Idempotency-Key"]);
    return Response.json({ data: { order_id: "order_1" } });
  });
  const action = () => postIdempotentData("/api/v1/orders", { quantity: "1" });
  const [first, second] = await Promise.all([action(), action()]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  await action();
  assert.equal(calls, 2);
  assert.notEqual(keys[0], keys[1]);
});

test("uncertain mutations reuse their key until the authenticated session is cleared", async (t) => {
  t.after(clearIdempotencyKeys);
  t.mock.timers.enable({ apis: ["Date"] });
  const keys: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    keys.push((options.headers as Record<string, string>)["Idempotency-Key"]);
    if (keys.length < 3) throw new TypeError("connection lost after the request was sent");
    return Response.json({ data: { transfer_id: "transfer_1" } });
  });
  const action = () => postIdempotentData("/api/v1/transfers", { amount: "1" });
  await assert.rejects(action(), (error) => error instanceof ApiError && error.code === "NETWORK_ERROR");
  t.mock.timers.tick(2 * 86_400_000);
  await assert.rejects(action(), ApiError);
  assert.equal(keys[0], keys[1]);
  clearIdempotencyKeys();
  await action();
  assert.notEqual(keys[1], keys[2]);
});

test("definitive rejection releases a mutation key for the next attempt", async (t) => {
  t.after(clearIdempotencyKeys);
  const keys: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    keys.push((options.headers as Record<string, string>)["Idempotency-Key"]);
    return keys.length === 1
      ? Response.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 })
      : Response.json({ data: { status: "ok" } });
  });
  const action = () => postIdempotentData("/api/v1/me/accounts", {});
  await assert.rejects(action(), ApiError);
  await action();
  assert.notEqual(keys[0], keys[1]);
});

test("unknown API codes cannot resolve inherited object properties as messages", () => {
  for (const code of ["toString", "__proto__", "constructor"]) {
    assert.equal(errorMessage(new ApiError(500, code, "server message")), "server message");
  }
});

test("a large Retry-After cannot overflow a browser timer into an immediate retry", async (t) => {
  for (const retryAfter of ["9999999999", "Fri, 01 Jan 2100 00:00:00 GMT"]) {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ error: { code: "RATE_LIMITED" } }, { status: 429, headers: { "Retry-After": retryAfter } }),
    );
    await assert.rejects(apiData("/api/v1/me"), (error) =>
      error instanceof ApiError && error.retryAfterMs === 2_147_483_647,
    );
  }
});
