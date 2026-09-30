"use client";

import Link from "next/link";
import { InstrumentAvatar } from "@/components/instrument-list";
import { ChevronRight } from "lucide-react";

import { ChangeIndicator } from "@/components/primitives";
import { fmtCredit, fmtQuantity } from "@/lib/format";
import { symbolHref } from "@/lib/routes";
import type { Instrument, Position } from "@/lib/types";

export interface HoldingView {
  position: Position;
  instrument: Instrument | undefined;
  value: number;
  changePct: number | null;
  realizedPnL: string;
}

export function HoldingRow({ holding }: { holding: HoldingView }) {
  const { position, value, changePct } = holding;
  return (
    <Link
      href={symbolHref(position.symbol)}
      prefetch={false}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-app-gray-50"
    >
      <InstrumentAvatar symbol={position.symbol} iconUrl={holding.instrument?.icon_url} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-app-gray-900">{position.name}</p>
        <p className="numeric truncate text-[12px] text-app-gray-500">
          {fmtQuantity(position.total_quantity)}주
          <span className="mx-1 text-app-gray-300">·</span>
          평균 {fmtCredit(position.average_cost_basis, 8)}
        </p>
      </div>
      <div className="col-start-2 row-start-2 min-w-0 text-left sm:col-start-3 sm:row-start-1 sm:text-right">
        <p className="numeric break-all text-[15px] font-bold text-app-gray-900">{fmtCredit(value, 2)}</p>
        <div className="flex sm:justify-end">
          <ChangeIndicator value={changePct} />
        </div>
      </div>
      <ChevronRight className="col-start-3 row-start-1 size-4 shrink-0 sm:col-start-4 text-app-gray-300" />
    </Link>
  );
}

export function buildHolding(
  position: Position,
  instrumentMap: Map<string, Instrument>,
): HoldingView {
  const instrument = instrumentMap.get(position.symbol);
  const price = instrument ? Number(instrument.curve_spot_price) : 0;
  const quantity = Number(position.total_quantity);
  const value = Number.isFinite(price * quantity) ? price * quantity : 0;
  const cost = Number(position.cost_basis);
  const changePct = cost > 0 ? ((value - cost) / cost) * 100 : null;
  return { position, instrument, value, changePct, realizedPnL: position.realized_pnl };
}
