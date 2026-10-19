import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { ApiError } from "../src/lib/api";
import { symbolHoldingsQueryOptions } from "../src/lib/hooks/symbol-holdings";
import {
  nearestSymbolHoldingsPoint,
  normalizeSymbolHoldings,
  SYMBOL_HOLDINGS_RANGES,
  symbolHoldingsChart,
  symbolHoldingsRangeQuery,
} from "../src/lib/symbol-holdings";

const point = {
  t: "2026-09-12T00:00:00Z",
  total_supply: "1000.00000000",
  circulating_supply: "800.00000000",
  held_quantity: "400.00000000",
  long_quantity: "100.00000000",
  short_quantity: "600.00000000",
  holding_ratio_ppm: 500000,
  margin_long_ratio_ppm: 250000,
  margin_short_ratio_ppm: 1500000,
};
const payload = {
  symbol: "ALPHA.M", interval: "1h", data: [point], page: { next_cursor: null, has_more: false },
};

test("normalizes the public holdings contract example and preserves quantities and short ratios above 100%", () => {
  const rows = normalizeSymbolHoldings(payload);
  assert.deepEqual(rows, [{ ...point, time: Date.parse(point.t) }]);
  assert.equal(rows[0].short_quantity, "600.00000000");
  assert.equal(rows[0].margin_short_ratio_ppm, 1_500_000);
});

test("sorts descending API buckets oldest first without filling unobserved buckets", () => {
  const latest = { ...point, t: "2026-09-13T00:00:00Z" };
  const rows = normalizeSymbolHoldings({ data: [latest, point] });
  assert.deepEqual(rows.map((row) => row.t), [point.t, latest.t]);
  assert.equal(rows.length, 2);
  assert.equal(rows.at(-1)?.held_quantity, latest.held_quantity);
});

test("keeps null ratios distinct from zero when a denominator is unavailable", () => {
  const [row] = normalizeSymbolHoldings({ data: [{
    ...point, holding_ratio_ppm: null, margin_long_ratio_ppm: 0, margin_short_ratio_ppm: null,
  }] });
  assert.equal(row.holding_ratio_ppm, null);
  assert.equal(row.margin_long_ratio_ppm, 0);
  assert.equal(row.margin_short_ratio_ppm, null);
});

test("ignores unknown fields, malformed values and rows without a bucket timestamp", () => {
  const rows = normalizeSymbolHoldings({ data: [null, false, [], 2, { t: "invalid" }, { t: 1 }, { t: "2026-09-12" }, {
    ...point,
    total_supply: 1000,
    held_quantity: "NaN",
    long_quantity: "1.123456789",
    short_quantity: "1e20",
    holding_ratio_ppm: Infinity,
    margin_long_ratio_ppm: "250000",
    margin_short_ratio_ppm: NaN,
    future_field: "ignored",
  }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total_supply, null);
  assert.equal(rows[0].held_quantity, null);
  assert.equal(rows[0].long_quantity, null);
  assert.equal(rows[0].short_quantity, null);
  assert.equal(rows[0].holding_ratio_ppm, null);
  assert.equal(rows[0].margin_long_ratio_ppm, null);
  assert.equal(rows[0].margin_short_ratio_ppm, null);
  assert.ok(!("future_field" in rows[0]));
  assert.equal(normalizeSymbolHoldings({ data: [{ ...point, holding_ratio_ppm: 0.5 }] })[0].holding_ratio_ppm, null);
  for (const value of [undefined, null, [], {}, { data: null }, { data: {} }]) {
    assert.deepEqual(normalizeSymbolHoldings(value), []);
  }
});

test("preserves finite JSON integers beyond safe integer precision without clamping", () => {
  const value = 1e100;
  assert.equal(normalizeSymbolHoldings({ data: [{ ...point, margin_short_ratio_ppm: value }] })[0].margin_short_ratio_ppm, value);
});

test("maps each preset to its interval and rolling start with at most 500 buckets", () => {
  const now = Date.parse("2026-10-19T03:27:46.123Z");
  const expected = [
    ["1d", "5m", "2026-10-18T03:27:46.123Z", 5 * 60_000],
    ["1w", "1h", "2026-10-12T03:27:46.123Z", 60 * 60_000],
    ["1mo", "4h", "2026-09-19T03:27:46.123Z", 4 * 60 * 60_000],
    ["1y", "1d", "2025-10-19T03:27:46.123Z", 86_400_000],
  ] as const;
  for (const [range, interval, from, bucketMs] of expected) {
    const query = symbolHoldingsRangeQuery(range, now);
    assert.deepEqual(query, { interval, from, limit: 500 });
    assert.ok(Math.ceil((now - Date.parse(from)) / bucketMs) + 1 <= query.limit);
  }
  assert.deepEqual(SYMBOL_HOLDINGS_RANGES.map((range) => range.value), expected.map(([range]) => range));
});

test("chart scales above 100%, uses actual time spacing, and breaks lines at null ratios", () => {
  const rows = normalizeSymbolHoldings({ data: [point,
    { ...point, t: "2026-09-12T01:00:00Z", holding_ratio_ppm: null },
    { ...point, t: "2026-09-12T04:00:00Z" },
  ] });
  const chart = symbolHoldingsChart(rows);
  assert.ok(chart.max > 1_500_000);
  assert.ok(chart.y(1_500_000) >= chart.top && chart.y(1_500_000) <= chart.bottom);
  assert.equal(chart.x(rows[1].time), chart.right / 4);
  assert.equal(chart.paths[0].path.match(/M/g)?.length, 2);
  assert.equal(chart.paths[1].path.match(/M/g)?.length, 1);
  assert.ok(!chart.paths.some(({ path }) => /NaN|Infinity/.test(path)));
});

test("single, flat, all-null and extreme finite ratios produce valid chart coordinates", () => {
  for (const value of [0, null, Number.MAX_VALUE, -Number.MAX_VALUE]) {
    const rows = normalizeSymbolHoldings({ data: [{
      ...point, holding_ratio_ppm: value, margin_long_ratio_ppm: value, margin_short_ratio_ppm: value,
    }] });
    const chart = symbolHoldingsChart(rows);
    assert.ok(!chart.paths.some(({ path }) => /NaN|Infinity/.test(path)));
    assert.equal(chart.x(rows[0].time), chart.right / 2);
    if (value !== null) assert.ok(chart.y(value) >= chart.top && chart.y(value) <= chart.bottom);
    else assert.ok(chart.paths.every(({ path }) => path === ""));
  }
});

test("hover selects the nearest bucket across sparse intervals and at either edge", () => {
  const rows = normalizeSymbolHoldings({ data: [point, { ...point, t: "2026-09-12T04:00:00Z" }] });
  assert.equal(nearestSymbolHoldingsPoint(rows, rows[0].time - 1), 0);
  assert.equal(nearestSymbolHoldingsPoint(rows, rows[0].time + 3 * 3_600_000), 1);
  assert.equal(nearestSymbolHoldingsPoint(rows, rows[1].time + 1), 1);
});

test("query reads the top-level public page in one request with a cancellation signal", async () => {
  const originalFetch = globalThis.fetch;
  const client = new QueryClient();
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/v1/market/symbols/ALPHA%2F.M/holdings");
    assert.equal(url.searchParams.get("interval"), "5m");
    assert.equal(url.searchParams.get("limit"), "500");
    assert.ok(Number.isFinite(Date.parse(url.searchParams.get("from")!)));
    assert.ok(!url.searchParams.has("cursor"));
    assert.equal(init?.credentials, "include");
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ ...payload, page: { next_cursor: "ignored", has_more: true } });
  };
  try {
    assert.deepEqual(await client.fetchQuery(symbolHoldingsQueryOptions("ALPHA/.M", "1d")), normalizeSymbolHoldings(payload));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    client.clear();
  }
});

test("query keeps range placeholders only within the same symbol and stops polling 4xx errors", () => {
  const options = symbolHoldingsQueryOptions("ALPHA.M", "1w");
  assert.deepEqual(options.queryKey, ["symbol-holdings", "ALPHA.M", "1w"]);
  assert.equal(options.staleTime, 60_000);
  assert.equal(options.retry, false);
  assert.equal(options.refetchIntervalInBackground, false);
  assert.equal(symbolHoldingsQueryOptions(undefined, "1w").enabled, false);
  const rows = normalizeSymbolHoldings(payload);
  const client = new QueryClient();
  try {
    const same = new QueryObserver(client, symbolHoldingsQueryOptions("ALPHA.M", "1d")).getCurrentQuery();
    const other = new QueryObserver(client, symbolHoldingsQueryOptions("BETA.M", "1d")).getCurrentQuery();
    assert.ok(typeof options.placeholderData === "function");
    assert.ok(typeof options.refetchInterval === "function");
    assert.equal(options.placeholderData(rows, same), rows);
    assert.equal(options.placeholderData(rows, other), undefined);
    for (const status of [400, 403, 404, 429]) {
      same.setState({ error: new ApiError(status, "NOT_FOUND", "not found") });
      assert.equal(options.refetchInterval(same), false);
    }
    for (const error of [null, new ApiError(503, "SERVICE_NOT_READY", "unavailable")]) {
      same.setState({ error });
      assert.equal(options.refetchInterval(same), 60_000);
    }
  } finally {
    client.clear();
  }
});
