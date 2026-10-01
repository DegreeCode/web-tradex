"use client";

import { useMemo, useState } from "react";

import { slippageError, type ExchangeInfo } from "@/lib/exchange-info";
import { isDecimalInput, isPositiveDecimal, ppmFromPercent } from "@/lib/format";
import { useSlippagePreference } from "@/lib/preferences";

/**
 * SLIPPAGE bounds the fill at the client's latest curve price ± the allowed
 * percent; PRICE_LIMIT sends 0% around the typed price, so the curve fills only
 * until it reaches that price (a cap for buys, a floor for sells).
 */
export type SlippageMode = "SLIPPAGE" | "PRICE_LIMIT";
export type TradeSide = "BUY" | "SELL";

export interface SlippageSettings {
  mode: SlippageMode;
  /** Percent as typed; blank means the server default. */
  slippage: string;
  limitPrice: string;
}

export interface SlippageRequestFields {
  slippage_ppm?: number;
  slippage_reference_price?: string;
}

/** The allowed percent is remembered across forms; the mode and limit price belong to one order. */
export function useSlippageSettings() {
  const [slippage, setSlippage] = useSlippagePreference();
  const [mode, setMode] = useState<SlippageMode>("SLIPPAGE");
  const [limitPrice, setLimitPrice] = useState("");
  const settings = useMemo<SlippageSettings>(() => ({ mode, slippage, limitPrice }), [mode, slippage, limitPrice]);
  return { settings, setMode, setSlippage, setLimitPrice };
}

export function limitPriceLabel(side: TradeSide): string {
  return side === "BUY" ? "매수 상한가" : "매도 하한가";
}

export function slippageSettingsError(
  settings: SlippageSettings,
  side: TradeSide,
  trade?: ExchangeInfo["trade"],
): string | null {
  if (settings.mode === "SLIPPAGE") return slippageError(settings.slippage, trade);
  const price = settings.limitPrice.trim();
  if (!isDecimalInput(price, 8) || !isPositiveDecimal(price)) return `${limitPriceLabel(side)}를 입력해주세요`;
  return null;
}

/** Request fields the user chose; the live reference price is added separately at send time. */
export function slippageRequestFields(settings: SlippageSettings): SlippageRequestFields {
  if (settings.mode === "PRICE_LIMIT") {
    return { slippage_ppm: 0, slippage_reference_price: settings.limitPrice.trim() };
  }
  const slippage = settings.slippage.trim();
  return slippage ? { slippage_ppm: ppmFromPercent(slippage) } : {};
}

/**
 * The client's latest curve price, anchoring the allowed slippage to what the
 * user saw. Undefined (server price at execution) when a limit price already
 * sets the reference or the cached price is not a valid request price.
 */
export function liveReferencePrice(settings: SlippageSettings, curvePrice: string | undefined): string | undefined {
  if (settings.mode !== "SLIPPAGE" || !curvePrice) return undefined;
  return isDecimalInput(curvePrice, 8) && isPositiveDecimal(curvePrice) ? curvePrice : undefined;
}

/** Collapsed advanced-settings summary, e.g. "슬리피지 5%" or "매수 상한가 1,234". */
export function slippageSummary(
  settings: SlippageSettings,
  side: TradeSide,
  defaultSlippagePpm: number | undefined,
  formatPrice: (price: string) => string,
): string | null {
  if (settings.mode === "PRICE_LIMIT") {
    const price = settings.limitPrice.trim();
    return price ? `${limitPriceLabel(side)} ${formatPrice(price)}` : limitPriceLabel(side);
  }
  const slippage = settings.slippage.trim();
  if (slippage) return `슬리피지 ${slippage}%`;
  return defaultSlippagePpm === undefined ? null : `슬리피지 ${defaultSlippagePpm / 10_000}%`;
}
