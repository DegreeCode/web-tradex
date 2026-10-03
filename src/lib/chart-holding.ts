import type { Position } from "./types";

export interface ChartHolding {
  averagePrice: string;
  returnPercent: number | null;
}

export function buildChartHolding(position: Position | undefined, spotPrice: string): ChartHolding | undefined {
  if (!position) return undefined;
  const quantity = Number(position.total_quantity);
  const averagePrice = Number(position.average_cost_basis);
  const cost = Number(position.cost_basis);
  const spot = Number(spotPrice);
  if (
    ![quantity, averagePrice, cost, spot].every(Number.isFinite) ||
    quantity <= 0 || averagePrice < 0 || cost < 0 || spot < 0
  ) return undefined;
  const percent = cost > 0 ? ((spot * quantity - cost) / cost) * 100 : null;
  return {
    averagePrice: position.average_cost_basis,
    returnPercent: percent !== null && Number.isFinite(percent) ? percent : null,
  };
}
