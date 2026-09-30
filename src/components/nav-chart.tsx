"use client";

import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fmtCredit, fmtDateTime, toNumber } from "@/lib/format";
import type { NavPoint } from "@/lib/types";

interface Point {
  t: number;
  value: number;
}

function renderTip(props: unknown): React.ReactNode {
  const { active, payload } = props as { active?: boolean; payload?: { payload?: Point }[] };
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-xl bg-app-gray-900/92 px-3 py-2 text-app-gray-50 shadow-lg">
      <p className="text-[11px] text-app-gray-50/60">{fmtDateTime(new Date(point.t).toISOString())}</p>
      <p className="numeric text-[13px] font-semibold">{fmtCredit(point.value, 2)}</p>
    </div>
  );
}

export function NavChart({ points, height = 200 }: { points: NavPoint[]; height?: number }) {
  const data = useMemo<Point[]>(
    () =>
      points
        .map((point) => ({ t: new Date(point.timestamp).getTime(), value: toNumber(point.value) }))
        .filter((point) => Number.isFinite(point.t))
        .sort((a, b) => a.t - b.t),
    [points],
  );

  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-app-gray-50 text-[13px] text-app-gray-400"
        style={{ height }}
      >
        아직 기록이 부족해요
      </div>
    );
  }

  const first = data[0].value;
  const last = data[data.length - 1].value;
  const color = last >= first ? "#f04452" : "#3182f6";
  let min = Infinity;
  let max = -Infinity;
  for (const point of data) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }
  const pad = (max - min) * 0.12 || max * 0.01 || 1;

  return (
    <div style={{ height }}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={0}
        debounce={0}
        initialDimension={{ width: 320, height }}
      >
        <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="navChartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.16} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
          <YAxis dataKey="value" domain={[min - pad, max + pad]} hide />
          <Tooltip content={renderTip} cursor={{ stroke: "#d1d6db", strokeDasharray: "3 3" }} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill="url(#navChartFill)"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
