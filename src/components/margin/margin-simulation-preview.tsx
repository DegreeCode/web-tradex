"use client";

import { fmtCredit, fmtPercentFromPPM, fmtPrice, fmtQuantity, fmtSigned } from "@/lib/format";
import { marginErrorMessage, useMarginSimulation } from "@/lib/margin";

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-[13px] text-app-gray-500">{label}</span>
      <span className="numeric min-w-0 break-all text-right text-[13px] font-semibold text-app-gray-900">{value}</span>
    </div>
  );
}

/** Explicit read-only preview for margin entry, reduction, and closure. */
export function MarginSimulationPreview({
  path,
  payload,
}: {
  path: string;
  payload: object | null;
}) {
  const simulation = useMarginSimulation(payload ? path : null, payload);
  const quote = simulation.data;
  return (
    <div className="space-y-2 rounded-xl border border-app-gray-200 p-3 text-[13px]">
      <button
        type="button"
        disabled={!payload || simulation.isFetching}
        onClick={() => void simulation.refetch()}
        className="font-semibold text-app-blue disabled:opacity-40"
      >
        {simulation.isFetching ? "예상 결과 계산 중…" : "예상 결과 확인"}
      </button>
      {simulation.isError ? (
        <p role="status" className="text-app-red">
          {marginErrorMessage(simulation.error)}
        </p>
      ) : quote && !simulation.isFetching ? (
        <div className="space-y-2" aria-label="마진 예상 결과">
          <ResultRow label="예상 체결 수량" value={`${fmtQuantity(quote.quantity)}주`} />
          <ResultRow label="예상 평균가" value={`${fmtPrice(quote.average_price)} Credit`} />
          <ResultRow label="예상 수수료" value={`${fmtCredit(quote.fee)} Credit`} />
          {quote.action === "OPEN" ? (
            <>
              <ResultRow label="선납 이자" value={`${fmtCredit(quote.interest_prepaid)} Credit`} />
              <ResultRow label="예상 총 차감액" value={`${fmtCredit(quote.total_debit)} Credit`} />
            </>
          ) : (
            <>
              <ResultRow label="이자 정산" value={`${fmtCredit(quote.interest_paid)} Credit`} />
              {quote.interest_refund !== "0" ? (
                <ResultRow label="선납 이자 환급" value={`${fmtCredit(quote.interest_refund)} Credit`} />
              ) : null}
              <ResultRow label="실현손익" value={`${fmtSigned(quote.realized_pnl)} Credit`} />
              <ResultRow label="예상 반환액" value={`${fmtCredit(quote.net_proceeds)} Credit`} />
            </>
          )}
          {quote.action !== "CLOSE" ? (
            <ResultRow
              label={quote.action === "OPEN" ? "진입 후 위험 비율" : "정산 후 위험 비율"}
              value={quote.risk_ratio_ppm_after !== null ? fmtPercentFromPPM(quote.risk_ratio_ppm_after) : "-"}
            />
          ) : null}
          <ResultRow label="거래 후 커브 가격" value={`${fmtPrice(quote.curve_price_after)} Credit`} />
          <p className="text-[12px] text-app-gray-500">
            현재 시점의 예상 결과예요. 실제 실행 시 가격·잔고·유동성을 다시 확인해요.
          </p>
        </div>
      ) : null}
    </div>
  );
}
