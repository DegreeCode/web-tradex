"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Landmark, PlusCircle, Send, ShieldCheck } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { HoldingRow, buildHolding, type HoldingView } from "@/components/holding-row";
import { InstrumentList } from "@/components/instrument-list";
import { NAV_RANGES, NavChart } from "@/components/nav-chart";
import {
  ChangeIndicator,
  EmptyState,
  ErrorBlock,
  SectionHeader,
  SkeletonRows,
  Surface,
} from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import { accountLabel } from "@/lib/accounts";
import { errorMessage } from "@/lib/api";
import { changePercent, fmtCredit, fmtDateTime, fmtDecimal, fmtSigned, shortId, toNumber } from "@/lib/format";
import { useAllPortfolios, useInstruments, useMarketState, useNav, useNavHistory } from "@/lib/hooks";
import type { Account, NavRange } from "@/lib/types";

const QUICK_ACTIONS = [
  { href: "/transfers", label: "송금", icon: Send },
  { href: "/accounts", label: "계좌", icon: Landmark },
  { href: "/security", label: "보안", icon: ShieldCheck },
  { href: "/listings/new", label: "상장", icon: PlusCircle },
];

function accountName(accountId: string, accounts: Account[]): string {
  const account = accounts.find((row) => row.account_id === accountId);
  return account ? accountLabel(account, accounts) : "계좌";
}

export default function HomePage() {
  const { user } = useAuth();
  const marketState = useMarketState();
  const instrumentsQuery = useInstruments();
  const { accounts, portfolios, isLoading, error: portfolioError, refetch: refetchPortfolios } = useAllPortfolios();
  const navQuery = useNav();
  const [range, setRange] = useState<NavRange>("1mo");
  const navHistory = useNavHistory(range);

  const instruments = useMemo(() => instrumentsQuery.data ?? [], [instrumentsQuery.data]);
  const instrumentMap = useMemo(
    () => new Map(instruments.map((instrument) => [instrument.symbol, instrument])),
    [instruments],
  );

  const { stockValue, costBasis, holdings } = useMemo(() => {
    let stockValue = 0;
    let costBasis = 0;
    const holdings: (HoldingView & { accountId: string })[] = [];
    for (const portfolio of portfolios) {
      for (const position of portfolio.positions) {
        const holding = buildHolding(position, instrumentMap);
        stockValue += holding.value;
        costBasis += toNumber(position.cost_basis);
        holdings.push({ ...holding, accountId: portfolio.account_id });
      }
    }
    holdings.sort((a, b) => b.value - a.value);
    return { stockValue, costBasis, holdings };
  }, [portfolios, instrumentMap]);

  const nav = navQuery.data;
  const totalValue = nav ? toNumber(nav.total_value) : 0;
  const creditValue = nav ? toNumber(nav.total_credit) : 0;
  const assetValue = nav ? toNumber(nav.asset_value) : stockValue;
  const lockedValue = nav ? toNumber(nav.locked_credit) + toNumber(nav.locked_asset_value) : 0;

  const unrealized = stockValue - costBasis;
  const unrealizedPct = costBasis > 0 ? (unrealized / costBasis) * 100 : null;

  const navSeries = useMemo(
    () =>
      [...(navHistory.data?.pages.flatMap((page) => page.data) ?? [])].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      ),
    [navHistory.data],
  );
  const periodChange =
    navSeries.length >= 2
      ? changePercent(navSeries[0].value, navSeries[navSeries.length - 1].value)
      : null;
  const periodAmount =
    navSeries.length >= 2
      ? toNumber(navSeries[navSeries.length - 1].value) - toNumber(navSeries[0].value)
      : null;

  const halted = marketState.data?.state === "GLOBAL_HALTED";
  const popular = useMemo(
    () => [...instruments]
      .sort((a, b) => toNumber(b.market_value) - toNumber(a.market_value))
      .slice(0, 5),
    [instruments],
  );

  return (
    <div className="space-y-6 xl:grid xl:grid-cols-12 xl:gap-5 xl:space-y-0">
      <div className="@container min-w-0 xl:col-span-12">
        <h1 className="break-words text-[13px] font-semibold text-app-gray-500">{user?.username}님의 자산</h1>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
          <p className="numeric min-w-0 break-all text-[clamp(1rem,6cqi,2rem)] leading-tight font-extrabold tracking-[-0.03em] text-app-gray-900">
            {nav ? fmtDecimal(totalValue, 2) : "—"}
            <span className="ml-1 text-[15px] font-bold text-app-gray-500">Credit</span>
          </p>
          <ChangeIndicator value={periodChange} />
        </div>
        {navQuery.isLoading ? <p role="status" className="mt-2 text-[13px] text-app-gray-500">자산 정보를 불러오는 중이에요…</p> : null}
        {navQuery.isError ? <ErrorBlock message={errorMessage(navQuery.error)} onRetry={() => void navQuery.refetch()} /> : null}
      </div>

      {halted ? (
        <div role="status" className="rounded-2xl bg-app-red-light px-4 py-3 xl:col-span-12">
          <p className="text-[13px] font-bold text-app-red">전체 시장이 일시 정지됐어요</p>
          <p className="mt-0.5 text-[12px] text-app-red/80">
            {marketState.data?.reason || "관리자에 의해 거래가 중단됐어요"}
            {marketState.data?.halted_until ? ` · ${fmtDateTime(marketState.data.halted_until)}까지` : ""}
          </p>
        </div>
      ) : null}

      <Surface className="p-5 xl:col-span-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-app-gray-500">자산 추이</p>
          {periodAmount !== null ? (
            <p className="numeric text-[12px] font-semibold text-app-gray-500">
              {fmtSigned(periodAmount, 2)} Credit
            </p>
          ) : null}
        </div>
        <div className="mt-3">
          {navHistory.isError ? <ErrorBlock message={errorMessage(navHistory.error)} onRetry={() => void navHistory.refetch()} /> : null}
          {navHistory.isLoading ? <div aria-label="자산 추이 로딩" role="status"><SkeletonRows rows={2} /></div> : navHistory.data || !navHistory.isError ? <NavChart points={navSeries} height={180} /> : null}
        </div>
        <Segmented<NavRange>
          value={range}
          onChange={setRange}
          options={NAV_RANGES}
          className="mt-3"
        />
      </Surface>

      <Surface className="p-0 xl:col-span-4">
        <div className="grid grid-cols-4 gap-1 p-2">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              prefetch={false}
              className="flex flex-col items-center gap-1.5 rounded-xl py-3 transition-colors hover:bg-app-gray-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-app-blue"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-app-blue-light text-app-blue-dark">
                <action.icon aria-hidden="true" className="size-[18px]" />
              </span>
              <span className="text-[12px] font-semibold text-app-gray-700">{action.label}</span>
            </Link>
          ))}
        </div>
        <div className="border-t border-app-gray-100 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
            <span className="text-[14px] text-app-gray-500">Credit 잔액</span>
            <span className="numeric min-w-0 break-all text-right text-[14px] font-semibold text-app-gray-900">
              {nav ? fmtCredit(creditValue, 2) : "—"}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
            <span className="text-[14px] text-app-gray-500">주식 평가액</span>
            <span className="numeric min-w-0 break-all text-right text-[14px] font-semibold text-app-gray-900">
              {nav ? fmtCredit(assetValue, 2) : "—"}
            </span>
          </div>
          {toNumber(nav?.margin_adjustment) !== 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
              <span className="text-[14px] text-app-gray-500">마진 자산 조정</span>
              <span className="numeric min-w-0 break-all text-right text-[14px] font-semibold text-app-gray-900">
                {fmtSigned(nav?.margin_adjustment, 2)}
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
            <span className="text-[14px] text-app-gray-500">보유 종목 평가 손익</span>
            <span className="numeric min-w-0 break-all text-right text-[14px] font-semibold text-app-gray-900">
              {isLoading || portfolioError || instrumentsQuery.isLoading ? "—" : fmtCredit(unrealized, 2)}
              {!isLoading && !portfolioError && !instrumentsQuery.isLoading && unrealizedPct !== null ? (
                <span className="ml-1 text-[12px] text-app-gray-400">({fmtSigned(unrealizedPct, 1)}%)</span>
              ) : null}
            </span>
          </div>
          {lockedValue > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
              <span className="text-[14px] text-app-gray-500">예약·잠금 금액</span>
              <span className="numeric min-w-0 break-all text-right text-[14px] font-semibold text-app-gray-900">
                {fmtCredit(lockedValue, 2)}
              </span>
            </div>
          ) : null}
        </div>
      </Surface>

      {nav && nav.accounts.length > 1 ? (
        <Surface className="p-5 xl:col-span-12">
          <p className="text-[13px] font-semibold text-app-gray-500">계좌별 자산</p>
          <div className="mt-2">
            {nav.accounts.map((account) => (
              <div key={account.account_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 text-[14px] text-app-gray-700">
                  {accountName(account.account_id, accounts)}
                  <span className="numeric ml-1.5 text-[12px] text-app-gray-400">{shortId(account.account_id)}</span>
                </span>
                <span className="numeric min-w-0 break-all text-right text-[14px] font-semibold text-app-gray-900">
                  {fmtCredit(account.total_value, 2)}
                </span>
              </div>
            ))}
          </div>
        </Surface>
      ) : null}

      <section className="xl:col-span-6">
        <SectionHeader
          title="내 보유 종목"
          action={
            <Link
              href="/portfolio"
              prefetch={false}
              className="flex items-center gap-1 text-[13px] font-semibold text-app-gray-500"
            >
              전체보기
              <ArrowRight className="size-3.5" />
            </Link>
          }
        />
        {portfolioError ? <ErrorBlock message={errorMessage(portfolioError)} onRetry={refetchPortfolios} /> : null}
        {isLoading && portfolios.length > 0 ? <p role="status" className="mb-3 text-[13px] text-app-gray-500">나머지 계좌 정보를 불러오는 중이에요…</p> : null}
        {isLoading && portfolios.length === 0 ? (
          <SkeletonRows rows={2} />
        ) : holdings.length === 0 && !isLoading && !portfolioError ? (
          <EmptyState
            title="아직 보유한 종목이 없어요"
            description="마켓에서 종목을 둘러보고 첫 투자를 시작해보세요"
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
        ) : (
          <div className="divide-y divide-app-gray-100 overflow-hidden rounded-2xl bg-card shadow-card">
            {holdings.slice(0, 3).map((holding) => (
              <HoldingRow key={`${holding.accountId}:${holding.position.symbol}`} holding={holding} />
            ))}
          </div>
        )}
      </section>

      <section className="xl:col-span-6">
        <SectionHeader
          title="인기 종목"
          action={
            <Link
              href="/market"
              prefetch={false}
              className="flex items-center gap-1 text-[13px] font-semibold text-app-gray-500"
            >
              전체보기
              <ArrowRight className="size-3.5" />
            </Link>
          }
        />
        {instrumentsQuery.isError ? <ErrorBlock message={errorMessage(instrumentsQuery.error)} onRetry={() => void instrumentsQuery.refetch()} /> : null}
        {instrumentsQuery.isLoading ? (
          <SkeletonRows rows={3} />
        ) : popular.length === 0 && !instrumentsQuery.isError ? (
          <EmptyState
            title="상장된 종목이 없어요"
            description="첫 번째 종목을 상장해보세요"
            action={
              <Link
                href="/listings/new"
                prefetch={false}
                className="text-[13px] font-semibold text-app-blue underline underline-offset-4"
              >
                종목 상장하기
              </Link>
            }
          />
        ) : (
          <InstrumentList instruments={popular} />
        )}
      </section>
    </div>
  );
}
