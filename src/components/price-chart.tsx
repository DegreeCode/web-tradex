"use client";

import { useMemo } from "react";

import { LightweightLineChart } from "@/components/lightweight-chart";
import { decimalPrecision, fmtPrice } from "@/lib/format";
import { buildTradeChartData } from "@/lib/chart-trades";
import type { PublicTrade } from "@/lib/types";
import type { ChartHolding } from "@/lib/chart-holding";
import type { ChartOrderLine } from "@/lib/chart-orders";

export function PriceChart({
  trades,
  height = 300,
  holding,
  orders,
  curvePrice,
}: {
  trades: PublicTrade[];
  height?: number;
  holding?: ChartHolding;
  orders?: ChartOrderLine[];
  curvePrice?: string;
}) {
  const chartData = useMemo(() => buildTradeChartData(trades), [trades]);

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
      pricePrecision={Math.max(chartData.pricePrecision, decimalPrecision(curvePrice), ...(orders ?? []).map((order) => decimalPrecision(order.price)))}
      volume={chartData.volume}
      emptyMessage={points.length === 0 ? "체결 데이터가 아직 없어요" : "차트를 그릴 체결이 더 필요해요"}
      ariaLabel="최근 체결 가격 차트"
      holding={holding}
      orders={orders}
      curvePrice={curvePrice}
    />
  );
}
