"use client";

import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  type AutoscaleInfo,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  HistogramSeries,
  type IChartApi,
  type IPaneApi,
  type IPriceLine,
  type LogicalRange,
  type ISeriesApi,
  LastPriceAnimationMode,
  LineStyle,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useTheme } from "next-themes";

import { fmtCompactQuantity, fmtPrice, fmtSigned } from "@/lib/format";
import type { ChartHolding } from "@/lib/chart-holding";
import { canIncrementallyUpdate } from "@/lib/chart-updates";
import { calculateVolumePaneHeight, setVolumePaneRatio } from "@/lib/preferences";

const UP_COLOR = "#f04452";
const DOWN_COLOR = "#3182f6";
const HOLDING_COLOR = "#f59e0b";
const CHART_THEMES = {
  light: { grid: "#f2f4f6", text: "#8b95a1", crosshair: "#c9ced4", crosshairLabel: "#4b5563" },
  dark: { grid: "#262a31", text: "#858e99", crosshair: "#5d6570", crosshairLabel: "#3e444d" },
};
const APP_TIMEZONE = "Asia/Seoul";
const DEFAULT_PRICE_PRECISION = 8;
const VOLUME_PRECISION = 8;

export interface LightweightLinePoint {
  time: UTCTimestamp;
  value: number;
  timestamp: string;
  valueText?: string;
}

export interface LightweightCandlePoint {
  time: UTCTimestamp;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: string;
  volumeValue: number;
  tradeCount: number;
  openText?: string;
  highText?: string;
  lowText?: string;
  closeText?: string;
  synthetic?: boolean;
}

export interface LightweightVolumePoint {
  time: UTCTimestamp;
  value: number;
  color?: string;
}

interface LineChartProps {
  data: LightweightLinePoint[];
  height: number;
  color: string;
  valueLabel: string;
  valueFormatter: (value: number) => string;
  pricePrecision?: number;
  volume?: LightweightVolumePoint[];
  emptyMessage: string;
  ariaLabel: string;
  holding?: ChartHolding;
}

function useHoldingPriceLine(
  seriesRef: React.RefObject<ISeriesApi<"Candlestick", Time> | ISeriesApi<"Area", Time> | null>,
  hasData: boolean,
  height: number,
  averagePrice: string | undefined,
  seriesType?: ChartSeriesType,
) {
  const lineRef = useRef<{
    series: ISeriesApi<"Candlestick", Time> | ISeriesApi<"Area", Time>;
    line: IPriceLine;
  } | null>(null);
  useEffect(() => {
    const series = seriesRef.current;
    const previous = lineRef.current;
    lineRef.current = null;
    if (!series) return;
    if (previous?.series === series) series.removePriceLine(previous.line);
    const price = Number(averagePrice);
    if (averagePrice === undefined || !Number.isFinite(price)) {
      if (previous?.series === series) series.applyOptions({ autoscaleInfoProvider: undefined });
      return;
    }
    series.applyOptions({
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const info = original();
        return info?.priceRange ? {
          ...info,
          priceRange: {
            minValue: Math.min(info.priceRange.minValue, price),
            maxValue: Math.max(info.priceRange.maxValue, price),
          },
        } : info;
      },
    });
    const line = series.createPriceLine({
      price,
      color: HOLDING_COLOR,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "평단",
    });
    // Chart teardown removes its lines; a recreated chart owns a new series.
    lineRef.current = { series, line };
  }, [seriesRef, hasData, height, averagePrice, seriesType]);
}

function ChartHoldingLegend({ holding }: { holding?: ChartHolding }) {
  if (!holding) return null;
  const percent = holding.returnPercent;
  return (
    <div className="numeric mt-0.5 flex flex-wrap gap-x-2 font-semibold">
      <span style={{ color: HOLDING_COLOR }}>평단가 {fmtPrice(holding.averagePrice)}</span>
      <span className="text-app-gray-500">
        평가수익률{" "}
        <span style={{ color: percent === null || percent === 0 ? undefined : percent > 0 ? UP_COLOR : DOWN_COLOR }}>
          {percent === null ? "—" : `${fmtSigned(percent, 2)}%`}
        </span>
      </span>
    </div>
  );
}

function chartHoldingDescription(holding?: ChartHolding): string {
  if (!holding) return "";
  const percent = holding.returnPercent;
  return `. 평단가 ${fmtPrice(holding.averagePrice)}. 평가수익률 ${percent === null ? "없음" : `${fmtSigned(percent, 2)}%`}`;
}

function formatChartTime(time: Time): string {
  const millis =
    typeof time === "number"
      ? Number(time) * 1_000
      : typeof time === "string"
        ? Date.parse(time)
        : Date.UTC(time.year, time.month - 1, time.day);
  if (!Number.isFinite(millis)) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: APP_TIMEZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(millis));
}

function sameLinePoint(left: LightweightLinePoint | undefined, right: LightweightLinePoint): boolean {
  return Boolean(
    left &&
      left.time === right.time &&
      left.value === right.value &&
      left.valueText === right.valueText,
  );
}

function sameCandlePoint(
  left: LightweightCandlePoint | undefined,
  right: LightweightCandlePoint,
): boolean {
  return Boolean(
    left &&
      left.time === right.time &&
      left.open === right.open &&
      left.high === right.high &&
      left.low === right.low &&
      left.close === right.close &&
      left.volume === right.volume &&
      left.tradeCount === right.tradeCount,
  );
}

function sameVolumePoint(
  left: LightweightVolumePoint | undefined,
  right: LightweightVolumePoint,
): boolean {
  return Boolean(
    left && left.time === right.time && left.value === right.value && left.color === right.color,
  );
}

function updateLineSeries(
  series: ISeriesApi<"Area", Time>,
  previous: LightweightLinePoint[],
  next: LightweightLinePoint[],
): void {
  if (!canIncrementallyUpdate(previous, next)) {
    series.setData(next.map(({ time, value }) => ({ time, value })));
    return;
  }
  const previousByTime = new Map(previous.map((point) => [point.time, point]));
  const previousLast = previous[previous.length - 1]?.time;
  for (const point of next) {
    if (sameLinePoint(previousByTime.get(point.time), point)) continue;
    series.update(
      { time: point.time, value: point.value },
      previousLast !== undefined && point.time < previousLast,
    );
  }
}

function updateCandleSeries(
  series: ISeriesApi<"Candlestick", Time>,
  previous: LightweightCandlePoint[],
  next: LightweightCandlePoint[],
): void {
  if (!canIncrementallyUpdate(previous, next)) {
    series.setData(next.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    return;
  }
  const previousByTime = new Map(previous.map((point) => [point.time, point]));
  const previousLast = previous[previous.length - 1]?.time;
  for (const point of next) {
    if (sameCandlePoint(previousByTime.get(point.time), point)) continue;
    series.update(
      { time: point.time, open: point.open, high: point.high, low: point.low, close: point.close },
      previousLast !== undefined && point.time < previousLast,
    );
  }
}

function updateVolumeSeries(
  series: ISeriesApi<"Histogram", Time>,
  previous: LightweightVolumePoint[],
  next: LightweightVolumePoint[],
): void {
  if (!canIncrementallyUpdate(previous, next)) {
    series.setData(next.map(({ time, value, color }) => ({ time, value, color })));
    return;
  }
  const previousByTime = new Map(previous.map((point) => [point.time, point]));
  const previousLast = previous[previous.length - 1]?.time;
  for (const point of next) {
    if (sameVolumePoint(previousByTime.get(point.time), point)) continue;
    series.update(
      { time: point.time, value: point.value, color: point.color },
      previousLast !== undefined && point.time < previousLast,
    );
  }
}

function priceFormat(precision: number | undefined) {
  const safePrecision = Math.max(
    0,
    Math.min(DEFAULT_PRICE_PRECISION, Math.round(precision ?? DEFAULT_PRICE_PRECISION)),
  );
  const minMove = 10 ** -safePrecision;
  // Drop trailing zeros so a high-precision symbol does not widen the price
  // scale with labels like "1320.00000000".
  return {
    type: "custom" as const,
    minMove,
    base: 10 ** safePrecision,
    formatter: (price: number) => {
      const text = price.toFixed(safePrecision);
      return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
    },
  };
}

function rawDecimal(value: string | undefined, fallback: number, formatter: (value: number) => string): string {
  if (value && /^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) return value.trim();
  return formatter(fallback);
}

function areaColors(color: string) {
  return { lineColor: color, topColor: `${color}28`, bottomColor: `${color}00` };
}

function closeLinePoint({ time, close, timestamp, closeText }: LightweightCandlePoint): LightweightLinePoint {
  return { time, value: close, timestamp, valueText: closeText };
}

function chartThemeOptions(resolvedTheme: string | undefined) {
  const theme = resolvedTheme === "dark" ? CHART_THEMES.dark : CHART_THEMES.light;
  return {
    layout: { textColor: theme.text },
    grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
    crosshair: {
      vertLine: { color: theme.crosshair, labelBackgroundColor: theme.crosshairLabel },
      horzLine: { color: theme.crosshair, labelBackgroundColor: theme.crosshairLabel },
    },
  };
}

function useChartTheme(
  chartRef: React.RefObject<IChartApi | null>,
  hasData: boolean,
  height: number,
  seriesType?: ChartSeriesType,
) {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    chartRef.current?.applyOptions(chartThemeOptions(resolvedTheme));
  }, [chartRef, hasData, height, resolvedTheme, seriesType]);
}

function chartOptions(height: number) {
  return {
    width: 320,
    height,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: CHART_THEMES.light.text,
    },
    grid: {
      vertLines: { color: CHART_THEMES.light.grid },
      horzLines: { color: CHART_THEMES.light.grid },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: CHART_THEMES.light.crosshair, width: 1 as const, style: 2, labelBackgroundColor: CHART_THEMES.light.crosshairLabel },
      horzLine: { color: CHART_THEMES.light.crosshair, width: 1 as const, style: 2, labelBackgroundColor: CHART_THEMES.light.crosshairLabel },
    },
    rightPriceScale: {
      borderVisible: false,
      scaleMargins: { top: 0.2, bottom: 0.12 },
    },
    timeScale: {
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 2,
      barSpacing: 8,
    },
    localization: { timeFormatter: formatChartTime },
    // Horizontal chart gestures remain active on touch while pan-y lets the
    // surrounding page keep its normal vertical scroll behavior on mobile.
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: {
      mouseWheel: true,
      pinch: true,
      axisPressedMouseMove: { time: true, price: true },
      axisDoubleClickReset: true,
    },
  };
}

function setupVolumePaneResizeSync(
  volumePane: IPaneApi<Time> | null | undefined,
  height: number,
): () => void {
  if (!volumePane) return () => {};
  volumePane.setHeight(calculateVolumePaneHeight(height));
  let lastRecordedHeight = volumePane.getHeight();
  const saveHeight = () => {
    const currentHeight = volumePane.getHeight();
    if (currentHeight > 0 && currentHeight !== lastRecordedHeight) {
      lastRecordedHeight = currentHeight;
      setVolumePaneRatio(currentHeight / height);
    }
  };
  // A newly added pane has no DOM element until the first chart draw.
  // Read its public height API when a mouse/touch resize gesture ends.
  window.addEventListener("pointerup", saveHeight);
  return () => {
    saveHeight();
    window.removeEventListener("pointerup", saveHeight);
  };
}

export function LightweightLineChart({
  data,
  height,
  color,
  valueLabel,
  valueFormatter,
  pricePrecision,
  volume = [],
  emptyMessage,
  ariaLabel,
  holding,
}: LineChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area", Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram", Time> | null>(null);
  const previousRef = useRef<LightweightLinePoint[]>([]);
  const previousVolumeRef = useRef<LightweightVolumePoint[]>([]);
  const dataRef = useRef(data);
  const colorRef = useRef(color);
  const pricePrecisionRef = useRef(pricePrecision);
  const [hovered, setHovered] = useState<LightweightLinePoint | null>(null);
  // Plot width excludes the price scale, so the legend never covers its labels.
  const [plotWidth, setPlotWidth] = useState(0);
  const hasData = data.length >= 2;

  const latest = data[data.length - 1];

  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    pricePrecisionRef.current = pricePrecision;
  }, [pricePrecision]);

  useEffect(() => {
    if (!hasData) return;
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, chartOptions(height));
    const series = chart.addSeries(AreaSeries, {
      ...areaColors(colorRef.current),
      lineWidth: 2,
      lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
      ...(pricePrecisionRef.current === undefined
        ? {}
        : { priceFormat: priceFormat(pricePrecisionRef.current) }),
    });
    // Keep the volume pane on the same chart instance even while its first
    // dataset is empty, so a live trade never recreates/reset the chart.
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume", precision: VOLUME_PRECISION, minMove: 10 ** -VOLUME_PRECISION },
      priceLineVisible: false,
      lastValueVisible: false,
    }, 1);
    const cleanupVolumeSync = setupVolumePaneResizeSync(chart.panes()[1], height);
    const crosshairHandler = (param: MouseEventParams<Time>) => {
      const time = param.time;
      const point = param.seriesData.get(series);
      if (!param.point || time === undefined || !point || !("value" in point) || typeof time !== "number") {
        setHovered(null);
        return;
      }
      const source = dataRef.current.find((item) => item.time === time);
      if (source) setHovered({ ...source, value: Number(point.value) });
    };
    chart.subscribeCrosshairMove(crosshairHandler);
    chart.timeScale().subscribeSizeChange(setPlotWidth);
    const resize = (width: number) => chart.applyOptions({ width: Math.max(1, Math.floor(width)), height });
    resize(container.getBoundingClientRect().width || 320);
    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) resize(width);
    });
    resizeObserver.observe(container);
    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    return () => {
      cleanupVolumeSync();
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.timeScale().unsubscribeSizeChange(setPlotWidth);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      previousRef.current = [];
      previousVolumeRef.current = [];
    };
  }, [hasData, height]);
  useChartTheme(chartRef, hasData, height);
  useHoldingPriceLine(seriesRef, hasData, height, holding?.averagePrice);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.applyOptions(areaColors(color));
    if (pricePrecision !== undefined) series.applyOptions({ priceFormat: priceFormat(pricePrecision) });
    updateLineSeries(series, previousRef.current, data);
    previousRef.current = data;
    if (volumeSeriesRef.current) updateVolumeSeries(volumeSeriesRef.current, previousVolumeRef.current, volume);
    previousVolumeRef.current = volume;
    setHovered((current) => (current && data.some((item) => item.time === current.time) ? current : null));
  }, [color, data, height, pricePrecision, volume]);

  const active = hovered ?? latest;
  if (data.length < 2) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-xl bg-app-gray-50 text-[13px] text-app-gray-400"
        style={{ height }}
      >
        <p>{emptyMessage}</p>
        <ChartHoldingLegend holding={holding} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl"
      style={{ height, touchAction: "pan-y" }}
      role="img"
      aria-label={`${ariaLabel}. ${valueLabel} ${rawDecimal(active.valueText, active.value, valueFormatter)}${chartHoldingDescription(holding)}`}
    >
      <div
        className="pointer-events-none absolute top-2 left-2.5 z-10 text-[10px] leading-4 sm:text-[11px]"
        style={plotWidth > 0 ? { maxWidth: plotWidth - 16 } : undefined}
      >
        <p className="numeric truncate font-bold" style={{ color }}>
          {valueLabel} {rawDecimal(active.valueText, active.value, valueFormatter)}
        </p>
        <ChartHoldingLegend holding={holding} />
      </div>
    </div>
  );
}

export type ChartSeriesType = "candle" | "line";

interface CandleChartProps {
  data: LightweightCandlePoint[];
  height: number;
  seriesType?: ChartSeriesType;
  pricePrecision?: number;
  emptyMessage: string;
  ariaLabel: string;
  onLoadOlder?: () => void;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  holding?: ChartHolding;
}

export function LightweightCandleChart({
  data,
  height,
  seriesType = "candle",
  pricePrecision,
  emptyMessage,
  ariaLabel,
  onLoadOlder,
  hasOlder,
  loadingOlder,
  holding,
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick", Time> | ISeriesApi<"Area", Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram", Time> | null>(null);
  const previousRef = useRef<LightweightCandlePoint[]>([]);
  const previousVolumeRef = useRef<LightweightVolumePoint[]>([]);
  const dataRef = useRef(data);
  const pricePrecisionRef = useRef(pricePrecision);
  const [hovered, setHovered] = useState<LightweightCandlePoint | null>(null);
  // Plot width excludes the price scale, so the legend never covers its labels.
  const [plotWidth, setPlotWidth] = useState(0);
  const hasData = data.length > 0;

  const latest = data[data.length - 1];
  // The line view follows the direction of the whole loaded period.
  const lineColor = latest && latest.close < data[0].open ? DOWN_COLOR : UP_COLOR;
  const lineColorRef = useRef(lineColor);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    pricePrecisionRef.current = pricePrecision;
  }, [pricePrecision]);
  useEffect(() => {
    lineColorRef.current = lineColor;
  }, [lineColor]);

  useEffect(() => {
    if (!hasData) return;
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, chartOptions(height));
    const series = seriesType === "line"
      ? chart.addSeries(AreaSeries, {
          ...areaColors(lineColorRef.current),
          lineWidth: 2,
          lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
          priceFormat: priceFormat(pricePrecisionRef.current),
        })
      : chart.addSeries(CandlestickSeries, {
          upColor: UP_COLOR,
          downColor: DOWN_COLOR,
          borderUpColor: UP_COLOR,
          borderDownColor: DOWN_COLOR,
          wickUpColor: UP_COLOR,
          wickDownColor: DOWN_COLOR,
          priceFormat: priceFormat(pricePrecisionRef.current),
        });
    const volumeSeries = dataRef.current.some((point) => point.volumeValue > 0 || point.volume === "0")
      ? chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume", precision: VOLUME_PRECISION, minMove: 10 ** -VOLUME_PRECISION },
          priceLineVisible: false,
          lastValueVisible: false,
        }, 1)
      : null;
    const cleanupVolumeSync = setupVolumePaneResizeSync(volumeSeries ? chart.panes()[1] : null, height);
    const crosshairHandler = (param: MouseEventParams<Time>) => {
      const time = param.time;
      if (!param.point || time === undefined || typeof time !== "number") {
        setHovered(null);
        return;
      }
      const source = dataRef.current.find((item) => item.time === time);
      if (source) setHovered(source);
    };
    chart.subscribeCrosshairMove(crosshairHandler);
    chart.timeScale().subscribeSizeChange(setPlotWidth);
    const resize = (width: number) => chart.applyOptions({ width: Math.max(1, Math.floor(width)), height });
    resize(container.getBoundingClientRect().width || 320);
    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) resize(width);
    });
    resizeObserver.observe(container);
    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    return () => {
      cleanupVolumeSync();
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.timeScale().unsubscribeSizeChange(setPlotWidth);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      previousRef.current = [];
      previousVolumeRef.current = [];
    };
  }, [hasData, height, seriesType]);
  useChartTheme(chartRef, hasData, height, seriesType);
  useHoldingPriceLine(seriesRef, hasData, height, holding?.averagePrice, seriesType);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (pricePrecision !== undefined) series.applyOptions({ priceFormat: priceFormat(pricePrecision) });
    if (series.seriesType() === "Area") {
      const area = series as ISeriesApi<"Area", Time>;
      area.applyOptions(areaColors(lineColor));
      updateLineSeries(area, previousRef.current.map(closeLinePoint), data.map(closeLinePoint));
    } else {
      updateCandleSeries(series as ISeriesApi<"Candlestick", Time>, previousRef.current, data);
    }
    previousRef.current = data;
    if (volumeSeriesRef.current) {
      updateVolumeSeries(
        volumeSeriesRef.current,
        previousVolumeRef.current,
        data.map((point) => ({
          time: point.time,
          value: point.volumeValue,
          color: point.close >= point.open ? `${UP_COLOR}99` : `${DOWN_COLOR}99`,
        })),
      );
    }
    previousVolumeRef.current = data.map((point) => ({
      time: point.time,
      value: point.volumeValue,
      color: point.close >= point.open ? `${UP_COLOR}99` : `${DOWN_COLOR}99`,
    }));
    setHovered((current) => (current && data.some((item) => item.time === current.time) ? current : null));
  }, [data, height, lineColor, pricePrecision, seriesType]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || !hasOlder || loadingOlder || !onLoadOlder) return;
    const timeScale = chart.timeScale();
    let previousFrom = timeScale.getVisibleLogicalRange()?.from;
    let requested = false;
    const onRangeChange = (range: LogicalRange | null) => {
      if (!range) return;
      const movingEarlier = previousFrom !== undefined && range.from < previousFrom;
      previousFrom = range.from;
      // Wait for scrolling toward history, not the chart's initial layout.
      if (!movingEarlier || requested) return;
      const bars = series.barsInLogicalRange(range);
      if (bars && bars.barsBefore < 15) {
        requested = true;
        onLoadOlder();
      }
    };
    timeScale.subscribeVisibleLogicalRangeChange(onRangeChange);
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(onRangeChange);
  }, [hasData, height, seriesType, hasOlder, loadingOlder, onLoadOlder]);

  const active = hovered ?? latest;
  if (data.length === 0 || !active) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-xl bg-app-gray-50 text-[13px] text-app-gray-400"
        style={{ height }}
      >
        <p>{emptyMessage}</p>
        <ChartHoldingLegend holding={holding} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl"
      style={{ height, touchAction: "pan-y" }}
      role="img"
      aria-label={`${ariaLabel}. 종가 ${rawDecimal(active.closeText, active.close, fmtPrice)}${chartHoldingDescription(holding)}`}
    >
      {loadingOlder ? (
        <span role="status" className="pointer-events-none absolute bottom-8 left-3 z-10 rounded-md bg-card/90 px-2 py-1 text-[11px] text-app-gray-500">
          이전 캔들 불러오는 중
        </span>
      ) : null}
      <div
        className="pointer-events-none absolute top-2 left-2.5 z-10 text-[10px] leading-4 sm:text-[11px]"
        style={plotWidth > 0 ? { maxWidth: plotWidth - 16 } : undefined}
      >
        <div className="numeric grid grid-cols-2 gap-x-2 font-medium text-app-gray-900 sm:flex sm:flex-wrap sm:font-semibold">
          <span className="truncate"><span className="text-app-gray-500">시</span> {rawDecimal(active.openText, active.open, fmtPrice)}</span>
          <span className="truncate"><span className="text-app-gray-500">고</span> {rawDecimal(active.highText, active.high, fmtPrice)}</span>
          <span className="truncate"><span className="text-app-gray-500">저</span> {rawDecimal(active.lowText, active.low, fmtPrice)}</span>
          <span className="truncate"><span className="text-app-gray-500">종</span> {rawDecimal(active.closeText, active.close, fmtPrice)}</span>
          <span className="max-sm:hidden"><span className="text-app-gray-500">거</span> {fmtCompactQuantity(active.volume || active.volumeValue)}</span>
        </div>
        <ChartHoldingLegend holding={holding} />
      </div>
    </div>
  );
}
