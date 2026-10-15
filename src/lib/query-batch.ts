import { hashKey, partialMatchKey, type QueryClient, type QueryKey } from "@tanstack/react-query";

const REFETCH_BATCH_MS = 300;

const pendingByClient = new WeakMap<
  QueryClient,
  { keys: Map<string, QueryKey>; timer: ReturnType<typeof setTimeout> }
>();

/**
 * Marks queries stale immediately but refetches their active observers once per
 * burst, so a WS event and its notification (or a mutation and its echo) do
 * not each start the same requests. Passive keys only refresh on next mount/focus.
 */
export function invalidateBatched(
  queryClient: QueryClient,
  keys: readonly QueryKey[],
  options: { passive?: boolean } = {},
): void {
  if (keys.length === 0) return;
  void queryClient.invalidateQueries({
    predicate: (query) => keys.some((key) => partialMatchKey(query.queryKey, key)),
    refetchType: "none",
  });
  if (options.passive) return;

  let pending = pendingByClient.get(queryClient);
  if (!pending) {
    const batch = {
      keys: new Map<string, QueryKey>(),
      timer: setTimeout(() => {
        pendingByClient.delete(queryClient);
        const keys = [...batch.keys.values()];
        // One cache pass also avoids matching overlapping prefixes repeatedly.
        // Skip queries a poll or another refetch already refreshed.
        void queryClient.refetchQueries({
          predicate: (query) => keys.some((key) => partialMatchKey(query.queryKey, key)),
          type: "active",
          stale: true,
        }, { cancelRefetch: false }).catch(() => undefined);
      }, REFETCH_BATCH_MS),
    };
    pending = batch;
    pendingByClient.set(queryClient, pending);
  }
  for (const queryKey of keys) pending.keys.set(hashKey(queryKey), queryKey);
}
