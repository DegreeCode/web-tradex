import test from "node:test";
import assert from "node:assert/strict";
import { createOrderRetry } from "../src/lib/advanced-order";
import { ApiError, clearIdempotencyKeys, postIdempotentData } from "../src/lib/api";
import type { OrderRequest } from "../src/lib/types";

test("a lost market-order response keeps the HTTP body and idempotency key after live values change", async (t) => {
  t.after(clearIdempotencyKeys);
  const requests: { body: unknown; key: string }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    requests.push({ body: options.body, key: (options.headers as Record<string, string>)["Idempotency-Key"] });
    if (requests.length === 1) throw new TypeError("response lost after execution");
    return Response.json({ data: { order_id: "ord_a" } });
  });
  const retry = createOrderRetry<OrderRequest>();
  let price = "100";
  let balance = "10";
  async function submit() {
    const body = retry.prepare("account, symbol and 100% balance shortcut", () => ({
      symbol: "ALPHA.M", account_id: "acc_a", side: "BUY", order_type: "MARKET",
      credit_amount: balance, slippage_reference_price: price,
    }));
    try {
      const result = await postIdempotentData("/api/v1/orders", body);
      retry.success(body);
      return result;
    } catch (error) {
      retry.failure(body, error);
      throw error;
    }
  }
  await assert.rejects(submit(), ApiError);
  price = "101";
  balance = "0";
  assert.deepEqual(await submit(), { order_id: "ord_a" });
  assert.deepEqual(requests[1], requests[0]);
  await submit();
  assert.notEqual(requests[2].key, requests[0].key);
  assert.equal(JSON.parse(requests[2].body as string).slippage_reference_price, "101");
});

for (const error of [
  new TypeError("lost response"),
  new ApiError(0, "NETWORK_ERROR", "offline"),
  new ApiError(200, "INVALID_RESPONSE", "bad response"),
  new ApiError(500, "INTERNAL_ERROR", "unknown"),
  new ApiError(503, "UNAVAILABLE", "unknown"),
  new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "pending"),
  new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "unknown"),
]) {
  test(`uncertain ${error.message}/${"code" in error ? error.code : error.name} reuses the complete payload`, () => {
    const retry = createOrderRetry<object>();
    const body = retry.prepare("same inputs", () => ({
      symbol: "ALPHA.M", account_id: "acc_a", quantity: "1", slippage_reference_price: "100",
      bracket: { take_profit_price: "120", stop_loss_price: "90" },
    }));
    retry.failure(body, error);
    assert.equal(retry.prepare("same inputs", () => { throw new Error("must not rebuild after a price tick or balance change"); }), body);
    assert.equal(JSON.stringify(retry.prepare("same inputs", () => ({}))), JSON.stringify(body));
  });
}

test("success and definitive 4xx permit a fresh payload", () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429]) {
    const retry = createOrderRetry<object>();
    const body = retry.prepare("inputs", () => ({ reference: "100" }));
    retry.failure(body, new ApiError(status, "INVALID_REQUEST", "rejected"));
    assert.deepEqual(retry.prepare("inputs", () => ({ reference: "101" })), { reference: "101" });
  }
  const retry = createOrderRetry<object>();
  const body = retry.prepare("inputs", () => ({}));
  retry.success(body);
  assert.notEqual(retry.prepare("inputs", () => ({})), body);
});

test("input, account and symbol changes discard a remembered payload even if restored", () => {
  const retry = createOrderRetry<object>();
  for (const changed of ["new amount", "new account", "new symbol"]) {
    const body = retry.prepare("original", () => ({}));
    retry.failure(body, new TypeError("lost"));
    retry.sync(changed);
    retry.sync("original");
    assert.notEqual(retry.prepare("original", () => ({})), body);
  }
});

test("amend retries preserve the original revision and residual amount across live rebases", () => {
  const retry = createOrderRetry<object>();
  const body = retry.prepare("order and user edit version", () => ({ expected_revision: 4, quantity: "6" }));
  retry.failure(body, new ApiError(500, "INTERNAL_ERROR", "unknown"));
  assert.equal(retry.prepare("order and user edit version", () => ({ expected_revision: 5, quantity: "3" })), body);
  retry.failure(body, new ApiError(409, "ORDER_REVISION_CONFLICT", "conflict"));
  assert.deepEqual(retry.prepare("order and user edit version", () => ({ expected_revision: 5, quantity: "3" })), { expected_revision: 5, quantity: "3" });
});

test("an older request settling cannot clear a newer submission", () => {
  const retry = createOrderRetry<object>();
  const old = retry.prepare("old", () => ({}));
  const next = retry.prepare("new", () => ({}));
  retry.success(old);
  retry.failure(old, new ApiError(400, "INVALID_REQUEST", "rejected"));
  assert.equal(retry.prepare("new", () => ({})), next);
});

test("local validation failures do not remember a payload", () => {
  const retry = createOrderRetry<object>();
  assert.throws(() => retry.prepare("inputs", () => { throw new Error("invalid"); }));
  assert.equal(retry.has("inputs"), false);
  const body = retry.prepare("inputs", () => ({}));
  assert.equal(retry.has("inputs"), true);
  assert.equal(retry.has("changed inputs"), false);
  retry.success(body);
  assert.equal(retry.has("inputs"), false);
});
