"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { GuestOrderBar, GuestOrderPrompt } from "@/components/guest";
import { OrderForm, type OrderAccountState } from "@/components/order-form";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { fmtPrice } from "@/lib/format";
import type { Instrument } from "@/lib/types";

// Matches Tailwind's `lg` breakpoint, where the form sits in the side column.
const DESKTOP_QUERY = "(min-width: 64rem)";

function subscribeToDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useIsDesktop() {
  return useSyncExternalStore(
    subscribeToDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

/**
 * On desktop the order form stays in the side column. On mobile it would sit
 * below every other section, so a bar above the tab bar opens it as a sheet.
 */
export function ResponsiveOrderForm({
  instrument,
  accountState,
}: {
  instrument: Instrument;
  accountState: OrderAccountState;
}) {
  const isDesktop = useIsDesktop();
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  // Kept after closing so the sheet does not empty out while it slides away.
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [sessionId, setSessionId] = useState(0);

  // A guest gets a way to sign in instead of the authenticated order form.
  if (status !== "authenticated") {
    return isDesktop ? <GuestOrderPrompt /> : <GuestOrderBar instrument={instrument} />;
  }

  function openOrder(next: "BUY" | "SELL") {
    setSide(next);
    setSessionId((id) => id + 1);
    setOpen(true);
  }

  if (isDesktop) {
    return (
      <div className="space-y-2">
        <OrderForm instrument={instrument} accountState={accountState} />
        <MarginLink symbol={instrument.symbol} />
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-[calc(61px+env(safe-area-inset-bottom))] z-20 border-t border-app-gray-200 bg-card/95 px-4 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-[1280px] items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-app-gray-500">{instrument.symbol}</p>
            <p className="numeric truncate text-[15px] font-bold text-app-gray-900">{fmtPrice(instrument.curve_spot_price)}</p>
          </div>
          <button
            type="button"
            onClick={() => openOrder("SELL")}
            className="h-11 w-24 rounded-xl bg-app-blue text-[15px] font-bold text-white"
          >
            매도
          </button>
          <button
            type="button"
            onClick={() => openOrder("BUY")}
            className="h-11 w-24 rounded-xl bg-app-red text-[15px] font-bold text-white"
          >
            매수
          </button>
        </div>
      </div>

      <Drawer open={open} onOpenChange={setOpen} swipeDirection="down" showSwipeHandle>
        <DrawerContent className="max-h-[90dvh] bg-app-gray-50">
          <DrawerTitle className="sr-only">{instrument.symbol} 주문</DrawerTitle>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <OrderForm
              key={sessionId}
              instrument={instrument}
              defaultSide={side}
              accountState={accountState}
            />
            <MarginLink symbol={instrument.symbol} className="mt-2" />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function MarginLink({ symbol, className }: { symbol: string; className?: string }) {
  return (
    <Link
      href={`/margin?symbol=${encodeURIComponent(symbol)}`}
      className={`flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 text-[13px] text-app-gray-500 transition-colors hover:bg-app-gray-50 ${className ?? ""}`}
    >
      레버리지로 롱·숏 거래하기
      <span className="inline-flex items-center gap-0.5 font-bold text-app-blue">
        마진 거래
        <ArrowUpRight className="size-3.5" />
      </span>
    </Link>
  );
}
