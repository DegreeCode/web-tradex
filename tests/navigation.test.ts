import test from "node:test";
import assert from "node:assert/strict";
import { MORE_NAV, moreNavFor } from "../src/lib/navigation";

const hrefs = (linked: boolean) => moreNavFor(linked).map((item) => item.href);

test("a linked session sees notifications but not inquiries or listing", () => {
  const linked = hrefs(true);
  assert.ok(linked.includes("/notifications"));
  assert.ok(!linked.includes("/support"));
  assert.ok(!linked.includes("/listings/new"));
});

test("a passkey session sees every more-menu entry", () => {
  assert.deepEqual(hrefs(false), MORE_NAV.map((item) => item.href));
  assert.ok(hrefs(false).includes("/support"));
  assert.ok(hrefs(false).includes("/listings/new"));
});

test("a link code survives login in tab storage and is cleared on read", async (t) => {
  const { preserveLinkCode, consumeLinkCode } = await import("../src/lib/navigation");
  const { loginHref } = await import("../src/lib/routes");
  const previousWindow = globalThis.window;
  const data = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage } });
  t.after(() => Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow }));
  preserveLinkCode("/link", "#code=K7QM-2XRP");
  assert.equal(loginHref("/link"), "/login?next=%2Flink");
  assert.equal(consumeLinkCode(), "K7QM-2XRP");
  assert.equal(consumeLinkCode(), null);
  assert.equal(data.size, 0);
  preserveLinkCode("/market", "#code=K7QM-2XRP");
  assert.equal(consumeLinkCode(), null, "only /link can leave a hand-off");
});

test("a denied tab-storage hand-off does not break the login redirect", async (t) => {
  const { preserveLinkCode, consumeLinkCode } = await import("../src/lib/navigation");
  const previousWindow = globalThis.window;
  const browser = Object.defineProperty({}, "sessionStorage", {
    get: () => { throw new DOMException("denied", "SecurityError"); },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  t.after(() => Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow }));
  assert.doesNotThrow(() => preserveLinkCode("/link", "#code=K7QM-2XRP"));
  assert.equal(consumeLinkCode(), null);
});
