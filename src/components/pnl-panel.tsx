"use client";

import { useState } from "react";
import { ApiError, errorMessage } from "@/lib/api";
import { compareDecimal, fmtDateTime, fmtSigned, shortId } from "@/lib/format";
import { usePnL } from "@/lib/advanced-order-hooks";
import { pnlSourceLabel, type PnLMarket } from "@/lib/pnl";
import {
  EmptyState,
  ErrorBlock,
  LoadMoreButton,
  SectionHeader,
  SkeletonRows,
} from "./primitives";
import { Segmented } from "./segmented";

export function PnLPanel({
  accountId,
  accountName,
}: {
  accountId?: string;
  accountName: (id: string) => string;
}) {
  const [market, setMarket] = useState<PnLMarket>("ALL");
  const [symbolInput, setSymbolInput] = useState("");
  const [symbol, setSymbol] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [asOf, setAsOf] = useState<string | undefined>();
  const filters = {
    account_id: accountId,
    symbol: symbol || undefined,
    market_type: market,
    as_of: asOf,
  };
  const query = usePnL(filters);
  const summary = query.data?.pages[0]?.summary;
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];
  const error = query.error ?? query.data?.pages[0]?.historyError;
  const availableFrom =
    error instanceof ApiError &&
    error.code === "PNL_HISTORY_UNAVAILABLE" &&
    typeof error.details?.available_from === "string"
      ? error.details.available_from
      : null;
  const unavailable = error instanceof ApiError && error.status === 404;
  return (
    <section className="xl:col-span-6 space-y-3">
      <SectionHeader
        title="실현 손익"
        description="조회 범위의 누적 손익과 정산 내역"
      />
      <Segmented<PnLMarket>
        value={market}
        onChange={setMarket}
        options={[
          { value: "ALL", label: "전체" },
          { value: "SPOT", label: "현물" },
          { value: "MARGIN", label: "마진" },
        ]}
      />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSymbol(symbolInput.trim().toUpperCase());
          setAsOf(dateInput ? new Date(dateInput).toISOString() : undefined);
        }}
      >
        <input
          aria-label="손익 종목"
          placeholder="종목 (전체)"
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          className="min-w-0 flex-1 rounded-xl bg-card p-3 text-sm"
        />
        <input
          aria-label="손익 기준 시각"
          type="datetime-local"
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
          className="min-w-0 max-w-full rounded-xl bg-card p-3 text-sm"
        />
        <button
          type="submit"
          className="rounded-xl bg-app-gray-100 px-4 text-sm font-semibold"
        >
          조회
        </button>
      </form>
      {query.isLoading ? (
        <SkeletonRows rows={2} />
      ) : summary ? (
        <div className="rounded-2xl bg-card p-4 shadow-card space-y-2">
          <p className="text-sm text-app-gray-500">
            누적 실현 손익 · {summary.entry_count}건
          </p>
          <p className="numeric break-all text-xl font-bold">
            {fmtSigned(summary.realized_pnl, 2)} Credit
          </p>
          <p className="numeric break-all text-xs text-app-gray-500">
            현물 {fmtSigned(summary.spot_realized_pnl, 2)} · 마진{" "}
            {fmtSigned(summary.margin_realized_pnl, 2)}
          </p>
          <p className="text-xs text-app-gray-400">
            {fmtDateTime(summary.as_of)} 기준 · 전체 계좌 조회에는 삭제된 계좌도
            포함돼요.
          </p>
        </div>
      ) : null}
      {error ? (
        <ErrorBlock
          message={
            unavailable
              ? "서버에서 통합 손익 조회를 아직 지원하지 않아요"
              : errorMessage(error)
          }
          onRetry={() => {
            void query.refetch({ cancelRefetch: false });
          }}
        />
      ) : null}
      {availableFrom ? (
        <div className="text-xs text-app-gray-500">
          조회 가능한 최초 시각: {fmtDateTime(availableFrom)}{" "}
          <button
            type="button"
            onClick={() => {
              setDateInput("");
              setAsOf(availableFrom);
            }}
            className="ml-2 font-semibold text-app-blue"
          >
            이 시점으로 조회
          </button>
        </div>
      ) : null}
      {summary && !error && rows.length === 0 ? (
        <EmptyState title="실현 손익 내역이 없어요" />
      ) : null}
      <div className="divide-y divide-app-gray-100 rounded-2xl bg-card px-4 shadow-card">
        {rows.map((row, index) => (
          <div
            key={`${row.account_id}-${row.instrument_id}-${row.source_type}-${row.source_id}-${row.at}-${index}`}
            className="flex flex-wrap justify-between gap-2 py-3"
          >
            <div className="min-w-0">
              <p className="break-all text-sm font-semibold">
                {row.symbol} · {row.market_type === "SPOT" ? "현물" : "마진"}
              </p>
              <p className="text-xs text-app-gray-500">
                {accountName(row.account_id)} · {pnlSourceLabel(row)} · 상장{" "}
                {row.listing_sequence}회차
              </p>
              <p className="text-xs text-app-gray-400">
                {fmtDateTime(row.at)}
                {row.position_id ? ` · ${shortId(row.position_id)}` : ""}
              </p>
            </div>
            <p
              className={`numeric break-all text-sm font-bold ${compareDecimal(row.realized_pnl, "0") >= 0 ? "text-app-red" : "text-app-blue"}`}
            >
              {fmtSigned(row.realized_pnl, 2)}
            </p>
          </div>
        ))}
      </div>
      <LoadMoreButton
        hasMore={query.hasNextPage}
        loading={query.isFetching}
        onLoad={() => void query.fetchNextPage({ cancelRefetch: false })}
      />
    </section>
  );
}
