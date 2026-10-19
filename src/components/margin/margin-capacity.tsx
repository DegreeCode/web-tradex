"use client";

import { InfoTip } from "@/components/info-tip";
import type { MarginCapacity, MarginCapacitySide, MarginCapacitySideModel } from "@/lib/margin-capacity";

function chipTone(model: MarginCapacitySideModel, side: MarginCapacitySide): string {
  if (model.tone === "unavailable") return "bg-app-gray-100 text-app-gray-500";
  if (model.tone === "unknown" || model.tone === "low") return "bg-app-gray-100 text-app-gray-600";
  return side === "LONG" ? "bg-app-red-light text-app-red" : "bg-app-blue-light text-app-blue";
}

export function MarginCapacityPanel({ capacity, side }: { capacity: MarginCapacity | null; side: MarginCapacitySide }) {
  const model = side === "LONG" ? capacity?.long : capacity?.short;
  if (!model) return null;
  const detail = model.detail;
  const sideLabel = side === "LONG" ? "롱" : "숏";
  return (
    <div className="-mt-2 min-w-0 rounded-xl bg-app-gray-50 px-3 py-2.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-semibold text-app-gray-600">종목 {sideLabel} 진입 여력</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${chipTone(model, side)}`}>{model.label}</span>
        <InfoTip label="종목 진입 여력">
          종목 전체 기준 추정치예요. 자금이나 수량을 예약하지 않으며, 슬리피지와 사용자별 자격·한도는 반영하지 않아요. 실제 진입 시 다시 확인해요.
        </InfoTip>
      </div>
      {model.reasonLabel ? <p className="mt-1 text-app-red">{model.reasonLabel}</p> : null}
      {detail && (detail.remainingText !== null || detail.notionalText !== null || detail.ratioPercent !== null) ? (
        <div className="mt-1.5 space-y-1 text-app-gray-500">
          {detail.remainingText !== null ? (
            <p className="break-words">
              남은 차입 가능 {side === "SHORT" ? "수량 " : ""}
              <span className="numeric text-app-gray-700">{detail.remainingText}</span>
              {detail.capacityText !== null ? <span className="numeric"> / 전체 {detail.capacityText}</span> : null}
            </p>
          ) : null}
          {detail.notionalText !== null ? <p className="break-words">추정 금액 <span className="numeric">{detail.notionalText}</span></p> : null}
          {detail.ratioPercent !== null ? (
            <div className="flex items-center gap-2">
              <div aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-app-gray-200">
                <div
                  className={`h-full rounded-full ${side === "LONG" ? "bg-app-red" : "bg-app-blue"}`}
                  style={{ width: `${detail.ratioPercent / Math.max(100, detail.ratioPercent) * 100}%` }}
                />
              </div>
              <span className="numeric shrink-0">남은 비율 {detail.ratioText}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MarginCapacityChips({ capacity }: { capacity: MarginCapacity | null }) {
  if (!capacity?.long && !capacity?.short) return null;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-semibold" aria-label="종목 전체 진입 여력">
      {capacity.long ? <span className={`rounded px-1.5 py-0.5 ${chipTone(capacity.long, "LONG")}`}>롱 {capacity.long.label}</span> : null}
      {capacity.short ? <span className={`rounded px-1.5 py-0.5 ${chipTone(capacity.short, "SHORT")}`}>숏 {capacity.short.label}</span> : null}
    </span>
  );
}
