"use client";

import Link from "next/link";
import { memo } from "react";
import { InstrumentAvatar } from "@/components/instrument-list";
import { ChevronRight } from "lucide-react";

import { ChangeIndicator } from "@/components/primitives";
import { fmtCompactQuantity, fmtCredit, fmtQuantity } from "@/lib/format";
import type { HoldingView } from "@/lib/holdings";
import { symbolHref } from "@/lib/routes";

// The parent rebuilds HoldingView objects on price updates. Compare the values
// this row renders so unrelated ticker changes don't redraw every holding.
export const HoldingRow = memo(function HoldingRow({ holding }: { holding: HoldingView }) {
  const { position, value, changePct } = holding;
  return (
    <Link
      href={symbolHref(position.symbol)}
      prefetch={false}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-app-gray-50 active:bg-app-gray-100"
    >
      <InstrumentAvatar symbol={position.symbol} iconUrl={holding.instrument?.icon_url} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-app-gray-900">{position.name}</p>
        <p className="numeric truncate text-[12px] text-app-gray-500">
          <span title={`${fmtQuantity(position.total_quantity)}주`}>{fmtCompactQuantity(position.total_quantity)}주</span>
          <span className="mx-1 text-app-gray-300">·</span>
          평균 {fmtCredit(position.average_cost_basis, 8)}
        </p>
      </div>
      <div className="col-start-2 row-start-2 min-w-0 text-left sm:col-start-3 sm:row-start-1 sm:text-right">
        <p className="numeric break-all text-[15px] font-bold text-app-gray-900">{value === null ? "—" : fmtCredit(value, 2)}</p>
        <div className="flex sm:justify-end">
          <ChangeIndicator value={changePct} />
        </div>
      </div>
      <ChevronRight className="col-start-3 row-start-1 size-4 shrink-0 sm:col-start-4 text-app-gray-300" />
    </Link>
  );
}, (previous, next) => {
  const before = previous.holding;
  const after = next.holding;
  return before.position === after.position &&
    before.instrument?.icon_url === after.instrument?.icon_url &&
    before.value === after.value && before.changePct === after.changePct;
});
