import test from "node:test";
import assert from "node:assert/strict";
import { closeSocket, getSocket } from "../src/lib/ws";

test("socket lookup stays idle, remount reconnects, and a stream gap reconciles once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  const instances: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    readyState = 1;
    closeCount = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { instances.push(this); }
    send() {}
    close() {
      this.closeCount += 1;
      this.readyState = 3;
      this.onclose?.();
    }
    emit(stream: string, seq: number, type = "update") {
      this.onmessage?.({ data: JSON.stringify({ type, stream, seq, version: seq, data: [] }) });
    }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeSocket });
  const socket = getSocket("public");
  try {
    assert.equal(instances.length, 0, "reading socket status must not create an unowned connection");
    const gaps: string[] = [];
    const accepted: string[] = [];
    socket.onGap((stream) => gaps.push(stream));
    socket.onFrame((frame) => accepted.push(frame.stream!));
    socket.subscribe("tickers");
    socket.unsubscribe("tickers");
    socket.subscribe("tickers");
    await Promise.resolve();
    assert.equal(instances.length, 2, "a same-turn remount must resume its live subscription");
    socket.subscribe("trades:AAA.M");
    socket.subscribe("disclosures");
    const transport = instances[1];
    transport.emit("tickers", 1, "snapshot");
    transport.emit("trades:AAA.M", 1, "snapshot");
    transport.emit("disclosures", 1, "snapshot");
    assert.deepEqual(gaps, []);
    transport.emit("trades:AAA.M", 3);
    assert.deepEqual(gaps, ["public"]);
    assert.equal(transport.closeCount, 1);
    assert.deepEqual(accepted, ["tickers", "trades:AAA.M", "disclosures"]);
    closeSocket("public");
    await Promise.resolve();
    assert.equal(instances.length, 2, "intentional cleanup must not restart a socket");
  } finally {
    closeSocket("public");
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousWebSocket) Object.defineProperty(globalThis, "WebSocket", previousWebSocket);
    else Reflect.deleteProperty(globalThis, "WebSocket");
  }
});
