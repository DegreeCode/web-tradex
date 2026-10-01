"use client";

import { useState, type ReactNode } from "react";
import { cn } from "cn";

import { compareDecimal } from "@/lib/format";
import { isQuotedPrice } from "@/lib/instruments";

type Direction = "up" | "down";


// The first ticker replaces a placeholder "0"; that fill is not a price move.
function flashDirection(previous: string, next: string): Direction | null {
  if (!isQuotedPrice(previous) || !isQuotedPrice(next)) return null;
  const order = compareDecimal(next, previous);
  return order > 0 ? "up" : order < 0 ? "down" : null;
}

/**
 * Briefly tints its children red/blue when `price` rises/falls. `resetKey`
 * (e.g. the symbol) suppresses the flash when the price changes because a
 * different instrument is now shown.
 */
export function PriceFlash({
  price,
  resetKey,
  className,
  children,
}: {
  price: string;
  resetKey?: string;
  className?: string;
  children: ReactNode;
}) {
  const [state, setState] = useState({ price, resetKey, direction: null as Direction | null, count: 0 });
  if (state.price !== price || state.resetKey !== resetKey) {
    const direction = state.resetKey === resetKey ? flashDirection(state.price, price) : null;
    setState({
      price,
      resetKey,
      direction: direction ?? state.direction,
      count: direction ? state.count + 1 : state.count,
    });
  }
  return (
    <span
      // Remounting restarts the CSS animation for consecutive same-direction moves.
      key={state.count}
      className={cn(
        "-mx-1 rounded-md px-1",
        state.count > 0 &&
          (state.direction === "up" ? "motion-safe:animate-price-flash-up" : "motion-safe:animate-price-flash-down"),
        className,
      )}
    >
      {children}
    </span>
  );
}
