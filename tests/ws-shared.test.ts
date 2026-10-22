import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/lib/api";
import type { WsFrame } from "../src/lib/types";
import { SocketHub, type HubPort } from "../src/lib/ws-hub";
import { WS_PROTOCOL_VERSION, type ClientMessage } from "../src/lib/ws-protocol";
import {
  HEARTBEAT_MS,
  SharedSockets,
  WELCOME_TIMEOUT_MS,
  type ClientPort,
  type SharedSocketsOptions,
} from "../src/lib/ws-shared";
import type { WsStatus } from "../src/lib/ws-transport";
import { FakePort, FakeTransport, type WorkerPort } from "./ws-fakes";

function setup(options: Partial<SharedSocketsOptions> = {}) {
  const ports: WorkerPort[] = [];
  const errorHandlers: Array<() => void> = [];
  const direct: FakeTransport[] = [];
  const client = new SharedSockets({
    connect: () => {
      const port: WorkerPort = new FakePort();
      ports.push(port);
      return { port, onError: (handler) => errorHandlers.push(handler) };
    },
    createSocket: (kind, hooks) => {
      const transport = new FakeTransport(kind, hooks);
      direct.push(transport);
      return transport;
    },
    requestTicket: async () => "ticket",
    onSessionExpired: () => {},
    ...options,
  });
  const port = () => ports.at(-1)!;
  const welcome = (status: Record<"public" | "private", WsStatus> = { public: "open", private: "open" }) =>
    port().deliver({ type: "welcome", generation: 0, status });
  return { client, ports, port, welcome, errorHandlers, direct };
}

function watch(socket: ReturnType<SharedSockets["socket"]>) {
  const events: string[] = [];
  socket.onFrame((frame) => events.push(`frame:${frame.stream}`));
  socket.onGap((stream) => events.push(`gap:${stream}`));
  socket.onStatus((status) => events.push(`status:${status}`));
  return events;
}

const ops = (messages: ClientMessage[]) => messages.map((message) => message.op);

test("this tab's reference counts reach the worker once", () => {
  const { client, port } = setup();
  try {
    assert.deepEqual(port().take(), [{ op: "hello", version: WS_PROTOCOL_VERSION, visible: true }]);
    const market = client.socket("public");
    market.subscribe("tickers");
    market.subscribe("tickers");
    market.unsubscribe("tickers");
    assert.deepEqual(port().take(), [{ op: "subscribe", channel: "tickers" }]);
    market.unsubscribe("tickers");
    assert.deepEqual(port().take(), [{ op: "unsubscribe", channel: "tickers" }]);

    const account = client.socket("private");
    const releaseA = account.retain();
    const releaseB = account.retain();
    releaseA();
    releaseA();
    assert.deepEqual(ops(port().take()), ["retain"]);
    releaseB();
    assert.deepEqual(ops(port().take()), ["release"]);
  } finally {
    client.dispose();
  }
});

test("frames, statuses and gaps from the worker reach the hooks", () => {
  const { client, port, welcome } = setup();
  try {
    const events = watch(client.socket("public"));
    welcome({ public: "open", private: "connecting" });
    assert.equal(client.socket("private").getStatus(), "connecting");
    port().deliver({ type: "frame", kind: "public", frame: { type: "snapshot", stream: "tickers", seq: 1, version: 1 } });
    port().deliver({ type: "frame", kind: "private", generation: 0, frame: { type: "update", stream: "orders", seq: 1, version: 1 } });
    port().deliver({ type: "gap", kind: "public", stream: "public" });
    port().deliver({ type: "status", kind: "public", status: "closed" });
    assert.deepEqual(events, ["status:open", "frame:tickers", "gap:public", "status:closed"]);
  } finally {
    client.dispose();
  }
});

test("the worker gets this tab's ticket, or the refusal with its code", async () => {
  let refuse = false;
  const { client, port, welcome } = setup({
    requestTicket: async () => {
      if (refuse) throw new ApiError(403, "SESSION_SCOPE_FORBIDDEN", "no", "", { reason: "NETWORK_MISMATCH" });
      return "tkt";
    },
  });
  try {
    welcome();
    port().take();
    port().deliver({ type: "ticket-request", id: 7, generation: 0 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(port().take(), [{ op: "ticket-result", id: 7, ticket: "tkt" }]);
    refuse = true;
    port().deliver({ type: "ticket-request", id: 8, generation: 0 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(port().take(), [{
      op: "ticket-result",
      id: 8,
      error: { status: 403, code: "SESSION_SCOPE_FORBIDDEN", message: "no", details: { reason: "NETWORK_MISMATCH" } },
    }]);
  } finally {
    client.dispose();
  }
});

test("a session the worker saw rejected is reported in this tab", () => {
  let expired = 0;
  const { client, port } = setup({ onSessionExpired: () => { expired += 1; } });
  try {
    port().deliver({ type: "welcome", generation: 0, status: { public: "closed", private: "closed" } });
    port().deliver({ type: "session-expired", generation: 0 });
    assert.equal(expired, 1);
  } finally {
    client.dispose();
  }
});

test("a tab the worker forgot re-introduces everything it holds and reconciles", () => {
  const { client, port, welcome } = setup();
  try {
    client.socket("public").subscribe("tickers");
    client.socket("private").retain();
    welcome();
    port().take();
    const publicEvents = watch(client.socket("public"));
    const privateEvents = watch(client.socket("private"));
    port().deliver({ type: "resync" });
    assert.deepEqual(ops(port().take()), ["hello", "subscribe", "retain"]);
    assert.deepEqual(publicEvents, ["status:closed", "gap:public"]);
    assert.deepEqual(privateEvents, ["status:closed", "gap:private"]);
    welcome();
    assert.deepEqual(privateEvents.at(-1), "status:open", "the reopen triggers the second reconcile");
  } finally {
    client.dispose();
  }
});

test("a worker that fails to start leaves this tab on its own connections", async () => {
  let expired = 0;
  const { client, port, errorHandlers, direct } = setup({ onSessionExpired: () => { expired += 1; } });
  try {
    client.socket("public").subscribe("tickers");
    const release = client.socket("private").retain();
    const events = watch(client.socket("public"));
    errorHandlers[0]();
    assert.equal(client.shared, false);
    assert.equal(port().closed, true);
    const [publicSocket, privateSocket] = direct;
    assert.equal(publicSocket.channels.get("tickers"), 1);
    assert.equal(privateSocket.retains, 1);
    assert.equal(await privateSocket.hooks.fetchTicket!(), "ticket");
    privateSocket.hooks.onAuthFailure!();
    assert.equal(expired, 1);
    assert.deepEqual(events, [], "nothing was missed before the worker ever answered");

    publicSocket.emit({ type: "snapshot", stream: "tickers", seq: 1, version: 1 });
    assert.deepEqual(events, ["frame:tickers"]);
    client.socket("public").subscribe("disclosures");
    assert.equal(publicSocket.channels.get("disclosures"), 1);

    client.resetPrivate();
    assert.equal(privateSocket.closed, true);
    assert.equal(direct[2].retains, 1, "the new private connection is still held");
    release();
    assert.equal(direct[2].retains, 0);
  } finally {
    client.dispose();
  }
});

test("a worker that never welcomes or speaks another version is given up on", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const silent = setup();
  try {
    t.mock.timers.tick(WELCOME_TIMEOUT_MS);
    assert.equal(silent.client.shared, false);
  } finally {
    silent.client.dispose();
  }
  const outdated = setup();
  try {
    outdated.port().deliver({ type: "incompatible" });
    assert.equal(outdated.client.shared, false);
  } finally {
    outdated.client.dispose();
  }
});

test("a worker that stops answering pings is replaced by a fresh connection", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { client, ports, port, welcome } = setup();
  try {
    client.socket("public").subscribe("tickers");
    welcome();
    const events = watch(client.socket("public"));
    for (let tick = 0; tick < 4; tick += 1) {
      t.mock.timers.tick(HEARTBEAT_MS);
      port().deliver({ type: "pong" });
    }
    assert.equal(ports.length, 1, "an answering worker is kept");

    t.mock.timers.tick(HEARTBEAT_MS);
    t.mock.timers.tick(HEARTBEAT_MS);
    assert.equal(ports.length, 1);
    t.mock.timers.tick(HEARTBEAT_MS);
    assert.equal(ports.length, 2);
    assert.equal(ports[0].closed, true);
    assert.deepEqual(ops(port().take()), ["hello", "subscribe"]);
    assert.deepEqual(events, ["status:closed", "gap:public"]);
  } finally {
    client.dispose();
  }
});

test("a tab frozen past its pings checks the worker again before giving up on it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { client, ports, welcome } = setup();
  try {
    welcome();
    t.mock.timers.tick(HEARTBEAT_MS);
    // Timers stopped while frozen; the next tick runs minutes late.
    t.mock.timers.setTime(Date.now() + HEARTBEAT_MS * 10);
    t.mock.timers.tick(HEARTBEAT_MS);
    assert.equal(ports.length, 1);
  } finally {
    client.dispose();
  }
});

test("two tabs share one connection through the worker", async () => {
  const transports: FakeTransport[] = [];
  const hub = new SocketHub({
    createSocket: (kind, hooks) => {
      const transport = new FakeTransport(kind, hooks);
      transports.push(transport);
      return transport;
    },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const openTab = () =>
    new SharedSockets({
      connect: () => {
        const channel = new MessageChannel();
        hub.addPort(channel.port1 as unknown as HubPort);
        return { port: channel.port2 as unknown as ClientPort, onError: () => {} };
      },
      requestTicket: async () => "tkt",
      onSessionExpired: () => {},
    });
  const first = openTab();
  const second = openTab();
  try {
    const received: Array<[string, WsFrame]> = [];
    first.socket("public").onFrame((frame) => received.push(["first", frame]));
    second.socket("public").onFrame((frame) => received.push(["second", frame]));
    first.socket("public").subscribe("tickers");
    await settle();
    const [publicSocket, privateSocket] = transports;
    assert.equal(hub.tabCount, 2);
    publicSocket.emit({ type: "snapshot", stream: "tickers", seq: 1, version: 1, data: [{ symbol: "AAA.M" }] });
    publicSocket.emit({ type: "update", stream: "tickers", seq: 2, version: 2, data: [{ symbol: "BBB.M" }] });
    await settle();
    second.socket("public").subscribe("tickers");
    await settle();
    assert.equal(publicSocket.channels.get("tickers"), 2);
    assert.deepEqual(received.map(([tab, frame]) => `${tab}:${frame.type}:${frame.seq}`), [
      "first:snapshot:1",
      "first:update:2",
      "second:snapshot:2",
    ]);

    first.socket("private").retain();
    await settle();
    assert.equal(privateSocket.retains, 1);
    assert.equal(await privateSocket.hooks.fetchTicket!(), "tkt");

    first.dispose();
    await settle();
    assert.equal(hub.tabCount, 1);
    assert.equal(publicSocket.channels.get("tickers"), 1);
    assert.equal(privateSocket.retains, 0);
  } finally {
    first.dispose();
    second.dispose();
  }
});

test("queued private messages cannot cross a tab's session reset", () => {
  let expired = 0;
  const { client, port, welcome } = setup({ onSessionExpired: () => { expired += 1; } });
  try {
    welcome();
    const account = client.socket("private");
    const release = account.retain();
    // The worker already posted these for A, but the tab has not handled them.
    const queued = [
      { type: "frame", kind: "private", generation: 0, frame: { type: "update", stream: "A-private", seq: 1, version: 1 } },
      { type: "status", kind: "private", generation: 0, status: "open" },
      { type: "gap", kind: "private", generation: 0, stream: "private" },
      { type: "session-expired", generation: 0 },
    ] as const;
    client.resetPrivate();
    release();
    account.retain();
    const events = watch(account);
    for (const message of queued) port().deliver(message);
    assert.deepEqual(events, []);
    assert.equal(expired, 0);
  } finally {
    client.dispose();
  }
});

test("only the latest reset acknowledgement resumes private delivery", () => {
  let expired = 0;
  const { client, port, welcome } = setup({ onSessionExpired: () => { expired += 1; } });
  try {
    welcome();
    client.socket("private").retain();
    client.resetPrivate();
    client.resetPrivate();
    const events = watch(client.socket("private"));
    const emit = (generation: number) => port().deliver({ type: "frame", kind: "private", generation,
      frame: { type: "update", stream: `account-${generation}`, seq: 1, version: 1 } });
    port().deliver({ type: "private-reset", generation: 1, resetId: 1 });
    emit(1);
    port().deliver({ type: "private-reset", generation: 2 });
    emit(2);
    assert.deepEqual(events, [], "another tab's reset cannot acknowledge ours");
    port().deliver({ type: "private-reset", generation: 3, resetId: 2 });
    for (const generation of [0, 1, 2]) {
      emit(generation);
      port().deliver({ type: "status", kind: "private", generation, status: "open" });
      port().deliver({ type: "gap", kind: "private", generation, stream: "private" });
      port().deliver({ type: "session-expired", generation });
    }
    assert.deepEqual(events, []);
    assert.equal(expired, 0);
    emit(3);
    port().deliver({ type: "status", kind: "private", generation: 3, status: "open" });
    assert.deepEqual(events, ["frame:account-3", "status:open"]);
  } finally {
    client.dispose();
  }
});

test("fallback resets detach private callbacks before closing the previous transport", () => {
  const { client, direct } = setup({ connect: () => { throw new Error("no worker"); } });
  try {
    const account = client.socket("private");
    account.retain();
    const old = direct[1];
    old.setStatus("open");
    const off = account.onStatus((status) => {
      if (status === "closed") old.emit({ type: "update", stream: "old-private", seq: 1, version: 1 });
    });
    const events = watch(account);
    client.resetPrivate();
    off();
    old.emit({ type: "update", stream: "A-private", seq: 1, version: 1 });
    old.gap("private");
    old.hooks.onAuthFailure?.();
    direct[2].emit({ type: "update", stream: "B-private", seq: 1, version: 1 });
    assert.deepEqual(events.filter(event => event.startsWith("frame:")), ["frame:B-private"]);
  } finally {
    client.dispose();
  }
});

test("snapshot requests reach the worker and direct fallback without changing reference counts", () => {
  const shared = setup();
  const fallback = setup({ connect: () => { throw new Error("no worker"); } });
  try {
    for (const { client } of [shared, fallback]) {
      const socket = client.socket("public");
      socket.subscribe("trades:AAA.M");
      socket.resubscribe("trades:AAA.M");
      socket.resubscribe("trades:unowned");
    }
    assert.deepEqual(shared.port().take().filter(message => message.op === "resubscribe"), [
      { op: "resubscribe", channel: "trades:AAA.M" },
    ]);
    assert.deepEqual(fallback.direct[0].resubscribed, ["trades:AAA.M"]);
    assert.equal(fallback.direct[0].channels.get("trades:AAA.M"), 1);
  } finally {
    shared.client.dispose();
    fallback.client.dispose();
  }
});

test("reset during private frame dispatch cannot add a new account to that dispatch", () => {
  const { client, port, welcome } = setup();
  try {
    welcome();
    const socket = client.socket("private");
    socket.retain();
    const received: string[] = [];
    const off = socket.onFrame(() => {
      off();
      client.resetPrivate();
      socket.onFrame(frame => received.push(frame.stream!));
    });
    port().deliver({ type: "frame", kind: "private", generation: 0,
      frame: { type: "update", stream: "A-private", seq: 1, version: 1 } });
    assert.deepEqual(received, []);
    port().deliver({ type: "private-reset", generation: 1, resetId: 1 });
    port().deliver({ type: "frame", kind: "private", generation: 1,
      frame: { type: "update", stream: "B-private", seq: 1, version: 1 } });
    assert.deepEqual(received, ["B-private"]);
  } finally {
    client.dispose();
  }
});
