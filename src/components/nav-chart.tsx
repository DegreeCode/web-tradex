"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import { fmtCredit, fmtDateTime, toNumber } from "@/lib/format";
import type { NavPoint, NavRange } from "@/lib/types";

export const NAV_RANGES: { value: NavRange; label: string }[] = [
  { value: "1d", label: "1일" },
  { value: "1w", label: "1주" },
  { value: "1mo", label: "1개월" },
  { value: "3mo", label: "3개월" },
  { value: "1y", label: "1년" },
];

const UP_COLOR = "#f04452";
const DOWN_COLOR = "#3182f6";

interface Point {
  time: UTCTimestamp;
  value: number;
}

/** Oldest-first points, one per second, as the chart requires. */
function toPoints(points: NavPoint[]): Point[] {
  const bySecond = new Map<number, number>();
  for (const point of points) {
    const millis = Date.parse(point.timestamp);
    if (Number.isFinite(millis)) bySecond.set(Math.floor(millis / 1_000), toNumber(point.value));
  }
  return [...bySecond]
    .sort(([a], [b]) => a - b)
    .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
}

function areaColors(color: string) {
  return { lineColor: color, topColor: `${color}29`, bottomColor: `${color}00` };
}

/** Axis-free asset sparkline; hovering shows the value at that moment. */
export function NavChart({ points, height = 200 }: { points: NavPoint[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area", Time> | null>(null);
  const [hovered, setHovered] = useState<Point | null>(null);
  const data = useMemo(() => toPoints(points), [points]);
  const hasData = data.length >= 2;
  const color = hasData && data[data.length - 1].value < data[0].value ? DOWN_COLOR : UP_COLOR;

  useEffect(() => {
    const container = containerRef.current;
    if (!hasData || !container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" } },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false, scaleMargins: { top: 0.1, bottom: 0.04 } },
      timeScale: { visible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "#b0b8c1", style: LineStyle.Dashed, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerRadius: 4,
    });
    const onMove = (param: MouseEventParams<Time>) => {
      const point = param.point && param.seriesData.get(series);
      setHovered(point && "value" in point ? { time: param.time as UTCTimestamp, value: point.value } : null);
    };
    chart.subscribeCrosshairMove(onMove);
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [hasData]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.applyOptions(areaColors(color));
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
    setHovered(null);
  }, [color, data]);

  if (!hasData) {
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-app-gray-50 text-[13px] text-app-gray-400"
        style={{ height }}
      >
        아직 기록이 부족해요
      </div>
    );
  }

  const first = data[0];
  const last = data[data.length - 1];
  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`자산 추이 차트. ${fmtCredit(first.value, 2)}에서 ${fmtCredit(last.value, 2)} Credit`}
      className="relative w-full"
      style={{ height, touchAction: "pan-y" }}
    >
      {hovered ? (
        <div className="pointer-events-none absolute top-0 left-0 z-10 rounded-lg bg-app-gray-900/90 px-2.5 py-1.5 text-app-gray-50 shadow-lg">
          <p className="text-[11px] text-app-gray-50/70">{fmtDateTime(new Date(hovered.time * 1_000).toISOString())}</p>
          <p className="numeric text-[13px] font-semibold">{fmtCredit(hovered.value, 2)} Credit</p>
        </div>
      ) : null}
    </div>
  );
}
