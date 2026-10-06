const ORDER_QUERY_ROOTS = ["orders", "order-groups"] as const;
const HOLD_QUERY_ROOTS = ["orders", "order-groups", "accounts", "portfolio", "nav"] as const;
const ACTIVATION_QUERY_ROOTS = ["orders", "order-groups", "my-trades", "portfolio", "nav", "nav-history", "pnl", "pnl-history", "margin-positions", "margin-position"] as const;
const ACTIVATION_NOTIFICATION_QUERY_ROOTS = [
  "orders", "my-trades", "portfolio", "accounts", "nav", "nav-history", "realized-pnl", "pnl", "pnl-history", "order-groups", "margin-positions", "margin-position",
] as const;

/** Trigger domain fields live directly in frame.data; missing fields never block a refresh. */
export function triggerEventQueryRoots(stream: string | undefined, data?: unknown): readonly string[] {
  // Keep the legacy stream's refreshes even when event_type is omitted.
  if (stream === "trigger.activated") return ACTIVATION_QUERY_ROOTS;
  if (stream !== "trigger.updated" && stream !== "trigger.group_updated") return [];

  const event = data && typeof data === "object" && "event_type" in data
    ? data.event_type
    : undefined;

  if (stream === "trigger.updated") {
    switch (event) {
      case "TRIGGER_AMENDED":
      case "TRIGGER_CANCELED":
      case "TRIGGER_EXPIRED":
      case "TRIGGER_FAILED":
        return HOLD_QUERY_ROOTS;
      // Requeue, retry and trailing updates do not move balances; fills have notifications.
      default:
        return ORDER_QUERY_ROOTS;
    }
  }

  switch (event) {
    case "TRIGGER_GROUP_CLAIMED":
    case "TRIGGER_GROUP_CLOSED":
      return HOLD_QUERY_ROOTS;
    default:
      return ORDER_QUERY_ROOTS;
  }
}

/** Stored trigger notifications also reconcile holds for changes made outside this tab. */
export function triggerNotificationQueryRoots(event: string | undefined): readonly string[] {
  switch (event) {
    case "TRIGGER_ACTIVATED":
      return ACTIVATION_NOTIFICATION_QUERY_ROOTS;
    case "TRIGGER_CREATED":
    case "TRIGGER_AMENDED":
    case "TRIGGER_CANCELED":
    case "TRIGGER_EXPIRED":
    case "TRIGGER_FAILED":
      return HOLD_QUERY_ROOTS;
    default:
      return [];
  }
}
