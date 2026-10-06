import type { Page } from "./types";

export type PnLMarket = "ALL" | "SPOT" | "MARGIN";
export interface PnLFilters {
  account_id?: string;
  symbol?: string;
  market_type: PnLMarket;
  as_of?: string;
}
export interface PnLSummary {
  as_of: string;
  market_type: PnLMarket;
  realized_pnl: string;
  spot_realized_pnl: string;
  margin_realized_pnl: string;
  entry_count: number;
  accounts: Array<{
    account_id: string;
    realized_pnl: string;
    spot_realized_pnl: string;
    margin_realized_pnl: string;
    entry_count: number;
    symbols: Array<{
      instrument_id: string;
      symbol: string;
      listing_sequence: number;
      realized_pnl: string;
      spot_realized_pnl: string;
      margin_realized_pnl: string;
      entry_count: number;
    }>;
  }>;
}
export interface PnLEntry {
  account_id: string;
  instrument_id: string;
  symbol: string;
  listing_sequence: number;
  realized_pnl: string;
  market_type: "SPOT" | "MARGIN";
  is_baseline: boolean;
  source_type: string;
  source_id: string | null;
  trade_id: string | null;
  position_id?: string;
  margin_side?: "LONG" | "SHORT";
  interest?: string;
  payout?: string;
  quantity?: string;
  principal?: string;
  fee?: string;
  distribution?: string;
  removed_cost_basis?: string;
  eligible_quantity?: string;
  eligible_locked_quantity?: string;
  lockup_inclusion_ppm?: number;
  at: string;
}
export type PnLHistory = Page<PnLEntry> & {
  as_of: string;
  market_type: PnLMarket;
};

export function pnlSourceLabel(
  entry: Pick<PnLEntry, "is_baseline" | "source_type">,
): string {
  if (entry.is_baseline) return "이전 누적 손익";
  return (
    (
      {
        TRADE: "현물 체결",
        DELIST_SETTLEMENT: "상장폐지 정산",
        ADJUSTMENT: "손익 조정",
        MARGIN_REDUCE: "부분 정산",
        MARGIN_CLOSE: "전액 종료",
      MARGIN_LIQUIDATION: "강제청산",
      MARGIN_DELIST_SETTLEMENT: "상장폐지 정산",
      MARGIN_CUSTODY_SETTLEMENT: "보관 정산",
      MARGIN_INTEREST: "이자",
      MARGIN_OPENING_BALANCE: "이전 누적 손익",
        CUSTODY_SETTLEMENT: "보관 정산",
        INTEREST: "이자",
        OPENING_BALANCE: "이전 누적 손익",
      } as Record<string, string>
    )[entry.source_type] ?? "손익 기록"
  );
}
