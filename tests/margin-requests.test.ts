import test from "node:test";
import assert from "node:assert/strict";
import { slippageRequestFields } from "../src/lib/slippage";
import { createOrderRetry } from "../src/lib/advanced-order";
import { ApiError, clearIdempotencyKeys, postIdempotentData } from "../src/lib/api";
import {
  buildMarginCreateRequest,
  buildMarginCollateralRequest,
  buildMarginReductionRequest,
  isMarginRiskAtOrBelow,
  marginRiskLevel,
} from "../src/lib/margin";

const entry = { account_id: "acc_a", symbol: "ALPHA.M", side: "LONG" as const, collateral: ".5", leverage: "2.0" };

test("margin bodies and simulations normalize permissive decimal input without losing precision", () => {
  for (const [input, expected] of [[".5", "0.5"], ["1.", "1"], [".1234567890123456", "0.1234567890123456"]]) {
    assert.equal(buildMarginCreateRequest({ ...entry, collateral: input }).collateral, expected);
    assert.equal(buildMarginCollateralRequest({ amount: input }).amount, expected);
  }
  assert.equal(buildMarginCreateRequest({ ...entry, leverage: "2" }).leverage, "2.0");
  for (const [quantity, expected] of [[".5", "0.5"], ["1.", "1"], [".12345678", "0.12345678"]]) {
    assert.equal(buildMarginReductionRequest({ quantity }).quantity, expected);
  }
  assert.throws(() => buildMarginCreateRequest({ ...entry, collateral: ".12345678901234567" }));
  assert.throws(() => buildMarginCollateralRequest({ amount: "." }));
  assert.throws(() => buildMarginReductionRequest({ quantity: ".123456789" }));
});

const actions = [
  { name: "create", path: "/api/v1/margin/positions", build: (price: string) => buildMarginCreateRequest({ ...entry, slippage_reference_price: price }) },
  { name: "collateral", path: "/api/v1/margin/positions/mgn_a/collateral", build: () => buildMarginCollateralRequest({ amount: ".5" }) },
  { name: "reduction", path: "/api/v1/margin/positions/mgn_a/reductions", build: (price: string) => buildMarginReductionRequest({ quantity: ".5", slippage_reference_price: price }) },
  { name: "closure", path: "/api/v1/margin/positions/mgn_a/closure", build: (price: string) => ({ slippage_reference_price: price }) },
];
for (const action of actions) {
  for (const failure of ["network", "5xx", "in-progress"] as const) {
    test(`${action.name} retries retain the body and key after ${failure} despite live changes`, async (t) => {
      t.after(clearIdempotencyKeys);
      const requests: { body: unknown; key: string }[] = [];
      t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
        requests.push({ body: options.body, key: (options.headers as Record<string, string>)["Idempotency-Key"] });
        if (requests.length === 1) {
          if (failure === "network") throw new TypeError("response lost after execution");
          return Response.json({ error: { code: failure === "5xx" ? "INTERNAL_ERROR" : "IDEMPOTENCY_IN_PROGRESS" } }, { status: failure === "5xx" ? 503 : 409 });
        }
        return Response.json({ data: { position_id: "mgn_a" } });
      });
      const retry = createOrderRetry<object>();
      let price = "100";
      const submit = async () => {
        const body = retry.prepare("account, position, raw user inputs and slippage settings", () => action.build(price));
        try {
          const result = await postIdempotentData(action.path, body);
          retry.success(body);
          return result;
        } catch (error) {
          retry.failure(body, error);
          throw error;
        }
      };
      await assert.rejects(submit(), ApiError);
      price = "101";
      await submit();
      assert.deepEqual(requests[1], requests[0]);
      await submit();
      assert.notEqual(requests[2].key, requests[0].key);
    });
  }
}

test("margin retries discard remembered bodies on user edits and definitive rejections", () => {
  const retry = createOrderRetry<object>();
  for (const changed of ["amount", "leverage", "account", "symbol", "position", "side", "slippage"]) {
    const body = retry.prepare("original", () => buildMarginCreateRequest(entry));
    retry.failure(body, new ApiError(503, "UNAVAILABLE", "unknown"));
    retry.sync(changed);
    retry.sync("original");
    assert.notEqual(retry.prepare("original", () => buildMarginCreateRequest(entry)), body);
  }
  const body = retry.prepare("original", () => ({}));
  retry.failure(body, new ApiError(409, "MARGIN_POSITION_STATE", "closed"));
  assert.equal(retry.has("original"), false);
});

test("margin price limits use the shared decimal normalization", () => {
  for (const [limitPrice, expected] of [[".5", "0.5"], ["1.", "1"]]) {
    const fields = slippageRequestFields({ mode: "PRICE_LIMIT", slippage: "", limitPrice });
    assert.equal(fields.slippage_reference_price, expected);
    assert.equal(buildMarginCreateRequest({ ...entry, ...fields }).slippage_reference_price, expected);
    assert.equal(buildMarginReductionRequest({ quantity: ".5", ...fields }).slippage_reference_price, expected);
  }
});

test("margin risk thresholds include equality, matching backend maintenance and warning checks", () => {
  const policy = { maintenance_ppm: 100_000, warning_ppm: 200_000 };
  for (const ratio of [-1, 0, 100_000]) {
    assert.equal(isMarginRiskAtOrBelow(ratio, policy.maintenance_ppm), true);
    assert.equal(marginRiskLevel(ratio, policy), "MAINTENANCE");
  }
  assert.equal(isMarginRiskAtOrBelow(100_001, policy.maintenance_ppm), false);
  assert.equal(marginRiskLevel(100_001, policy), "WARNING");
  assert.equal(marginRiskLevel(200_000, policy), "WARNING");
  assert.equal(marginRiskLevel(200_001, policy), "SAFE");
  assert.equal(marginRiskLevel(null, policy), null);
  assert.equal(isMarginRiskAtOrBelow(null, policy.maintenance_ppm), false);
});
