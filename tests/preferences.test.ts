import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

const preferenceUrl = new URL("../src/lib/preferences.ts", import.meta.url);
const KEY = "tradex:preferences:v1";
type PreferencesModule = typeof import("../src/lib/preferences");

function memoryStorage(initial: Record<string, string> = {}) {
  const stored = new Map(Object.entries(initial));
  return {
    stored,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, String(value)),
    removeItem: (key: string) => void stored.delete(key),
  };
}

const blockedStorage = {
  getItem: () => { throw new Error("Storage disabled"); },
  setItem: () => { throw new Error("Storage disabled"); },
  removeItem: () => { throw new Error("Storage disabled"); },
};

/** Loads a fresh module instance against the given storage. */
async function loadWith(t: TestContext, localStorage: object, tag: string): Promise<PreferencesModule> {
  (globalThis as { window?: unknown }).window = { localStorage };
  t.after(() => { delete (globalThis as { window?: unknown }).window; });
  return import(`${preferenceUrl}?${tag}`);
}

test("legacy single-value keys migrate into one JSON record", async (t) => {
  const storage = memoryStorage({
    "tradex:trade-execution-popup:v1": "false",
    "tradex:volume-pane-ratio:v1": "0.4",
    "tradex:candle-interval:v1": "15m",
  });
  const preference = await loadWith(t, storage, "migrate");
  const expected = { tradeExecutionPopup: false, volumePaneRatio: 0.4, candleInterval: "15m" };
  assert.deepEqual(preference.readPreferences(), expected);
  assert.deepEqual(JSON.parse(storage.stored.get(KEY)!), expected);
  assert.deepEqual([...storage.stored.keys()], [KEY]);
});

test("updates merge into the record, and undefined removes a field", async (t) => {
  const storage = memoryStorage({ [KEY]: JSON.stringify({ candleInterval: "1d" }) });
  const preference = await loadWith(t, storage, "update");
  preference.updatePreferences({ slippagePercent: "1.25" });
  assert.deepEqual(JSON.parse(storage.stored.get(KEY)!), { candleInterval: "1d", slippagePercent: "1.25" });
  preference.updatePreferences({ slippagePercent: undefined });
  assert.deepEqual(JSON.parse(storage.stored.get(KEY)!), { candleInterval: "1d" });
  assert.equal(preference.shouldShowTradeExecutionPopup(), true);
});

test("malformed records and fields are dropped instead of breaking the UI", async (t) => {
  const { sanitizePreferences } = await loadWith(t, memoryStorage(), "sanitize");
  assert.deepEqual(
    sanitizePreferences({ tradeExecutionPopup: "no", volumePaneRatio: 1, candleInterval: "", slippagePercent: "1.23456", extra: 1 }),
    {},
  );
  assert.deepEqual(sanitizePreferences({ slippagePercent: "0.5", volumePaneRatio: 0.3 }), { slippagePercent: "0.5", volumePaneRatio: 0.3 });
  for (const raw of ["junk", "[1]", "null", "2"]) {
    const preference = await loadWith(t, memoryStorage({ [KEY]: raw }), `malformed=${raw}`);
    assert.deepEqual(preference.readPreferences(), {});
    assert.equal(preference.calculateVolumePaneHeight(260), 73, "falls back to the initial pane layout");
  }
});

test("volume pane height survives a reload and scales with the chart", async (t) => {
  const storage = memoryStorage();
  const original = await loadWith(t, storage, "pane-original");
  assert.equal(original.calculateVolumePaneHeight(260), 73);
  original.setVolumePaneRatio(109 / 260);
  const reloaded = await loadWith(t, storage, "pane-reloaded");
  assert.equal(reloaded.calculateVolumePaneHeight(260), 109);
  assert.equal(reloaded.calculateVolumePaneHeight(220), 92);
});

test("preferences stay in memory when localStorage is blocked", async (t) => {
  const preference = await loadWith(t, blockedStorage, "blocked");
  preference.updatePreferences({ tradeExecutionPopup: false, slippagePercent: "2" });
  assert.equal(preference.shouldShowTradeExecutionPopup(), false);
  assert.equal(preference.readPreferences().slippagePercent, "2");
  preference.setVolumePaneRatio(0.5);
  assert.equal(preference.calculateVolumePaneHeight(260), 130);
});
