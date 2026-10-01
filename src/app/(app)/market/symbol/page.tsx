"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock, Clock, OctagonAlert } from "lucide-react";
import { cn } from "cn";

import { useAuth } from "@/components/auth-provider";
import { CandleChart } from "@/components/candle-chart";
import { CeilingBadge, InstrumentAvatar } from "@/components/instrument-list";
import type { ChartSeriesType } from "@/components/lightweight-chart";
import { ManagerPanel, ManagerTransferInbox } from "@/components/manager-panel";
import { PriceChart } from "@/components/price-chart";
import { PriceFlash } from "@/components/price-flash";
import {
  BackLink,
  ChangeIndicator,
  EmptyState,
  ErrorBlock,
  InstrumentStateChip,
  LoadingBlock,
  PageHeader,
  SideBadge,
  SkeletonRows,
  Surface,
} from "@/components/primitives";
import { ResponsiveOrderForm } from "@/components/responsive-order-form";
import { SymbolDisclosures } from "@/components/symbol-disclosures";
import { errorMessage } from "@/lib/api";
import { isCandleInterval } from "@/lib/candle-data";
import {
  changePercent,
  compareDecimal,
  fmtCompact,
  fmtDate,
  fmtDateTime,
  fmtPrice,
  fmtQuantity,
  fmtTime,
  toNumber,
} from "@/lib/format";
import { useCandles, useInstrument, useSymbolTradeStream, useSymbolTrades } from "@/lib/hooks";
import { hasDistinctLastTrade, isAtCurveCeiling } from "@/lib/instruments";
import { updatePreferences, usePreferences } from "@/lib/preferences";
import type { CandleInterval, Instrument } from "@/lib/types";

const INTERVALS: { value: CandleInterval; label: string }[] = [
  { value: "1m", label: "1분" },
  { value: "5m", label: "5분" },
  { value: "15m", label: "15분" },
  { value: "1h", label: "1시간" },
  { value: "4h", label: "4시간" },
  { value: "1d", label: "1일" },
];

const DEFAULT_CANDLE_INTERVAL: CandleInterval = "1h";

function useCandleIntervalPreference() {
  const stored = usePreferences();
  const storedInterval = stored?.candleInterval;
  const interval = isCandleInterval(storedInterval) ? storedInterval : DEFAULT_CANDLE_INTERVAL;
  const updateInterval = (next: CandleInterval) => updatePreferences({ candleInterval: next });
  return { interval, updateInterval, hydrated: stored !== null };
}

function IntervalPicker({
  interval,
  onChange,
  children,
}: {
  interval: CandleInterval;
  onChange: (interval: CandleInterval) => void;
  children?: React.ReactNode;
}) {
  return (
    <div role="group" aria-label="차트 기간" className="mt-3 flex gap-1 overflow-x-auto">
      {INTERVALS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={interval === option.value}
          className="min-h-8 shrink-0 rounded-lg px-2.5 text-[12px] font-semibold text-app-gray-500 hover:bg-app-gray-100 aria-pressed:bg-app-gray-900 aria-pressed:text-app-gray-50"
        >
          {option.label}
        </button>
      ))}
      {children}
    </div>
  );
}

/** Banner for any state that limits trading, with its reason and timing. */
function TradingStateBanner({ instrument }: { instrument: Instrument }) {
  if (instrument.state === "TRADING") return null;
  const halted = instrument.state === "HALTED";
  const delisted = instrument.state === "DELISTED";
  const title = halted
    ? "거래가 정지된 종목이에요"
    : delisted
      ? "상장폐지된 종목이에요"
      : "상장폐지가 예정된 종목이에요";
  const detail = [
    instrument.halt_reason,
    halted && instrument.halted_until ? `${fmtDateTime(instrument.halted_until)}까지` : null,
    !halted && !delisted ? "보유 수량과 주문을 확인해주세요" : null,
  ].filter(Boolean).join(" · ");
  const Icon = halted || delisted ? OctagonAlert : CalendarClock;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2.5 rounded-2xl px-4 py-3",
        halted || delisted ? "bg-app-red-light text-app-red" : "bg-app-orange-light text-app-orange",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-[13px] font-bold">{title}</p>
        {detail ? <p className="mt-0.5 text-[12px] opacity-80">{detail}</p> : null}
      </div>
    </div>
  );
}

// Chart-mode icons drawn in the chart's own colors: a falling (blue) and a
// rising (red) candle, or the line in the color the line view is drawn with.
function CandleModeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4">
      <path d="M3 3v16a2 2 0 0 0 2 2h16" stroke="currentColor" />
      <g stroke="var(--app-blue)">
        <path d="M9 5v4" />
        <rect width="4" height="6" x="7" y="9" rx="1" />
        <path d="M9 15v2" />
      </g>
      <g stroke="var(--app-red)">
        <path d="M17 3v2" />
        <rect width="4" height="8" x="15" y="5" rx="1" />
        <path d="M17 13v3" />
      </g>
    </svg>
  );
}

function LineModeIcon({ rising }: { rising: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4">
      <path d="M3 3v16a2 2 0 0 0 2 2h16" stroke="currentColor" />
      <path d="m19 9-5 5-4-4-3 3" stroke={rising ? "var(--app-red)" : "var(--app-blue)"} />
    </svg>
  );
}

function SymbolDetail() {
  const searchParams = useSearchParams();
  const symbol = searchParams.get("symbol")?.trim() ?? "";
  const { user } = useAuth();
  const { interval, updateInterval, hydrated: intervalHydrated } = useCandleIntervalPreference();
  const [chartSeriesType, setChartSeriesType] = useState<ChartSeriesType>("candle");
  const instrumentQuery = useInstrument(symbol || undefined);
  const canonicalSymbol = instrumentQuery.data?.symbol;
  const tradesQuery = useSymbolTrades(canonicalSymbol, 150);
  const candlesQuery = useCandles(canonicalSymbol, interval, 200, intervalHydrated);

  useSymbolTradeStream(intervalHydrated ? canonicalSymbol : undefined, 150);

  if (!symbol) {
    return (
      <EmptyState
        title="종목을 선택해주세요"
        description="마켓에서 종목을 고르면 상세 정보를 볼 수 있어요"
        icon={<Clock aria-hidden="true" className="size-6" />}
        action={
          <Link
            href="/market"
            prefetch={false}
            className="text-[13px] font-semibold text-app-blue underline underline-offset-4"
          >
            마켓 보러가기
          </Link>
        }
      />
    );
  }

  if (!instrumentQuery.data) {
    const failed = instrumentQuery.isError;
    return (
      <div className="space-y-4">
        <PageHeader
          title={symbol}
          subtitle={failed ? "종목 정보를 확인하지 못했어요" : "종목 정보를 불러오는 중이에요"}
          back={<BackLink href="/market" label="마켓으로" />}
        />
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-6">
          <div className="min-w-0 space-y-4">
            <Surface>
              <p className="text-[13px] font-semibold text-app-gray-500">현재가</p>
              <p className="my-2 text-[30px] font-extrabold text-app-gray-300">—</p>
              <IntervalPicker interval={interval} onChange={updateInterval} />
              <div className="mt-2">
                {failed ? (
                  <ErrorBlock message={errorMessage(instrumentQuery.error)} onRetry={() => void instrumentQuery.refetch()} />
                ) : (
                  <LoadingBlock className="h-[300px] rounded-xl bg-app-gray-50 py-0" label="차트 불러오는 중" />
                )}
              </div>
            </Surface>
            {["종목 정보", "공시"].map((title) => (
              <Surface key={title}>
                <h2 className="mb-2 text-[17px] font-bold text-app-gray-900">{title}</h2>
                {failed ? <p className="text-[13px] text-app-gray-500">종목 정보를 확인하면 표시돼요</p> : <SkeletonRows rows={2} />}
              </Surface>
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-4 self-start">
            <Surface className="space-y-4">
              <h2 className="text-[17px] font-bold text-app-gray-900">주문</h2>
              <p role="status" className="text-[13px] text-app-gray-500">{failed ? "종목 정보를 확인한 뒤 주문할 수 있어요" : "종목 정보를 확인하고 있어요"}</p>
              <button type="button" disabled className="h-12 w-full rounded-xl bg-app-gray-100 text-[15px] font-semibold text-app-gray-400">주문 준비 중</button>
            </Surface>
            <Surface>
              <h2 className="mb-2 text-[17px] font-bold text-app-gray-900">최근 체결</h2>
              {failed ? <p className="text-[13px] text-app-gray-500">종목 정보를 확인하면 표시돼요</p> : <SkeletonRows rows={3} />}
            </Surface>
          </div>
        </div>
      </div>
    );
  }

  const instrument = instrumentQuery.data;
  const trades = tradesQuery.data?.data ?? [];
  const candles = candlesQuery.data?.data ?? [];
  // Same rule as the line view's color: the loaded period's latest close
  // against its earliest open. The chart sorts candles by time, so do too.
  let first = candles[0];
  let last = candles[0];
  for (const candle of candles) {
    if (Date.parse(candle.timestamp) < Date.parse(first.timestamp)) first = candle;
    if (Date.parse(candle.timestamp) > Date.parse(last.timestamp)) last = candle;
  }
  const periodRising = !first || Number(last.close) >= Number(first.open);
  const newest = trades[0];
  const oldest = trades[trades.length - 1];
  const windowChange = trades.length >= 2 ? changePercent(oldest.price, newest.price) : null;
  const change = Number.isFinite(instrument.change_ppm)
    ? instrument.change_ppm / 10_000
    : windowChange;
  const isManager = Boolean(
    instrument.manager_user_id && user && instrument.manager_user_id === user.user_id,
  );
  // Hidden (not removed) until there is a trade that differs from the spot
  // price, so the chart below never jumps.
  const showLastTrade = hasDistinctLastTrade(instrument);
  // Where the current price sits within today's low–high range.
  const dayLow = toNumber(instrument.low);
  const dayHigh = toNumber(instrument.high);
  const dayPosition = dayHigh > dayLow
    ? Math.min(1, Math.max(0, (toNumber(instrument.curve_spot_price) - dayLow) / (dayHigh - dayLow)))
    : 0.5;
  const todayStats = [
    { label: "시가", value: fmtPrice(instrument.open) },
    { label: "거래량", value: `${fmtQuantity(instrument.volume_shares)}주` },
    { label: "거래대금", value: `${fmtCompact(instrument.volume_credit)} Credit` },
  ];
  const lockedSupply = compareDecimal(instrument.locked_supply, "0") > 0;
  const profile = [
    { label: "시가총액", value: `${fmtCompact(instrument.market_value)} Credit` },
    { label: "홀더", value: `${instrument.holder_count}명` },
    { label: "유통 / 발행", value: `${fmtQuantity(instrument.circulating_supply)} / ${fmtQuantity(instrument.total_supply)}주` },
    ...(lockedSupply ? [{ label: "락업", value: `${fmtQuantity(instrument.locked_supply)}주` }] : []),
    { label: "상장일", value: fmtDate(instrument.listed_at) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={instrument.name}
        subtitle={instrument.name !== instrument.symbol ? instrument.symbol : undefined}
        back={<BackLink href="/market" label="마켓으로" />}
        action={
          <div className="flex items-center gap-2">
            <InstrumentStateChip state={instrument.state} />
            <InstrumentAvatar symbol={instrument.symbol} iconUrl={instrument.icon_url} />
          </div>
        }
      />

      <TradingStateBanner instrument={instrument} />

      {/* Desktop: the right column spans both rows so the left column flows
          without gaps; mobile stacks chart/info, trades, then disclosures. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] xl:gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
          <Surface>
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <div className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2">
                <span className="numeric min-w-0 break-all text-[clamp(1.5rem,6vw,1.875rem)] leading-tight font-extrabold tracking-[-0.02em] text-app-gray-900">
                  <PriceFlash price={instrument.curve_spot_price} resetKey={instrument.symbol}>
                    {fmtPrice(instrument.curve_spot_price)}
                  </PriceFlash>
                </span>
                <span className="text-[13px] font-semibold text-app-gray-500">Credit</span>
                {isAtCurveCeiling(instrument) ? <CeilingBadge className="px-1.5 text-[11px]" /> : null}
              </div>
              <div className="min-w-0 max-w-full break-all text-right">
                <ChangeIndicator value={change} />
                <p
                  aria-hidden={!showLastTrade}
                  className={cn("mt-0.5 text-[12px] text-app-gray-400", !showLastTrade && "invisible")}
                >
                  최근 체결 {showLastTrade ? fmtPrice(instrument.last_price) : "-"}
                </p>
              </div>
            </div>

            <IntervalPicker interval={interval} onChange={updateInterval}>
              <button
                type="button"
                onClick={() => setChartSeriesType((current) => (current === "candle" ? "line" : "candle"))}
                aria-label={chartSeriesType === "candle" ? "라인 차트로 보기" : "캔들 차트로 보기"}
                title={chartSeriesType === "candle" ? "라인 차트로 보기" : "캔들 차트로 보기"}
                className="ml-auto flex min-h-8 shrink-0 items-center rounded-lg px-2 text-app-gray-500 hover:bg-app-gray-100"
              >
                {chartSeriesType === "candle" ? <CandleModeIcon /> : <LineModeIcon rising={periodRising} />}
              </button>
            </IntervalPicker>

            <div className="mt-2">
              {candlesQuery.isError && candles.length === 0 ? (
                <ErrorBlock message={errorMessage(candlesQuery.error)} onRetry={() => void candlesQuery.refetch()} />
              ) : !intervalHydrated ||
              (candles.length === 0 && (candlesQuery.isLoading || candlesQuery.isPending)) ? (
                <LoadingBlock className="h-[300px] rounded-xl bg-app-gray-50 py-0" />
              ) : candles.length > 0 ? (
                <CandleChart
                  candles={candles}
                  seriesType={chartSeriesType}
                  onLoadOlder={candlesQuery.loadOlder}
                  hasOlder={candlesQuery.hasOlder && !candlesQuery.olderError}
                  loadingOlder={candlesQuery.isLoadingOlder}
                />
              ) : (
                <PriceChart trades={trades} />
              )}
              {candlesQuery.olderError ? (
                <div role="alert" className="mt-2 flex items-center justify-between gap-3 text-[12px] text-app-gray-500">
                  <span>이전 캔들을 불러오지 못했어요. {errorMessage(candlesQuery.olderError)}</span>
                  <button
                    type="button"
                    onClick={candlesQuery.loadOlder}
                    className="shrink-0 font-semibold text-app-blue"
                  >
                    다시 시도
                  </button>
                </div>
              ) : null}
            </div>

          </Surface>

          <Surface>
            <h2 className="text-[17px] font-bold tracking-[-0.02em] text-app-gray-900">
              종목 정보
            </h2>
            <div className="mt-3 rounded-xl bg-app-gray-50 p-3">
              <div className="flex items-center justify-between text-[12px] text-app-gray-500">
                <span>오늘 저가 <b className="numeric font-semibold text-app-blue">{fmtPrice(instrument.low)}</b></span>
                <span>고가 <b className="numeric font-semibold text-app-red">{fmtPrice(instrument.high)}</b></span>
              </div>
              <div className="relative mt-2 h-1.5 rounded-full bg-gradient-to-r from-app-blue/30 to-app-red/30" aria-hidden>
                <span
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-app-gray-900 shadow"
                  style={{ left: `${dayPosition * 100}%` }}
                />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                {todayStats.map((item) => (
                  <div key={item.label} className="min-w-0">
                    <dt className="text-[11px] text-app-gray-500">{item.label}</dt>
                    <dd className="numeric truncate text-[13px] font-semibold text-app-gray-900">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">
              {profile.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 py-1.5">
                  <dt className="shrink-0 text-[13px] text-app-gray-500">{item.label}</dt>
                  <dd className="numeric min-w-0 truncate text-right text-[13px] font-semibold text-app-gray-900">{item.value}</dd>
                </div>
              ))}
            </dl>
            {instrument.description ? (
              <p className="mt-3 break-words [overflow-wrap:anywhere] border-t border-app-gray-100 pt-3 text-[13px] leading-relaxed whitespace-pre-wrap text-app-gray-600">
                {instrument.description}
              </p>
            ) : null}
            {instrument.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {instrument.tags.map((tag) => (
                  <span
                    key={tag}
                    className="max-w-full break-all rounded-lg bg-app-gray-100 px-2 py-1 text-[12px] font-medium text-app-gray-600"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </Surface>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto">
          <ResponsiveOrderForm instrument={instrument} />

          <Surface className="lg:flex lg:min-h-56 lg:flex-1 lg:flex-col">
            <h2 className="text-[17px] font-bold tracking-[-0.02em] text-app-gray-900">
              최근 체결
            </h2>
            {tradesQuery.isLoading ? (
              <SkeletonRows rows={3} />
            ) : tradesQuery.isError && trades.length === 0 ? (
              <ErrorBlock message={errorMessage(tradesQuery.error)} onRetry={() => void tradesQuery.refetch()} />
            ) : trades.length === 0 ? (
              <p className="mt-2 text-[13px] text-app-gray-400">아직 체결이 없어요. 첫 거래의 주인이 되어보세요.</p>
            ) : (
              <div className="mt-2 divide-y divide-app-gray-100 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                {trades.slice(0, 12).map((trade) => (
                  <div
                    key={`${trade.sequence}-${trade.timestamp}`}
                    className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 py-2"
                  >
                    <SideBadge side={trade.side} />
                    <span className="numeric min-w-0 truncate text-[13px] font-semibold text-app-gray-900">
                      {fmtPrice(trade.price)}
                    </span>
                    <span className="numeric text-right text-[13px] text-app-gray-700">
                      {fmtQuantity(trade.quantity)}주
                    </span>
                    <span className="numeric w-16 text-right text-[11px] text-app-gray-400">{fmtTime(trade.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </Surface>
        </div>

        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-2">
          <SymbolDisclosures symbol={instrument.symbol} />

          {user ? (
            isManager ? (
              <ManagerPanel instrument={instrument} userId={user.user_id} />
            ) : (
              <ManagerTransferInbox instrument={instrument} userId={user.user_id} />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function SymbolPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <SymbolDetail />
    </Suspense>
  );
}
