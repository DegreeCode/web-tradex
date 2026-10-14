import test from "node:test";
import assert from "node:assert/strict";
import type { UTCTimestamp } from "lightweight-charts";
import { formatChartTime } from "../src/lib/chart-time";
import type { CandleInterval } from "../src/lib/types";

const timestamp = (value: string) => Date.parse(value) / 1_000 as UTCTimestamp;
const time = timestamp("2026-10-14T01:02:03Z");

for (const interval of ["1s", "1m", "5m", "15m", "30m", "1h", "4h"] satisfies CandleInterval[]) {
  test(`${interval} candle hover labels include seconds in Seoul time`, () => {
    assert.equal(formatChartTime(time, interval), "10. 14. 10:02:03");
  });
}

test("an omitted interval includes seconds for trade charts and default candle charts", () => {
  assert.equal(formatChartTime(time), "10. 14. 10:02:03");
});

test("consecutive trade seconds have distinct hover labels", () => {
  assert.equal(formatChartTime(time), "10. 14. 10:02:03");
  assert.equal(formatChartTime((time + 1) as UTCTimestamp), "10. 14. 10:02:04");
});

for (const interval of ["1d", "1w"] satisfies CandleInterval[]) {
  test(`${interval} candle hover labels show only the two-digit month and day`, () => {
    assert.equal(formatChartTime(time, interval), "10. 14.");
    assert.equal(formatChartTime(timestamp("2026-10-14T02:34:56Z"), interval), "10. 14.");
  });
}

test("monthly candle hover labels show the year and month", () => {
  assert.equal(formatChartTime(time, "1M"), "2026. 10.");
});

test("yearly candle hover labels show only the year", () => {
  assert.equal(formatChartTime(time, "1y"), "2026년");
});

test("Seoul midnight advances the displayed date and preserves seconds", () => {
  const midnight = timestamp("2026-10-13T15:00:03Z");
  assert.equal(formatChartTime(midnight, "1s"), "10. 14. 00:00:03");
  assert.equal(formatChartTime(midnight, "1d"), "10. 14.");
  assert.equal(formatChartTime(midnight, "1w"), "10. 14.");
});

test("monthly and yearly labels follow the Seoul calendar at year boundaries", () => {
  const newYear = timestamp("2026-12-31T15:00:00Z");
  assert.equal(formatChartTime(newYear, "1M"), "2027. 1.");
  assert.equal(formatChartTime(newYear, "1y"), "2027년");
});

test("string and business-day times retain the existing input support", () => {
  assert.equal(formatChartTime("2026-10-14T10:02:03+09:00"), "10. 14. 10:02:03");
  assert.equal(formatChartTime("2026-10-14", "1d"), "10. 14.");
  assert.equal(formatChartTime({ year: 2026, month: 10, day: 14 }), "10. 14. 09:00:00");
  assert.equal(formatChartTime({ year: 2026, month: 10, day: 14 }, "1d"), "10. 14.");
});

test("invalid times keep the existing placeholder", () => {
  for (const invalid of ["invalid", NaN as UTCTimestamp, Infinity as UTCTimestamp]) {
    assert.equal(formatChartTime(invalid), "-");
    assert.equal(formatChartTime(invalid, "1y"), "-");
  }
});
