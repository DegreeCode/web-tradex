"use client";

import { useId } from "react";

import { InfoTip } from "@/components/info-tip";
import { useExchangeInfo } from "@/lib/exchange-info";
import { fmtPercentFromPPM, isDecimalInput } from "@/lib/format";

/** Allowed slippage and its reference price, shared by spot and margin trades. */
export function SlippageFields({
  slippage,
  onSlippageChange,
  referencePrice,
  onReferencePriceChange,
}: {
  slippage: string;
  onSlippageChange: (value: string) => void;
  referencePrice: string;
  onReferencePriceChange: (value: string) => void;
}) {
  const { data: exchangeInfo } = useExchangeInfo();
  const trade = exchangeInfo?.trade;
  const id = useId();
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-0.5">
          <label htmlFor={`${id}-slippage`} className="text-[13px] font-semibold text-app-gray-500">
            허용 슬리피지
          </label>
          <InfoTip label="허용 슬리피지">
            체결 평균가가 기준가보다 이 비율 넘게 불리해지지 않게 막아요. 범위를 넘는 만큼은 체결되지 않아 일부만
            체결될 수 있어요.
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
            value={slippage}
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-0.5">
          <label htmlFor={`${id}-reference`} className="text-[13px] font-semibold text-app-gray-500">
            기준가 (선택)
          </label>
          <InfoTip label="기준가">
            슬리피지를 계산하는 기준 가격이에요. 비워두면 주문을 처리하는 시점의 현재가를 써요. 보고 있던 가격을
            넣으면 그 뒤로 움직인 가격까지 슬리피지로 계산돼요.
          </InfoTip>
        </div>
        <input
          id={`${id}-reference`}
          type="text"
          inputMode="decimal"
          value={referencePrice}
          placeholder="현재가"
          onChange={(event) => {
            const next = event.target.value.replace(/,/g, "");
            if (next === "" || isDecimalInput(next, 8)) onReferencePriceChange(next);
          }}
          className="numeric w-28 bg-transparent text-right text-base md:text-[14px] font-semibold text-app-gray-900 outline-none placeholder:text-app-gray-300"
        />
      </div>
    </>
  );
}
