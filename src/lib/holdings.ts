import { isQuotedPrice } from "./instruments";
import type { Instrument, Position } from "./types";

export interface HoldingView {
  position: Position;
  instrument: Instrument | undefined;
  /** Missing or initial placeholder prices do not imply a total loss. */
  value: number | null;
  changePct: number | null;
}

export function buildHolding(
  position: Position,
  instrumentMap: ReadonlyMap<string, Instrument>,
): HoldingView {
  const instrument = instrumentMap.get(position.symbol);
  const price = instrument?.curve_spot_price;
  const rawValue = isQuotedPrice(price) ? Number(price) * Number(position.total_quantity) : NaN;
  const value = Number.isFinite(rawValue) ? rawValue : null;
  const cost = Number(position.cost_basis);
  const changePct = value !== null && Number.isFinite(cost) && cost > 0
    ? ((value - cost) / cost) * 100
    : null;
  return { position, instrument, value, changePct };
}
