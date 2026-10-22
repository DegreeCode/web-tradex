import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { applySymbolTradeFrame, fetchSymbolTrades } from "../src/lib/hooks/trades";
import { candleRuntime, retainCandleRuntime } from "../src/lib/candle-cache";
import type { CandlePage } from "../src/lib/candle-data";
import type { PublicTrade } from "../src/lib/types";
import { closeSocket, getSocket } from "../src/lib/ws";
import { mockSockets } from "./ws-fakes";

const symbol = "STREAM.M";
const trade = (sequence: number): PublicTrade => ({
  symbol, sequence, side: "BUY", price: String(sequence), quantity: "1", credit: String(sequence), fee: "0",
  timestamp: `2026-10-14T15:00:${String(sequence).padStart(2, "0")}Z`,
});
const frame = (type: "snapshot" | "update", data: PublicTrade[] | PublicTrade) =>
  ({ type, stream: `trades:${symbol}`, seq: 1, version: 1, data });
const key = ["candles", symbol, "1m", 200];
const empty = (): CandlePage => ({ data: [], syncedThrough: "2026-10-14T15:00:00Z", page: { next_cursor: null, has_more: false } });
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a trade sequence gap requests a snapshot and resumes without reconnecting", async (t) => {
  const client = new QueryClient();
  const release = retainCandleRuntime(symbol);
  const instances = mockSockets(t);
  const socket = getSocket("public");
  const off = socket.onFrame(frame => applySymbolTradeFrame(client, symbol, 150, frame));
  t.after(() => { off(); release(); client.clear(); closeSocket("public"); });
  socket.subscribe(`trades:${symbol}`);
  await settle();
  const transport = instances[0];
  transport.onopen?.();
  transport.emitFrame(frame("snapshot", [trade(1)]));
  transport.emitFrame({ ...frame("update", trade(3)), seq: 2, version: 2 });
  assert.equal(candleRuntime(symbol).awaitingSnapshotRecovery, true);
  assert.deepEqual(transport.sent.slice(-2), [
    { op: "unsubscribe", channel: `trades:${symbol}` },
    { op: "subscribe", channel: `trades:${symbol}` },
  ]);
  transport.emitFrame({ ...frame("update", trade(4)), seq: 3, version: 3 });
  assert.equal(candleRuntime(symbol).lastSequence, undefined, "updates wait for the requested snapshot");
  transport.emitFrame({ ...frame("snapshot", [trade(3), trade(2), trade(1)]), seq: 3, version: 3 });
  transport.emitFrame({ ...frame("update", trade(4)), seq: 4, version: 4 });
  assert.equal(candleRuntime(symbol).lastSequence, 4);
  assert.equal(candleRuntime(symbol).awaitingSnapshotRecovery, false);
  assert.equal(socket.getStatus(), "open");
  assert.equal(transport.closeCount, 0);
});

test("REST trade polls keep candles live once per sequence and stop merging when WS returns", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new QueryClient();
  const release = retainCandleRuntime(symbol);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => empty(), staleTime: Infinity });
  const off = observer.subscribe(() => {});
  await observer.refetch();
  let rows = [trade(1)];
  let pendingResponse: Promise<Response> | undefined;
  const response = () => Response.json({ data: rows, page: { has_more: false, next_cursor: null } });
  t.mock.method(globalThis, "fetch", async () => pendingResponse ?? response());
  const instances = mockSockets(t);
  t.after(() => { off(); release(); closeSocket("public"); client.clear(); });
  const poll = () => fetchSymbolTrades(client, symbol, 150);
  const count = () => client.getQueryData<CandlePage>(key)?.data[0]?.trade_count;
  await poll();
  assert.equal(count(), 1, "first offline REST trade reaches candles");
  await poll();
  assert.equal(count(), 1);
  rows = [trade(3), trade(2), trade(1)];
  await poll();
  assert.equal(count(), 3);
  rows = [trade(4), trade(3), trade(2)];
  await poll();
  assert.equal(count(), 4);
  let completePoll!: (response: Response) => void;
  pendingResponse = new Promise(resolve => { completePoll = resolve; });
  const latePoll = poll();
  const socket = getSocket("public");
  socket.subscribe(`trades:${symbol}`);
  await settle();
  instances[0].onopen?.();
  applySymbolTradeFrame(client, symbol, 150, frame("snapshot", rows));
  assert.equal(count(), 4, "returning WS snapshot does not recount polled trades");
  rows = [trade(5), ...rows];
  completePoll(response());
  await latePoll;
  pendingResponse = undefined;
  assert.equal(count(), 4, "a late REST completion cannot update live WS candles");
  applySymbolTradeFrame(client, symbol, 150, frame("update", trade(5)));
  assert.equal(count(), 5);
  instances[0].close();
  rows = [trade(6), trade(5), trade(4)];
  await poll();
  await poll();
  assert.equal(count(), 6, "a second outage preserves WS and REST sequence deduplication");
});
