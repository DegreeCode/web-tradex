"use client";

import { useExchangeInfo } from "@/lib/exchange-info";
import { TradePolicy } from "@/components/exchange-policy";
import { SlippageFields } from "@/components/slippage-fields";
import { useInstrument } from "@/lib/hooks";
import {
  liveReferencePrice,
  slippageRequestFields,
  slippageSettingsError,
  useSlippageSettings,
} from "@/lib/slippage";
import { useId, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  compareDecimal,
  fmtCredit,
  fmtQuantity,
  isDecimalInput,
  scaleDecimal,
} from "@/lib/format";
import { MarginSimulationPreview } from "./margin-simulation-preview";
import {
  isMarginRiskAtOrBelow,
  marginErrorMessage,
  marginPartialFillText,
  useReduceMarginPosition,
  validateReductionQuantity,
  type MarginPosition,
} from "@/lib/margin";

export function MarginReductionDialog({
  position,
  open,
  onOpenChange,
}: {
  position: MarginPosition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [quantity, setQuantity] = useState("");
  const inputId = useId();
  const { data: exchangeInfo } = useExchangeInfo();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { settings: slippageSettings, setMode: setSlippageMode, setSlippage, setLimitPrice } = useSlippageSettings();
  const curvePrice = useInstrument(position?.symbol).data?.curve_spot_price;
  const reduceMutation = useReduceMarginPosition(position?.position_id ?? "");

  if (!position) return null;

  const errorText = validateReductionQuantity(quantity, position.quantity);
  // At or below maintenance the server accepts only a full closure.
  const belowMaintenance = isMarginRiskAtOrBelow(
    position.risk_ratio_ppm,
    exchangeInfo?.margin.maintenance_ppm,
  );
  // Exiting a Long sells and exiting a Short buys back.
  const exitSide = position.side === "LONG" ? "SELL" : "BUY";
  const referencePrice = liveReferencePrice(slippageSettings, curvePrice);
  const isValid = !errorText && !belowMaintenance;
  const payload = isValid && !slippageSettingsError(slippageSettings, exitSide, exchangeInfo?.trade)
    ? { quantity: quantity.trim(), ...slippageRequestFields(slippageSettings) }
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const invalidSlippage = slippageSettingsError(slippageSettings, exitSide, exchangeInfo?.trade);
    if (invalidSlippage) { toast.error(invalidSlippage); return; }
    if (!payload || !position) return;
    try {
      const result = await reduceMutation.mutateAsync(
        referencePrice ? { ...payload, slippage_reference_price: referencePrice } : payload,
      );
      if (result.execution?.partially_filled) {
        toast.warning("요청 수량 중 일부만 정산했어요", {
          description: `${marginPartialFillText(result.execution)}. 나머지는 자동으로 다시 주문되지 않아요.`,
        });
      } else {
        toast.success("포지션 일부를 정산했어요");
      }
      setQuantity("");
      onOpenChange(false);
    } catch (err) {
      toast.error(marginErrorMessage(err));
    }
  }

  function handleQuickFraction(fraction: number) {
    if (!position) return;
    const scaled = scaleDecimal(position.quantity, fraction, 8);
    setQuantity(scaled);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>포지션 부분 정산</DialogTitle>
          <DialogDescription>
            수량 일부를 정산해 담보와 빌린 원금을 비율대로 돌려받아요. 밀린 이자부터 먼저 갚아요.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {belowMaintenance ? (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-app-red-light p-3 text-[12px] text-app-red">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                위험 비율이 유지 기준 이하라 부분 정산을 할 수 없어요. 강제청산 전에 담보를 추가하거나 전액 종료해주세요.
              </p>
            </div>
          ) : null}
          <TradePolicy />
          <div className="rounded-xl bg-app-gray-50 p-3 text-[13px] text-app-gray-600 space-y-1">
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <span>종목</span>
              <span className="min-w-0 break-all font-semibold text-app-gray-900">{position.symbol}</span>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <span>현재 보유 수량</span>
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
          </div>

          <div>
            <label htmlFor={inputId} className="block text-[13px] font-medium text-app-gray-700">
              정산할 수량 (소수점 8자리까지)
            </label>
            <div className="relative mt-1.5">
              <input
                id={inputId}
                type="text"
                inputMode="decimal"
                value={quantity}
                placeholder="0"
                aria-invalid={Boolean(quantity && errorText)}
                onChange={(e) => {
                  const val = e.target.value.replace(/,/g, "");
                  if (val === "" || isDecimalInput(val, 8)) {
                    setQuantity(val);
                  }
                }}
                className="w-full rounded-xl border border-app-gray-200 pl-3.5 pr-16 py-2.5 text-base md:text-[15px] font-semibold text-app-gray-900 placeholder:text-app-gray-400 focus:border-app-blue focus:outline-none"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] font-medium text-app-gray-500">
                주
              </span>
            </div>
            {quantity && errorText ? (
              <p className="mt-1 text-[12px] font-medium text-app-red">{errorText}</p>
            ) : null}
          </div>

          <div className="flex gap-2">
            {[
              { label: "25%", frac: 0.25 },
              { label: "50%", frac: 0.5 },
              { label: "75%", frac: 0.75 },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => handleQuickFraction(item.frac)}
                aria-pressed={Boolean(quantity) && compareDecimal(quantity, scaleDecimal(position.quantity, item.frac, 8)) === 0}
                className="min-h-11 flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-app-blue border border-app-gray-200 aria-pressed:border-app-blue aria-pressed:bg-app-blue-light aria-pressed:text-app-blue py-1.5 text-[12px] font-semibold text-app-gray-600 hover:bg-app-gray-50"
              >
                {item.label}
              </button>
            ))}
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
              <div className="mt-2 space-y-2.5 rounded-xl bg-app-gray-50 p-3">
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
            path={`/api/v1/margin/positions/${position.position_id}/reductions/simulation`}
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
              disabled={!isValid || reduceMutation.isPending}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-app-blue px-4 py-2.5 text-[14px] font-bold text-white hover:bg-app-blue-hover disabled:bg-app-gray-200 disabled:text-app-gray-400"
            >
              {reduceMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              부분 정산하기
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
