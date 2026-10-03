"use client";

import { useMemo } from "react";

import {
  type ChartSeriesType,
  LightweightCandleChart,
  type LightweightCandlePoint,
} from "@/components/lightweight-chart";
import { decimalPrecision, toNumber } from "@/lib/format";
import type { ChartHolding } from "@/lib/chart-holding";
import type { Candle } from "@/lib/types";

export function CandleChart({
  candles,
  seriesType,
  height = 300,
  onLoadOlder,
  hasOlder,
  loadingOlder,
  holding,
}: {
  candles: Candle[];
  seriesType?: ChartSeriesType;
  height?: number;
  onLoadOlder?: () => void;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  holding?: ChartHolding;
}) {
  const pricePrecision = useMemo(
    () =>
      candles.reduce(
        (precision, candle) =>
          Math.max(
            precision,
            decimalPrecision(candle.open),
            decimalPrecision(candle.high),
            decimalPrecision(candle.low),
            decimalPrecision(candle.close),
          ),
        0,
      ),
    [candles],
  );
  const data = useMemo<LightweightCandlePoint[]>(
    () =>
      [...candles]
        .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
        .map((candle) => ({
          time: Math.floor(Date.parse(candle.timestamp) / 1_000) as LightweightCandlePoint["time"],
          timestamp: candle.timestamp,
          open: toNumber(candle.open),
          high: toNumber(candle.high),
          low: toNumber(candle.low),
          close: toNumber(candle.close),
          volume: candle.volume_shares,
          volumeValue: toNumber(candle.volume_shares),
          tradeCount: candle.trade_count,
          openText: candle.open,
          highText: candle.high,
          lowText: candle.low,
          closeText: candle.close,
          synthetic: candle.synthetic,
        }))
        .filter((candle) => Number.isFinite(candle.time)),
    [candles],
  );

  return (
    <LightweightCandleChart
      data={data}
      height={height}
      seriesType={seriesType}
      pricePrecision={pricePrecision}
      emptyMessage="캔들 데이터가 아직 없어요"
      ariaLabel={seriesType === "line" ? "가격 라인 차트" : "가격 캔들 차트"}
      onLoadOlder={onLoadOlder}
      hasOlder={hasOlder}
      loadingOlder={loadingOlder}
      holding={holding}
    />
  );
}
