import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import type { Notification } from "../src/lib/types";
import { TradexSocket } from "../src/lib/ws-transport";
import { applyPrivateStreamFrame, reconcileNotificationData, resyncPrivateStreamGaps } from "../src/lib/hooks/private-stream";
import { FakeTransport, mockSockets } from "./ws-fakes";


test("a private gap reconciles when it happens and again once reconnected", () => {
  const socket = new FakeTransport("private", {});
  let reconciled = 0;
  const off = resyncPrivateStreamGaps(socket, () => { reconciled += 1; });

  socket.setStatus("open");
  assert.equal(reconciled, 0, "the first connection needs no resync");

  socket.gap("private");
  assert.equal(reconciled, 1);
  // Failed reconnects report more gaps without polling.
  socket.setStatus("closed");
  socket.gap("private");
  socket.setStatus("connecting");
  socket.setStatus("closed");
  assert.equal(reconciled, 1);

  socket.setStatus("open");
  assert.equal(reconciled, 2, "changes made while disconnected are fetched after reconnecting");
  socket.setStatus("closed");
  socket.setStatus("open");
  assert.equal(reconciled, 2, "a reopen without a gap does not refetch");

  socket.emit({ type: "update", stream: "orders", seq: 1, version: 1 });
  socket.gap("private");
  assert.equal(reconciled, 3);

  off();
  assert.equal(socket.handlerCount, 0);
});

test("failed private handshakes do not reopen the recovery outage", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const instances = mockSockets(t);
  const socket = new TradexSocket("private", { fetchTicket: async () => "ticket", onAuthFailure: () => {} });
  let reconciled = 0;
  const off = resyncPrivateStreamGaps(socket, () => { reconciled += 1; });
  t.after(() => { off(); socket.close(); });
  socket.retain();
  await settle();
  instances[0].onopen?.();
  instances[0].emitFrame({ type: "pong" });
  instances[0].close();
  assert.equal(reconciled, 1);
  for (let retry = 1; retry <= 6; retry += 1) {
    t.mock.timers.tick(31_000);
    await settle();
    instances[retry].onopen?.();
    instances[retry].close();
  }
  assert.equal(reconciled, 1, "six failed handshakes share one outage reconciliation");
  t.mock.timers.tick(31_000);
  await settle();
  instances[7].onopen?.();
  instances[7].emitFrame({ type: "pong" });
  assert.equal(reconciled, 2, "authenticated recovery reconciles once more");
});

test("inquiry.opened refreshes inquiry lists and details through both private delivery paths", () => {
  const client = new QueryClient();
  seed();
  applyPrivateStreamFrame(client, { type: "update", stream: "inquiry.opened", seq: 1, version: 1, data: { ticket: "T1" } });
  assert.equal(client.getQueryState(["inquiries"])?.isInvalidated, true);
  assert.equal(client.getQueryState(["inquiry", "T1"])?.isInvalidated, true);
  seed();
  reconcileNotificationData(client, {
    notification_id: "n1", kind: "SYSTEM", title: "opened", body: "inquiry.opened",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    read: false, version: 1, pinned: false, expires_at: null,
  } satisfies Notification);
  assert.equal(client.getQueryState(["inquiries"])?.isInvalidated, true);
  assert.equal(client.getQueryState(["inquiry", "T1"])?.isInvalidated, true);
  client.clear();
  function seed() {
    client.setQueryData(["inquiries"], []);
    client.setQueryData(["inquiry", "T1"], {});
  }
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
