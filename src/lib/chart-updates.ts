export function canIncrementallyUpdate<T extends { time: number }>(
  previous: T[],
  next: T[],
): boolean {
  if (previous.length === 0 || next.length < previous.length) return false;
  // update(..., true) can only replace an existing timestamp. A finer
  // interval or a backfill inserts historical points and needs setData.
  // Equal endpoints alone don't guarantee matching historical timestamps.
  // A corrected middle bucket must go through setData too.
  return previous.every((point, index) => point.time === next[index].time);
}

/** Chart data is sorted oldest first; crosshair lookup must stay cheap. */
export function findChartPoint<T extends { time: number }>(points: T[], time: number | null): T | undefined {
  if (time === null) return undefined;
  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const point = points[middle];
    if (point.time === time) return point;
    if (point.time < time) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}
