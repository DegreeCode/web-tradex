import assert from "node:assert/strict";
import { test } from "node:test";
import { canIncrementallyUpdate } from "../src/lib/chart-updates.ts";

const points = (...times) => times.map((time) => ({ time, value: 1 }));

test("interval changes and historical backfills replace the dataset", () => {
  const coarse = points(60, 180, 300);
  const fine = points(60, 120, 180, 240, 300);
  assert.equal(canIncrementallyUpdate(coarse, fine), false);
  assert.equal(canIncrementallyUpdate(fine, coarse), false);
  assert.equal(canIncrementallyUpdate(coarse, points(0, 60, 180, 300)), false);
  assert.equal(canIncrementallyUpdate(coarse, points(60, 120, 180, 300, 360)), false);
});

test("existing-point corrections and new trailing bars stay incremental", () => {
  const previous = points(60, 180, 300);
  assert.equal(canIncrementallyUpdate(previous, previous.map((point) => ({ ...point, value: 2 }))), true);
  assert.equal(canIncrementallyUpdate(previous, points(60, 180, 300, 360, 420)), true);
});

test("initial, cleared, replaced and rolling-window data use setData", () => {
  assert.equal(canIncrementallyUpdate([], points(60)), false);
  assert.equal(canIncrementallyUpdate(points(60), []), false);
  assert.equal(canIncrementallyUpdate(points(60, 180), points(120, 240)), false);
  assert.equal(canIncrementallyUpdate(points(60, 180), points(180, 300)), false);
});
