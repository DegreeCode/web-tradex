"use client";

import { useMemo } from "react";

import {
  type ChartSeriesType,
  LightweightCandleChart,
} from "@/components/lightweight-chart";
import { decimalPrecision } from "@/lib/format";
import { buildCandleChartData } from "@/lib/chart-updates";
import type { ChartHolding } from "@/lib/chart-holding";
import type { ChartOrderLine } from "@/lib/chart-orders";
import type { Candle, CandleInterval } from "@/lib/types";

export function CandleChart({
  candles,
  interval,
  seriesType,
  height = 300,
  onLoadOlder,
  hasOlder,
  loadingOlder,
  holding,
  orders,
  curvePrice,
}: {
  candles: Candle[];
  interval?: CandleInterval;
  seriesType?: ChartSeriesType;
  height?: number;
  onLoadOlder?: () => void;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  holding?: ChartHolding;
  orders?: ChartOrderLine[];
  curvePrice?: string;
}) {
  const { data, pricePrecision: candlePrecision } = useMemo(() => buildCandleChartData(candles), [candles]);
  const pricePrecision = Math.max(candlePrecision, decimalPrecision(curvePrice),
    ...(orders ?? []).map(order => decimalPrecision(order.price)));

  return (
    <LightweightCandleChart
      data={data}
      interval={interval}
      height={height}
      seriesType={seriesType}
      pricePrecision={pricePrecision}
      emptyMessage="캔들 데이터가 아직 없어요"
      ariaLabel={seriesType === "line" ? "가격 라인 차트" : "가격 캔들 차트"}
      onLoadOlder={onLoadOlder}
      hasOlder={hasOlder}
      loadingOlder={loadingOlder}
      holding={holding}
      orders={orders}
      curvePrice={curvePrice}
    />
  );
}
