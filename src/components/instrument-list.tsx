"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";

import { InstrumentStateChip } from "@/components/primitives";
import { PriceFlash } from "@/components/price-flash";
import { compareDecimal, fmtCompact, fmtPercentFromPPM, fmtPrice } from "@/lib/format";
import { symbolHref } from "@/lib/routes";
import type { Instrument } from "@/lib/types";

export function InstrumentAvatar({ symbol, iconUrl, size = "md" }: {
  symbol: string;
  iconUrl?: string | null;
  size?: "md" | "lg";
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const source = apiAssetUrl(iconUrl);
  return (
    <div
      className={
        size === "lg"
          ? "flex size-12 shrink-0 items-center justify-center rounded-2xl bg-app-gray-100 text-[16px] font-bold text-app-gray-700"
          : "flex size-10 shrink-0 items-center justify-center rounded-xl bg-app-gray-100 text-[14px] font-bold text-app-gray-700"
      }
    >
      {source && source !== failedUrl ? (
        <Image
          unoptimized
          src={source}
          alt=""
          width={size === "lg" ? 48 : 40}
          height={size === "lg" ? 48 : 40}
          className="size-full rounded-[inherit] object-cover"
          onError={() => setFailedUrl(source)}
        />
      ) : symbol.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function InstrumentRow({
  instrument,
  twoColumn = false,
}: {
  instrument: Instrument;
  twoColumn?: boolean;
}) {
  const change = instrument.change_ppm;
  const isAtTheoreticalCeiling =
    typeof instrument.curve_ceiling_price === "string" &&
    instrument.curve_ceiling_price.length > 0 &&
    instrument.curve_spot_price !== "0" &&
    /^\d+(?:\.\d+)?$/.test(instrument.curve_spot_price) &&
    /^\d+(?:\.\d+)?$/.test(instrument.curve_ceiling_price) &&
    compareDecimal(instrument.curve_spot_price, instrument.curve_ceiling_price) === 0;
  return (
    <Link
      href={symbolHref(instrument.symbol)}
      prefetch={false}
      className={cn(
        "grid min-w-0 grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-app-gray-50 sm:grid-cols-[40px_minmax(0,1fr)_minmax(0,auto)_16px]",
        twoColumn && "xl:border-b xl:border-app-gray-100 xl:px-4 xl:odd:border-r",
      )}
    >
      <div className="row-span-2 self-start sm:row-span-1 sm:self-center">
        <InstrumentAvatar symbol={instrument.symbol} iconUrl={instrument.icon_url} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-[15px] font-semibold text-app-gray-900">{instrument.name}</p>
          <InstrumentStateChip state={instrument.state} />
        </div>
        <p className="truncate text-[12px] text-app-gray-500">
          {instrument.symbol}
          <span className="mx-1 text-app-gray-300">·</span>
          시총 {fmtCompact(instrument.market_value)}
          {instrument.volume_credit !== "0" ? (
            <>
              <span className="mx-1 text-app-gray-300">·</span>
              오늘 {fmtCompact(instrument.volume_credit)}
            </>
          ) : null}
        </p>
      </div>
      <div className="col-span-2 col-start-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:text-right">
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <p className="numeric min-w-0 break-all text-[15px] font-bold text-app-gray-900">
            <PriceFlash price={instrument.curve_spot_price}>
              {fmtPrice(instrument.curve_spot_price)}
            </PriceFlash>
          </p>
          {isAtTheoreticalCeiling ? (
            <span className="rounded-md bg-app-red-light px-1 py-0.5 text-[10px] font-bold text-app-red">
              상한가
            </span>
          ) : null}
        </div>
        {typeof change === "number" ? (
          <p
            className={cn(
              "numeric text-[12px] font-semibold",
              change > 0 ? "text-app-red" : change < 0 ? "text-app-blue" : "text-app-gray-400",
            )}
          >
            {change > 0 ? "+" : ""}
            {fmtPercentFromPPM(change)}
          </p>
        ) : (
          <p className="text-[12px] text-app-gray-400">홀더 {instrument.holder_count}명</p>
        )}
      </div>
      <ChevronRight className="col-start-3 row-start-1 size-4 text-app-gray-300 sm:col-start-4" />
    </Link>
  );
}

export function InstrumentList({
  instruments,
  twoColumn = false,
}: {
  instruments: Instrument[];
  twoColumn?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 divide-y divide-app-gray-100 overflow-hidden rounded-2xl bg-card shadow-[0_1px_2px_0_rgba(25,31,40,0.03)]",
        twoColumn && "xl:grid-cols-2 xl:divide-y-0",
      )}
    >
      {instruments.map((instrument) => (
        <InstrumentRow
          key={instrument.symbol}
          instrument={instrument}
          twoColumn={twoColumn}
        />
      ))}
    </div>
  );
}
