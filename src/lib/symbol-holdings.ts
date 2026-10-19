export type SymbolHoldingsInterval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w" | "1M" | "1y";
export type SymbolHoldingsRange = "1d" | "1w" | "1mo" | "1y";

export interface SymbolHoldingsPoint {
  t: string;
  time: number;
  total_supply: string | null;
  circulating_supply: string | null;
  held_quantity: string | null;
  long_quantity: string | null;
  short_quantity: string | null;
  holding_ratio_ppm: number | null;
  margin_long_ratio_ppm: number | null;
  margin_short_ratio_ppm: number | null;
}

const DAY_MS = 86_400_000;

export const SYMBOL_HOLDINGS_RANGES: {
  value: SymbolHoldingsRange;
  label: string;
  interval: SymbolHoldingsInterval;
  durationMs: number;
}[] = [
  { value: "1d", label: "1일", interval: "5m", durationMs: DAY_MS },
  { value: "1w", label: "1주", interval: "1h", durationMs: 7 * DAY_MS },
  { value: "1mo", label: "1개월", interval: "4h", durationMs: 30 * DAY_MS },
  { value: "1y", label: "1년", interval: "1d", durationMs: 365 * DAY_MS },
];

export const SYMBOL_HOLDINGS_SERIES = [
  { key: "holding_ratio_ppm", label: "보유율" },
  { key: "margin_long_ratio_ppm", label: "롱 비율" },
  { key: "margin_short_ratio_ppm", label: "숏 비율" },
] as const;

export type SymbolHoldingsRatio = (typeof SYMBOL_HOLDINGS_SERIES)[number]["key"];

export function symbolHoldingsRangeQuery(range: SymbolHoldingsRange, now = Date.now()) {
  const preset = SYMBOL_HOLDINGS_RANGES.find((item) => item.value === range)!;
  return { interval: preset.interval, from: new Date(now - preset.durationMs).toISOString(), limit: 500 };
}

function quantity(value: unknown): string | null {
  return typeof value === "string" && /^-?\d+(?:\.\d{1,8})?$/.test(value) ? value : null;
}

function ratio(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) ? value : null;
}

export function normalizeSymbolHoldings(payload: unknown): SymbolHoldingsPoint[] {
  if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) return [];
  const byTime = new Map<number, SymbolHoldingsPoint>();
  for (const row of payload.data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const t = row.t;
    const time = typeof t === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(t) ? Date.parse(t) : NaN;
    if (!Number.isFinite(time)) continue;
    byTime.set(time, {
      t,
      time,
      total_supply: quantity(row.total_supply),
      circulating_supply: quantity(row.circulating_supply),
      held_quantity: quantity(row.held_quantity),
      long_quantity: quantity(row.long_quantity),
      short_quantity: quantity(row.short_quantity),
      holding_ratio_ppm: ratio(row.holding_ratio_ppm),
      margin_long_ratio_ppm: ratio(row.margin_long_ratio_ppm),
      margin_short_ratio_ppm: ratio(row.margin_short_ratio_ppm),
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function symbolHoldingsChart(points: SymbolHoldingsPoint[]) {
  const width = 640;
  const height = 220;
  const left = 0;
  const right = 554;
  const top = 14;
  const bottom = 196;
  let peak = 10_000;
  let min = 0;
  for (const point of points) {
    for (const { key } of SYMBOL_HOLDINGS_SERIES) {
      peak = Math.max(peak, point[key] ?? 0);
      min = Math.min(min, point[key] ?? 0);
    }
  }
  const max = Math.min(Number.MAX_VALUE, peak + peak * 0.1);
  const first = points[0]?.time ?? 0;
  const last = points.at(-1)?.time ?? first;
  const x = (time: number) => first === last ? right / 2 : ((time - first) / (last - first)) * right;
  const scale = Math.max(max, Math.abs(min));
  const y = (value: number) => bottom - ((value / scale - min / scale) / (max / scale - min / scale)) * (bottom - top);
  const paths = SYMBOL_HOLDINGS_SERIES.map(({ key }) => {
    let connected = false;
    let path = "";
    for (const point of points) {
      const value = point[key];
      if (value === null) {
        connected = false;
        continue;
      }
      const position = `${x(point.time).toFixed(2)},${y(value).toFixed(2)}`;
      path += connected ? ` L${position}` : ` M${position} L${position}`;
      connected = true;
    }
    return { key, path: path.trim() };
  });
  return { width, height, left, right, top, bottom, min, max, x, y, paths };
}

export function nearestSymbolHoldingsPoint(points: SymbolHoldingsPoint[], time: number): number {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].time < time) low = mid + 1;
    else high = mid;
  }
  return low > 0 && time - points[low - 1].time < points[low].time - time ? low - 1 : low;
}
