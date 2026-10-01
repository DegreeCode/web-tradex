import test from "node:test";
import assert from "node:assert/strict";
import { resyncPrivateStreamGaps } from "../src/lib/hooks";
import type { WsFrame } from "../src/lib/types";
import type { WsStatus } from "../src/lib/ws";

function fakeSocket() {
  const frames = new Set<(frame: WsFrame) => void>();
  const gaps = new Set<(stream: string) => void>();
  const statuses = new Set<(status: WsStatus) => void>();
  const add = <T>(set: Set<T>) => (handler: T) => {
    set.add(handler);
    return () => set.delete(handler);
  };
  return {
    onFrame: add(frames),
    onGap: add(gaps),
    onStatus: add(statuses),
    frame: (frame: WsFrame) => frames.forEach((handler) => handler(frame)),
    gap: () => gaps.forEach((handler) => handler("private")),
    status: (status: WsStatus) => statuses.forEach((handler) => handler(status)),
    handlers: () => frames.size + gaps.size + statuses.size,
  };
}

test("a private gap reconciles when it happens and again once reconnected", () => {
  const socket = fakeSocket();
  let reconciled = 0;
  const off = resyncPrivateStreamGaps(socket, () => { reconciled += 1; });

  socket.status("open");
  assert.equal(reconciled, 0, "the first connection needs no resync");

  socket.gap();
  assert.equal(reconciled, 1);
  // Failed reconnects report more gaps without polling.
  socket.status("closed");
  socket.gap();
  socket.status("connecting");
  socket.status("closed");
  assert.equal(reconciled, 1);

  socket.status("open");
  assert.equal(reconciled, 2, "changes made while disconnected are fetched after reconnecting");
  socket.status("closed");
  socket.status("open");
  assert.equal(reconciled, 2, "a reopen without a gap does not refetch");

  socket.frame({ type: "update", stream: "orders", seq: 1, version: 1 });
  socket.gap();
  assert.equal(reconciled, 3);

  off();
  assert.equal(socket.handlers(), 0);
});
