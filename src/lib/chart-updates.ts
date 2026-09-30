export function canIncrementallyUpdate<T extends { time: number }>(
  previous: T[],
  next: T[],
): boolean {
  if (previous.length === 0 || next.length < previous.length) return false;
  // update(..., true) can only replace an existing timestamp. A finer
  // interval or a backfill inserts historical points and needs setData.
  return previous.every((point, index) => point.time === next[index].time);
}
