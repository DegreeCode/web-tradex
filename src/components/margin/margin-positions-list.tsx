"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Layers } from "lucide-react";
import {
  EmptyState,
  LoadMoreButton,
  SectionHeader,
  SkeletonRows,
  Surface,
} from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import {
  fmtCredit,
  fmtPercentFromPPM,
  fmtQuantity,
} from "@/lib/format";
import { MarginPositionDetailDialog } from "./margin-position-detail-dialog";
import { MarginReturn } from "./margin-return";
import { MarginRiskBadge, MarginSideBadge, MarginStatusChip } from "./margin-status-chip";
import { isActiveMarginPosition, marginRiskLevel, type MarginPosition } from "@/lib/margin";
import { useExchangeInfo } from "@/lib/exchange-info";

type FilterStatus = "ALL" | "OPEN" | "CLOSED";

export function MarginPositionsList({
  positions,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onFetchNextPage,
  availableCredit,
  onDetailOpenChange,
  onCreate,
}: {
  positions: MarginPosition[];
  isLoading: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onFetchNextPage?: () => void;
  availableCredit?: string;
  onDetailOpenChange?: (open: boolean) => void;
  onCreate?: () => void;
}) {
  const { data: exchangeInfo } = useExchangeInfo();
  const [filter, setFilter] = useState<FilterStatus>("ALL");
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const filteredPositions = useMemo(() => {
    if (filter === "ALL") return positions;
    const active = filter === "OPEN";
    return positions.filter((position) => isActiveMarginPosition(position.status) === active);
  }, [positions, filter]);

  function handleDetailOpenChange(open: boolean) {
    setDetailOpen(open);
    onDetailOpenChange?.(open);
  }

  function handleSelectPosition(positionId: string) {
    setSelectedPositionId(positionId);
    handleDetailOpenChange(true);
  }

  return (
    <div className="space-y-3">
      <SectionHeader
        title="내 포지션"
        action={
          <Segmented
            value={filter}
            onChange={(val) => setFilter(val as FilterStatus)}
            options={[
              { value: "ALL", label: "전체" },
              { value: "OPEN", label: "보유중" },
              { value: "CLOSED", label: "종료" },
            ]}
            className="w-full sm:w-auto"
          />
        }
      />

      {isLoading && positions.length === 0 ? (
        <SkeletonRows rows={4} />
      ) : filteredPositions.length === 0 ? (
        <Surface>
          <EmptyState
            icon={<Layers className="size-8" />}
            title={
              filter === "OPEN"
                ? "보유 중인 마진 포지션이 없어요"
                : "마진 포지션 내역이 없어요"
            }
            description={
              hasNextPage && filter !== "ALL"
                ? "이전 포지션을 더 불러와 확인해보세요."
                : "새 포지션을 열어 레버리지 거래를 시작해보세요."
            }
          />
          {onCreate ? (
            <button
              type="button"
              onClick={onCreate}
              className="mx-auto mt-1 block min-h-11 rounded-xl bg-app-blue px-4 text-[14px] font-bold text-white lg:hidden"
            >
              새 포지션 열기
            </button>
          ) : null}
        </Surface>
      ) : (
        <div className="space-y-2.5">
          {filteredPositions.map((pos) => {
            const riskLevel = pos.status === "OPEN"
              ? marginRiskLevel(pos.risk_ratio_ppm, exchangeInfo?.margin)
              : null;
            const isHighRisk = riskLevel === "WARNING" || riskLevel === "MAINTENANCE";
            return (
              <Surface
                key={pos.position_id}
                className="min-w-0 cursor-pointer p-4 transition-shadow hover:shadow-md"
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`${pos.symbol} 포지션 상세`}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSelectPosition(pos.position_id);
                    }
                  }}
                  onClick={() => handleSelectPosition(pos.position_id)}
                  className="space-y-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-app-blue"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[16px] font-bold text-app-gray-900">
                        {pos.symbol}
                      </span>
                      <MarginSideBadge side={pos.side} />
                      <span className="numeric shrink-0 text-[13px] font-bold text-app-gray-500">
                        {pos.leverage}x
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <MarginStatusChip status={pos.status} />
                      <ChevronRight aria-hidden="true" className="size-4 text-app-gray-400" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 rounded-xl bg-app-gray-50 px-3 py-2.5">
                    <div className="flex min-w-0 flex-col text-[17px]">
                      <span className="text-[12px] font-normal text-app-gray-500">추정 수익률</span>
                      <MarginReturn position={pos} />
                    </div>
                    <div className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1 text-[12px] text-app-gray-500">
                        위험 비율 <MarginRiskBadge level={riskLevel} />
                      </span>
                      <p
                        className={`numeric break-all text-[17px] font-bold ${
                          isHighRisk ? "text-app-red" : "text-app-gray-900"
                        }`}
                      >
                        {pos.risk_ratio_ppm !== null && pos.status === "OPEN"
                          ? fmtPercentFromPPM(pos.risk_ratio_ppm)
                          : "—"}
                      </p>
                    </div>
                  </div>

                  <p className="numeric flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-app-gray-500">
                    <span>수량 <b className="font-semibold text-app-gray-700">{fmtQuantity(pos.quantity)}주</b></span>
                    <span>담보 <b className="font-semibold text-app-gray-700">{fmtCredit(pos.collateral, 2)}</b></span>
                    <span>자본 <b className="font-semibold text-app-gray-700">{fmtCredit(pos.equity, 2)}</b></span>
                    <span>부채 <b className="font-semibold text-app-gray-700">{fmtCredit(pos.debt_value, 2)}</b></span>
                  </p>
                </div>
              </Surface>
            );
          })}

        </div>
      )}

      {/* Outside the list so a filter with no loaded match can still page back. */}
      {onFetchNextPage ? (
        <LoadMoreButton
          hasMore={hasNextPage}
          loading={isFetchingNextPage}
          onLoad={onFetchNextPage}
          label="이전 포지션 더 보기"
        />
      ) : null}

      {positions.length > 0 ? (
        <p className="text-[12px] leading-relaxed text-app-gray-500">
          현재 자기자본과 추정 투자금을 비교한 참고 수익률이에요. 계산 기준은 포지션 상세에서 확인하세요.
        </p>
      ) : null}

      <MarginPositionDetailDialog
        positionId={selectedPositionId}
        open={detailOpen}
        onOpenChange={handleDetailOpenChange}
        availableCredit={availableCredit}
      />
    </div>
  );
}
