import { hashKey, partialMatchKey, type Query, type QueryClient, type QueryKey } from "@tanstack/react-query";

const REFETCH_BATCH_MS = 300;

const pendingByClient = new WeakMap<
  QueryClient,
  { keys: Map<string, QueryKey>; tainted: Map<string, Query>; timer: ReturnType<typeof setTimeout> }
>();

async function refetchTainted(queryClient: QueryClient, query: Query): Promise<void> {
  if (!query.isActive()) return;
  // Waiting also covers a request paused between retries. Its response must
  // finish before we can start the fetch that accounts for this batch's event.
  if (query.state.fetchStatus !== "idle") await query.promise?.catch(() => undefined);
  await queryClient.refetchQueries({
    type: "active",
    // A removed query must not refetch a new session's query with the same key.
    predicate: (current) => current === query,
  }, { cancelRefetch: false });
}

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
  const matches = (query: { queryKey: QueryKey }) => keys.some((key) => partialMatchKey(query.queryKey, key));
  const fetching = options.passive ? [] : queryClient.getQueryCache().findAll({ predicate: matches })
    .filter((query) => query.state.fetchStatus === "fetching");
  void queryClient.invalidateQueries({
    predicate: matches,
    refetchType: "none",
  });
  if (options.passive) return;

  let pending = pendingByClient.get(queryClient);
  if (!pending) {
    const batch = {
      keys: new Map<string, QueryKey>(),
      tainted: new Map<string, Query>(),
      timer: setTimeout(() => {
        pendingByClient.delete(queryClient);
        const keys = [...batch.keys.values()];
        // Untainted queries refreshed by a later poll need no extra request.
        // Tainted responses can clear invalidation, so they get one follow-up
        // regardless of staleness, after any current request finishes.
        void queryClient.refetchQueries({
          predicate: (query) => batch.tainted.get(query.queryHash) !== query &&
            keys.some((key) => partialMatchKey(query.queryKey, key)),
          type: "active",
          stale: true,
        }, { cancelRefetch: false }).catch(() => undefined);
        for (const query of batch.tainted.values()) {
          void refetchTainted(queryClient, query).catch(() => undefined);
        }
      }, REFETCH_BATCH_MS),
    };
    pending = batch;
    pendingByClient.set(queryClient, pending);
  }
  for (const queryKey of keys) pending.keys.set(hashKey(queryKey), queryKey);
  for (const query of fetching) pending.tainted.set(query.queryHash, query);
}
