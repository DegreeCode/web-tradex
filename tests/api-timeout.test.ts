import test from "node:test";
import assert from "node:assert/strict";
import { apiData, ApiError } from "../src/lib/api";

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
