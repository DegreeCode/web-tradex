"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  Clock,
  FilePenLine,
  FileText,
  Landmark,
  LockKeyhole,
  Megaphone,
  OctagonAlert,
  RefreshCw,
  ShieldAlert,
  UserRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { CandleChart } from "@/components/candle-chart";
import type { ChartSeriesType } from "@/components/lightweight-chart";
import { ManagerPanel, ManagerTransferInbox } from "@/components/manager-panel";
import { ResponsiveOrderForm } from "@/components/responsive-order-form";
import { PriceChart } from "@/components/price-chart";
import { PriceFlash } from "@/components/price-flash";
import {
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
import { InstrumentAvatar } from "@/components/instrument-list";
import { Segmented } from "@/components/segmented";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api";
import { updatePreferences, usePreferences } from "@/lib/preferences";
import {
  changePercent,
  compareDecimal,
  fmtCompact,
  fmtDate,
  fmtDateTime,
  fmtPrice,
  fmtPercentFromPPM,
  fmtQuantity,
  fmtRelative,
  fmtTime,
  shortId,
  toNumber,
} from "@/lib/format";
import {
  useCandles,
  useDisclosures,
  useInstrument,
  useSymbolTradeStream,
  useSymbolTrades,
} from "@/lib/hooks";
import type { CandleInterval, Disclosure } from "@/lib/types";

const INTERVALS: { value: CandleInterval; label: string }[] = [
  { value: "1m", label: "1분" },
  { value: "5m", label: "5분" },
  { value: "15m", label: "15분" },
  { value: "1h", label: "1시간" },
  { value: "4h", label: "4시간" },
  { value: "1d", label: "1일" },
];

const DEFAULT_CANDLE_INTERVAL: CandleInterval = "1h";
const SUPPORTED_CANDLE_INTERVALS: readonly CandleInterval[] = [
  "1s",
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
  "1M",
  "1y",
];

function isSupportedCandleInterval(value: string | null): value is CandleInterval {
  return value !== null && SUPPORTED_CANDLE_INTERVALS.includes(value as CandleInterval);
}

function useCandleIntervalPreference() {
  const stored = usePreferences();
  const storedInterval = stored?.candleInterval ?? null;
  const interval = isSupportedCandleInterval(storedInterval) ? storedInterval : DEFAULT_CANDLE_INTERVAL;
  const updateInterval = (next: CandleInterval) => {
    if (SUPPORTED_CANDLE_INTERVALS.includes(next)) updatePreferences({ candleInterval: next });
  };
  return { interval, updateInterval, hydrated: stored !== null };
}

type DisclosureTone = "blue" | "green" | "orange" | "red" | "gray";

interface DisclosurePresentation {
  title: string;
  description: string;
  icon: LucideIcon;
  tone: DisclosureTone;
}

interface DisclosureDetail {
  label: string;
  value: string;
}

const DISCLOSURE_PRESENTATION: Record<string, DisclosurePresentation> = {
  ADDITIONAL_ISSUANCE: {
    title: "추가 발행",
    description: "새로운 발행 내역이 공시되었어요",
    icon: Landmark,
    tone: "blue",
  },
  ISSUANCE_CREATED: {
    title: "추가 발행",
    description: "새로운 발행 내역이 공시되었어요",
    icon: Landmark,
    tone: "blue",
  },
  LOCKUP_RELEASE: {
    title: "락업 해제",
    description: "잠금 물량이 유통 물량으로 전환되었어요",
    icon: LockKeyhole,
    tone: "green",
  },
  MANAGER_CHANGED: {
    title: "매니저 변경",
    description: "종목 매니저가 변경되었어요",
    icon: UserRound,
    tone: "blue",
  },
  MANAGER_FORCED_CHANGE: {
    title: "매니저 변경",
    description: "운영에 의해 종목 매니저가 변경되었어요",
    icon: ShieldAlert,
    tone: "orange",
  },
  SYMBOL_HALTED: {
    title: "거래 정지",
    description: "종목 거래가 일시 정지되었어요",
    icon: OctagonAlert,
    tone: "red",
  },
  SYMBOL_RESUMED: {
    title: "거래 재개",
    description: "종목 거래가 다시 시작되었어요",
    icon: RefreshCw,
    tone: "green",
  },
  DELIST_SCHEDULED: {
    title: "상장폐지 예정",
    description: "상장폐지 일정이 공시되었어요",
    icon: CalendarClock,
    tone: "orange",
  },
  DELIST_CANCELED: {
    title: "상장폐지 취소",
    description: "예정된 상장폐지가 취소되었어요",
    icon: RefreshCw,
    tone: "green",
  },
  DELISTED: {
    title: "상장폐지 완료",
    description: "종목의 상장폐지가 완료되었어요",
    icon: OctagonAlert,
    tone: "red",
  },
  SYMBOL_METADATA_CHANGED: {
    title: "종목 정보 변경",
    description: "종목 이름이나 설명이 변경되었어요",
    icon: FilePenLine,
    tone: "blue",
  },
  GLOBAL_MARKET_HALTED: {
    title: "시장 거래 정지",
    description: "전체 시장 거래가 일시 정지되었어요",
    icon: Megaphone,
    tone: "red",
  },
  GLOBAL_MARKET_RESUMED: {
    title: "시장 거래 재개",
    description: "전체 시장 거래가 다시 시작되었어요",
    icon: Activity,
    tone: "green",
  },
  OWNER_TRADE: {
    title: "소유자 거래 공시",
    description: "소유자 관련 거래 내역이 공개되었어요",
    icon: ArrowUpRight,
    tone: "orange",
  },
  OWNER_STOCK_TRANSFER: {
    title: "소유자 주식 이동",
    description: "소유자 관련 주식 이동 내역이 공개되었어요",
    icon: WalletCards,
    tone: "orange",
  },
};

const FALLBACK_DISCLOSURE: DisclosurePresentation = {
  title: "시장 공시",
  description: "새로운 시장 소식이 등록되었어요",
  icon: FileText,
  tone: "gray",
};

const DISCLOSURE_TONE_CLASS: Record<DisclosureTone, { icon: string; badge: string }> = {
  blue: { icon: "bg-app-blue-light text-app-blue", badge: "bg-app-blue-light text-app-blue-dark" },
  green: { icon: "bg-app-green-light text-app-green", badge: "bg-app-green-light text-app-green" },
  orange: { icon: "bg-app-orange-light text-app-orange", badge: "bg-app-orange-light text-app-orange" },
  red: { icon: "bg-app-red-light text-app-red", badge: "bg-app-red-light text-app-red" },
  gray: { icon: "bg-app-gray-100 text-app-gray-500", badge: "bg-app-gray-100 text-app-gray-600" },
};

const STATE_LABEL: Record<string, string> = {
  HALTED: "거래 정지",
  TRADING: "거래 중",
  RESUMED: "거래 재개",
};

const SIDE_LABEL: Record<string, string> = { BUY: "매수", SELL: "매도" };
const DIRECTION_LABEL: Record<string, string> = {
  SEND: "보냄",
  RECEIVE: "받음",
  BOTH: "보냄·받음",
  SELF_TRANSFER: "본인 계정 간 이동",
};

function payloadText(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function addDisclosureDetail(details: DisclosureDetail[], label: string, value: string | null): void {
  if (value && value !== "-") details.push({ label, value });
}

function participantsLabel(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const roles = new Set<string>();
  for (const participant of value) {
    if (!participant || typeof participant !== "object") continue;
    const item = participant as Record<string, unknown>;
    const role = typeof item.role === "string" ? item.role : null;
    const transferRole = typeof item.transfer_role === "string" ? item.transfer_role : null;
    if (role === "CURRENT_OWNER") roles.add("현재 소유자");
    if (role === "PREVIOUS_OWNER") roles.add("이전 소유자");
    if (transferRole === "SEND") roles.add("송신");
    if (transferRole === "RECEIVE") roles.add("수신");
    if (transferRole === "BOTH") roles.add("송수신");
  }
  const roleText = roles.size > 0 ? ` · ${Array.from(roles).join("·")}` : "";
  return `${value.length}명${roleText}`;
}

function disclosureDetails(disclosure: Disclosure): DisclosureDetail[] {
  const { payload } = disclosure;
  const details: DisclosureDetail[] = [];
  const addText = (label: string, key: string) => addDisclosureDetail(details, label, payloadText(payload, key));
  const addPrice = (label: string, key: string) => {
    const value = payloadText(payload, key);
    addDisclosureDetail(details, label, value ? `${fmtPrice(value)} Credit` : null);
  };
  const addQuantity = (label: string, key: string) => {
    const value = payloadText(payload, key);
    addDisclosureDetail(details, label, value ? `${fmtQuantity(value)}주` : null);
  };
  const addCredit = (label: string, key: string) => {
    const value = payloadText(payload, key);
    addDisclosureDetail(details, label, value ? `${fmtCompact(value)} Credit` : null);
  };
  const addDate = (label: string, key: string) => addDisclosureDetail(details, label, fmtDateTime(payloadText(payload, key)));
  const addPpm = (label: string, key: string) => {
    const value = payloadNumber(payload, key);
    addDisclosureDetail(details, label, value === null ? null : fmtPercentFromPPM(value));
  };

  switch (disclosure.type) {
    case "ADDITIONAL_ISSUANCE":
    case "ISSUANCE_CREATED":
      addCredit("예치 금액", "deposit_credit");
      addPrice("발행 전 가격", "price_before");
      addPrice("발행 후 가격", "price_after");
      addPpm("가격 희석률", "price_dilution_ppm");
      addQuantity("잠금 발행량", "locked_shares_issued");
      addQuantity("풀 발행량", "pool_shares_issued");
      addQuantity("총 발행량", "total_shares_issued");
      addQuantity("발행 후 총 공급량", "total_supply_after");
      addPpm("24시간 공급 증가율", "rolling_24h_supply_increase_ppm");
      addDisclosureDetail(details, "강제 발행", payloadText(payload, "forced") === "true" ? "예" : null);
      addDate("발행 시각", "issued_at");
      break;
    case "LOCKUP_RELEASE":
      addQuantity("해제 물량", "released_quantity");
      addQuantity("해제 후 락업 물량", "locked_supply_after");
      addQuantity("해제 후 유통 물량", "circulating_supply_after");
      addDate("해제 시각", "released_at");
      break;
    case "MANAGER_CHANGED":
    case "MANAGER_FORCED_CHANGE":
      addDisclosureDetail(details, "이전 매니저", shortId(payloadText(payload, "previous_manager_user_id")));
      addDisclosureDetail(details, "새 매니저", shortId(payloadText(payload, "manager_user_id")));
      addText("변경 사유", "reason");
      break;
    case "SYMBOL_HALTED":
    case "SYMBOL_RESUMED":
      addDisclosureDetail(details, "상태", STATE_LABEL[payloadText(payload, "state") ?? ""] ?? "상태 변경");
      addText("사유", "reason");
      addDate("예정 시각", "halted_until");
      break;
    case "DELIST_SCHEDULED":
      addDate("예정 시각", "scheduled_at");
      addText("사유", "reason");
      break;
    case "DELIST_CANCELED":
      addText("사유", "reason");
      break;
    case "DELISTED":
      addQuantity("정산 대상 물량", "eligible_unlocked_shares");
      addCredit("정산 풀", "pool_credit");
      addPrice("주당 분배금", "distribution_per_share");
      addDate("완료 시각", "delisted_at");
      break;
    case "SYMBOL_METADATA_CHANGED":
      addText("새 이름", "name");
      addText("새 설명", "description");
      break;
    case "GLOBAL_MARKET_HALTED":
    case "GLOBAL_MARKET_RESUMED":
      addDisclosureDetail(details, "상태", STATE_LABEL[payloadText(payload, "state") ?? ""] ?? "시장 상태 변경");
      addText("사유", "reason");
      addDate("변경 시각", "changed_at");
      addDate("예정 시각", "halted_until");
      break;
    case "OWNER_TRADE":
      addDisclosureDetail(details, "거래", SIDE_LABEL[payloadText(payload, "side") ?? ""] ?? "거래");
      addQuantity("수량", "quantity");
      addPrice("가격", "price");
      addCredit("거래 금액", "credit");
      addCredit("수수료", "fee");
      addDisclosureDetail(details, "공개 참여자", participantsLabel(payload.owner_participants));
      addDate("체결 시각", "completed_at");
      break;
    case "OWNER_STOCK_TRANSFER":
      addDisclosureDetail(details, "이동", DIRECTION_LABEL[payloadText(payload, "direction") ?? ""] ?? "주식 이동");
      addQuantity("수량", "quantity");
      addCredit("이동 금액", "credit");
      addCredit("수수료", "fee");
      addDisclosureDetail(details, "본인 계정 간 이동", payloadText(payload, "self_transfer") === "true" ? "예" : null);
      addDisclosureDetail(details, "공개 참여자", participantsLabel(payload.owner_participants));
      addDate("완료 시각", "completed_at");
      break;
    default:
      break;
  }
  return details;
}

function disclosureSummary(disclosure: Disclosure): string | null {
  return disclosureDetails(disclosure)
    .slice(0, 2)
    .map(({ label, value }) => `${label} ${value}`)
    .join(" · ") || null;
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
  const [selectedDisclosure, setSelectedDisclosure] = useState<Disclosure | null>(null);
  const [chartSeriesType, setChartSeriesType] = useState<ChartSeriesType>("candle");
  const instrumentQuery = useInstrument(symbol || undefined);
  const canonicalSymbol = instrumentQuery.data?.symbol;
  const tradesQuery = useSymbolTrades(canonicalSymbol, 150);
  const candlesQuery = useCandles(canonicalSymbol, interval, 200, intervalHydrated);
  const disclosuresQuery = useDisclosures({ symbol: canonicalSymbol, limit: 10, enabled: Boolean(canonicalSymbol) });

  useSymbolTradeStream(intervalHydrated ? canonicalSymbol : undefined, 150);

  if (!symbol) {
    return (
      <EmptyState
        title="종목을 선택해주세요"
        description="마켓에서 종목을 고르면 상세 정보를 볼 수 있어요"
        icon={<Clock className="size-6" />}
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
          back={<Link href="/market" prefetch={false} aria-label="뒤로" className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-app-gray-100"><ArrowLeft className="size-5" /></Link>}
        />
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-6">
          <div className="min-w-0 space-y-4">
            <Surface>
              <p className="text-[13px] font-semibold text-app-gray-500">현재가</p>
              <p className="my-2 text-[30px] font-extrabold text-app-gray-300">—</p>
              {failed ? (
                <ErrorBlock message={errorMessage(instrumentQuery.error)} onRetry={() => void instrumentQuery.refetch()} />
              ) : (
                <LoadingBlock className="h-[300px] rounded-xl bg-app-gray-50 py-0" />
              )}
              <Segmented<CandleInterval> value={interval} onChange={updateInterval} options={INTERVALS} className="mt-3" />
            </Surface>
            {["오늘의 지표", "종목 정보", "최근 체결", "공시"].map((title) => (
              <Surface key={title}>
                <h2 className="mb-2 text-[17px] font-bold text-app-gray-900">{title}</h2>
                {failed ? <p className="text-[13px] text-app-gray-500">종목 정보를 확인하면 표시돼요</p> : <SkeletonRows rows={2} />}
              </Surface>
            ))}
          </div>
          <Surface className="min-w-0 space-y-4 self-start">
            <h2 className="text-[17px] font-bold text-app-gray-900">주문</h2>
            <p role="status" className="text-[13px] text-app-gray-500">{failed ? "종목 정보를 확인한 뒤 주문할 수 있어요" : "종목 정보를 확인하고 있어요"}</p>
            {!failed ? <SkeletonRows rows={2} /> : null}
            <button type="button" disabled className="h-12 w-full rounded-xl bg-app-gray-100 text-[15px] font-semibold text-app-gray-400">주문 준비 중</button>
          </Surface>
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
  const disclosures: Disclosure[] = disclosuresQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const newest = trades[0];
  const oldest = trades[trades.length - 1];
  const windowChange = trades.length >= 2 ? changePercent(oldest.price, newest.price) : null;
  const change = Number.isFinite(instrument.change_ppm)
    ? instrument.change_ppm / 10_000
    : windowChange;
  const isManager = Boolean(
    instrument.manager_user_id && user && instrument.manager_user_id === user.user_id,
  );
  const isAtTheoreticalCeiling =
    typeof instrument.curve_ceiling_price === "string" &&
    instrument.curve_ceiling_price.length > 0 &&
    instrument.curve_spot_price !== "0" &&
    /^\d+(?:\.\d+)?$/.test(instrument.curve_spot_price) &&
    /^\d+(?:\.\d+)?$/.test(instrument.curve_ceiling_price) &&
    compareDecimal(instrument.curve_spot_price, instrument.curve_ceiling_price) === 0;

  const showLastTrade =
    Boolean(instrument.last_price) && compareDecimal(instrument.last_price, instrument.curve_spot_price) !== 0;
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
        back={
          <Link
            href="/market"
            prefetch={false}
            aria-label="뒤로"
            className="flex size-9 items-center justify-center rounded-full text-app-gray-700 hover:bg-app-gray-100"
          >
            <ArrowLeft className="size-5" />
          </Link>
        }
        action={
          <div className="flex items-center gap-2">
            <InstrumentStateChip state={instrument.state} />
            <InstrumentAvatar symbol={instrument.symbol} iconUrl={instrument.icon_url} />
          </div>
        }
      />

      {instrument.state === "HALTED" ? (
        <div className="rounded-2xl bg-app-red-light px-4 py-3">
          <p className="text-[13px] font-bold text-app-red">거래가 정지된 종목이에요</p>
          {instrument.halt_reason ? (
            <p className="mt-0.5 text-[12px] text-app-red/80">
              {instrument.halt_reason}
              {instrument.halted_until
                ? ` · ${new Date(instrument.halted_until).toLocaleString("ko-KR")}까지`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

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
                {isAtTheoreticalCeiling ? (
                  <span className="rounded-md bg-app-red-light px-1.5 py-0.5 text-[11px] font-bold text-app-red">
                    상한가
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 max-w-full break-all text-right">
                <ChangeIndicator value={change} />
                {/* Always laid out so the chart below doesn't jump when the
                    last trade matches the spot price and the line hides. */}
                <p
                  aria-hidden={!showLastTrade}
                  className={`mt-0.5 text-[12px] text-app-gray-400${showLastTrade ? "" : " invisible"}`}
                >
                  최근 체결 {instrument.last_price ? fmtPrice(instrument.last_price) : "-"}
                </p>
              </div>
            </div>

            <div className="mt-3 flex gap-1 overflow-x-auto" aria-label="차트 기간">
              {INTERVALS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateInterval(option.value)}
                  aria-pressed={interval === option.value}
                  className="shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-semibold text-app-gray-500 hover:bg-app-gray-100 aria-pressed:bg-app-gray-900 aria-pressed:text-app-gray-50"
                >
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setChartSeriesType((current) => (current === "candle" ? "line" : "candle"))}
                aria-label={chartSeriesType === "candle" ? "라인 차트로 보기" : "캔들 차트로 보기"}
                title={chartSeriesType === "candle" ? "라인 차트로 보기" : "캔들 차트로 보기"}
                className="flex shrink-0 items-center rounded-lg px-2 py-1 text-app-gray-500 hover:bg-app-gray-100"
              >
                {chartSeriesType === "candle" ? <CandleModeIcon /> : <LineModeIcon rising={periodRising} />}
              </button>
            </div>

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
          <Surface>
            <h2 className="mb-2 flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em] text-app-gray-900">
              <FileText className="size-4 text-app-gray-400" />
              공시
            </h2>
            {disclosuresQuery.isLoading ? (
              <SkeletonRows rows={2} />
            ) : disclosuresQuery.isError && disclosures.length === 0 ? (
              <ErrorBlock message={errorMessage(disclosuresQuery.error)} onRetry={() => void disclosuresQuery.refetch()} />
            ) : disclosures.length === 0 ? (
              <p className="text-[13px] text-app-gray-400">아직 공시가 없어요</p>
            ) : (
              <div className="space-y-2">
                {disclosures.map((disclosure) => {
                  const presentation = DISCLOSURE_PRESENTATION[disclosure.type] ?? FALLBACK_DISCLOSURE;
                  const tone = DISCLOSURE_TONE_CLASS[presentation.tone];
                  const Icon = presentation.icon;
                  const summary = disclosureSummary(disclosure);
                  return (
                    <button
                      key={disclosure.disclosure_id}
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => setSelectedDisclosure(disclosure)}
                      className="group flex w-full items-start gap-3 rounded-xl border border-app-gray-100 bg-card p-3 text-left transition hover:border-app-gray-200 hover:bg-app-gray-50 focus-visible:ring-2 focus-visible:ring-app-blue focus-visible:outline-none"
                    >
                      <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${tone.icon}`} aria-hidden="true">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone.badge}`}>
                            {presentation.title}
                          </span>
                          <span className="text-[11px] text-app-gray-400">
                            {fmtRelative(disclosure.occurred_at)}
                          </span>
                        </span>
                        <span className="mt-1 block text-[13px] font-medium text-app-gray-800">
                          {presentation.description}
                        </span>
                        {summary ? (
                          <span className="numeric mt-1 block truncate text-[12px] text-app-gray-500">{summary}</span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
                {disclosuresQuery.hasNextPage ? (
                  <button
                    type="button"
                    onClick={() => void disclosuresQuery.fetchNextPage()}
                    disabled={disclosuresQuery.isFetchingNextPage}
                    className="h-10 w-full rounded-xl bg-app-gray-50 text-[12px] font-semibold text-app-gray-600 transition hover:bg-app-gray-100 disabled:opacity-50"
                  >
                    {disclosuresQuery.isFetchingNextPage ? "불러오는 중…" : "공시 더보기"}
                  </button>
                ) : null}
              </div>
            )}
          </Surface>

          <Dialog
            open={Boolean(selectedDisclosure)}
            onOpenChange={(open) => {
              if (!open) setSelectedDisclosure(null);
            }}
          >
            {selectedDisclosure ? (() => {
              const presentation = DISCLOSURE_PRESENTATION[selectedDisclosure.type] ?? FALLBACK_DISCLOSURE;
              const tone = DISCLOSURE_TONE_CLASS[presentation.tone];
              const Icon = presentation.icon;
              const details = disclosureDetails(selectedDisclosure);
              return (
                <DialogContent className="max-h-[min(620px,calc(100vh-2rem))] overflow-y-auto sm:max-w-lg">
                  <DialogHeader className="pr-8">
                    <div className="flex items-center gap-3">
                      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone.icon}`} aria-hidden="true">
                        <Icon className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <DialogTitle>{presentation.title}</DialogTitle>
                        <DialogDescription className="mt-1">{presentation.description}</DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>
                  <div className="rounded-xl bg-app-gray-50 px-3 py-2.5">
                    <p className="text-[12px] font-semibold text-app-gray-500">{selectedDisclosure.symbol || symbol}</p>
                    <p className="mt-0.5 text-[12px] text-app-gray-400">
                      {fmtDateTime(selectedDisclosure.occurred_at)} · {fmtRelative(selectedDisclosure.occurred_at)}
                    </p>
                  </div>
                  {details.length > 0 ? (
                    <div className="divide-y divide-app-gray-100 rounded-xl border border-app-gray-100 px-3">
                      {details.map((detail) => (
                        <div key={`${detail.label}-${detail.value}`} className="flex items-start justify-between gap-4 py-2.5">
                          <span className="shrink-0 text-[13px] text-app-gray-500">{detail.label}</span>
                          <span className="numeric max-w-[70%] text-right text-[13px] font-medium break-words text-app-gray-900">
                            {detail.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-app-gray-50 px-3 py-3 text-[13px] text-app-gray-500">
                      자세한 내용은 공시 원문에서 확인할 수 있어요.
                    </p>
                  )}
                </DialogContent>
              );
            })() : null}
          </Dialog>

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
