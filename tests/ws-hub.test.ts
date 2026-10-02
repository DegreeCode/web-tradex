import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/lib/api";
import { PORT_TIMEOUT_MS, SocketHub, TICKET_TIMEOUT_MS } from "../src/lib/ws-hub";
import { WS_PROTOCOL_VERSION, type HubMessage } from "../src/lib/ws-protocol";
import { FakePort, FakeTransport, type TabPort } from "./ws-fakes";

function setup() {
  let now = 0;
  const transports: FakeTransport[] = [];
  const hub = new SocketHub({
    createSocket: (kind, hooks) => {
      const transport = new FakeTransport(kind, hooks);
      transports.push(transport);
      return transport;
    },
    now: () => now,
  });
  const publicSocket = transports[0];
  const privateSocket = () => transports.filter((transport) => transport.kind === "private").at(-1)!;
  const tab = (visible = true): TabPort => {
    const port: TabPort = new FakePort();
    hub.addPort(port);
    port.deliver({ op: "hello", version: WS_PROTOCOL_VERSION, visible });
    port.take();
    return port;
  };
  const advance = (ms: number) => { now += ms; };
  return { hub, publicSocket, privateSocket, transports, tab, advance };
}

const framesOf = (messages: HubMessage[]) =>
  messages.flatMap((message) => (message.type === "frame" ? [message.frame] : []));

test("a late tab gets the snapshot a fresh subscribe would send, and frames go only to subscribers", () => {
  const { publicSocket, tab } = setup();
  const first = tab();
  first.deliver({ op: "subscribe", channel: "tickers" });
  publicSocket.emit({ type: "snapshot", stream: "tickers", seq: 1, version: 1, data: [{ symbol: "AAA.M", last_price: "1" }] });
  publicSocket.emit({ type: "update", stream: "tickers", seq: 2, version: 2, data: [{ symbol: "AAA.M", last_price: "2" }] });
  assert.equal(framesOf(first.take()).length, 2);

  const late = tab();
  late.deliver({ op: "subscribe", channel: "tickers" });
  assert.deepEqual(framesOf(late.take()), [
    { type: "snapshot", stream: "tickers", seq: 2, version: 2, data: [{ symbol: "AAA.M", last_price: "2" }] },
  ]);
  assert.deepEqual(publicSocket.resubscribed, []);

  late.deliver({ op: "subscribe", channel: "trades:AAA.M" });
  publicSocket.emit({ type: "snapshot", stream: "trades:AAA.M", seq: 1, version: 1, data: [] });
  assert.equal(framesOf(first.take()).length, 0, "a tab never receives a channel it did not ask for");
  assert.equal(framesOf(late.take()).length, 1);

  first.deliver({ op: "unsubscribe", channel: "tickers" });
  assert.equal(publicSocket.channels.get("tickers"), 1);
  late.deliver({ op: "bye" });
  assert.equal(late.closed, true);
  assert.equal(publicSocket.channels.size, 0, "a tab that leaves releases everything it held");
});

test("a tab that joins before the snapshot receives it along with the first tab", () => {
  const { publicSocket, tab } = setup();
  const first = tab();
  const second = tab();
  first.deliver({ op: "subscribe", channel: "disclosures" });
  second.deliver({ op: "subscribe", channel: "disclosures" });
  assert.equal(framesOf(second.take()).length, 0);
  publicSocket.emit({ type: "snapshot", stream: "disclosures", seq: 1, version: 1, data: [] });
  assert.equal(framesOf(first.take()).length, 1);
  assert.equal(framesOf(second.take()).length, 1);
});

test("a channel whose updates can't be folded is asked for again when a tab joins", () => {
  const { publicSocket, tab } = setup();
  tab().deliver({ op: "subscribe", channel: "candles:AAA.M" });
  publicSocket.emit({ type: "snapshot", stream: "candles:AAA.M", seq: 1, version: 1, data: [] });
  tab().deliver({ op: "subscribe", channel: "candles:AAA.M" });
  assert.deepEqual(publicSocket.resubscribed, ["candles:AAA.M"]);
});

test("a lost connection forgets snapshots, so a joining tab waits for the new one", () => {
  const { publicSocket, tab } = setup();
  const first = tab();
  first.deliver({ op: "subscribe", channel: "tickers" });
  publicSocket.setStatus("open");
  publicSocket.emit({ type: "snapshot", stream: "tickers", seq: 1, version: 1, data: [] });
  publicSocket.gap("public");
  assert.ok(first.take().some((message) => message.type === "gap" && message.kind === "public"));

  const late = tab();
  late.deliver({ op: "subscribe", channel: "tickers" });
  assert.equal(framesOf(late.take()).length, 0);
  assert.deepEqual(publicSocket.resubscribed, []);
});

test("a visible tab holding the stream issues the ticket and private frames reach only holders", async () => {
  const { privateSocket, tab } = setup();
  const hidden = tab(false);
  const visible = tab(true);
  const watcher = tab(true);
  hidden.deliver({ op: "retain" });
  visible.deliver({ op: "retain" });
  assert.equal(privateSocket().retains, 2);

  const ticket = privateSocket().hooks.fetchTicket!();
  assert.equal(hidden.take().length, 0);
  const [request] = visible.take();
  assert.equal(request.type, "ticket-request");
  visible.deliver({ op: "ticket-result", id: (request as { id: number }).id, ticket: "tkt" });
  assert.equal(await ticket, "tkt");

  privateSocket().emit({ type: "update", stream: "notification.created", seq: 1, version: 1 });
  assert.equal(framesOf(hidden.take()).length, 1);
  assert.equal(framesOf(visible.take()).length, 1);
  assert.equal(framesOf(watcher.take()).length, 0);
});

test("an unanswered ticket request moves to the next tab and a refusal keeps its code", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { privateSocket, tab } = setup();
  const frozen = tab(true);
  const backup = tab(false);
  frozen.deliver({ op: "retain" });
  backup.deliver({ op: "retain" });

  const ticket = privateSocket().hooks.fetchTicket!();
  assert.equal(frozen.take()[0]?.type, "ticket-request");
  t.mock.timers.tick(TICKET_TIMEOUT_MS);
  await new Promise((resolve) => setImmediate(resolve));
  const [request] = backup.take();
  assert.equal(request?.type, "ticket-request");
  backup.deliver({
    op: "ticket-result",
    id: (request as { id: number }).id,
    error: { status: 401, code: "SESSION_INVALID", message: "expired" },
  });
  await assert.rejects(ticket, (error) => error instanceof ApiError && error.status === 401 && error.code === "SESSION_INVALID");
});

test("with no tab holding the stream the ticket fails like a network error", async () => {
  const { privateSocket } = setup();
  await assert.rejects(privateSocket().hooks.fetchTicket!(), (error) => error instanceof ApiError && error.code === "NETWORK_ERROR");
});

test("a rejected private connection tells every tab its session ended", () => {
  const { privateSocket, tab } = setup();
  const tabs = [tab(), tab()];
  privateSocket().hooks.onAuthFailure!();
  for (const port of tabs) assert.ok(port.take().some((message) => message.type === "session-expired"));
});

test("resetting the private stream replaces its connection and keeps the tabs holding it", () => {
  const { privateSocket, tab } = setup();
  const holder = tab();
  const other = tab();
  holder.deliver({ op: "retain" });
  const old = privateSocket();
  other.deliver({ op: "reset-private" });
  assert.equal(old.closed, true);
  assert.notEqual(privateSocket(), old);
  assert.equal(privateSocket().retains, 1);
  old.emit({ type: "update", stream: "orders", seq: 1, version: 1 });
  assert.equal(framesOf(holder.take()).length, 0, "the old connection is no longer listened to");
  holder.deliver({ op: "release" });
  assert.equal(privateSocket().retains, 0);
});

test("a tab silent past the timeout is dropped and told to resync when it speaks again", () => {
  const { hub, publicSocket, privateSocket, tab, advance } = setup();
  const sleeper = tab();
  const awake = tab();
  sleeper.deliver({ op: "subscribe", channel: "tickers" });
  sleeper.deliver({ op: "retain" });
  advance(PORT_TIMEOUT_MS / 2);
  awake.deliver({ op: "ping" });
  advance(PORT_TIMEOUT_MS / 2 + 1);
  hub.sweep();
  assert.equal(hub.tabCount, 1);
  assert.equal(publicSocket.channels.size, 0);
  assert.equal(privateSocket().retains, 0);

  sleeper.take();
  sleeper.deliver({ op: "ping" });
  assert.deepEqual(sleeper.take(), [{ type: "resync" }]);
});

test("a tab speaking another protocol version is turned away", () => {
  const { hub } = setup();
  const port: TabPort = new FakePort();
  hub.addPort(port);
  port.deliver({ op: "hello", version: WS_PROTOCOL_VERSION + 1, visible: true });
  assert.deepEqual(port.take(), [{ type: "incompatible" }]);
  assert.equal(hub.tabCount, 0);
});

test("a welcome carries the current status of both connections", () => {
  const { hub, publicSocket } = setup();
  publicSocket.setStatus("open");
  const port: TabPort = new FakePort();
  hub.addPort(port);
  port.deliver({ op: "hello", version: WS_PROTOCOL_VERSION, visible: true });
  assert.deepEqual(port.take(), [{ type: "welcome", status: { public: "open", private: "closed" } }]);
});
