import test from "node:test";
import assert from "node:assert/strict";
import { resolveAccountId, singleAccountHeading } from "../src/lib/accounts";

const primary = { account_id: "acc_primary", is_primary: true };
const extra = { account_id: "acc_extra", is_primary: false };

test("a lone extra account is named as one, not as the primary", () => {
  // A linked device may be granted only an extra account.
  assert.equal(singleAccountHeading(false, extra, [extra]), "추가 계좌");
});

test("a lone primary account keeps its name", () => {
  assert.equal(singleAccountHeading(false, primary, [primary]), "대표 계좌");
});

test("loading and empty states keep their own headings", () => {
  assert.equal(singleAccountHeading(true, undefined, []), "계좌 불러오는 중…");
  assert.equal(singleAccountHeading(false, undefined, []), "계좌가 없어요");
});

test("remembered accounts are restored only while accessible", () => {
  assert.equal(resolveAccountId([primary, extra], extra.account_id), extra.account_id);
  assert.equal(resolveAccountId([primary, extra], "deleted_account"), primary.account_id);
  assert.equal(resolveAccountId([extra], primary.account_id), extra.account_id);
  assert.equal(resolveAccountId([], extra.account_id), "");
});
