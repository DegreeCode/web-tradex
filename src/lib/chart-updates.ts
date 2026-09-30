export function canIncrementallyUpdate<T extends { time: number }>(
  previous: T[],
  next: T[],
): boolean {
  if (previous.length === 0 || next.length < previous.length) return false;
  // update(..., true) can only replace an existing timestamp. A finer
  // interval or a backfill inserts historical points and needs setData.
  return previous.every((point, index) => point.time === next[index].time);
}

export interface EffectivePriceLineResult {
  price: number;
  color: string;
}

export function resolveEffectivePriceLine({
  lastPrice,
  latestPointPrice,
  baselinePrice,
  upColor = "#f04452",
  downColor = "#3182f6",
}: {
  lastPrice?: string | number | null;
  latestPointPrice?: number | null;
  baselinePrice?: number | null;
  upColor?: string;
  downColor?: string;
}): EffectivePriceLineResult | null {
  // The instrument uses zero until its ticker arrives. Keep the candle's
  // latest close visible during that bootstrap instead of drawing at zero.
  const numericLastPrice = lastPrice == null ? 0 : Number(lastPrice);
  const price = Number.isFinite(numericLastPrice) && numericLastPrice > 0
    ? numericLastPrice
    : latestPointPrice;
  if (price == null || !Number.isFinite(price) || price <= 0) return null;

  const baseline = baselinePrice ?? price;
  const color = price >= baseline ? upColor : downColor;
  return { price, color };
}
