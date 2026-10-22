import type { TestContext } from "node:test";
import type { WsFrame } from "../src/lib/types";
import type { ClientMessage, HubMessage } from "../src/lib/ws-protocol";
import type { SocketHooks, WsKind, WsStatus } from "../src/lib/ws-transport";

/** Stands in for TradexSocket: records what it was asked and replays server events. */
export class FakeTransport {
  status: WsStatus = "closed";
  readonly channels = new Map<string, number>();
  readonly resubscribed: string[] = [];
  retains = 0;
  closed = false;
  private readonly frames = new Set<(frame: WsFrame) => void>();
  private readonly statuses = new Set<(status: WsStatus) => void>();
  private readonly gaps = new Set<(stream: string) => void>();

  constructor(
    readonly kind: WsKind,
    readonly hooks: SocketHooks,
  ) {}

  get handlerCount(): number {
    return this.frames.size + this.statuses.size + this.gaps.size;
  }

  getStatus(): WsStatus {
    return this.status;
  }

  onFrame(handler: (frame: WsFrame) => void) {
    this.frames.add(handler);
    return () => this.frames.delete(handler);
  }

  onStatus(handler: (status: WsStatus) => void) {
    this.statuses.add(handler);
    return () => this.statuses.delete(handler);
  }

  onGap(handler: (stream: string) => void) {
    this.gaps.add(handler);
    return () => this.gaps.delete(handler);
  }

  subscribe(channel: string): void {
    this.channels.set(channel, (this.channels.get(channel) ?? 0) + 1);
  }

  unsubscribe(channel: string): void {
    const count = (this.channels.get(channel) ?? 0) - 1;
    if (count > 0) this.channels.set(channel, count);
    else this.channels.delete(channel);
  }

  retain(): () => void {
    this.retains += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retains -= 1;
    };
  }

  resubscribe(channel: string): void {
    this.resubscribed.push(channel);
  }

  close(): void {
    this.closed = true;
    this.setStatus("closed");
  }

  emit(frame: WsFrame): void {
    for (const handler of this.frames) handler(frame);
  }

  setStatus(status: WsStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of this.statuses) handler(status);
  }

  gap(stream: string): void {
    for (const handler of this.gaps) handler(stream);
  }
}

/** One end of a port that records what is posted to it and lets a test talk back. */
export class FakePort<In, Out> {
  readonly sent: Out[] = [];
  onmessage: ((event: { data: In }) => void) | null = null;
  closed = false;

  postMessage(message: Out): void {
    this.sent.push(structuredClone(message));
  }

  close(): void {
    this.closed = true;
  }

  deliver(message: In): void {
    this.onmessage?.({ data: message });
  }

  take(): Out[] {
    return this.sent.splice(0);
  }
}

export type TabPort = FakePort<ClientMessage, HubMessage>;
export type WorkerPort = FakePort<HubMessage, ClientMessage>;

export function mockSockets(t: TestContext) {
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
