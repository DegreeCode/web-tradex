"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { ErrorBlock, LoadingBlock, PageHeader, Surface } from "@/components/primitives";
import { accountLabel, defaultAccountId as pickDefaultAccount } from "@/lib/accounts";
import { Segmented } from "@/components/segmented";
import { addDecimal, fmtCredit } from "@/lib/format";
import { useAccounts } from "@/lib/hooks";
import { MarginCreateForm } from "@/components/margin/margin-create-form";
import { MarginPositionsList } from "@/components/margin/margin-positions-list";
import { useMarginPositions, type MarginPosition } from "@/lib/margin";

type MobileTab = "POSITIONS" | "CREATE";

function MarginContent() {
  const searchParams = useSearchParams();
  const paramSymbol = searchParams.get("symbol") ?? undefined;
  const paramAccountId = searchParams.get("account_id") ?? undefined;

  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];

  const [selectedAccountId, setSelectedAccountId] = useState<string>(paramAccountId ?? "");
  // A linked account_id that is not one of ours falls back to the default.
  const effectiveAccountId = accounts.some((account) => account.account_id === selectedAccountId)
    ? selectedAccountId
    : pickDefaultAccount(accounts);

  // Mobile shows one column at a time; arriving from a symbol page means the
  // user wants to open a position on it.
  const [mobileTab, setMobileTab] = useState<MobileTab>(paramSymbol ? "CREATE" : "POSITIONS");

  // The open detail dialog polls its own position; pause the list meanwhile.
  const [detailOpen, setDetailOpen] = useState(false);
  const positionsQuery = useMarginPositions({
    accountId: effectiveAccountId || undefined,
    limit: 50,
    enabled: Boolean(effectiveAccountId),
    poll: !detailOpen,
  });

  const positions = useMemo(() => {
    return (
      positionsQuery.data?.pages.flatMap((page) => page.positions) ?? ([] as MarginPosition[])
    );
  }, [positionsQuery.data]);

  const eligibility = positionsQuery.data?.pages[0]?.eligibility;

  const selectedAccount = accounts.find((a) => a.account_id === effectiveAccountId);

  // Aggregated margin stats for the selected account
  const { openCount, totalCollateral, totalEquity, totalDebt } = useMemo(() => {
    let openCount = 0;
    let totalCollateral = "0";
    let totalEquity = "0";
    let totalDebt = "0";
    for (const position of positions) {
      if (position.status !== "OPEN") continue;
      openCount += 1;
      totalCollateral = addDecimal(totalCollateral, position.collateral ?? "0");
      totalEquity = addDecimal(totalEquity, position.equity ?? "0");
      totalDebt = addDecimal(totalDebt, position.debt_value ?? "0");
    }
    return { openCount, totalCollateral, totalEquity, totalDebt };
  }, [positions]);

  const positionsPending = !positionsQuery.data && (accountsQuery.isPending || (Boolean(effectiveAccountId) && positionsQuery.isPending));
  const positionsUnavailable = accountsQuery.isError || positionsQuery.isError;
  const statsReady = Boolean(positionsQuery.data);

  return (
    <div className="space-y-4 lg:space-y-6">
      <PageHeader
        title="마진 거래"
        subtitle="빌린 자금으로 롱·숏 포지션을 열고 관리해요"
        action={
          <button
            type="button"
            onClick={() => void positionsQuery.refetch()}
            disabled={!effectiveAccountId || positionsQuery.isRefetching}
            aria-label="새로고침"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-app-gray-200 bg-card px-3 text-[13px] font-semibold text-app-gray-700 hover:bg-app-gray-50 disabled:opacity-50"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-3.5 ${positionsQuery.isRefetching ? "animate-spin" : ""}`}
            />
            <span className="max-sm:hidden">새로고침</span>
          </button>
        }
      />

      <Surface className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {accounts.length > 1 ? (
            <div role="group" className="flex gap-1.5 overflow-x-auto" aria-label="관리 계좌">
              {accounts.map((account) => (
                <button
                  key={account.account_id}
                  type="button"
                  onClick={() => setSelectedAccountId(account.account_id)}
                  aria-pressed={effectiveAccountId === account.account_id}
                  className="min-h-9 shrink-0 rounded-lg bg-app-gray-100 px-2.5 text-[13px] font-semibold text-app-gray-500 aria-pressed:bg-app-blue-light aria-pressed:text-app-blue-dark"
                >
                  {accountLabel(account, accounts)}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[14px] font-bold text-app-gray-900">
              {accountsQuery.isPending ? "계좌 불러오는 중…" : selectedAccount ? "대표 계좌" : "계좌가 없어요"}
            </p>
          )}
          {selectedAccount ? (
            <p className="numeric text-[13px] text-app-gray-500">
              사용 가능{" "}
              <span className="font-bold text-app-gray-900">
                {fmtCredit(selectedAccount.available_credit, 2)} Credit
              </span>
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="보유 포지션" value={statsReady ? `${openCount}개` : "—"} />
          <Stat label="담보 합계" value={statsReady ? fmtCredit(totalCollateral, 2) : "—"} unit="Credit" />
          <Stat label="자기자본 합계" value={statsReady ? fmtCredit(totalEquity, 2) : "—"} unit="Credit" />
          <Stat label="부채 합계" value={statsReady ? fmtCredit(totalDebt, 2) : "—"} unit="Credit" />
        </div>
      </Surface>

      {accountsQuery.isError ? <ErrorBlock message="계좌 정보를 불러오지 못했어요." onRetry={() => void accountsQuery.refetch()} /> : null}

      <Segmented<MobileTab>
        value={mobileTab}
        onChange={setMobileTab}
        className="lg:hidden"
        options={[
          { value: "POSITIONS", label: statsReady && openCount > 0 ? `내 포지션 ${openCount}` : "내 포지션" },
          { value: "CREATE", label: "새 포지션 열기" },
        ]}
      />

      <div className="lg:grid lg:grid-cols-12 lg:gap-6">
        <div className={`min-w-0 space-y-4 lg:col-span-7 ${mobileTab === "POSITIONS" ? "" : "max-lg:hidden"}`}>
          {positionsQuery.isError ? <ErrorBlock message="마진 포지션 정보를 불러오지 못했어요." onRetry={() => void positionsQuery.refetch()} /> : null}
          {(!positionsUnavailable || positions.length > 0) ? <MarginPositionsList
            positions={positions}
            isLoading={positionsPending}
            hasNextPage={positionsQuery.hasNextPage}
            isFetchingNextPage={positionsQuery.isFetchingNextPage}
            onFetchNextPage={() => void positionsQuery.fetchNextPage()}
            availableCredit={selectedAccount?.available_credit}
            onDetailOpenChange={setDetailOpen}
            onCreate={() => setMobileTab("CREATE")}
          /> : null}
        </div>

        <div className={`min-w-0 lg:col-span-5 lg:sticky lg:top-6 lg:self-start ${mobileTab === "CREATE" ? "" : "max-lg:hidden"}`}>
          <MarginCreateForm
            eligibility={eligibility}
            eligibilityPending={positionsPending && !positionsUnavailable}
            initialSymbol={paramSymbol}
            selectedAccountId={effectiveAccountId}
            onCreated={() => setMobileTab("POSITIONS")}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-app-gray-50 px-3 py-2.5">
      <p className="text-[12px] text-app-gray-500">{label}</p>
      <p className="numeric mt-0.5 break-all text-[16px] font-bold text-app-gray-900">
        {value}
        {unit && value !== "—" ? <span className="ml-1 text-[11px] font-medium text-app-gray-400">{unit}</span> : null}
      </p>
    </div>
  );
}

export default function MarginPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <MarginContent />
    </Suspense>
  );
}
