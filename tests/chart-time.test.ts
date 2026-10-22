import test from "node:test";
import assert from "node:assert/strict";
import type { TickMarkType, UTCTimestamp } from "lightweight-charts";
import { formatChartTime, formatChartTickMark } from "../src/lib/chart-time";
import type { CandleInterval } from "../src/lib/types";

// lightweight-charts is ESM-only; keep the harness free of its browser runtime.
const tickTypes = { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 } satisfies Record<string, TickMarkType>;
const timestamp = (value: string) => Date.parse(value) / 1_000 as UTCTimestamp;
const time = timestamp("2026-10-14T01:02:03Z");

test("intraday and default charts preserve consecutive seconds in Seoul time", () => {
  for (const interval of [undefined, "1s", "1m", "5m", "15m", "30m", "1h", "4h"] satisfies (CandleInterval | undefined)[]) {
    assert.equal(formatChartTime(time, interval), "10. 14. 10:02:03");
    assert.equal(formatChartTime((time + 1) as UTCTimestamp, interval), "10. 14. 10:02:04");
  }
});

test("daily and weekly candle labels show the month and day", () => {
  for (const interval of ["1d", "1w"] satisfies CandleInterval[]) {
    assert.equal(formatChartTime(time, interval), "10. 14.");
    assert.equal(formatChartTime(timestamp("2026-10-14T02:34:56Z"), interval), "10. 14.");
  }
});

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
  for (const invalid of ["invalid", NaN as UTCTimestamp, Infinity as UTCTimestamp, 1e20 as UTCTimestamp]) {
    assert.equal(formatChartTime(invalid), "-");
    assert.equal(formatChartTime(invalid, "1y"), "-");
  }
});

for (const [instant, labels] of [
  ["2026-10-13T14:59:59Z", ["2026년", "10월", "13일", "23:59", "23:59:59"]],
  ["2026-10-13T15:00:00Z", ["2026년", "10월", "14일", "00:00", "00:00:00"]],
  ["2026-10-31T14:59:59Z", ["2026년", "10월", "31일", "23:59", "23:59:59"]],
  ["2026-10-31T15:00:00Z", ["2026년", "11월", "1일", "00:00", "00:00:00"]],
  ["2026-12-31T14:59:59Z", ["2026년", "12월", "31일", "23:59", "23:59:59"]],
  ["2026-12-31T15:00:00Z", ["2027년", "1월", "1일", "00:00", "00:00:00"]],
] as const) {
  test(`axis tick types follow Seoul calendar at ${instant}`, () => {
    for (const [index, type] of [tickTypes.Year, tickTypes.Month, tickTypes.DayOfMonth,
      tickTypes.Time, tickTypes.TimeWithSeconds].entries()) {
      assert.equal(formatChartTickMark(timestamp(instant), type), labels[index]);
    }
  });
}
