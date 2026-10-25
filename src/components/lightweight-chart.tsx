"use client";

import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
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
  PriceScaleMode,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useTheme } from "next-themes";

import { fmtCompactQuantity, fmtPrice, fmtSigned } from "@/lib/format";
import type { ChartHolding } from "@/lib/chart-holding";
import type { ChartOrderLine } from "@/lib/chart-orders";
import { formatChartTickMark, formatChartTime } from "@/lib/chart-time";
import { candleLinePoint, candleVolumePoint, canIncrementallyUpdate, findChartPoint } from "@/lib/chart-updates";
import { calculateVolumePaneHeight, setVolumePaneRatio, useChartSettings } from "@/lib/chart-settings";
import type { CandleInterval } from "@/lib/types";

const UP_COLOR = "#f04452";
const DOWN_COLOR = "#3182f6";
const HOLDING_COLOR = "#f59e0b";
const CURVE_PRICE_COLOR = "#8b5cf6";
const EMPTY_ORDER_LINES: ChartOrderLine[] = [];
const CHART_THEMES = {
  light: { grid: "#f2f4f6", text: "#8b95a1", crosshair: "#c9ced4", crosshairLabel: "#4b5563" },
  dark: { grid: "#262a31", text: "#858e99", crosshair: "#5d6570", crosshairLabel: "#3e444d" },
};
const DEFAULT_PRICE_PRECISION = 8;
const VOLUME_PRECISION = 8;

type PrimarySeries = ISeriesApi<"Candlestick", Time> | ISeriesApi<"Area", Time>;

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
  orders?: ChartOrderLine[];
  curvePrice?: string;
}

function useCurvePriceLine(
  seriesRef: React.RefObject<PrimarySeries | null>,
  hasData: boolean,
  height: number,
  curvePrice: string | undefined,
  seriesType?: ChartSeriesType,
) {
  const lineRef = useRef<{
    series: PrimarySeries;
    line: IPriceLine;
  } | null>(null);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) {
      lineRef.current = null;
      return;
    }
    // A chart recreation discards the previous series and its price lines.
    const previous = lineRef.current?.series === series ? lineRef.current : null;
    const price = Number(curvePrice);
    if (curvePrice === undefined || !Number.isFinite(price) || price <= 0) {
      if (previous) series.removePriceLine(previous.line);
      lineRef.current = null;
      return;
    }
    const options = {
      price,
      color: CURVE_PRICE_COLOR,
      lineWidth: 1 as const,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "현재가",
    };
    if (previous) previous.line.applyOptions(options);
    else lineRef.current = { series, line: series.createPriceLine(options) };
  }, [seriesRef, hasData, height, curvePrice, seriesType]);
}

function useHoldingPriceLine(
  seriesRef: React.RefObject<PrimarySeries | null>,
  hasData: boolean,
  height: number,
  averagePrice: string | undefined,
  seriesType?: ChartSeriesType,
) {
  const lineRef = useRef<{
    series: PrimarySeries;
    line: IPriceLine;
  } | null>(null);
  useEffect(() => {
    const series = seriesRef.current;
    const previous = lineRef.current;
    lineRef.current = null;
    if (!series) return;
    if (previous?.series === series) series.removePriceLine(previous.line);
    const price = Number(averagePrice);
    if (averagePrice === undefined || !Number.isFinite(price)) return;
    const line = series.createPriceLine({
      price,
      color: HOLDING_COLOR,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
    });
    // Chart teardown removes its lines; a recreated chart owns a new series.
    lineRef.current = { series, line };
  }, [seriesRef, hasData, height, averagePrice, seriesType]);
}

function useOrderPriceLines(
  seriesRef: React.RefObject<PrimarySeries | null>,
  hasData: boolean,
  height: number,
  orders: ChartOrderLine[],
  seriesType?: ChartSeriesType,
) {
  const linesRef = useRef<{
    series: PrimarySeries;
    lines: Map<string, IPriceLine>;
  } | null>(null);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) {
      linesRef.current = null;
      return;
    }
    // A chart recreation discards the previous series and its price lines.
    const lines = linesRef.current?.series === series ? linesRef.current.lines : new Map<string, IPriceLine>();
    const activeIds = new Set(orders.map((order) => order.id));
    for (const [id, line] of lines) {
      if (activeIds.has(id)) continue;
      series.removePriceLine(line);
      lines.delete(id);
    }
    for (const order of orders) {
      const options = {
        price: Number(order.price),
        color: order.side === "BUY" ? UP_COLOR : DOWN_COLOR,
        lineWidth: 1 as const,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: order.label,
      };
      const line = lines.get(order.id);
      if (line) line.applyOptions(options);
      else lines.set(order.id, series.createPriceLine(options));
    }
    linesRef.current = { series, lines };
  }, [seriesRef, hasData, height, orders, seriesType]);
}

function ChartOrderLegend({ orders }: { orders: ChartOrderLine[] }) {
  if (orders.length === 0) return null;
  const buys = orders.filter((order) => order.side === "BUY").length;
  const sells = orders.length - buys;
  return (
    <div className="numeric mt-0.5 flex flex-wrap gap-x-2 font-semibold">
      {buys > 0 ? <span style={{ color: UP_COLOR }}>예약 매수 {buys}건</span> : null}
      {sells > 0 ? <span style={{ color: DOWN_COLOR }}>예약 매도 {sells}건</span> : null}
    </div>
  );
}

function chartOrdersDescription(orders: ChartOrderLine[]): string {
  return orders.map((order) => `. ${order.label} ${fmtPrice(order.price)}`).join("");
}

function chartCurvePriceDescription(curvePrice?: string): string {
  return curvePrice === undefined ? "" : `. 현재가 ${fmtPrice(curvePrice)}`;
}

function ChartHoldingLegend({ holding }: { holding?: ChartHolding }) {
  if (!holding || holding.showAverageCost === false) return null;
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
  if (!holding || holding.showAverageCost === false) return "";
  const percent = holding.returnPercent;
  return `. 평단가 ${fmtPrice(holding.averagePrice)}. 평가수익률 ${percent === null ? "없음" : `${fmtSigned(percent, 2)}%`}`;
}

function sameLinePoint(left: LightweightLinePoint | undefined, right: LightweightLinePoint): boolean {
  return Boolean(
    left &&
      left.time === right.time &&
      left.value === right.value,
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
      left.close === right.close,
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
  const previousLast = previous[previous.length - 1]?.time;
  for (let index = 0; index < next.length; index += 1) {
    const point = next[index];
    if (sameLinePoint(previous[index], point)) continue;
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
  const previousLast = previous[previous.length - 1]?.time;
  for (let index = 0; index < next.length; index += 1) {
    const point = next[index];
    if (sameCandlePoint(previous[index], point)) continue;
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
  const previousLast = previous[previous.length - 1]?.time;
  for (let index = 0; index < next.length; index += 1) {
    const point = next[index];
    if (sameVolumePoint(previous[index], point)) continue;
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

function useChartPriceScale(
  seriesRef: React.RefObject<PrimarySeries | null>,
  hasData: boolean,
  height: number,
  seriesType?: ChartSeriesType,
) {
  const logarithmic = useChartSettings()?.logarithmic ?? false;
  useEffect(() => {
    // Apply only to the price series so the volume pane keeps its linear scale.
    seriesRef.current?.priceScale().applyOptions({
      mode: logarithmic ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [seriesRef, hasData, height, logarithmic, seriesType]);
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
      tickMarkFormatter: formatChartTickMark,
      timeVisible: true,
      secondsVisible: true,
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

interface MountedChart<S extends PrimarySeries> {
  chart: IChartApi;
  series: S;
  volumeSeries: ISeriesApi<"Histogram", Time>;
  dispose: () => void;
}

/**
 * Creates a chart with a primary series and a volume pane, sized to its
 * container. The volume pane exists even while its data is empty, so a live
 * trade never recreates or resets the chart.
 */
function mountChart<S extends PrimarySeries>(
  container: HTMLElement,
  height: number,
  addPrimary: (chart: IChartApi) => S,
  onHover: (time: number | null, param: MouseEventParams<Time>, series: S) => void,
  onPlotWidth: (width: number) => void,
): MountedChart<S> {
  const chart = createChart(container, chartOptions(height));
  const series = addPrimary(chart);
  const volumeSeries = chart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume", precision: VOLUME_PRECISION, minMove: 10 ** -VOLUME_PRECISION },
  }, 1);
  const cleanupVolumeSync = setupVolumePaneResizeSync(chart.panes()[1], height);
  const crosshairHandler = (param: MouseEventParams<Time>) => {
    const time = param.time;
    onHover(param.point && typeof time === "number" ? time : null, param, series);
  };
  chart.subscribeCrosshairMove(crosshairHandler);
  chart.timeScale().subscribeSizeChange(onPlotWidth);
  const resize = (width: number) => chart.applyOptions({ width: Math.max(1, Math.floor(width)), height });
  resize(container.getBoundingClientRect().width || 320);
  const resizeObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width;
    if (width) resize(width);
  });
  resizeObserver.observe(container);
  return {
    chart,
    series,
    volumeSeries,
    dispose: () => {
      cleanupVolumeSync();
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.timeScale().unsubscribeSizeChange(onPlotWidth);
      resizeObserver.disconnect();
      chart.remove();
    },
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
  orders = EMPTY_ORDER_LINES,
  curvePrice,
}: LineChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area", Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram", Time> | null>(null);
  const previousRef = useRef<LightweightLinePoint[]>([]);
  const previousVolumeRef = useRef<LightweightVolumePoint[]>([]);
  const colorRef = useRef(color);
  const pricePrecisionRef = useRef(pricePrecision);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  // Plot width excludes the price scale, so the legend never covers its labels.
  const [plotWidth, setPlotWidth] = useState(0);
  const hasData = data.length >= 2;

  const latest = data[data.length - 1];

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
    const { chart, series, volumeSeries, dispose } = mountChart(
      container,
      height,
      (created) => created.addSeries(AreaSeries, {
        ...areaColors(colorRef.current),
        lineWidth: 2,
        lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
        ...(pricePrecisionRef.current === undefined
          ? {}
          : { priceFormat: priceFormat(pricePrecisionRef.current) }),
      }),
      (time, param, primary) => {
        const point = param.seriesData.get(primary);
        setHoveredTime(time !== null && point && "value" in point ? time : null);
      },
      setPlotWidth,
    );
    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    return () => {
      dispose();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      previousRef.current = [];
      previousVolumeRef.current = [];
    };
  }, [hasData, height]);
  useChartTheme(chartRef, hasData, height);
  useChartPriceScale(seriesRef, hasData, height);
  useHoldingPriceLine(seriesRef, hasData, height, holding?.showAverageCost !== false ? holding?.averagePrice : undefined);
  useOrderPriceLines(seriesRef, hasData, height, orders);
  useCurvePriceLine(seriesRef, hasData, height, curvePrice);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.applyOptions(areaColors(color));
    if (pricePrecision !== undefined) series.applyOptions({ priceFormat: priceFormat(pricePrecision) });
    updateLineSeries(series, previousRef.current, data);
    previousRef.current = data;
    if (volumeSeriesRef.current) updateVolumeSeries(volumeSeriesRef.current, previousVolumeRef.current, volume);
    previousVolumeRef.current = volume;
  }, [color, data, height, pricePrecision, volume]);

  const active = findChartPoint(data, hoveredTime) ?? latest;
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
      aria-label={`${ariaLabel}. ${valueLabel} ${rawDecimal(active.valueText, active.value, valueFormatter)}${chartHoldingDescription(holding)}${chartOrdersDescription(orders)}${chartCurvePriceDescription(curvePrice)}`}
    >
      <div
        className="pointer-events-none absolute top-2 left-2.5 z-10 text-[10px] leading-4 sm:text-[11px]"
        style={plotWidth > 0 ? { maxWidth: plotWidth - 16 } : undefined}
      >
        <p className="numeric truncate font-bold" style={{ color }}>
          {valueLabel} {rawDecimal(active.valueText, active.value, valueFormatter)}
        </p>
        <ChartHoldingLegend holding={holding} />
        <ChartOrderLegend orders={orders} />
      </div>
    </div>
  );
}

export type ChartSeriesType = "candle" | "line";

interface CandleChartProps {
  data: LightweightCandlePoint[];
  interval?: CandleInterval;
  height: number;
  seriesType?: ChartSeriesType;
  pricePrecision?: number;
  emptyMessage: string;
  ariaLabel: string;
  onLoadOlder?: () => void;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  holding?: ChartHolding;
  orders?: ChartOrderLine[];
  curvePrice?: string;
}

export function LightweightCandleChart({
  data,
  interval,
  height,
  seriesType = "candle",
  pricePrecision,
  emptyMessage,
  ariaLabel,
  onLoadOlder,
  hasOlder,
  loadingOlder,
  holding,
  orders = EMPTY_ORDER_LINES,
  curvePrice,
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<PrimarySeries | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram", Time> | null>(null);
  const previousRef = useRef<LightweightCandlePoint[]>([]);
  const previousVolumeRef = useRef<LightweightVolumePoint[]>([]);
  const pricePrecisionRef = useRef(pricePrecision);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  // Plot width excludes the price scale, so the legend never covers its labels.
  const [plotWidth, setPlotWidth] = useState(0);
  const hasData = data.length > 0;

  const latest = data[data.length - 1];
  // The line view follows the direction of the whole loaded period.
  const lineColor = latest && latest.close < data[0].open ? DOWN_COLOR : UP_COLOR;
  const lineColorRef = useRef(lineColor);

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
    const { chart, series, volumeSeries, dispose } = mountChart<PrimarySeries>(
      container,
      height,
      (created) => seriesType === "line"
        ? created.addSeries(AreaSeries, {
            ...areaColors(lineColorRef.current),
            lineWidth: 2,
            lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
            priceFormat: priceFormat(pricePrecisionRef.current),
          })
        : created.addSeries(CandlestickSeries, {
            upColor: UP_COLOR,
            downColor: DOWN_COLOR,
            borderUpColor: UP_COLOR,
            borderDownColor: DOWN_COLOR,
            wickUpColor: UP_COLOR,
            wickDownColor: DOWN_COLOR,
            priceFormat: priceFormat(pricePrecisionRef.current),
          }),
      (time) => setHoveredTime(time),
      setPlotWidth,
    );
    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    return () => {
      dispose();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      previousRef.current = [];
      previousVolumeRef.current = [];
    };
  }, [hasData, height, seriesType]);
  useEffect(() => {
    chartRef.current?.applyOptions({
      localization: { timeFormatter: (time: Time) => formatChartTime(time, interval) },
    });
  }, [hasData, height, interval, seriesType]);
  useChartTheme(chartRef, hasData, height, seriesType);
  useChartPriceScale(seriesRef, hasData, height, seriesType);
  useHoldingPriceLine(seriesRef, hasData, height, holding?.showAverageCost !== false ? holding?.averagePrice : undefined, seriesType);
  useOrderPriceLines(seriesRef, hasData, height, orders, seriesType);
  useCurvePriceLine(seriesRef, hasData, height, curvePrice, seriesType);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (pricePrecision !== undefined) series.applyOptions({ priceFormat: priceFormat(pricePrecision) });
    if (series.seriesType() === "Area") {
      const area = series as ISeriesApi<"Area", Time>;
      area.applyOptions(areaColors(lineColor));
      updateLineSeries(area, previousRef.current.map(candleLinePoint), data.map(candleLinePoint));
    } else {
      updateCandleSeries(series as ISeriesApi<"Candlestick", Time>, previousRef.current, data);
    }
    previousRef.current = data;
    const volume = data.map(candleVolumePoint);
    if (volumeSeriesRef.current) {
      updateVolumeSeries(
        volumeSeriesRef.current,
        previousVolumeRef.current,
        volume,
      );
    }
    previousVolumeRef.current = volume;
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

  const active = findChartPoint(data, hoveredTime) ?? latest;
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
      aria-label={`${ariaLabel}. 종가 ${rawDecimal(active.closeText, active.close, fmtPrice)}${chartHoldingDescription(holding)}${chartOrdersDescription(orders)}${chartCurvePriceDescription(curvePrice)}`}
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
        <ChartOrderLegend orders={orders} />
      </div>
    </div>
  );
}
