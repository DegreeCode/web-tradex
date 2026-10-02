"use client";

import { useState } from "react";
import { Copy, Plus, RefreshCw, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fmtCredit,
  fmtDateTime,
  fmtPercentFromPPM,
  fmtQuantity,
  shortId,
} from "@/lib/format";
import { ErrorBlock, LoadingBlock } from "@/components/primitives";
import { copyToClipboard } from "@/lib/clipboard";
import { useAccounts } from "@/lib/hooks";
import { ScopeNotice, useSessionAccess } from "@/components/session-access";
import { MarginCollateralDialog } from "./margin-collateral-dialog";
import { MarginReductionDialog } from "./margin-reduction-dialog";
import { MarginClosureDialog } from "./margin-closure-dialog";
import { MarginRiskBadge, MarginSideBadge, MarginStatusChip } from "./margin-status-chip";
import { MarginReturn } from "./margin-return";
import { marginRiskLevel, useMarginPosition, type MarginPosition } from "@/lib/margin";
import { useExchangeInfo } from "@/lib/exchange-info";

export function MarginPositionDetailDialog({
  positionId,
  open,
  onOpenChange,
  availableCredit,
}: {
  positionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableCredit?: string;
}) {
  const positionQuery = useMarginPosition(open ? positionId : null);
  const freshPosition = positionQuery.data;
  const position: MarginPosition | null = freshPosition ?? null;
  const accountsQuery = useAccounts();
  const { data: exchangeInfo } = useExchangeInfo();
  const positionAccount = (accountsQuery.data ?? []).find(
    (a) => a.account_id === position?.account_id
  );
  const effectiveCredit = positionAccount?.available_credit ?? availableCredit;

  const marginAccess = useSessionAccess("MARGIN");
  const [collateralOpen, setCollateralOpen] = useState(false);
  const [reductionOpen, setReductionOpen] = useState(false);
  const [closureOpen, setClosureOpen] = useState(false);

  if (!position) return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>마진 포지션 상세</DialogTitle></DialogHeader>
        {positionQuery.isError ? (
          <ErrorBlock message="포지션 상세를 불러오지 못했어요." onRetry={() => void positionQuery.refetch()} />
        ) : <LoadingBlock />}
      </DialogContent>
    </Dialog>
  );

  const isOpen = position.status === "OPEN";
  const riskLevel = marginRiskLevel(position.risk_ratio_ppm, exchangeInfo?.margin);
  // At or below maintenance the server accepts only a full closure.
  const reductionBlocked = riskLevel === "MAINTENANCE";

  function copyText(text: string, label: string) {
    void copyToClipboard(text, `${label} 복사했어요`);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <DialogTitle className="break-all text-[18px] font-bold text-app-gray-900">
                  {position.symbol}
                </DialogTitle>
                <MarginSideBadge side={position.side} />
                <span className="numeric min-w-0 break-all text-[13px] font-bold text-app-gray-600">
                  {position.leverage}x
                </span>
              </div>
              <MarginStatusChip status={position.status} />
            </div>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3 rounded-2xl bg-app-gray-50 p-3.5">
              <div className="flex min-w-0 flex-col text-[20px]">
                <span className="text-[12px] font-normal text-app-gray-500">추정 수익률</span>
                <MarginReturn position={position} />
              </div>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1 text-[12px] text-app-gray-500">
                  위험 비율 <MarginRiskBadge level={isOpen ? riskLevel : null} />
                </p>
                <p className={`numeric break-all text-[20px] font-bold ${
                  isOpen && (riskLevel === "WARNING" || riskLevel === "MAINTENANCE")
                    ? "text-app-red"
                    : "text-app-gray-900"
                }`}>
                  {position.risk_ratio_ppm !== null && isOpen
                    ? fmtPercentFromPPM(position.risk_ratio_ppm)
                    : "—"}
                </p>
              </div>
              <div className="col-span-2 text-[12px] leading-relaxed text-app-gray-500">
                <p>
                  수익률은 (현재 자기자본 − 추정 투자금) ÷ 추정 투자금 × 100이에요. 진입 수수료와 납부한 이자는 빠진 참고값이에요.
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer font-semibold text-app-gray-600">계산 기준 자세히</summary>
                  <p className="mt-1">
                    롱은 차입금·레버리지·남은 담보로 투자금을 추정하고, 숏은 담보금을 기준으로 해요.
                    자기자본에는 미납 이자와 청산 수수료가 반영돼요. 선납 이자 환불액도 반영하지 않아
                    실제 정산 수익률과 달라질 수 있어요. 보유 중이 아니거나 기준 금액이 없으면 표시하지 않아요.
                  </p>
                  {riskLevel && exchangeInfo ? (
                    <p className="mt-1">
                      위험 비율은 자기자본 ÷ 부채예요. {fmtPercentFromPPM(exchangeInfo.margin.warning_ppm)} 이하면 경고,{" "}
                      {fmtPercentFromPPM(exchangeInfo.margin.maintenance_ppm)} 이하가 {exchangeInfo.margin.liquidation_confirm_seconds}초
                      이어지면 강제청산돼요.
                    </p>
                  ) : null}
                </details>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5 px-1">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-app-gray-500">수량</p>
                <p className="numeric break-all mt-0.5 text-[15px] font-bold text-app-gray-900">
                  {fmtQuantity(position.quantity)}
                  <span className="ml-0.5 text-[11px] font-normal text-app-gray-500">주</span>
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-app-gray-500">격리 담보</p>
                <p className="numeric break-all mt-0.5 text-[15px] font-bold text-app-gray-900">
                  {fmtCredit(position.collateral, 4)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-app-gray-500">차입 원금</p>
                <p className="numeric break-all mt-0.5 text-[15px] font-bold text-app-gray-900">
                  {fmtCredit(position.borrowed_credit, 4)}
                </p>
              </div>
            </div>

            {/* Financial breakdown */}
            <div className="divide-y divide-app-gray-100 rounded-2xl border border-app-gray-200 px-4 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="text-app-gray-500">부채 평가액</span>
                <span className="numeric min-w-0 break-all font-semibold text-app-gray-900">
                  {fmtCredit(position.debt_value, 4)} Credit
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="text-app-gray-500">자기자본</span>
                <span className="numeric min-w-0 break-all font-semibold text-app-gray-900">
                  {fmtCredit(position.equity, 4)} Credit
                </span>
              </div>
              {position.locked_proceeds && position.locked_proceeds !== "0" ? (
                <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-app-gray-500">잠긴 매도 대금</span>
                  <span className="numeric min-w-0 break-all font-semibold text-app-gray-900">
                    {fmtCredit(position.locked_proceeds, 4)} Credit
                  </span>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="text-app-gray-500">선납 이자</span>
                <span className="numeric min-w-0 break-all text-app-gray-700">
                  {fmtCredit(position.prepaid_interest)} Credit
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="text-app-gray-500">미납 이자</span>
                <span className="numeric min-w-0 break-all text-app-gray-700">
                  {fmtCredit(position.unpaid_interest)} Credit
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="text-app-gray-500">환불 가능 선납이자</span>
                <span className="numeric min-w-0 break-all text-app-gray-700">
                  {fmtCredit(position.refundable_interest)} Credit
                </span>
              </div>
              {position.next_interest_at ? (
                <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-app-gray-500">다음 이자 기산 시각</span>
                  <span className="numeric min-w-0 break-all text-app-gray-700">
                    {fmtDateTime(position.next_interest_at)}
                  </span>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="text-app-gray-500">누적 실현손익</span>
                <span className="numeric min-w-0 break-all font-semibold text-app-gray-900">
                  {fmtCredit(position.realized_pnl, 4)} Credit
                </span>
              </div>
              {position.settled_payout && position.settled_payout !== "0" ? (
                <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-app-gray-500">정산 확정 지급액</span>
                  <span className="numeric min-w-0 break-all font-bold text-app-blue">
                    {fmtCredit(position.settled_payout, 4)} Credit
                  </span>
                </div>
              ) : null}
            </div>

            {/* Identifiers & Timestamps */}
            <div className="rounded-xl bg-app-gray-50 p-3 text-[12px] text-app-gray-500 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>포지션 ID</span>
                <button
                  type="button"
                  onClick={() => copyText(position.position_id, "포지션 ID가")}
                  aria-label="포지션 ID 복사"
                  className="inline-flex min-h-8 items-center gap-1 font-mono text-app-gray-700 hover:text-app-blue"
                >
                  {shortId(position.position_id)}
                  <Copy aria-hidden="true" className="size-3" />
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>계좌 ID</span>
                <button
                  type="button"
                  onClick={() => copyText(position.account_id, "계좌 ID가")}
                  aria-label="계좌 ID 복사"
                  className="inline-flex min-h-8 items-center gap-1 font-mono text-app-gray-700 hover:text-app-blue"
                >
                  {shortId(position.account_id)}
                  <Copy aria-hidden="true" className="size-3" />
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>개설 일시</span>
                <span className="numeric min-w-0 break-all text-app-gray-700">{fmtDateTime(position.created_at)}</span>
              </div>
              {position.closed_at ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>종료 일시</span>
                  <span className="numeric min-w-0 break-all text-app-gray-700">{fmtDateTime(position.closed_at)}</span>
                </div>
              ) : null}
            </div>

            {/* Action buttons (only when status is OPEN) */}
            {isOpen && !marginAccess.allowed ? <ScopeNotice reason={marginAccess.reason} /> : null}
            {isOpen && marginAccess.allowed ? (
              <div className="sticky -bottom-4 -mx-4 -mb-4 flex flex-wrap gap-2 border-t border-app-gray-100 bg-popover px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={() => setCollateralOpen(true)}
                  className="flex min-h-11 min-w-24 flex-1 items-center justify-center gap-1.5 rounded-xl border border-app-blue bg-app-blue-light py-2.5 text-[13px] font-bold text-app-blue-dark transition-opacity hover:opacity-80"
                >
                  <Plus aria-hidden="true" className="size-4" />
                  담보 추가
                </button>
                <button
                  type="button"
                  onClick={() => setReductionOpen(true)}
                  disabled={reductionBlocked}
                  title={reductionBlocked ? "유지 기준 이하에서는 전액 종료만 가능해요" : undefined}
                  className="flex min-h-11 min-w-24 flex-1 items-center justify-center gap-1.5 rounded-xl border border-app-gray-300 bg-card py-2.5 text-[13px] font-bold text-app-gray-800 hover:bg-app-gray-50 disabled:cursor-not-allowed disabled:bg-app-gray-100 disabled:text-app-gray-400"
                >
                  <RefreshCw aria-hidden="true" className="size-4" />
                  부분 정산
                </button>
                <button
                  type="button"
                  onClick={() => setClosureOpen(true)}
                  className="flex min-h-11 min-w-24 flex-1 items-center justify-center gap-1.5 rounded-xl bg-app-red py-2.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
                >
                  <XCircle aria-hidden="true" className="size-4" />
                  전액 종료
                </button>
                {reductionBlocked ? (
                  <p role="status" className="w-full text-[12px] leading-relaxed text-app-red">
                    위험 비율이 유지 기준 이하예요. 강제청산 전에 담보를 추가하거나 전액 종료할 수 있어요(수수료 5배).
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <MarginCollateralDialog
        position={position}
        open={collateralOpen}
        onOpenChange={setCollateralOpen}
        availableCredit={effectiveCredit}
      />

      <MarginReductionDialog
        key={position?.position_id}
        position={position}
        open={reductionOpen}
        onOpenChange={setReductionOpen}
      />

      <MarginClosureDialog
        key={position?.position_id}
        position={position}
        open={closureOpen}
        onOpenChange={setClosureOpen}
      />
    </>
  );
}
