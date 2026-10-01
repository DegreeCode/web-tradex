import assert from "node:assert/strict";
import { test } from "node:test";

const preferenceUrl = new URL("../src/lib/preferences.ts", import.meta.url);
const KEY = "tradex:preferences:v1";

function memoryStorage(initial = {}) {
  const stored = new Map(Object.entries(initial));
  return {
    stored,
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key),
  };
}

test("legacy single-value keys migrate into one JSON record", async (t) => {
  const storage = memoryStorage({
    "tradex:trade-execution-popup:v1": "false",
    "tradex:volume-pane-ratio:v1": "0.4",
    "tradex:candle-interval:v1": "15m",
  });
  globalThis.window = { localStorage: storage };
  t.after(() => { delete globalThis.window; });
  const preference = await import(`${preferenceUrl}?migrate`);
  assert.deepEqual(preference.readPreferences(), { tradeExecutionPopup: false, volumePaneRatio: 0.4, candleInterval: "15m" });
  assert.deepEqual(JSON.parse(storage.stored.get(KEY)), { tradeExecutionPopup: false, volumePaneRatio: 0.4, candleInterval: "15m" });
  assert.deepEqual([...storage.stored.keys()], [KEY]);
});

test("updates merge into the record, and undefined removes a field", async (t) => {
  const storage = memoryStorage({ [KEY]: JSON.stringify({ candleInterval: "1d" }) });
  globalThis.window = { localStorage: storage };
  t.after(() => { delete globalThis.window; });
  const preference = await import(`${preferenceUrl}?update`);
  preference.updatePreferences({ slippagePercent: "1.25" });
  assert.deepEqual(JSON.parse(storage.stored.get(KEY)), { candleInterval: "1d", slippagePercent: "1.25" });
  preference.updatePreferences({ slippagePercent: undefined });
  assert.deepEqual(JSON.parse(storage.stored.get(KEY)), { candleInterval: "1d" });
  assert.equal(preference.shouldShowTradeExecutionPopup(), true);
});

test("malformed records and fields are dropped instead of breaking the UI", async (t) => {
  t.after(() => { delete globalThis.window; });
  const { sanitizePreferences } = await import(`${preferenceUrl}?sanitize`);
  assert.deepEqual(
    sanitizePreferences({ tradeExecutionPopup: "no", volumePaneRatio: 1, candleInterval: "", slippagePercent: "1.23456", extra: 1 }),
    {},
  );
  assert.deepEqual(sanitizePreferences({ slippagePercent: "0.5", volumePaneRatio: 0.3 }), { slippagePercent: "0.5", volumePaneRatio: 0.3 });
  for (const raw of ["junk", "[1]", "null", "2"]) {
    globalThis.window = { localStorage: memoryStorage({ [KEY]: raw }) };
    const preference = await import(`${preferenceUrl}?malformed=${raw}`);
    assert.deepEqual(preference.readPreferences(), {});
  }
});

test("preferences stay in memory when localStorage is blocked", async (t) => {
  globalThis.window = { localStorage: {
    getItem: () => { throw new Error("Storage disabled"); },
    setItem: () => { throw new Error("Storage disabled"); },
  } };
  t.after(() => { delete globalThis.window; });
  const preference = await import(`${preferenceUrl}?blocked-prefs`);
  preference.updatePreferences({ tradeExecutionPopup: false, slippagePercent: "2" });
  assert.equal(preference.shouldShowTradeExecutionPopup(), false);
  assert.equal(preference.readPreferences().slippagePercent, "2");
});
