import { ApiError } from "./api";
import type { WsFrame } from "./types";
import { canFoldSnapshot, foldSnapshot } from "./ws-snapshots";
import {
  WS_PROTOCOL_VERSION,
  type ClientMessage,
  type HubMessage,
  type PortLike,
  type TicketError,
} from "./ws-protocol";
import type { SocketHooks, StreamSocket, WsKind } from "./ws-transport";

export type HubPort = PortLike<ClientMessage, HubMessage>;

/** The transport the hub drives; TradexSocket in the worker. */
export interface HubSocket extends StreamSocket {
  resubscribe(channel: string): void;
  close(): void;
}

export interface SocketHubOptions {
  createSocket: (kind: WsKind, hooks: SocketHooks) => HubSocket;
  now?: () => number;
}

// Hidden tabs may run their timers only once a minute, so a tab is given up
// on only after missing several heartbeats in a row.
export const PORT_TIMEOUT_MS = 180_000;
// A frozen tab never answers; the next tab is asked instead.
export const TICKET_TIMEOUT_MS = 10_000;

interface TabState {
  port: HubPort;
  channels: Set<string>;
  release: (() => void) | null;
  visible: boolean;
  lastSeen: number;
}

type TicketResult = { ticket: string } | { error: TicketError } | null;

interface PendingTicket {
  tab: TabState;
  resolve: (result: TicketResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Owns one public and one private connection for every tab of this origin.
 * Tabs subscribe through their ports; the hub keeps each channel subscribed
 * once, routes frames to the tabs that asked, and hands a tab that joins a
 * live channel the snapshot it would have received from its own subscribe.
 */
export class SocketHub {
  private readonly tabs = new Map<HubPort, TabState>();
  private readonly createSocket: SocketHubOptions["createSocket"];
  private readonly now: () => number;
  private readonly publicSocket: HubSocket;
  private privateSocket: HubSocket;
  private unwirePrivate: () => void;
  // Latest snapshot of each live channel with the updates since folded in.
  private readonly snapshots = new Map<string, WsFrame>();
  // Channels whose snapshot has already gone out on this connection.
  private readonly live = new Set<string>();
  private readonly pendingTickets = new Map<number, PendingTicket>();
  private nextTicketId = 1;

  constructor(options: SocketHubOptions) {
    this.createSocket = options.createSocket;
    this.now = options.now ?? Date.now;
    this.publicSocket = options.createSocket("public", {});
    this.publicSocket.onFrame((frame) => this.routePublic(frame));
    this.publicSocket.onStatus((status) => {
      if (status !== "open") this.forgetSnapshots();
      this.broadcast({ type: "status", kind: "public", status });
    });
    this.publicSocket.onGap((stream) => {
      this.forgetSnapshots();
      this.broadcast({ type: "gap", kind: "public", stream });
    });
    [this.privateSocket, this.unwirePrivate] = this.openPrivate();
  }

  addPort(port: HubPort): void {
    port.onmessage = (event) => this.receive(port, event.data);
  }

  /** Forgets tabs that stopped sending heartbeats; a later message makes them resync. */
  sweep(): void {
    const cutoff = this.now() - PORT_TIMEOUT_MS;
    for (const tab of [...this.tabs.values()]) {
      if (tab.lastSeen < cutoff) this.drop(tab);
    }
  }

  get tabCount(): number {
    return this.tabs.size;
  }

  private receive(port: HubPort, message: ClientMessage): void {
    if (message.op === "hello") {
      this.hello(port, message.version, message.visible);
      return;
    }
    const tab = this.tabs.get(port);
    if (!tab) {
      if (message.op === "bye") port.close();
      else this.post(port, { type: "resync" });
      return;
    }
    tab.lastSeen = this.now();
    switch (message.op) {
      case "subscribe":
        this.join(tab, message.channel);
        break;
      case "unsubscribe":
        this.leave(tab, message.channel);
        break;
      case "retain":
        tab.release ??= this.privateSocket.retain();
        break;
      case "release":
        tab.release?.();
        tab.release = null;
        break;
      case "reset-private":
        this.resetPrivate();
        break;
      case "ticket-result":
        this.settleTicket(message.id, tab, "ticket" in message ? { ticket: message.ticket } : { error: message.error });
        break;
      case "visibility":
        tab.visible = message.visible;
        break;
      case "ping":
        this.post(port, { type: "pong" });
        break;
      case "bye":
        this.drop(tab);
        port.close();
        break;
    }
  }

  private hello(port: HubPort, version: number, visible: boolean): void {
    if (version !== WS_PROTOCOL_VERSION) {
      this.post(port, { type: "incompatible" });
      return;
    }
    // A tab re-introducing itself on the same port starts over.
    const existing = this.tabs.get(port);
    if (existing) this.drop(existing);
    this.tabs.set(port, { port, channels: new Set(), release: null, visible, lastSeen: this.now() });
    this.post(port, {
      type: "welcome",
      status: { public: this.publicSocket.getStatus(), private: this.privateSocket.getStatus() },
    });
  }

  private join(tab: TabState, channel: string): void {
    if (tab.channels.has(channel)) return;
    const shared = this.subscriberCount(channel) > 0;
    tab.channels.add(channel);
    this.publicSocket.subscribe(channel);
    if (!shared) return;
    const snapshot = this.snapshots.get(channel);
    if (snapshot) {
      this.post(tab.port, { type: "frame", kind: "public", frame: snapshot });
    } else if (this.live.has(channel)) {
      // No folded copy to hand over: ask the server for a new snapshot, which
      // every subscriber of the channel then receives.
      this.live.delete(channel);
      this.publicSocket.resubscribe(channel);
    }
    // Otherwise the snapshot is still on its way and reaches this tab too.
  }

  private leave(tab: TabState, channel: string): void {
    if (!tab.channels.delete(channel)) return;
    this.publicSocket.unsubscribe(channel);
    if (this.subscriberCount(channel) === 0) {
      this.snapshots.delete(channel);
      this.live.delete(channel);
    }
  }

  private drop(tab: TabState): void {
    for (const channel of [...tab.channels]) this.leave(tab, channel);
    tab.release?.();
    tab.release = null;
    this.tabs.delete(tab.port);
    for (const [id, pending] of this.pendingTickets) {
      if (pending.tab === tab) this.settleTicket(id, tab, null);
    }
  }

  private subscriberCount(channel: string): number {
    let count = 0;
    for (const tab of this.tabs.values()) if (tab.channels.has(channel)) count += 1;
    return count;
  }

  private routePublic(frame: WsFrame): void {
    const stream = frame.stream;
    if (stream && frame.type === "snapshot") {
      this.live.add(stream);
      if (canFoldSnapshot(stream)) this.snapshots.set(stream, frame);
    } else if (stream && frame.type === "update") {
      const snapshot = this.snapshots.get(stream);
      if (snapshot) this.snapshots.set(stream, foldSnapshot(snapshot, frame));
    }
    for (const tab of this.tabs.values()) {
      if (!stream || tab.channels.has(stream)) this.post(tab.port, { type: "frame", kind: "public", frame });
    }
  }

  private forgetSnapshots(): void {
    this.snapshots.clear();
    this.live.clear();
  }

  private openPrivate(): [HubSocket, () => void] {
    const socket = this.createSocket("private", {
      fetchTicket: () => this.requestTicket(),
      onAuthFailure: () => this.broadcast({ type: "session-expired" }),
    });
    const offFrame = socket.onFrame((frame) => {
      for (const tab of this.tabs.values()) {
        if (tab.release) this.post(tab.port, { type: "frame", kind: "private", frame });
      }
    });
    const offStatus = socket.onStatus((status) => this.broadcast({ type: "status", kind: "private", status }));
    const offGap = socket.onGap((stream) => this.broadcast({ type: "gap", kind: "private", stream }));
    return [socket, () => {
      offFrame();
      offStatus();
      offGap();
    }];
  }

  /**
   * A session ended or changed in some tab: drop the connection authenticated
   * by the old ticket. Tabs still holding the stream reconnect with a new one.
   */
  private resetPrivate(): void {
    this.privateSocket.close();
    this.unwirePrivate();
    [this.privateSocket, this.unwirePrivate] = this.openPrivate();
    this.broadcast({ type: "status", kind: "private", status: this.privateSocket.getStatus() });
    for (const tab of this.tabs.values()) {
      if (tab.release) tab.release = this.privateSocket.retain();
    }
  }

  /** A worker can't read the CSRF cookie, so a tab holding the stream issues the ticket. */
  private async requestTicket(): Promise<string> {
    const asked = new Set<TabState>();
    for (;;) {
      const tab = this.ticketCandidate(asked);
      if (!tab) throw new ApiError(0, "NETWORK_ERROR", "네트워크에 연결하지 못했어요");
      asked.add(tab);
      const result = await this.askTicket(tab);
      if (!result) continue;
      if ("ticket" in result) return result.ticket;
      const { status, code, message, details } = result.error;
      throw new ApiError(status, code, message, "", details);
    }
  }

  private ticketCandidate(asked: Set<TabState>): TabState | null {
    let best: TabState | null = null;
    for (const tab of this.tabs.values()) {
      if (!tab.release || asked.has(tab)) continue;
      if (!best || (tab.visible && !best.visible) || (tab.visible === best.visible && tab.lastSeen > best.lastSeen)) {
        best = tab;
      }
    }
    return best;
  }

  private askTicket(tab: TabState): Promise<TicketResult> {
    const id = this.nextTicketId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settleTicket(id, tab, null), TICKET_TIMEOUT_MS);
      this.pendingTickets.set(id, { tab, resolve, timer });
      this.post(tab.port, { type: "ticket-request", id });
    });
  }

  private settleTicket(id: number, tab: TabState, result: TicketResult): void {
    const pending = this.pendingTickets.get(id);
    if (!pending || pending.tab !== tab) return;
    this.pendingTickets.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(result);
  }

  private broadcast(message: HubMessage): void {
    for (const tab of this.tabs.values()) this.post(tab.port, message);
  }

  private post(port: HubPort, message: HubMessage): void {
    try {
      port.postMessage(message);
    } catch {
      // A closed port is dropped by its bye or by the next sweep.
    }
  }
}
