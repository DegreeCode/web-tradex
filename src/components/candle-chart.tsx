"use client";

import { useMemo } from "react";

import {
  type ChartSeriesType,
  LightweightCandleChart,
  type LightweightCandlePoint,
} from "@/components/lightweight-chart";
import { decimalPrecision, toNumber } from "@/lib/format";
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
  const { data, pricePrecision } = useMemo(() => {
    let precision = Math.max(
      decimalPrecision(curvePrice),
      ...(orders ?? []).map((order) => decimalPrecision(order.price)),
    );
    // Candle pages are newest-first; the chart needs oldest-first. Convert in
    // one pass without sorting, since candle-data guarantees the order.
    const data: LightweightCandlePoint[] = [];
    for (let index = candles.length - 1; index >= 0; index -= 1) {
      const candle = candles[index];
      precision = Math.max(
        precision,
        decimalPrecision(candle.open),
        decimalPrecision(candle.high),
        decimalPrecision(candle.low),
        decimalPrecision(candle.close),
      );
      const time = Math.floor(Date.parse(candle.timestamp) / 1_000);
      if (!Number.isFinite(time)) continue;
      data.push({
        time: time as LightweightCandlePoint["time"],
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
      });
    }
    // The chart throws on out-of-order or repeated times. Pages are already
    // ordered, so this check is a single scan and the sort a rare fallback.
    const ordered = data.every((point, index) => index === 0 || point.time > data[index - 1].time);
    if (!ordered) data.sort((left, right) => left.time - right.time);
    return {
      data: ordered ? data : data.filter((point, index) => index === 0 || point.time !== data[index - 1].time),
      pricePrecision: precision,
    };
  }, [candles, orders, curvePrice]);

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
