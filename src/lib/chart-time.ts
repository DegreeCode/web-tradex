import type { TickMarkType, Time } from "lightweight-charts";
import type { CandleInterval } from "./types";

const APP_TIMEZONE = "Asia/Seoul";

// Axis and crosshair labels are formatted on every draw; reuse Intl formatters.
const formatter = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: APP_TIMEZONE,
  ...options,
});
const FORMATTERS = {
  year: formatter({ year: "numeric" }),
  month: formatter({ year: "numeric", month: "2-digit" }),
  day: formatter({ month: "2-digit", day: "2-digit" }),
  second: formatter({
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }),
};

function chartTimeMillis(time: Time): number {
  const millis =
    typeof time === "number"
      ? Number(time) * 1_000
      : typeof time === "string"
        ? Date.parse(time)
        : Date.UTC(time.year, time.month - 1, time.day);
  return millis;
}

export function formatChartTime(time: Time, interval?: CandleInterval): string {
  const millis = chartTimeMillis(time);
  if (!Number.isFinite(millis) || Math.abs(millis) > 8.64e15) return "-";
  const selected =
    interval === "1y"
      ? FORMATTERS.year
      : interval === "1M"
        ? FORMATTERS.month
        : interval === "1d" || interval === "1w"
          ? FORMATTERS.day
          : FORMATTERS.second;
  return selected.format(millis);
}

// TickMarkType's numeric keys keep this helper independent of the chart runtime.
const TICK_FORMATTERS: Record<TickMarkType, Intl.DateTimeFormat> = {
  0: FORMATTERS.year,
  1: formatter({ month: "long" }),
  2: formatter({ day: "numeric" }),
  3: formatter({ hour: "2-digit", minute: "2-digit", hour12: false }),
  4: formatter({ hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
};

export function formatChartTickMark(time: Time, type: TickMarkType): string {
  const millis = chartTimeMillis(time);
  if (!Number.isFinite(millis) || Math.abs(millis) > 8.64e15) return "-";
  return TICK_FORMATTERS[type].format(millis);
}
