import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/lib/api";
import { closeSocket, getSocket, TradexSocket } from "../src/lib/ws";
import type { WsFrame } from "../src/lib/types";

function mockSockets(t: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  const instances: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    readyState = 1;
    closeCount = 0;
    deferClose = false;
    readonly sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { instances.push(this); }
    send(raw: string) { this.sent.push(JSON.parse(raw)); }
    close() {
      this.closeCount += 1;
      this.readyState = 3;
      if (!this.deferClose) this.onclose?.();
    }
    receive(raw: string) { this.onmessage?.({ data: raw }); }
    emitFrame(frame: unknown) { this.receive(JSON.stringify(frame)); }
    emit(stream: string, seq: number, type = "update") {
      this.emitFrame({ type, stream, seq, version: seq, data: [] });
    }
  }
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeSocket });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "WebSocket", previous);
    else Reflect.deleteProperty(globalThis, "WebSocket");
  });
  return instances;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("socket lookup stays idle, remount reconnects, and a stream gap reconciles once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const instances = mockSockets(t);
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
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
  }
});

test("a private ticket refused for the session's scope is not asked for again until the next retain", async (t) => {
  mockSockets(t);
  let asked = 0;
  const socket = new TradexSocket("private", {
    fetchTicket: async () => {
      asked += 1;
      throw new ApiError(403, "SESSION_SCOPE_FORBIDDEN", "refused");
    },
  });
  try {
    const release = socket.retain();
    await settle();
    assert.equal(asked, 1);
    assert.equal(socket.getStatus(), "closed");
    release();
    socket.retain();
    await settle();
    assert.equal(asked, 2, "a new holder tries once more");
  } finally {
    socket.close();
  }
});

test("malformed frames reconcile once without escaping the message handler", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const instances = mockSockets(t);
  for (const raw of [
    "null", "[]", '"invalid"', '{"type":"update","stream":{}}',
    '{"type":"snapshot","stream":"tickers","seq":-1,"version":-1}',
    '{"type":"snapshot","stream":"tickers","seq":9007199254740991.1,"version":9007199254740991.1}',
    '{"type":"snapshot","stream":"tickers","seq":1,"version":1,"part":2,"parts":2,"data":[]}',
  ]) {
    const socket = new TradexSocket("public");
    let gaps = 0;
    socket.onGap(() => { gaps += 1; });
    socket.subscribe("tickers");
    const transport = instances.at(-1)!;
    assert.doesNotThrow(() => transport.receive(raw), raw);
    assert.equal(gaps, 1, raw);
    assert.equal(transport.closeCount, 1, raw);
    socket.close();
  }
});

test("multipart snapshots publish all rows together and discard unsubscribed in-flight frames", (t) => {
  const instances = mockSockets(t);
  const socket = new TradexSocket("public");
  t.after(() => socket.close());
  const frames: WsFrame[] = [];
  let gaps = 0;
  socket.onFrame((frame) => frames.push(frame));
  socket.onGap(() => { gaps += 1; });
  socket.subscribe("tickers");
  socket.subscribe("disclosures");
  const transport = instances[0];
  transport.emitFrame({ type: "snapshot", stream: "tickers", seq: 7, version: 7, part: 1, parts: 2, data: [{ symbol: "AAA.M" }] });
  assert.equal(frames.length, 0);
  transport.emit("disclosures", 1, "snapshot");
  transport.emitFrame({ type: "snapshot", stream: "tickers", seq: 7, version: 7, part: 2, parts: 2, data: [{ symbol: "BBB.M" }] });
  assert.deepEqual(frames[1], { type: "snapshot", stream: "tickers", seq: 7, version: 7, data: [{ symbol: "AAA.M" }, { symbol: "BBB.M" }] });
  transport.emit("tickers", 8);
  socket.unsubscribe("tickers");
  transport.emit("tickers", 9);
  assert.equal(frames.length, 3);
  assert.equal(gaps, 0);

  socket.subscribe("tickers");
  transport.emitFrame({ type: "snapshot", stream: "tickers", seq: 9, version: 9, part: 1, parts: 2, data: [] });
  socket.unsubscribe("tickers");
  socket.subscribe("tickers");
  transport.emit("tickers", 10, "snapshot");
  assert.equal(frames.at(-1)?.seq, 10, "unsubscription clears incomplete snapshot buffers");
  assert.equal(gaps, 0);
});

test("a released pending ticket cannot authenticate the next private connection", async (t) => {
  const instances = mockSockets(t);
  const resolveTickets: Array<(ticket: string) => void> = [];
  const socket = new TradexSocket("private", {
    fetchTicket: () => new Promise((resolve) => resolveTickets.push(resolve)),
  });
  t.after(() => socket.close());
  const release = socket.retain();
  release();
  socket.retain();
  resolveTickets[0]("previous-session");
  await settle();
  assert.equal(instances.length, 0);
  assert.equal(resolveTickets.length, 2);
  resolveTickets[1]("current-session");
  await settle();
  const transport = instances[0];
  transport.onopen?.();
  assert.deepEqual(transport.sent, [{ op: "auth", ticket: "current-session" }]);
  const lateOpen = transport.onopen;
  socket.close();
  assert.equal(transport.onopen, null);
  lateOpen?.();
  assert.equal(socket.getStatus(), "closed");
});

test("additional subscriptions wait for socket closure and respect reconnect backoff", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const instances = mockSockets(t);
  const socket = new TradexSocket("public");
  t.after(() => socket.close());
  let gaps = 0;
  socket.onGap(() => { gaps += 1; });
  socket.subscribe("tickers");
  await settle();
  instances[0].close();
  socket.subscribe("disclosures");
  assert.equal(instances.length, 1);
  t.mock.timers.tick(1400);
  assert.equal(instances.length, 2);
  await settle();

  const closing = instances[1];
  closing.deferClose = true;
  closing.emit("tickers", 1, "snapshot");
  closing.emit("tickers", 3);
  socket.subscribe("market_state");
  assert.equal(instances.length, 2, "the closing connection still owns its reconnect");
  const lateClose = closing.onclose;
  lateClose?.();
  assert.equal(gaps, 2, "a gap's close event does not reconcile twice");
  t.mock.timers.tick(1400);
  assert.equal(instances.length, 3);
  instances[2].onopen?.();
  lateClose?.();
  assert.equal(socket.getStatus(), "open", "an old close callback cannot reset the replacement connection");
});
