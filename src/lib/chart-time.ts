import type { Time } from "lightweight-charts";
import type { CandleInterval } from "./types";

const APP_TIMEZONE = "Asia/Seoul";

// Axis and crosshair labels are formatted on every draw. Share the four
// formatter shapes instead of constructing Intl formatters for each label.
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

export function formatChartTime(time: Time, interval?: CandleInterval): string {
  const millis =
    typeof time === "number"
      ? Number(time) * 1_000
      : typeof time === "string"
        ? Date.parse(time)
        : Date.UTC(time.year, time.month - 1, time.day);
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
