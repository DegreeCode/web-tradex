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

test("legacy preferences migrate while chart settings get a separate record", async (t) => {
  const storage = memoryStorage({
    "tradex:trade-execution-popup:v1": "false",
    "tradex:volume-pane-ratio:v1": "0.4",
    "tradex:candle-interval:v1": "15m",
  });
  const preference = await loadWith(t, storage, "migrate");
  const expected = { tradeExecutionPopup: false };
  assert.deepEqual(preference.readPreferences(), expected);
  assert.deepEqual(JSON.parse(storage.stored.get(KEY)!), expected);
  assert.deepEqual(JSON.parse(storage.stored.get("tradex:chart-settings:v1")!), { volumePaneRatio: 0.4, candleInterval: "15m" });
  assert.deepEqual([...storage.stored.keys()].sort(), ["tradex:chart-settings:v1", KEY]);
});

test("updates merge into the record, and undefined removes a field", async (t) => {
  const storage = memoryStorage({ [KEY]: JSON.stringify({ liveNotificationPopup: false }) });
  const preference = await loadWith(t, storage, "update");
  preference.updatePreferences({ slippagePercent: "1.25" });
  assert.deepEqual(JSON.parse(storage.stored.get(KEY)!), { liveNotificationPopup: false, slippagePercent: "1.25" });
  preference.updatePreferences({ slippagePercent: undefined });
  assert.deepEqual(JSON.parse(storage.stored.get(KEY)!), { liveNotificationPopup: false });
  assert.equal(preference.shouldShowTradeExecutionPopup(), true);
});

test("malformed records and fields are dropped instead of breaking the UI", async (t) => {
  const { sanitizePreferences } = await loadWith(t, memoryStorage(), "sanitize");
  assert.deepEqual(
    sanitizePreferences({ tradeExecutionPopup: "no", selectedAccount: { userId: "u", accountId: "" }, slippagePercent: "1.23456", extra: 1 }),
    {},
  );
  assert.deepEqual(sanitizePreferences({ slippagePercent: "0.5", selectedAccount: "acc" }), { slippagePercent: "0.5" });
  for (const raw of ["junk", "[1]", "null", "2"]) {
    const preference = await loadWith(t, memoryStorage({ [KEY]: raw }), `malformed=${raw}`);
    assert.deepEqual(preference.readPreferences(), {});
  }
});

test("account selection survives reloads without overwriting other preferences", async (t) => {
  const storage = memoryStorage({ [KEY]: JSON.stringify({ slippagePercent: "0.5", tradeExecutionPopup: false }) });
  const original = await loadWith(t, storage, "account-original");
  original.updatePreferences({ selectedAccount: { userId: "u", accountId: "acc_extra" } });
  const reloaded = await loadWith(t, storage, "account-reloaded");
  assert.deepEqual(reloaded.readPreferences(), {
    tradeExecutionPopup: false, slippagePercent: "0.5", selectedAccount: { userId: "u", accountId: "acc_extra" },
  });
});

test("general preference writes preserve old chart values if migration cannot save them", async (t) => {
  const storage = memoryStorage({ [KEY]: JSON.stringify({ candleInterval: "1d", volumePaneRatio: 0.4 }) });
  const originalSetItem = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === "tradex:chart-settings:v1") throw new Error("Chart settings cannot be written");
    originalSetItem(key, value);
  };
  const preference = await loadWith(t, storage, "migration-write-blocked");
  preference.updatePreferences({ slippagePercent: "2" });
  assert.deepEqual(JSON.parse(storage.stored.get(KEY)!), { candleInterval: "1d", volumePaneRatio: 0.4, slippagePercent: "2" });
});

test("preferences stay in memory when localStorage is blocked", async (t) => {
  const preference = await loadWith(t, blockedStorage, "blocked");
  preference.updatePreferences({ tradeExecutionPopup: false, slippagePercent: "2" });
  assert.equal(preference.shouldShowTradeExecutionPopup(), false);
  assert.equal(preference.readPreferences().slippagePercent, "2");
  preference.updatePreferences({ selectedAccount: { userId: "u", accountId: "a" } });
  assert.deepEqual(preference.readPreferences().selectedAccount, { userId: "u", accountId: "a" });
});
