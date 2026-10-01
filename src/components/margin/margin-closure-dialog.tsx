"use client";

import { useExchangeInfo, slippageError } from "@/lib/exchange-info";
import { TradePolicy } from "@/components/exchange-policy";
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
import { fmtQuantity, isDecimalInput } from "@/lib/format";
import { MarginSimulationPreview } from "./margin-simulation-preview";
import {
  isMarginRiskAtOrBelow,
  marginErrorMessage,
  marginPartialFillText,
  marginSlippageFields,
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
  const [slippagePercent, setSlippagePercent] = useState("");
  const [referencePrice, setReferencePrice] = useState("");
  const closeMutation = useCloseMarginPosition(position?.position_id ?? "");

  if (!position) return null;

  const isLong = position.side === "LONG";
  const belowMaintenance = isMarginRiskAtOrBelow(
    position.risk_ratio_ppm,
    exchangeInfo?.margin.maintenance_ppm,
  );
  const payload = slippageError(slippagePercent, exchangeInfo?.trade)
    ? null
    : marginSlippageFields(slippagePercent, referencePrice);

  async function handleClose(e: React.FormEvent) {
    e.preventDefault();
    const invalidSlippage = slippageError(slippagePercent, exchangeInfo?.trade);
    if (invalidSlippage) { toast.error(invalidSlippage); return; }
    if (!position || !payload) return;
    try {
      const result = await closeMutation.mutateAsync(payload);
      // A 200 closure may settle only part of the position; the rest stays OPEN.
      if (result.status === "OPEN") {
        toast.warning("포지션을 일부만 종료했어요", {
          description: `${result.execution ? `${marginPartialFillText(result.execution)} · ` : ""}잔여 ${fmtQuantity(result.quantity)}주는 그대로 유지돼요.`,
        });
      } else {
        toast.success("포지션 전액 종료 정산이 완료되었어요");
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
          <DialogTitle>포지션 전액 종료 (전체 정산)</DialogTitle>
          <DialogDescription>
            남은 포지션 전체를 즉시 시장가로 청산 정산합니다. 슬리피지나 풀 재고 때문에 일부만 정산되면 남은 수량의 포지션은 유지됩니다.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleClose} className="space-y-4 pt-2">
          <TradePolicy />
          <div className="rounded-xl bg-app-gray-50 p-3 text-[13px] text-app-gray-600 space-y-1.5">
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <span>종목 및 방향</span>
              <span className="min-w-0 break-all font-semibold text-app-gray-900">
                {position.symbol} ({isLong ? "LONG 매수" : "SHORT 매도"}, {position.leverage}x)
              </span>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <span>남은 포지션 수량</span>
              <span className="numeric min-w-0 break-all font-semibold text-app-gray-900">
                {position.quantity} 주
              </span>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <span>대여 원금</span>
              <span className="numeric min-w-0 break-all font-semibold text-app-gray-900">
                {position.borrowed_credit} Credit
              </span>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <span>현재 부채 / 자기자본</span>
              <span className="numeric min-w-0 break-all font-semibold text-app-gray-900">
                부채 {position.debt_value} / 자본 {position.equity} Credit
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl bg-app-red-light p-3 text-[12px] text-app-red">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">정산 실행 방식</p>
              <p className="mt-0.5 leading-relaxed">
                {isLong
                  ? "LONG 포지션은 보유 중인 Share 전량을 본딩 곡선에 매도하여 차입 Credit과 미납 이자를 전액 상환하고, 정산 잔여금을 계좌로 돌려받습니다."
                  : "SHORT 포지션은 매도대금으로 Share 전량을 본딩 곡선에서 매수 상환하고, 정산 잔여금을 계좌로 돌려받습니다."}
              </p>
              {belowMaintenance ? (
                <p className="mt-1 leading-relaxed">
                  위험 비율이 유지 기준 이하라 거래 수수료의 5배가 적용됩니다. 직접 종료이므로 강제청산 스트라이크는 늘지 않습니다.
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              aria-expanded={showAdvanced}
              className="flex items-center gap-1 text-[12px] font-semibold text-app-gray-500 hover:text-app-gray-800"
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
              />
              고급 설정 (슬리피지 등)
            </button>
            {showAdvanced ? (
              <div className="mt-2 space-y-3 rounded-xl bg-app-gray-50 p-3">
                <div>
                  <label className="block text-[12px] text-app-gray-600">
                    허용 슬리피지 (%)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slippagePercent}
                    placeholder={exchangeInfo ? `기본값 (${exchangeInfo.trade.default_slippage_ppm / 10_000}%)` : "서버 기본값"}
                    onChange={(e) => setSlippagePercent(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-app-gray-200 bg-card px-2.5 py-1.5 text-base md:text-[13px] text-app-gray-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-app-gray-600">
                    슬리피지 기준 가격 (생략 시 현재 곡선가)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={referencePrice}
                    placeholder="0.00000000"
                    onChange={(e) => {
                      const val = e.target.value.replace(/,/g, "");
                      if (val === "" || isDecimalInput(val, 8)) {
                        setReferencePrice(val);
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-app-gray-200 bg-card px-2.5 py-1.5 text-base md:text-[13px] text-app-gray-900 focus:outline-none"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <MarginSimulationPreview
            path={`/api/v1/margin/positions/${position.position_id}/closure/simulation`}
            payload={payload}
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
              className="flex items-center justify-center gap-1.5 rounded-xl bg-app-red px-4 py-2.5 text-[14px] font-bold text-white hover:bg-red-600 disabled:bg-app-gray-200 disabled:text-app-gray-400"
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
