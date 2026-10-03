"use client";

import { useQuery } from "@tanstack/react-query";
import { apiData } from "./api";
import { fmtPercentFromPPM, isDecimalInput, ppmFromPercent } from "./format";
import { useSignedIn } from "./session-mode";

export interface ListingEvaluationCriteria {
  min_external_holders: number;
  min_external_traders: number;
  min_qualified_activity_ppm: number;
}

export interface ExchangeInfo {
  settings_version: string;
  trade: {
    fee_ppm: number;
    default_slippage_ppm: number;
    max_slippage_ppm: number;
  };
  margin: {
    daily_interest_ppm: number;
    warning_ppm: number;
    maintenance_ppm: number;
    liquidation_confirm_seconds: number;
    /** Margin side a symbol's current manager may not open on that symbol. */
    manager_own_symbol_block?: "LONG" | "SHORT" | "BOTH";
    interest_period_seconds: number;
    interest_collection: string;
    interest_rate_scope: string;
    long_interest_basis: string;
    short_interest_basis: string;
  };
  listing: {
    user_fee_credit: string;
    user_daily_limit: number;
    default_locked_supply_ppm?: number;
    min_locked_supply_ppm?: number;
    max_locked_supply_ppm?: number;
    issuance_max_price_dilution_ppm?: number;
    issuance_cooldown_hours?: number;
    issuance_post_listing_block_hours?: number;
    maintenance: {
      after_24h: ListingEvaluationCriteria;
      after_72h: ListingEvaluationCriteria;
      periodic: { interval_hours: number; max_consecutive_failures: number };
    };
  };
  transfer: {
    fee_ppm: number;
    expiry_hours: number;
    asset_policy: "BOTH" | "CREDIT_ONLY" | "STOCK_ONLY" | "DISABLED";
    approval_mode: "MANUAL" | "AUTO";
  };
  metadata: {
    icon_requests_per_minute_per_user: number;
    max_tags: number;
    tag_max_bytes: number;
    tag_encoding: string;
    icon_allowed_hosts: string[];
    icon_max_bytes: number;
    icon_max_width: number;
    icon_max_height: number;
    icon_formats: string[];
    icon_requires_approval: boolean;
  };
}

export function useExchangeInfo(poll = false) {
  // Only signed-in screens act on these settings, so a guest never asks.
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: ["exchange-info"],
    queryFn: () => apiData<ExchangeInfo>("/api/v1/exchange/info"),
    enabled: signedIn,
    // Settings change rarely; focus/reconnect refetch only once this is stale.
    staleTime: 60_000,
    // Only the app shell owns the timer; form observers share its response.
    refetchInterval: poll ? 5 * 60_000 : false,
  });
}

export function slippageError(
  value: string,
  trade?: ExchangeInfo["trade"],
): string | null {
  if (!value.trim()) return null; // Omit the field so the server applies its current default.
  if (!isDecimalInput(value.trim(), 4) || !/[0-9]/.test(value))
    return "슬리피지를 0 이상의 숫자로 입력해주세요";
  if (trade && ppmFromPercent(value.trim()) > trade.max_slippage_ppm)
    return `슬리피지는 0~${fmtPercentFromPPM(trade.max_slippage_ppm, 4)} 사이로 입력해주세요`;
  return null;
}

// The API accepts locked ratios in 0.1% (1000 ppm) steps.
export const LOCKED_SUPPLY_STEP_PPM = 1_000;

/**
 * Converts a typed percent into a locked ratio: the nearest 0.1% step, clamped
 * to the published range. Returns null when the text is not a decimal with at
 * most one fractional digit.
 */
export function lockedSupplyPpmFromPercent(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!isDecimalInput(trimmed, 1) || trimmed === ".") return null;
  const stepped = Math.round(ppmFromPercent(trimmed) / LOCKED_SUPPLY_STEP_PPM) * LOCKED_SUPPLY_STEP_PPM;
  return Math.min(max, Math.max(min, stepped));
}

export function tagPolicyError(
  tags: string[],
  metadata?: ExchangeInfo["metadata"],
): string | null {
  if (!metadata) return null;
  if (tags.length > metadata.max_tags)
    return `태그는 최대 ${metadata.max_tags}개까지 입력할 수 있어요`;
  if (
    tags.some(
      (tag) => new TextEncoder().encode(tag).length > metadata.tag_max_bytes,
    )
  )
    return `각 태그는 ${metadata.tag_encoding} 기준 ${metadata.tag_max_bytes}바이트 이내로 입력해주세요`;
  return null;
}

export function transferAllowed(
  asset: "CREDIT" | "STOCK",
  sameOwner: boolean,
  policy?: ExchangeInfo["transfer"]["asset_policy"],
): boolean {
  return (
    sameOwner || !policy || policy === "BOTH" || policy === `${asset}_ONLY`
  );
}

export function iconPolicyError(
  value: string,
  metadata?: ExchangeInfo["metadata"],
): string | null {
  if (!value.trim() || !metadata) return null;
  if (!metadata.icon_allowed_hosts.length)
    return "현재 아이콘 등록에 허용된 호스트가 없어요. URL을 비우고 진행해주세요";
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !metadata.icon_allowed_hosts.includes(url.hostname.toLowerCase())
    )
      return "아이콘은 안내된 허용 호스트의 HTTPS URL을 입력해주세요";
  } catch {
    return "올바른 아이콘 URL을 입력해주세요";
  }
  return null;
}

/** Whether a symbol's manager is barred from opening this margin side on it. */
export function managerMarginSideBlocked(
  side: "LONG" | "SHORT",
  block: NonNullable<ExchangeInfo["margin"]["manager_own_symbol_block"]> | undefined,
): boolean {
  return block === "BOTH" || block === side;
}
