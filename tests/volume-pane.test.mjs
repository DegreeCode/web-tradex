import assert from "node:assert/strict";
import { test } from "node:test";

const preferenceUrl = new URL("../src/lib/preferences.ts", import.meta.url);

test("volume pane height survives a fresh module and a different chart height", async (t) => {
  const stored = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  } };
  t.after(() => { delete globalThis.window; });
  const original = await import(`${preferenceUrl}?original`);
  assert.equal(original.calculateVolumePaneHeight(260), 73);
  original.setVolumePaneRatio(109 / 260);
  const reloaded = await import(`${preferenceUrl}?reloaded`);
  assert.equal(reloaded.calculateVolumePaneHeight(260), 109);
  assert.equal(reloaded.calculateVolumePaneHeight(220), 92);
});

test("invalid stored pane ratios retain the initial layout", async (t) => {
  t.after(() => { delete globalThis.window; });
  for (const value of [null, "junk", "Infinity", "-1", "0", "1", "2"]) {
    globalThis.window = { localStorage: { getItem: () => value } };
    const preference = await import(`${preferenceUrl}?invalid=${value}`);
    assert.equal(preference.calculateVolumePaneHeight(260), 73);
  }
});

test("resizing remains usable when localStorage is blocked", async (t) => {
  globalThis.window = { localStorage: {
    getItem: () => { throw new Error("Storage disabled"); },
    setItem: () => { throw new Error("Storage disabled"); },
  } };
  t.after(() => { delete globalThis.window; });
  const preference = await import(`${preferenceUrl}?blocked`);
  assert.equal(preference.calculateVolumePaneHeight(260), 73);
  preference.setVolumePaneRatio(0.5);
  assert.equal(preference.calculateVolumePaneHeight(260), 130);
});
