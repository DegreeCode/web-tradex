"use client";

import { useExchangeInfo } from "@/lib/exchange-info";
import { fmtPercentFromPPM } from "@/lib/format";

export function ExchangeInfoNotice() {
  const query = useExchangeInfo();
  if (!query.isError && query.data) return null;
  return (
    <p
      className="text-[12px] text-app-gray-500"
      role={query.isError ? "status" : undefined}
    >
      {query.isError
        ? query.data
          ? "설정을 갱신하지 못해 마지막 확인한 값을 표시하고 있어요."
          : "거래소 설정을 불러오지 못했어요."
        : "거래소 설정을 불러오는 중이에요…"}
      {query.isError && (
        <button
          type="button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
          className="ml-2 font-semibold text-app-blue"
        >
          다시 시도
        </button>
      )}
    </p>
  );
}

export function TradePolicy() {
  const { data } = useExchangeInfo();
  return (
    <div className="space-y-1 text-[12px] leading-5 text-app-gray-500">
      {data && (
        <p>
          거래 수수료 {fmtPercentFromPPM(data.trade.fee_ppm, 4)} · 기본 슬리피지{" "}
          {fmtPercentFromPPM(data.trade.default_slippage_ppm, 4)} · 최대{" "}
          {fmtPercentFromPPM(data.trade.max_slippage_ppm, 4)}
        </p>
      )}
      <ExchangeInfoNotice />
    </div>
  );
}

export function MarginInterestPolicy() {
  const { data } = useExchangeInfo();
  if (!data) return null;
  const policy = data.margin;
  return (
    <div className="mt-3 space-y-1 rounded-lg bg-app-gray-50 p-3 text-[12px] leading-5 text-app-gray-600">
      <p>
        신규 포지션 일 이율 {fmtPercentFromPPM(policy.daily_interest_ppm, 4)} ·
        이자 주기 {policy.interest_period_seconds / 3600}시간
      </p>
      <p>
        위험 비율 경고 기준 {fmtPercentFromPPM(policy.warning_ppm)} · 유지 기준{" "}
        {fmtPercentFromPPM(policy.maintenance_ppm)} 이하가{" "}
        {policy.liquidation_confirm_seconds}초 이상 이어지면 강제청산돼요. 그 전에는
        거래 수수료 5배로 직접 전액 종료할 수 있어요.
      </p>
      {policy.interest_collection === "PREPAID_AT_OPEN_AND_EVERY_24H" && (
        <p>포지션 개설 시와 매 이자 주기마다 선납해요.</p>
      )}
      {policy.interest_rate_scope === "POSITION_OPEN_SNAPSHOT" && (
        <p>
          개설 시점의 이율이 포지션에 고정되며, 이후 설정 변경은 기존 포지션에
          적용되지 않아요.
        </p>
      )}
      {policy.long_interest_basis === "BORROWED_CREDIT" && (
        <p>롱 이자 기준: 차입 Credit</p>
      )}
      {policy.short_interest_basis === "CURVE_BUY_COST_AT_PERIOD_START" && (
        <p>숏 이자 기준: 각 이자 주기 시작 시점의 곡선 매수 비용</p>
      )}
    </div>
  );
}
