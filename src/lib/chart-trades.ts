import type { UTCTimestamp } from "lightweight-charts";

import { addDecimal, decimalPrecision, toNumber } from "./format";
import type { PublicTrade } from "./types";

/** One closing price per second, following the same sequence order as candles. */
export function buildTradeChartData(trades: PublicTrade[]) {
  const bySecond = new Map<number, { trade: PublicTrade; volume: string }>();
  let pricePrecision = 0;
  for (const trade of trades) {
    const millis = Date.parse(trade.timestamp);
    if (!Number.isFinite(millis)) continue;
    const time = Math.floor(millis / 1_000);
    pricePrecision = Math.max(pricePrecision, decimalPrecision(trade.price));
    const current = bySecond.get(time);
    if (current) {
      current.volume = addDecimal(current.volume, trade.quantity);
      // Millisecond comparisons lose nanosecond ordering and do not account
      // for a server clock moving backward. Trade sequences define the close.
      if (trade.sequence > current.trade.sequence) current.trade = trade;
    } else {
      bySecond.set(time, { trade, volume: trade.quantity });
    }
  }
  const groups = [...bySecond].sort(([left], [right]) => left - right);
  const points = groups.map(([time, { trade }]) => ({
    time: time as UTCTimestamp,
    value: toNumber(trade.price),
    timestamp: trade.timestamp,
    valueText: trade.price,
  }));
  const volume = groups.map(([time, group], index) => ({
    time: time as UTCTimestamp,
    value: toNumber(group.volume),
    color: index === 0 || points[index].value >= points[index - 1].value ? "#f0445299" : "#3182f699",
  }));
  return { points, volume, pricePrecision };
}
