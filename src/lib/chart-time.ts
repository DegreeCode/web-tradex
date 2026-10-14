import type { Time } from "lightweight-charts";
import type { CandleInterval } from "./types";

const APP_TIMEZONE = "Asia/Seoul";

export function formatChartTime(time: Time, interval?: CandleInterval): string {
  const millis =
    typeof time === "number"
      ? Number(time) * 1_000
      : typeof time === "string"
        ? Date.parse(time)
        : Date.UTC(time.year, time.month - 1, time.day);
  if (!Number.isFinite(millis)) return "-";
  const options: Intl.DateTimeFormatOptions =
    interval === "1y"
      ? { year: "numeric" }
      : interval === "1M"
        ? { year: "numeric", month: "2-digit" }
        : interval === "1d" || interval === "1w"
          ? { month: "2-digit", day: "2-digit" }
          : {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            };
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: APP_TIMEZONE,
    ...options,
  }).format(new Date(millis));
}
