"use client";

import { useId, useMemo, useRef, useState } from "react";

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
const TOOLTIP_GAP = 12;

interface Point {
  time: number;
  value: number;
}

interface Hovered extends Point {
  x: number;
  y: number;
  width: number;
}

/** Oldest-first points, one per second, deduplicated. */
function toPoints(points: NavPoint[]): Point[] {
  const bySecond = new Map<number, number>();
  for (const point of points) {
    const millis = Date.parse(point.timestamp);
    if (Number.isFinite(millis)) bySecond.set(Math.floor(millis / 1_000), toNumber(point.value));
  }
  return [...bySecond]
    .sort(([a], [b]) => a - b)
    .map(([time, value]) => ({ time, value }));
}

/**
 * Axis-free asset sparkline. This is a single SVG path rather than the full
 * charting library, so home and portfolio do not ship lightweight-charts.
 */
export function NavChart({ points, height = 200 }: { points: NavPoint[]; height?: number }) {
  const gradientId = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const data = useMemo(() => toPoints(points), [points]);
  const hasData = data.length >= 2;
  const color = hasData && data[data.length - 1].value < data[0].value ? DOWN_COLOR : UP_COLOR;

  const geometry = useMemo(() => {
    if (!hasData) return null;
    const width = 1000;
    const inset = 6;
    const values = data.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const x = (index: number) => (index / (data.length - 1)) * width;
    const y = (value: number) => inset + (1 - (value - min) / range) * (height - inset * 2);
    const line = data.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { width, line, area, min, max };
  }, [data, hasData, height]);

  if (!geometry) {
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

  function onMove(event: React.PointerEvent<HTMLDivElement>) {
    const container = containerRef.current;
    if (!container || !geometry) return;
    const rect = container.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const index = Math.round(ratio * (data.length - 1));
    const point = data[index];
    if (!point) return;
    setHovered({
      ...point,
      x: ratio * rect.width,
      y: 0,
      width: rect.width,
    });
  }

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`자산 추이 차트. ${fmtCredit(first.value, 2)}에서 ${fmtCredit(last.value, 2)} Credit`}
      className="relative w-full touch-pan-y"
      style={{ height }}
      onPointerMove={onMove}
      onPointerLeave={() => setHovered(null)}
    >
      <svg
        viewBox={`0 0 ${geometry.width} ${height}`}
        preserveAspectRatio="none"
        className="size-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={geometry.area} fill={`url(#${gradientId})`} />
        <path
          d={geometry.line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      {hovered ? (
        <div
          className="pointer-events-none absolute z-10 rounded-lg bg-app-gray-900/90 px-2.5 py-1.5 whitespace-nowrap text-app-gray-50 shadow-lg"
          style={{
            top: 8,
            ...(hovered.x < hovered.width / 2
              ? { left: hovered.x + TOOLTIP_GAP }
              : { right: hovered.width - hovered.x + TOOLTIP_GAP }),
          }}
        >
          <p className="text-[11px] text-app-gray-50/70">
            {fmtDateTime(new Date(hovered.time * 1_000).toISOString())}
          </p>
          <p className="numeric text-[13px] font-semibold">{fmtCredit(hovered.value, 2)} Credit</p>
        </div>
      ) : null}
    </div>
  );
}
