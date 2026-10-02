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
