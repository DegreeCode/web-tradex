import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

const moduleUrl = new URL("../src/lib/chart-settings.ts", import.meta.url);
const KEY = "tradex:chart-settings:v1";
const GENERAL_KEY = "tradex:preferences:v1";
type SettingsModule = typeof import("../src/lib/chart-settings");

function memoryStorage(initial: Record<string, string> = {}) {
  const stored = new Map(Object.entries(initial));
  return {
    stored,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, String(value)),
    removeItem: (key: string) => void stored.delete(key),
  };
}

async function loadWith(t: TestContext, localStorage: object, tag: string): Promise<SettingsModule> {
  (globalThis as { window?: unknown }).window = { localStorage };
  t.after(() => { delete (globalThis as { window?: unknown }).window; });
  return import(`${moduleUrl}?${tag}`);
}

test("chart fields move out of general preferences without changing unrelated values", async (t) => {
  const general = { tradeExecutionPopup: false, slippagePercent: "2", selectedAccount: { userId: "u", accountId: "a" } };
  const storage = memoryStorage({ [GENERAL_KEY]: JSON.stringify({ ...general, candleInterval: "15m", volumePaneRatio: 0.4 }) });
  const chart = await loadWith(t, storage, "bundled-migration");
  assert.deepEqual(chart.readChartSettings(), { candleInterval: "15m", volumePaneRatio: 0.4 });
  assert.deepEqual(JSON.parse(storage.stored.get(KEY)!), chart.readChartSettings());
  assert.deepEqual(JSON.parse(storage.stored.get(GENERAL_KEY)!), general);
});

test("single-value chart keys migrate without creating general preferences", async (t) => {
  const storage = memoryStorage({ "tradex:candle-interval:v1": "4h", "tradex:volume-pane-ratio:v1": "0.5" });
  const chart = await loadWith(t, storage, "single-migration");
  assert.deepEqual(chart.readChartSettings(), { candleInterval: "4h", volumePaneRatio: 0.5 });
  assert.deepEqual([...storage.stored.keys()], [KEY]);
});

test("saved chart settings take precedence over leftover legacy fields", async (t) => {
  const storage = memoryStorage({
    [KEY]: JSON.stringify({ candleInterval: "1d", showAverageCost: false }),
    [GENERAL_KEY]: JSON.stringify({ candleInterval: "1m", volumePaneRatio: 0.3 }),
  });
  const chart = await loadWith(t, storage, "precedence");
  assert.deepEqual(chart.readChartSettings(), { candleInterval: "1d", showAverageCost: false });
});

test("visibility, series mode, logarithmic scale and volume height survive reloads in the chart record", async (t) => {
  const storage = memoryStorage({ [GENERAL_KEY]: JSON.stringify({ slippagePercent: "2" }) });
  const original = await loadWith(t, storage, "original");
  assert.equal(original.calculateVolumePaneHeight(260), 73);
  original.updateChartSettings({ showAverageCost: false, seriesType: "line", candleInterval: "5m", logarithmic: true });
  original.setVolumePaneRatio(109 / 260);
  const reloaded = await loadWith(t, storage, "reloaded");
  assert.deepEqual(reloaded.readChartSettings(), { candleInterval: "5m", seriesType: "line", volumePaneRatio: 109 / 260, showAverageCost: false, logarithmic: true });
  assert.equal(reloaded.calculateVolumePaneHeight(260), 109);
  assert.equal(reloaded.calculateVolumePaneHeight(220), 92);
  assert.deepEqual(JSON.parse(storage.stored.get(GENERAL_KEY)!), { slippagePercent: "2" });
  reloaded.updateChartSettings({ logarithmic: false });
  const linear = await loadWith(t, storage, "linear-reloaded");
  assert.equal(linear.readChartSettings().logarithmic, false);
  assert.equal(linear.readChartSettings().showAverageCost, false);
});

test("invalid and malformed settings safely fall back to defaults", async (t) => {
  const { sanitizeChartSettings } = await loadWith(t, memoryStorage(), "sanitize");
  assert.deepEqual(sanitizeChartSettings({ candleInterval: "bad", seriesType: "bars", volumePaneRatio: 1, showAverageCost: "false", logarithmic: "true" }), {});
  assert.deepEqual(sanitizeChartSettings({ candleInterval: "1h", volumePaneRatio: 0.3, showAverageCost: true, logarithmic: false }), { candleInterval: "1h", volumePaneRatio: 0.3, showAverageCost: true, logarithmic: false });
  for (const raw of ["junk", "[1]", "null", "2"]) {
    const chart = await loadWith(t, memoryStorage({ [KEY]: raw }), `malformed=${raw}`);
    assert.deepEqual(chart.readChartSettings(), {});
    assert.equal(chart.calculateVolumePaneHeight(260), 73);
  }
});

test("chart controls work in memory when browser storage is blocked", async (t) => {
  const blockedStorage = {
    getItem: () => { throw new Error("Storage disabled"); },
    setItem: () => { throw new Error("Storage disabled"); },
    removeItem: () => { throw new Error("Storage disabled"); },
  };
  const chart = await loadWith(t, blockedStorage, "blocked");
  chart.updateChartSettings({ showAverageCost: false, seriesType: "line", logarithmic: true });
  chart.setVolumePaneRatio(0.5);
  assert.deepEqual(chart.readChartSettings(), { seriesType: "line", volumePaneRatio: 0.5, showAverageCost: false, logarithmic: true });
  assert.equal(chart.calculateVolumePaneHeight(260), 130);
});
