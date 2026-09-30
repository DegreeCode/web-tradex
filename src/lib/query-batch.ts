import type { QueryClient, QueryKey } from "@tanstack/react-query";

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
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
  }
  if (options.passive || keys.length === 0) return;

  let pending = pendingByClient.get(queryClient);
  if (!pending) {
    const batch = {
      keys: new Map<string, QueryKey>(),
      timer: setTimeout(() => {
        pendingByClient.delete(queryClient);
        for (const queryKey of batch.keys.values()) {
          // Skip queries a poll or another refetch already refreshed.
          void queryClient
            .refetchQueries({ queryKey, type: "active", stale: true }, { cancelRefetch: false })
            .catch(() => undefined);
        }
      }, REFETCH_BATCH_MS),
    };
    pending = batch;
    pendingByClient.set(queryClient, pending);
  }
  for (const queryKey of keys) pending.keys.set(JSON.stringify(queryKey), queryKey);
}
