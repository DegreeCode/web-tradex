"use client";

import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";

import { InfoTip } from "@/components/info-tip";
import { ErrorBlock, SkeletonRows, Surface } from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import { errorMessage, isApiError } from "@/lib/api";
import { fmtCompactQuantity, fmtDate, fmtDateTime, fmtPercentFromPPM, fmtQuantity } from "@/lib/format";
import { useSymbolHoldings } from "@/lib/hooks/symbol-holdings";
import {
  nearestSymbolHoldingsPoint,
  SYMBOL_HOLDINGS_RANGES,
  SYMBOL_HOLDINGS_SERIES,
  symbolHoldingsChart,
  type SymbolHoldingsPoint,
  type SymbolHoldingsRange,
  type SymbolHoldingsRatio,
} from "@/lib/symbol-holdings";

const SERIES_CLASS: Record<SymbolHoldingsRatio, string> = {
  holding_ratio_ppm: "text-app-gray-900",
  margin_long_ratio_ppm: "text-app-red",
  margin_short_ratio_ppm: "text-app-blue",
};

function HoldingsChart({ points }: { points: SymbolHoldingsPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const descriptionId = useId();
  const chart = useMemo(() => symbolHoldingsChart(points), [points]);
  const first = points[0];
  const last = points[points.length - 1];
  const hovered = hoverIndex === null ? null : points[Math.min(hoverIndex, points.length - 1)];

  function onMove(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width * chart.width / chart.right));
    setHoverIndex(nearestSymbolHoldingsPoint(points, first.time + fraction * (last.time - first.time)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = hoverIndex ?? points.length - 1;
    if (event.key === "ArrowLeft") setHoverIndex(Math.max(0, index - 1));
    else if (event.key === "ArrowRight") setHoverIndex(Math.min(points.length - 1, index + 1));
    else if (event.key === "Home") setHoverIndex(0);
    else if (event.key === "End") setHoverIndex(points.length - 1);
    else if (event.key === "Escape") setHoverIndex(null);
    else return;
    event.preventDefault();
  }

  return (
    <div>
      <div
        role="group"
        aria-label="보유율·롱·숏 비율 이력 차트"
        aria-describedby={descriptionId}
        tabIndex={0}
        className="relative h-[220px] w-full touch-pan-y rounded-lg focus-visible:outline-2 focus-visible:outline-app-blue"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHoverIndex(null)}
        onFocus={() => setHoverIndex(points.length - 1)}
        onBlur={() => setHoverIndex(null)}
        onKeyDown={onKeyDown}
      >
        <p id={descriptionId} className="sr-only">
          {fmtDateTime(first.t)}부터 {fmtDateTime(last.t)}까지 {points.length}개 기록이에요.
          좌우 방향키로 시점을 선택할 수 있어요. 비율을 계산할 수 없는 구간은 선이 끊겨요.
        </p>
        <svg viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none" className="size-full" aria-hidden="true">
          {[1, 0.5, 0].map((fraction) => {
            const value = chart.max * fraction + chart.min * (1 - fraction);
            return (
              <line key={fraction} x1={chart.left} x2={chart.right} y1={chart.y(value)} y2={chart.y(value)} className="stroke-app-gray-100" vectorEffect="non-scaling-stroke" />
            );
          })}
          {chart.paths.map(({ key, path }) => (
            <path key={key} d={path} fill="none" stroke="currentColor" strokeWidth={key === "holding_ratio_ppm" ? 2.5 : 1.5}
              strokeDasharray={key === "margin_long_ratio_ppm" ? "5 3" : key === "margin_short_ratio_ppm" ? "2 3" : undefined}
              strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className={SERIES_CLASS[key]} />
          ))}
          {hovered ? (
            <line x1={chart.x(hovered.time)} x2={chart.x(hovered.time)} y1={chart.top} y2={chart.bottom}
              className="stroke-app-gray-400" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          ) : null}
        </svg>
        {[1, 0.5, 0].map((fraction) => {
          const value = chart.max * fraction + chart.min * (1 - fraction);
          return (
            <span key={fraction} aria-hidden="true" title={fmtPercentFromPPM(value, 1)}
              className="numeric pointer-events-none absolute right-0 w-[13%] -translate-y-1/2 truncate text-right text-[10px] text-app-gray-400"
              style={{ top: `${chart.y(value) / chart.height * 100}%` }}>
              {fmtPercentFromPPM(value, 1)}
            </span>
          );
        })}
        {hovered ? (
          <div className="pointer-events-none absolute top-1 z-10 max-w-full rounded-lg bg-app-gray-900/95 px-3 py-2 text-[11px] text-app-gray-50 shadow-lg"
            style={chart.x(hovered.time) > chart.right / 2 ? { right: "14%" } : { left: 0 }}>
            <p>{fmtDateTime(hovered.t)}</p>
            <p className="numeric mt-1 flex flex-wrap gap-x-3 gap-y-1" aria-live="polite" aria-atomic="true">
              {SYMBOL_HOLDINGS_SERIES.map(({ key, label }) => <span key={key} className="min-w-0 break-all">{label} {fmtPercentFromPPM(hovered[key])}</span>)}
            </p>
          </div>
        ) : null}
      </div>
      <div className="-mt-2 flex justify-between pr-[14%] text-[10px] text-app-gray-400" aria-hidden="true">
        <span>{fmtDate(first.t)}</span><span>{fmtDate(last.t)}</span>
      </div>
      <ul aria-label="차트 범례" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {SYMBOL_HOLDINGS_SERIES.map(({ key, label }) => (
          <li key={key} className={`flex items-center gap-1.5 ${SERIES_CLASS[key]}`}>
            <span aria-hidden="true" className={`w-4 border-t-2 ${key === "holding_ratio_ppm" ? "" : key === "margin_long_ratio_ppm" ? "border-dashed" : "border-dotted"}`} />{label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SymbolHoldings({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<SymbolHoldingsRange>("1w");
  const query = useSymbolHoldings(symbol, range);
  const points = query.data ?? [];
  const current = points[points.length - 1];
  const unavailable = isApiError(query.error) && (
    query.error.status === 404 || (query.error.status === 403 && query.error.code === "MARGIN_STATUS_DISABLED")
  );
  if (unavailable) return null;

  return (
    <Surface>
      <div className="mb-3 flex items-center gap-1">
        <h2 className="text-[17px] font-bold tracking-[-0.02em] text-app-gray-900">보유 현황</h2>
        <InfoTip label="보유 현황">
          유통량은 총발행량에서 락업 물량을 뺀 수량이에요. 보유량은 유통량에서 풀 물량과 보험기금 물량을 빼고 숏 수량을 더한 값으로, 사용자 마진 롱도 포함해요.
          보유율은 보유량 ÷ 유통량, 롱·숏 비율은 각 마진 수량 ÷ 보유량이에요. 숏 수량은 보유량보다 커서 비율이 100%를 넘을 수 있어요.
          1분 단위로 관측하며 변동이 없으면 마지막 값을 이어 써요. 수집 시작 이전 기록은 소급하지 않아요. 최신 구간은 아직 진행 중이에요.
        </InfoTip>
      </div>
      <Segmented value={range} onChange={setRange} options={SYMBOL_HOLDINGS_RANGES} ariaLabel="보유 현황 조회 기간" />
      <div className="mt-4" aria-busy={query.isFetching}>
        {query.isPending ? (
          <div className="h-[348px]"><SkeletonRows rows={4} label="보유 현황을 불러오는 중" /></div>
        ) : isApiError(query.error) && query.error.status === 503 ? (
          <p className="text-[13px] text-app-gray-400">보유 현황을 잠시 확인할 수 없어요</p>
        ) : query.isError ? (
          <ErrorBlock message={`보유 현황을 불러오지 못했어요. ${errorMessage(query.error)}`} onRetry={() => void query.refetch()} />
        ) : !current ? (
          <p className="text-[13px] text-app-gray-400">아직 수집된 보유 기록이 없어요</p>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-2">
              {SYMBOL_HOLDINGS_SERIES.map(({ key, label }) => (
                <div key={key} className="min-w-0">
                  <dt className="text-[11px] text-app-gray-500">{label}</dt>
                  <dd title={fmtPercentFromPPM(current[key])} className={`numeric truncate text-[18px] font-bold ${SERIES_CLASS[key]}`}>{fmtPercentFromPPM(current[key])}</dd>
                </div>
              ))}
            </dl>
            <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-app-gray-50 p-3">
              {([
                ["보유량", current.held_quantity],
                ["유통량", current.circulating_supply],
                ["총발행량", current.total_supply],
              ] as const).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[11px] text-app-gray-500">{label}</dt>
                  <dd title={value === null ? undefined : `${fmtQuantity(value)}주`} className="numeric truncate text-[12px] font-semibold text-app-gray-900">
                    {value === null ? "-" : `${fmtCompactQuantity(value)}주`}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[10px] text-app-gray-400">{fmtDateTime(current.t)} 구간 · 진행 중인 최신 기록이에요</p>
            <div className="mt-2" aria-label={query.isPlaceholderData ? "선택한 기간을 불러오는 중이에요. 이전 기간을 표시해요" : undefined}>
              <HoldingsChart key={`${symbol}-${range}`} points={points} />
            </div>
          </>
        )}
      </div>
    </Surface>
  );
}
