import test from "node:test";
import assert from "node:assert/strict";
import { createQueryClient } from "../src/app/providers";

test("WS ticker cache survives inactivity while other inactive queries are collected", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = createQueryClient();
  // Node defaults to infinite GC; explicitly emulate the browser's 5 minutes.
  client.setDefaultOptions({ queries: { gcTime: 300_000 } });
  const lastTickers = [{ symbol: "AAA.M", last_price: "20.125" }];
  client.setQueryData(["ticker-cache"], lastTickers);
  client.setQueryData(["unrelated-cache"], "temporary");
  t.mock.timers.tick(360_000);
  assert.equal(client.getQueryData(["unrelated-cache"]), undefined);
  assert.deepEqual(client.getQueryData(["ticker-cache"]), lastTickers);
  client.clear();
});
