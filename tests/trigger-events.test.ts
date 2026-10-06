import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { reconcileNotificationData } from "../src/lib/hooks";
import { invalidateBatched } from "../src/lib/query-batch";
import { triggerEventQueryRoots, triggerNotificationQueryRoots } from "../src/lib/trigger-events";
import type { Notification } from "../src/lib/types";

const holdRoots = ["orders", "order-groups", "accounts", "portfolio", "nav"];
const activationRoots = ["orders", "order-groups", "my-trades", "portfolio", "nav", "nav-history", "pnl", "pnl-history", "margin-positions", "margin-position"];
const activationNotificationRoots = [
  "orders", "my-trades", "portfolio", "accounts", "nav", "nav-history", "realized-pnl", "pnl", "pnl-history", "order-groups", "margin-positions", "margin-position",
];
const streamCases: Array<[string, string, string[]]> = [
  ["trigger.activated", "TRIGGER_ACTIVATED", activationRoots],
  ["trigger.updated", "TRIGGER_AMENDED", holdRoots],
  ["trigger.updated", "TRIGGER_REQUEUED", ["orders", "order-groups"]],
  ["trigger.updated", "TRIGGER_RETRY_DEFERRED", ["orders", "order-groups"]],
  ["trigger.updated", "TRIGGER_TRAIL_UPDATED", ["orders", "order-groups"]],
  ["trigger.updated", "TRIGGER_CANCELED", holdRoots],
  ["trigger.updated", "TRIGGER_EXPIRED", holdRoots],
  ["trigger.updated", "TRIGGER_FAILED", holdRoots],
  ["trigger.group_updated", "TRIGGER_GROUP_CREATED", ["orders", "order-groups"]],
  ["trigger.group_updated", "TRIGGER_GROUP_CLAIMED", holdRoots],
  ["trigger.group_updated", "TRIGGER_GROUP_CLOSED", holdRoots],
];

for (const [stream, event, expected] of streamCases) {
  test(`${stream} ${event} refreshes the affected query roots`, () => {
    assert.deepEqual(triggerEventQueryRoots(stream, { event_type: event }), expected);
  });
}

test("unknown events on the new trigger streams only refresh orders", () => {
  for (const stream of ["trigger.updated", "trigger.group_updated"]) {
    assert.deepEqual(triggerEventQueryRoots(stream, { event_type: "TRIGGER_FUTURE_EVENT" }), ["orders", "order-groups"]);
  }
  assert.deepEqual(triggerEventQueryRoots("trigger.updated", { event_type: "TRIGGER_GROUP_CLOSED" }), ["orders", "order-groups"]);
  assert.deepEqual(triggerEventQueryRoots("trigger.group_updated", { event_type: "TRIGGER_AMENDED" }), ["orders", "order-groups"]);
});

test("missing or malformed data on the new trigger streams still refreshes orders", () => {
  for (const stream of ["trigger.updated", "trigger.group_updated"]) {
    for (const data of [undefined, null, {}, { event_type: null }, { event_type: 1 }, [], 1, "TRIGGER_AMENDED"]) {
      assert.deepEqual(triggerEventQueryRoots(stream, data), ["orders", "order-groups"]);
    }
  }
});

test("trigger event fields are read directly from frame.data", () => {
  assert.deepEqual(triggerEventQueryRoots("trigger.updated", {
    data: { event_type: "TRIGGER_AMENDED" },
  }), ["orders", "order-groups"]);
  assert.deepEqual(triggerEventQueryRoots("trigger.updated", {
    event_type: "TRIGGER_AMENDED",
    data: { event_type: "TRIGGER_TRAIL_UPDATED" },
  }), holdRoots);
});

test("legacy activation frames retain their original refreshes without event_type", () => {
  for (const data of [undefined, null, {}, { order_id: "ord_legacy" }, { event_type: "UNKNOWN" }]) {
    assert.deepEqual(triggerEventQueryRoots("trigger.activated", data), activationRoots);
  }
});

test("unrelated or missing streams have no trigger invalidations", () => {
  for (const stream of [undefined, "", "trigger.future", "notification.created", "transfer.updated"]) {
    assert.deepEqual(triggerEventQueryRoots(stream, { event_type: "TRIGGER_AMENDED" }), []);
  }
});

const storedEvents = ["TRIGGER_CREATED", "TRIGGER_AMENDED", "TRIGGER_CANCELED", "TRIGGER_EXPIRED", "TRIGGER_FAILED"];

for (const event of storedEvents) {
  test(`${event} notifications refresh orders and held balances`, () => {
    assert.deepEqual(triggerNotificationQueryRoots(event), holdRoots);
  });
}

test("TRIGGER_ACTIVATED notifications retain all existing trade and balance refreshes", () => {
  assert.deepEqual(triggerNotificationQueryRoots("TRIGGER_ACTIVATED"), activationNotificationRoots);
});

test("WS-only, unknown and absent notification events have no stored-trigger mapping", () => {
  for (const event of [
    "TRIGGER_REQUEUED", "TRIGGER_RETRY_DEFERRED", "TRIGGER_TRAIL_UPDATED",
    "TRIGGER_GROUP_CREATED", "TRIGGER_GROUP_CLAIMED", "TRIGGER_GROUP_CLOSED",
    "TRIGGER_FUTURE_EVENT", "TRADE_EXECUTED", undefined,
  ]) {
    assert.deepEqual(triggerNotificationQueryRoots(event), []);
  }
});

function notification(body: string, title = "Notice"): Notification {
  return {
    notification_id: "ntf_trigger",
    kind: "USER",
    title,
    body,
    version: 1,
    pinned: false,
    read: false,
    created_at: "2026-10-05T00:00:00Z",
    updated_at: "2026-10-05T00:00:00Z",
    expires_at: null,
  };
}

test("backend trigger notification bodies reconcile holds, including OCO cancellation reasons", () => {
  for (const event of storedEvents) {
    const client = new QueryClient();
    const roots = [...holdRoots, "my-trades", "nav-history", "realized-pnl", "pnl", "pnl-history", "order-groups", "margin-positions", "margin-position", "transfers", "notifications"];
    try {
      for (const root of roots) client.setQueryData([root, "cached"], {});
      const body = event === "TRIGGER_CANCELED"
        ? "ALPHA.M TRIGGER_CANCELED: paired OCO order executed"
        : `ALPHA.M ${event}`;
      reconcileNotificationData(client, notification(body, event === "TRIGGER_AMENDED" ? "Trigger amended" : "Notice"));
      for (const root of roots) {
        assert.equal(client.getQueryState([root, "cached"])?.isInvalidated, holdRoots.includes(root), `${event}: ${root}`);
      }
    } finally {
      client.clear();
    }
  }
});

test("legacy cancellation, expiry and failure notifications reconcile without a symbol", () => {
  for (const body of [
    "TRIGGER_CANCELED",
    "TRIGGER_EXPIRED: EXPIRED",
    "TRIGGER_FAILED: INSUFFICIENT_CREDIT",
  ]) {
    const client = new QueryClient();
    try {
      for (const root of holdRoots) client.setQueryData([root], {});
      reconcileNotificationData(client, notification(body));
      for (const root of holdRoots) assert.equal(client.getQueryState([root])?.isInvalidated, true, `${body}: ${root}`);
    } finally {
      client.clear();
    }
  }
});

test("a trigger domain event and its stored notification share one batched balance refetch", async () => {
  const client = new QueryClient();
  const fetches = new Map<string, number>();
  const subscriptions = holdRoots.map((root) => {
    const observer = new QueryObserver(client, {
      queryKey: [root, "cached"],
      initialData: "cached",
      queryFn: async () => {
        fetches.set(root, (fetches.get(root) ?? 0) + 1);
        return "refreshed";
      },
      staleTime: Infinity,
    });
    return observer.subscribe(() => {});
  });
  try {
    invalidateBatched(client, triggerEventQueryRoots("trigger.updated", {
      event_type: "TRIGGER_CANCELED",
    }).map((root) => [root]));
    reconcileNotificationData(client, notification("ALPHA.M TRIGGER_CANCELED: paired OCO order executed"));
    assert.equal(fetches.size, 0, "refetches wait for the shared batch");
    for (const root of holdRoots) assert.equal(client.getQueryState([root, "cached"])?.isInvalidated, true);

    await new Promise((resolve) => setTimeout(resolve, 400));
    for (const root of holdRoots) assert.equal(fetches.get(root), 1, root);
  } finally {
    for (const unsubscribe of subscriptions) unsubscribe();
    client.clear();
  }
});
