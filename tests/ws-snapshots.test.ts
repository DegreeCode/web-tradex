import test from "node:test";
import assert from "node:assert/strict";
import { canFoldSnapshot, foldSnapshot } from "../src/lib/ws-snapshots";
import type { WsFrame } from "../src/lib/types";

const snapshot = (stream: string, data: unknown, seq = 1): WsFrame => ({ type: "snapshot", stream, seq, version: seq, data });
const update = (stream: string, data: unknown, seq: number): WsFrame => ({ type: "update", stream, seq, version: seq, data });

test("ticker updates replace or remove rows by symbol", () => {
  const folded = foldSnapshot(
    snapshot("tickers", [{ symbol: "AAA.M", last_price: "1" }, { symbol: "BBB.M", last_price: "2" }]),
    update("tickers", [{ symbol: "AAA.M", last_price: "3" }, { symbol: "BBB.M", deleted: true }, { symbol: "CCC.M", last_price: "4" }], 2),
  );
  assert.equal(folded.type, "snapshot");
  assert.equal(folded.seq, 2);
  assert.equal(folded.version, 2);
  assert.deepEqual(folded.data, [{ symbol: "AAA.M", last_price: "3" }, { symbol: "CCC.M", last_price: "4" }]);
});

test("trades keep the newest 50, newest first, without repeats", () => {
  const trades = Array.from({ length: 50 }, (_, index) => ({ sequence: 50 - index }));
  let frame = snapshot("trades:AAA.M", trades);
  frame = foldSnapshot(frame, update("trades:AAA.M", { sequence: 51 }, 2));
  frame = foldSnapshot(frame, update("trades:AAA.M", { sequence: 51 }, 3));
  const rows = frame.data as Array<{ sequence: number }>;
  assert.equal(rows.length, 50);
  assert.equal(rows[0].sequence, 51);
  assert.equal(rows.at(-1)?.sequence, 2);
});

test("disclosures merge by id in time order and skip rows without identity", () => {
  let frame = snapshot("disclosures", [
    { disclosure_id: "d2", occurred_at: "2026-10-02T02:00:00Z" },
    { disclosure_id: "d1", occurred_at: "2026-10-02T01:00:00Z" },
  ]);
  frame = foldSnapshot(frame, update("disclosures", { disclosure_id: "d3", occurred_at: "2026-10-02T01:30:00Z" }, 2));
  frame = foldSnapshot(frame, update("disclosures", { state: "HALTED" }, 3));
  assert.deepEqual((frame.data as Array<{ disclosure_id: string }>).map((row) => row.disclosure_id), ["d2", "d3", "d1"]);
});

test("market state takes the latest global state and ignores per-symbol changes", () => {
  let frame = snapshot("market_state", { state: "OPEN" });
  frame = foldSnapshot(frame, update("market_state", { symbol: "AAA.M", state: "HALTED" }, 2));
  assert.deepEqual(frame.data, { state: "OPEN" });
  frame = foldSnapshot(frame, update("market_state", { state: "HALTED", reason: "maintenance" }, 3));
  assert.deepEqual(frame.data, { state: "HALTED", reason: "maintenance" });
});

test("only the known channel shapes are folded", () => {
  for (const channel of ["tickers", "disclosures", "market_state", "trades:AAA.M"]) {
    assert.equal(canFoldSnapshot(channel), true, channel);
  }
  assert.equal(canFoldSnapshot("candles:AAA.M"), false);
});
