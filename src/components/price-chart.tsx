"use client";

import { useMemo } from "react";

import {
  LightweightLineChart,
  type LightweightLinePoint,
  type LightweightVolumePoint,
} from "@/components/lightweight-chart";
import { addDecimal, decimalPrecision, fmtPrice, toNumber } from "@/lib/format";
import type { PublicTrade } from "@/lib/types";
import type { ChartHolding } from "@/lib/chart-holding";
import type { ChartOrderLine } from "@/lib/chart-orders";

function toChartTime(timestamp: string): number | null {
  const millis = Date.parse(timestamp);
  if (!Number.isFinite(millis)) return null;
  return Math.floor(millis / 1_000);
}

export function PriceChart({
  trades,
  height = 300,
  holding,
  orders,
}: {
  trades: PublicTrade[];
  height?: number;
  holding?: ChartHolding;
  orders?: ChartOrderLine[];
}) {
  const chartData = useMemo<{ points: LightweightLinePoint[]; volume: LightweightVolumePoint[]; pricePrecision: number }>(() => {
    const bySecond = new Map<number, { point: LightweightLinePoint; volume: string }>();
    for (const trade of trades) {
      const time = toChartTime(trade.timestamp);
      if (time === null) continue;
      const current = bySecond.get(time);
      if (current) {
        current.volume = addDecimal(current.volume, trade.quantity);
        if (Date.parse(trade.timestamp) >= Date.parse(current.point.timestamp)) {
          current.point = {
            time: time as LightweightLinePoint["time"],
            value: toNumber(trade.price),
            timestamp: trade.timestamp,
            valueText: trade.price,
          };
        }
      } else {
        bySecond.set(time, {
          point: {
            time: time as LightweightLinePoint["time"],
            value: toNumber(trade.price),
            timestamp: trade.timestamp,
            valueText: trade.price,
          },
          volume: trade.quantity,
        });
      }
    }
    const groups = [...bySecond.values()].sort((left, right) => left.point.time - right.point.time);
    const points = groups.map((group) => group.point);
    const volume = groups.map((group, index) => ({
      time: group.point.time,
      value: toNumber(group.volume),
      color:
        index === 0 || group.point.value >= points[index - 1].value
          ? "#f0445299"
          : "#3182f699",
    }));
    return {
      points,
      volume,
      pricePrecision: trades.reduce(
        (precision, trade) => Math.max(precision, decimalPrecision(trade.price)),
        0,
      ),
    };
  }, [trades]);

  const points = chartData.points;
  const first = points[0]?.value ?? 0;
  const last = points[points.length - 1]?.value ?? 0;
  const color = last >= first ? "#f04452" : "#3182f6";

  return (
    <LightweightLineChart
      data={points}
      height={height}
      color={color}
      valueLabel="최근 체결"
      valueFormatter={fmtPrice}
      pricePrecision={Math.max(chartData.pricePrecision, ...(orders ?? []).map((order) => decimalPrecision(order.price)))}
      volume={chartData.volume}
      emptyMessage={points.length === 0 ? "체결 데이터가 아직 없어요" : "차트를 그릴 체결이 더 필요해요"}
      ariaLabel="최근 체결 가격 차트"
      holding={holding}
      orders={orders}
    />
  );
}
