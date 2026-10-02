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
