"use client";

import { useId } from "react";

import { InfoTip } from "@/components/info-tip";
import { Segmented } from "@/components/segmented";
import { useExchangeInfo } from "@/lib/exchange-info";
import { compareDecimal, fmtPercentFromPPM, fmtPrice, isDecimalInput, isPositiveDecimal } from "@/lib/format";
import { limitPriceLabel, type SlippageMode, type SlippageSettings, type TradeSide } from "@/lib/slippage";

/** Allowed slippage or a limit price, shared by spot and margin trades. */
export function SlippageFields({
  side,
  settings,
  onModeChange,
  onSlippageChange,
  onLimitPriceChange,
  currentPrice,
  trigger = false,
}: {
  /** Direction of the fill: a buy takes a cap, a sell takes a floor. */
  side: TradeSide;
  settings: SlippageSettings;
  onModeChange: (mode: SlippageMode) => void;
  onSlippageChange: (value: string) => void;
  onLimitPriceChange: (value: string) => void;
  /** Hints when the limit price already sits past the current price. */
  currentPrice?: string;
  /** Trigger orders measure slippage from the target price, not the current one. */
  trigger?: boolean;
}) {
  const { data: exchangeInfo } = useExchangeInfo();
  const trade = exchangeInfo?.trade;
  const id = useId();
  const limitLabel = limitPriceLabel(side);
  const limitPrice = settings.limitPrice.trim();
  const unreachable =
    currentPrice &&
    isPositiveDecimal(currentPrice) &&
    isDecimalInput(limitPrice, 8) &&
    isPositiveDecimal(limitPrice) &&
    compareDecimal(limitPrice, currentPrice) * (side === "BUY" ? 1 : -1) < 0;
  return (
    <>
      <Segmented<SlippageMode>
        value={settings.mode}
        onChange={onModeChange}
        options={[
          { value: "SLIPPAGE", label: "슬리피지" },
          { value: "PRICE_LIMIT", label: side === "BUY" ? "상한가" : "하한가" },
        ]}
      />
      {settings.mode === "SLIPPAGE" ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-0.5">
            <label htmlFor={`${id}-slippage`} className="text-[13px] font-semibold text-app-gray-500">
              허용 슬리피지
            </label>
            <InfoTip label="허용 슬리피지">
              {trigger
                ? "목표 가격보다 이 비율 넘게 불리한 가격까지는 체결하지 않아요."
                : "주문할 때 보고 있던 현재가보다 이 비율 넘게 불리한 가격까지는 체결하지 않아요."}{" "}
              범위를 넘는 만큼은 체결되지 않아 일부만 체결될 수 있어요.
              {trade
                ? ` 비워두면 기본 ${fmtPercentFromPPM(trade.default_slippage_ppm, 4)}, 최대 ${fmtPercentFromPPM(trade.max_slippage_ppm, 4)}까지 입력할 수 있어요.`
                : " 비워두면 서버 기본값을 써요."}
            </InfoTip>
          </div>
          <div className="flex items-baseline gap-1">
            <input
              id={`${id}-slippage`}
              type="text"
              inputMode="decimal"
              value={settings.slippage}
              placeholder={trade ? `기본 ${trade.default_slippage_ppm / 10_000}` : "서버 기본값"}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "" || isDecimalInput(next, 4)) onSlippageChange(next);
              }}
              className="numeric w-20 bg-transparent text-right text-base md:text-[15px] font-bold text-app-gray-900 outline-none placeholder:text-app-gray-300"
            />
            <span className="text-[12px] font-semibold text-app-gray-400">%</span>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-0.5">
              <label htmlFor={`${id}-limit`} className="text-[13px] font-semibold text-app-gray-500">
                {limitLabel}
              </label>
              <InfoTip label={limitLabel}>
                {side === "BUY"
                  ? "가격이 이 값까지 오르는 동안만 체결하고, 넘어서는 만큼은 체결하지 않아요."
                  : "가격이 이 값까지 내려가는 동안만 체결하고, 밑도는 만큼은 체결하지 않아요."}{" "}
                그래서 일부만 체결될 수 있어요.
              </InfoTip>
            </div>
            <div className="flex items-baseline gap-1">
              <input
                id={`${id}-limit`}
                type="text"
                inputMode="decimal"
                value={settings.limitPrice}
                placeholder={currentPrice ? fmtPrice(currentPrice) : "가격"}
                onChange={(event) => {
                  const next = event.target.value.replace(/,/g, "");
                  if (next === "" || isDecimalInput(next, 8)) onLimitPriceChange(next);
                }}
                className="numeric w-28 bg-transparent text-right text-base md:text-[15px] font-bold text-app-gray-900 outline-none placeholder:text-app-gray-300"
              />
              <span className="text-[12px] font-semibold text-app-gray-400">Credit</span>
            </div>
          </div>
          {unreachable ? (
            <p role="status" className="mt-1 text-right text-[12px] text-app-red">
              현재가보다 {side === "BUY" ? "낮아서" : "높아서"} 지금은 체결되지 않아요
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
