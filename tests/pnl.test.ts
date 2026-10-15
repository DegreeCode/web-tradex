import test from "node:test";
import assert from "node:assert/strict";
import { pnlSourceLabel } from "../src/lib/pnl";

test("ledger source labels fall back safely for unexpected or inherited keys", () => {
  assert.equal(pnlSourceLabel({ is_baseline: false, source_type: "MARGIN_CLOSE" }), "전액 종료");
  assert.equal(pnlSourceLabel({ is_baseline: true, source_type: "TRADE" }), "이전 누적 손익");
  for (const source_type of ["constructor", "toString", "__proto__", "UNKNOWN"]) {
    assert.equal(pnlSourceLabel({ is_baseline: false, source_type }), "손익 기록");
  }
});
