import type { WsFrame } from "./types";

// What the server's own snapshots hold: the newest 50 trades of a symbol and
// the newest 50 disclosures.
const TRADE_SNAPSHOT_SIZE = 50;
const DISCLOSURE_SNAPSHOT_SIZE = 50;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a channel's updates can be folded into its snapshot. */
export function canFoldSnapshot(channel: string): boolean {
  return (
    channel === "tickers" ||
    channel === "disclosures" ||
    channel === "market_state" ||
    channel.startsWith("trades:")
  );
}

/**
 * Folds one live update into a channel's latest snapshot, so a tab that joins
 * a shared subscription later starts from what a fresh subscribe would send.
 */
export function foldSnapshot(snapshot: WsFrame, update: WsFrame): WsFrame {
  const channel = snapshot.stream ?? "";
  const data = foldData(channel, snapshot.data, update.data);
  return { ...snapshot, data, seq: update.seq, version: update.version };
}

function foldData(channel: string, current: unknown, change: unknown): unknown {
  if (channel === "tickers") return foldTickers(current, change);
  if (channel === "disclosures") return foldDisclosures(current, change);
  if (channel === "market_state") {
    // A per-symbol state change is not part of the global snapshot.
    if (isRow(change) && typeof change.symbol === "string" && typeof change.state === "string") {
      return current;
    }
    return isRow(change) ? change : current;
  }
  if (channel.startsWith("trades:")) return foldTrades(current, change);
  return current;
}

function foldTickers(current: unknown, change: unknown): unknown {
  if (!Array.isArray(current) || !Array.isArray(change)) return current;
  const rows = new Map<string, Row>();
  for (const row of current) if (isRow(row) && typeof row.symbol === "string") rows.set(row.symbol, row);
  for (const row of change) {
    if (!isRow(row) || typeof row.symbol !== "string") continue;
    if (row.deleted) rows.delete(row.symbol);
    else rows.set(row.symbol, row);
  }
  return [...rows.values()];
}

function foldTrades(current: unknown, change: unknown): unknown {
  if (!Array.isArray(current) || !isRow(change) || !Number.isSafeInteger(change.sequence)) return current;
  if (current.some((row) => isRow(row) && row.sequence === change.sequence)) return current;
  return [change, ...current].slice(0, TRADE_SNAPSHOT_SIZE);
}

function foldDisclosures(current: unknown, change: unknown): unknown {
  if (!Array.isArray(current)) return current;
  // Frames without a disclosure identity are market-state notices, not rows.
  if (!isRow(change) || typeof change.disclosure_id !== "string" || typeof change.occurred_at !== "string") {
    return current;
  }
  const rows = new Map<string, Row>();
  for (const row of current) if (isRow(row) && typeof row.disclosure_id === "string") rows.set(row.disclosure_id, row);
  rows.set(change.disclosure_id, change);
  return [...rows.values()]
    .sort((a, b) =>
      Date.parse(String(b.occurred_at)) - Date.parse(String(a.occurred_at)) ||
      String(b.disclosure_id).localeCompare(String(a.disclosure_id)),
    )
    .slice(0, DISCLOSURE_SNAPSHOT_SIZE);
}
