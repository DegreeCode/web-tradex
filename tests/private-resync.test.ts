import test from "node:test";
import assert from "node:assert/strict";
import { resyncPrivateStreamGaps } from "../src/lib/hooks/private-stream";
import { FakeTransport } from "./ws-fakes";


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
