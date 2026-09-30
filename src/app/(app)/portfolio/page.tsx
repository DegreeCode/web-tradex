"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { buildHolding, HoldingRow } from "@/components/holding-row";
import { NavChart } from "@/components/nav-chart";
import {
  ChangeIndicator,
  EmptyState,
  ErrorBlock,
  SectionHeader,
  SkeletonRows,
  Surface,
} from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import { errorMessage } from "@/lib/api";
import {
  changePercent,
  fmtCredit,
  fmtDecimal,
  fmtRelative,
  fmtSigned,
  toNumber,
} from "@/lib/format";
import {
  useAccountPortfolioHistory,
  useAllPortfolios,
  useInstruments,
  useNav,
  useNavHistory,
  useRealizedPnL,
} from "@/lib/hooks";
import type { NavRange } from "@/lib/types";

const RANGES: { value: NavRange; label: string }[] = [
  { value: "1d", label: "1일" },
  { value: "1w", label: "1주" },
  { value: "1mo", label: "1개월" },
  { value: "3mo", label: "3개월" },
  { value: "1y", label: "1년" },
];

export default function PortfolioPage() {
  const { accounts, portfolios, isLoading, error: portfolioError, refetch: refetchPortfolios } = useAllPortfolios();
  const instrumentsQuery = useInstruments();
  const realizedQuery = useRealizedPnL(20);
  const navQuery = useNav();
  const [realizedLimit, setRealizedLimit] = useState(5);
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [range, setRange] = useState<NavRange>("1mo");
  const navHistory = useNavHistory(range, accountFilter === "ALL");
  const accountHistory = useAccountPortfolioHistory(
    accountFilter === "ALL" ? undefined : accountFilter,
    range,
  );

  const instrumentMap = useMemo(
    () =>
      new Map(
        (instrumentsQuery.data ?? []).map((instrument) => [instrument.symbol, instrument]),
      ),
    [instrumentsQuery.data],
  );

  const nav = navQuery.data;
  // NAV already aggregates every account; portfolio sums are only a fallback.
  const totalCredit = nav
    ? toNumber(nav.total_credit)
    : portfolios.reduce((sum, portfolio) => sum + toNumber(portfolio.total_credit), 0);
  const lockedCredit = nav
    ? toNumber(nav.locked_credit)
    : portfolios.reduce((sum, portfolio) => sum + toNumber(portfolio.locked_credit), 0);

  const holdings = useMemo(() => {
    const filtered =
      accountFilter === "ALL"
        ? portfolios
        : portfolios.filter((portfolio) => portfolio.account_id === accountFilter);
    const rows = filtered.flatMap((portfolio) =>
      portfolio.positions.map((position) => ({
        ...buildHolding(position, instrumentMap),
        accountId: portfolio.account_id,
      })),
    );
    rows.sort((a, b) => b.value - a.value);
    return rows;
  }, [portfolios, accountFilter, instrumentMap]);

  const stockValue = holdings.reduce((sum, holding) => sum + holding.value, 0);
  const costBasis = holdings.reduce(
    (sum, holding) => sum + toNumber(holding.position.cost_basis),
    0,
  );
  const unrealized = stockValue - costBasis;
  const unrealizedPct = costBasis > 0 ? (unrealized / costBasis) * 100 : null;
  const computedTotal = totalCredit + stockValue;

  const historyQuery = accountFilter === "ALL" ? navHistory : accountHistory;
  const totalAssets = nav ? toNumber(nav.total_value) : computedTotal;
  const navSeries = useMemo(
    () =>
      [...(accountFilter === "ALL" ? (navHistory.data?.pages.flatMap((page) => page.data) ?? []) : (accountHistory.data?.pages.flatMap((page) => page.data) ?? []))].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      ),
    [accountFilter, navHistory.data, accountHistory.data],
  );
  const periodChange =
    navSeries.length >= 2
      ? changePercent(navSeries[0].value, navSeries[navSeries.length - 1].value)
      : null;
  const periodAmount =
    navSeries.length >= 2
      ? toNumber(navSeries[navSeries.length - 1].value) - toNumber(navSeries[0].value)
      : null;

  const realizedRows = (realizedQuery.data?.pages.flatMap((page) => page.data) ?? []).slice(
    0,
    realizedLimit,
  );
  const realizedTotal = (realizedQuery.data?.pages.flatMap((page) => page.data) ?? []).reduce(
    (sum, row) => sum + toNumber(row.realized_pnl),
    0,
  );

  return (
    <div className="space-y-6 xl:grid xl:grid-cols-12 xl:gap-5 xl:space-y-0">
      <div className="xl:col-span-12 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.03em] text-app-gray-900">투자</h1>
          <p className="mt-1 text-[13px] text-app-gray-500">자산과 보유 종목을 한눈에 확인하세요</p>
        </div>
        <Link
          href="/margin"
          className="inline-flex items-center gap-1.5 rounded-xl border border-app-blue bg-app-blue-light px-3.5 py-2 text-[13px] font-bold text-app-blue-dark hover:bg-blue-100 transition-colors"
        >
          마진 포지션 관리
        </Link>
      </div>

      <Surface className="@container min-w-0 xl:col-span-4">
        <p className="text-[13px] font-semibold text-app-gray-500">총 자산</p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="numeric text-[clamp(1rem,6.5cqi,1.75rem)] leading-tight font-extrabold tracking-[-0.03em] text-app-gray-900 break-all">
              {nav ? fmtDecimal(totalAssets, 2) : "—"}
            </span>
            <span className="text-[13px] sm:text-[14px] font-bold text-app-gray-500 shrink-0">Credit</span>
          </div>
          <div className="shrink-0">
            <ChangeIndicator value={isLoading || portfolioError || instrumentsQuery.isLoading ? null : unrealizedPct} />
          </div>
        </div>
        {navQuery.isLoading ? <p role="status" className="mt-2 text-[13px] text-app-gray-500">자산 정보를 불러오는 중이에요…</p> : null}
        {navQuery.isError ? <ErrorBlock message={errorMessage(navQuery.error)} onRetry={() => void navQuery.refetch()} /> : null}
        <div className="mt-4 space-y-2 rounded-xl bg-app-gray-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-app-gray-500 shrink-0">Credit</span>
            <span className="numeric text-[13px] sm:text-[14px] font-bold text-app-gray-900 text-right break-all">
              {nav ? fmtCredit(nav.total_credit, 2) : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-app-gray-500 shrink-0">주식 평가액</span>
            <span className="numeric text-[13px] sm:text-[14px] font-bold text-app-gray-900 text-right break-all">
              {nav ? fmtCredit(nav.asset_value, 2) : "—"}
            </span>
          </div>
          {toNumber(nav?.margin_adjustment) !== 0 ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-medium text-app-gray-500 shrink-0">마진 자산 조정</span>
              <span className="numeric text-[13px] sm:text-[14px] font-bold text-app-gray-900 text-right break-all">
                {fmtSigned(nav?.margin_adjustment, 2)}
              </span>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-app-gray-500 shrink-0">평가 손익</span>
            <span className="numeric text-[13px] sm:text-[14px] font-bold text-app-gray-900 text-right break-all">
              {isLoading || portfolioError || instrumentsQuery.isLoading ? "—" : fmtSigned(unrealized, 2)}
            </span>
          </div>
        </div>
        {!isLoading && !portfolioError && lockedCredit > 0 ? (
          <p className="mt-2 text-[12px] text-app-gray-500 break-all">
            예약·잠금 금액 {fmtCredit(lockedCredit, 2)} Credit
          </p>
        ) : null}
      </Surface>

      <Surface className="xl:col-span-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-app-gray-500">
            {accountFilter === "ALL" ? "전체 자산 추이" : "계좌 자산 추이"}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {periodAmount !== null ? (
              <p className="numeric text-[12px] font-semibold text-app-gray-500">
                {fmtSigned(periodAmount, 2)} Credit
              </p>
            ) : null}
            <ChangeIndicator value={periodChange} />
          </div>
        </div>
        <div className="mt-3">
          {historyQuery.isError ? <ErrorBlock message={errorMessage(historyQuery.error)} onRetry={() => void historyQuery.refetch()} /> : null}
          {historyQuery.isLoading ? <div aria-label="자산 추이 로딩" role="status"><SkeletonRows rows={2} /></div> : historyQuery.data || !historyQuery.isError ? <NavChart points={navSeries} height={180} /> : null}
        </div>
        <Segmented<NavRange> value={range} onChange={setRange} options={RANGES} className="mt-3" />
      </Surface>

      {nav && nav.accounts.length > 1 ? (
        <Surface className="xl:col-span-12">
          <p className="mb-1 text-[13px] font-semibold text-app-gray-500">계좌별 자산</p>
          {nav.accounts.map((account) => (
            <div
              key={account.account_id}
              className="flex flex-col items-start gap-1 border-b border-app-gray-100 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div>
                <p className="min-w-0 break-all text-[14px] font-semibold text-app-gray-900">
                  {account.account_id}
                </p>
                <p className="numeric min-w-0 break-all text-[12px] text-app-gray-500">
                  Credit {fmtCredit(account.total_credit, 2)} · 주식{" "}
                  {fmtCredit(account.asset_value, 2)}
                  {toNumber(account.margin_adjustment) !== 0
                    ? ` · 마진 자산 조정 ${fmtSigned(account.margin_adjustment, 2)}`
                    : ""}
                </p>
              </div>
              <p className="numeric min-w-0 break-all text-[14px] font-bold text-app-gray-900">
                {fmtCredit(account.total_value, 2)}
              </p>
            </div>
          ))}
        </Surface>
      ) : null}

      {accounts.length > 1 ? (
        <Segmented
          className="xl:col-span-12"
          value={accountFilter}
          onChange={setAccountFilter}
          options={[
            { value: "ALL", label: "전체 계좌" },
            ...accounts.map((account) => ({
              value: account.account_id,
              label: account.is_primary ? "대표" : "추가",
            })),
          ]}
        />
      ) : null}

      <section className="xl:col-span-6">
        <SectionHeader title="보유 종목" description={`${holdings.length}개 종목`} />
        {portfolioError ? <ErrorBlock message={errorMessage(portfolioError)} onRetry={refetchPortfolios} /> : null}
        {isLoading && portfolios.length > 0 ? <p role="status" className="mb-3 text-[13px] text-app-gray-500">나머지 계좌 정보를 불러오는 중이에요…</p> : null}
        {isLoading && portfolios.length === 0 ? (
          <SkeletonRows rows={3} />
        ) : holdings.length === 0 && !isLoading && !portfolioError ? (
          <EmptyState
            title="보유한 종목이 없어요"
            description="마켓에서 종목을 둘러보고 투자를 시작해보세요"
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
          <div className="divide-y divide-app-gray-100 overflow-hidden rounded-2xl bg-card shadow-[0_1px_2px_0_rgba(25,31,40,0.03)]">
            {holdings.map((holding) => (
              <HoldingRow key={`${holding.accountId}:${holding.position.symbol}`} holding={holding} />
            ))}
          </div>
        )}
      </section>

      <section className="xl:col-span-6">
        <SectionHeader
          title="실현 손익"
          description={realizedQuery.data ? `누적 ${fmtSigned(realizedTotal, 4)} Credit` : undefined}
        />
        {realizedQuery.isError ? <ErrorBlock message={errorMessage(realizedQuery.error)} onRetry={() => void realizedQuery.refetch()} /> : null}
        {realizedQuery.isLoading ? (
          <SkeletonRows rows={2} />
        ) : realizedRows.length === 0 && !realizedQuery.isError ? (
          <EmptyState title="실현 손익 내역이 없어요" description="매도하면 손익이 기록돼요" />
        ) : (
          <>
            <div className="divide-y divide-app-gray-100 rounded-2xl bg-card px-4 shadow-[0_1px_2px_0_rgba(25,31,40,0.03)]">
              {realizedRows.map((row) => (
                <div
                  key={`${row.trade_id}-${row.at}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div>
                    <p className="min-w-0 break-all text-[14px] font-semibold text-app-gray-900">{row.symbol}</p>
                    <p className="text-[12px] text-app-gray-500">{fmtRelative(row.at)}</p>
                  </div>
                  <p
                    className={
                      toNumber(row.realized_pnl) >= 0
                        ? "numeric min-w-0 break-all text-[14px] font-bold text-app-red"
                        : "numeric min-w-0 break-all text-[14px] font-bold text-app-blue"
                    }
                  >
                    {fmtSigned(row.realized_pnl, 6)}
                  </p>
                </div>
              ))}
            </div>
            {realizedQuery.hasNextPage || realizedLimit < realizedRows.length ? (
              <button
                type="button"
                onClick={() => {
                  setRealizedLimit((limit) => limit + 10);
                  if (realizedQuery.hasNextPage) void realizedQuery.fetchNextPage();
                }}
                className="mt-3 h-11 w-full rounded-xl bg-card text-[13px] font-semibold text-app-gray-600 shadow-[0_1px_2px_0_rgba(25,31,40,0.03)]"
              >
                더보기
              </button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
