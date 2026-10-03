"use client";

import { useExchangeInfo } from "@/lib/exchange-info";
import { TradePolicy } from "@/components/exchange-policy";
import { SlippageFields } from "@/components/slippage-fields";
import { useInstrument } from "@/lib/hooks";
import { noteSelfAction } from "@/lib/live-notifications";
import {
  liveReferencePrice,
  slippageRequestFields,
  slippageSettingsError,
  useSlippageSettings,
} from "@/lib/slippage";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtCredit, fmtQuantity } from "@/lib/format";
import { MarginSimulationPreview } from "./margin-simulation-preview";
import {
  isMarginRiskAtOrBelow,
  marginErrorMessage,
  marginPartialFillText,
  useCloseMarginPosition,
  type MarginPosition,
} from "@/lib/margin";

export function MarginClosureDialog({
  position,
  open,
  onOpenChange,
}: {
  position: MarginPosition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: exchangeInfo } = useExchangeInfo();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { settings: slippageSettings, setMode: setSlippageMode, setSlippage, setLimitPrice } = useSlippageSettings();
  const curvePrice = useInstrument(position?.symbol).data?.curve_spot_price;
  const closeMutation = useCloseMarginPosition(position?.position_id ?? "");

  if (!position) return null;

  const isLong = position.side === "LONG";
  const belowMaintenance = isMarginRiskAtOrBelow(
    position.risk_ratio_ppm,
    exchangeInfo?.margin.maintenance_ppm,
  );
  // Exiting a Long sells and exiting a Short buys back.
  const exitSide = position.side === "LONG" ? "SELL" : "BUY";
  const referencePrice = liveReferencePrice(slippageSettings, curvePrice);
  const payload = slippageSettingsError(slippageSettings, exitSide, exchangeInfo?.trade)
    ? null
    : slippageRequestFields(slippageSettings);

  async function handleClose(e: React.FormEvent) {
    e.preventDefault();
    const invalidSlippage = slippageSettingsError(slippageSettings, exitSide, exchangeInfo?.trade);
    if (invalidSlippage) { toast.error(invalidSlippage); return; }
    if (!position || !payload) return;
    noteSelfAction("TRADE_EXECUTED", position.symbol);
    try {
      const result = await closeMutation.mutateAsync(
        referencePrice ? { ...payload, slippage_reference_price: referencePrice } : payload,
      );
      // A 200 closure may settle only part of the position; the rest stays OPEN.
      if (result.status === "OPEN") {
        toast.warning("포지션을 일부만 종료했어요", {
          description: `${result.execution ? `${marginPartialFillText(result.execution)} · ` : ""}잔여 ${fmtQuantity(result.quantity)}주는 그대로 유지돼요.`,
        });
      } else {
        toast.success("포지션을 모두 정산했어요");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(marginErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>포지션 전액 종료</DialogTitle>
          <DialogDescription>
            남은 수량 전체를 지금 시장가로 정산해요. 슬리피지나 풀 재고 때문에 일부만 정산되면 남은 수량은 포지션으로 유지돼요.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleClose} className="space-y-4 pt-2">
          <TradePolicy />
          <div className="rounded-xl bg-app-gray-50 p-3 text-[13px] text-app-gray-600 space-y-1.5">
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <span>종목 및 방향</span>
              <span className="min-w-0 break-all font-semibold text-app-gray-900">
                {position.symbol} · {isLong ? "롱" : "숏"} {position.leverage}x
              </span>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <span>남은 포지션 수량</span>
              <span className="numeric min-w-0 break-all font-semibold text-app-gray-900">
                {fmtQuantity(position.quantity)}주
              </span>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <span>빌린 원금</span>
              <span className="numeric min-w-0 break-all font-semibold text-app-gray-900">
                {fmtCredit(position.borrowed_credit, 4)} Credit
              </span>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <span>현재 부채 / 자기자본</span>
              <span className="numeric min-w-0 break-all font-semibold text-app-gray-900">
                부채 {fmtCredit(position.debt_value, 4)} / 자본 {fmtCredit(position.equity, 4)} Credit
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl bg-app-red-light p-3 text-[12px] text-app-red">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">정산 실행 방식</p>
              <p className="mt-0.5 leading-relaxed">
                {isLong
                  ? "롱 포지션은 보유 주식 전량을 본딩 커브에 팔아 빌린 Credit과 밀린 이자를 갚고, 남은 금액을 계좌로 돌려받아요."
                  : "숏 포지션은 매도 대금으로 빌린 주식 전량을 본딩 커브에서 사서 갚고, 남은 금액을 계좌로 돌려받아요."}
              </p>
              {belowMaintenance ? (
                <p className="mt-1 leading-relaxed">
                  위험 비율이 유지 기준 이하라 거래 수수료의 5배가 적용돼요. 직접 종료라서 강제청산 횟수에는 포함되지 않아요.
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              aria-expanded={showAdvanced}
              className="flex min-h-9 items-center gap-1 text-[12px] font-semibold text-app-gray-500 hover:text-app-gray-800"
            >
              <ChevronDown
                aria-hidden="true"
                className={`size-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
              />
              고급 설정 (슬리피지·{exitSide === "BUY" ? "상한가" : "하한가"})
            </button>
            {showAdvanced ? (
              <div className="mt-2 animate-reveal space-y-2.5 rounded-xl bg-app-gray-50 p-3">
                <SlippageFields
                  side={exitSide}
                  settings={slippageSettings}
                  onModeChange={setSlippageMode}
                  onSlippageChange={setSlippage}
                  onLimitPriceChange={setLimitPrice}
                  currentPrice={curvePrice}
                />
              </div>
            ) : null}
          </div>

          <MarginSimulationPreview
            path={`/api/v1/margin/positions/${position.position_id}/closure/simulation`}
            payload={payload}
            referencePrice={referencePrice}
          />

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl border border-app-gray-200 px-4 py-2.5 text-[14px] font-semibold text-app-gray-700 hover:bg-app-gray-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={closeMutation.isPending}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-app-red px-4 py-2.5 text-[14px] font-bold text-white hover:opacity-90 disabled:bg-app-gray-200 disabled:text-app-gray-400"
            >
              {closeMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              포지션 전액 종료하기
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
