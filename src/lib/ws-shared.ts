import { ApiError, markSessionExpired } from "./api";
import type { WsFrame } from "./types";
import {
  WS_PROTOCOL_VERSION,
  type ClientMessage,
  type HubMessage,
  type PortLike,
  type TicketError,
} from "./ws-protocol";
import {
  requestWsTicket,
  TradexSocket,
  type SocketHooks,
  type StreamSocket,
  type WsKind,
  type WsStatus,
} from "./ws-transport";

export type ClientPort = PortLike<HubMessage, ClientMessage>;

export interface SharedConnection {
  port: ClientPort;
  /** Registers for the worker failing to start. */
  onError(handler: () => void): void;
}

/** The part of TradexSocket a tab falls back to. */
type DirectSocket = StreamSocket & { close(): void };

export interface SharedSocketsOptions {
  connect: () => SharedConnection;
  createSocket?: (kind: WsKind, hooks: SocketHooks) => DirectSocket;
  requestTicket?: () => Promise<string>;
  onSessionExpired?: () => void;
}

// Kept above the hub's port timeout even when a hidden tab's timers run only
// once a minute.
export const HEARTBEAT_MS = 15_000;
// A worker that leaves a ping unanswered this long while the tab runs is gone.
export const PONG_TIMEOUT_MS = 20_000;
// Loading the worker script can be slow on a poor connection.
export const WELCOME_TIMEOUT_MS = 15_000;

type FrameHandler = (frame: WsFrame) => void;
type StatusHandler = (status: WsStatus) => void;
type GapHandler = (stream: string) => void;

/** What the hooks hold: this tab's reference counts and listeners for one kind. */
class SocketProxy implements StreamSocket {
  readonly channels = new Map<string, number>();
  retains = 0;
  private status: WsStatus = "closed";
  private readonly frameHandlers = new Set<FrameHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private readonly gapHandlers = new Set<GapHandler>();

  constructor(
    private readonly kind: WsKind,
    private readonly owner: SharedSockets,
  ) {}

  getStatus(): WsStatus {
    return this.status;
  }

  onFrame(handler: FrameHandler): () => void {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  onGap(handler: GapHandler): () => void {
    this.gapHandlers.add(handler);
    return () => this.gapHandlers.delete(handler);
  }

  subscribe(channel: string): void {
    if (this.kind === "private") return;
    const count = this.channels.get(channel) ?? 0;
    this.channels.set(channel, count + 1);
    if (count === 0) this.owner.subscribe(channel);
  }

  unsubscribe(channel: string): void {
    if (this.kind === "private") return;
    const count = this.channels.get(channel) ?? 0;
    if (count === 0) return;
    if (count > 1) {
      this.channels.set(channel, count - 1);
      return;
    }
    this.channels.delete(channel);
    this.owner.unsubscribe(channel);
  }

  retain(): () => void {
    if (this.kind !== "private") return () => {};
    this.retains += 1;
    if (this.retains === 1) this.owner.retain();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retains = Math.max(0, this.retains - 1);
      if (this.retains === 0) this.owner.release();
    };
  }

  emitFrame(frame: WsFrame): void {
    for (const handler of this.frameHandlers) handler(frame);
  }

  emitGap(stream: string): void {
    for (const handler of this.gapHandlers) handler(stream);
  }

  setStatus(status: WsStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of this.statusHandlers) handler(status);
  }
}

/** This tab's own connections, used when the shared worker can't be. */
class DirectBackend {
  private publicSocket: DirectSocket;
  private privateSocket: DirectSocket;
  private readonly unwire: Record<WsKind, () => void> = { public: () => {}, private: () => {} };
  private privateRelease: (() => void) | null = null;

  constructor(
    private readonly proxies: Record<WsKind, SocketProxy>,
    private readonly createSocket: NonNullable<SharedSocketsOptions["createSocket"]>,
  ) {
    this.publicSocket = this.open("public");
    this.privateSocket = this.open("private");
  }

  subscribe(channel: string): void {
    this.publicSocket.subscribe(channel);
  }

  unsubscribe(channel: string): void {
    this.publicSocket.unsubscribe(channel);
  }

  retain(): void {
    this.privateRelease ??= this.privateSocket.retain();
  }

  release(): void {
    this.privateRelease?.();
    this.privateRelease = null;
  }

  resetPrivate(): void {
    const held = this.privateRelease !== null;
    this.privateSocket.close();
    this.unwire.private();
    this.privateRelease = null;
    this.privateSocket = this.open("private");
    if (held) this.retain();
  }

  dispose(): void {
    this.publicSocket.close();
    this.privateSocket.close();
    this.unwire.public();
    this.unwire.private();
  }

  private open(kind: WsKind): DirectSocket {
    const socket = this.createSocket(kind, {});
    const proxy = this.proxies[kind];
    const offFrame = socket.onFrame((frame) => proxy.emitFrame(frame));
    const offStatus = socket.onStatus((status) => proxy.setStatus(status));
    const offGap = socket.onGap((stream) => proxy.emitGap(stream));
    this.unwire[kind] = () => {
      offFrame();
      offStatus();
      offGap();
    };
    proxy.setStatus(socket.getStatus());
    return socket;
  }
}

function ticketError(error: unknown): TicketError {
  if (error instanceof ApiError) {
    return { status: error.status, code: error.code, message: error.message, details: error.details };
  }
  return { status: 0, code: "NETWORK_ERROR", message: "네트워크에 연결하지 못했어요" };
}

function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * The tab side of the shared worker: hands the hooks per-kind sockets whose
 * subscriptions run over one worker-owned connection for every tab. When the
 * worker can't start or speaks another protocol version, this tab opens its
 * own connections instead.
 */
export class SharedSockets {
  private readonly proxies: Record<WsKind, SocketProxy>;
  private readonly connect: SharedSocketsOptions["connect"];
  private readonly createSocket: NonNullable<SharedSocketsOptions["createSocket"]>;
  private readonly requestTicket: () => Promise<string>;
  private readonly onSessionExpired: () => void;
  private port: ClientPort | null = null;
  private direct: DirectBackend | null = null;
  private welcomed = false;
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private lastTickAt: number | null = null;
  private awaitingPongSince: number | null = null;
  private readonly removeListeners: () => void;

  constructor(options: SharedSocketsOptions) {
    this.connect = options.connect;
    this.createSocket = options.createSocket ?? ((kind, hooks) => new TradexSocket(kind, hooks));
    this.requestTicket = options.requestTicket ?? requestWsTicket;
    this.onSessionExpired = options.onSessionExpired ?? markSessionExpired;
    this.proxies = { public: new SocketProxy("public", this), private: new SocketProxy("private", this) };
    this.open();
    this.heartbeat = setInterval(() => this.tick(), HEARTBEAT_MS);
    this.removeListeners = this.listen();
  }

  socket(kind: WsKind): StreamSocket {
    return this.proxies[kind];
  }

  /** Whether frames come from the worker rather than this tab's own connections. */
  get shared(): boolean {
    return this.direct === null;
  }

  /** Drops the private connection of a session that ended; holders reconnect with a new ticket. */
  resetPrivate(): void {
    if (this.direct) this.direct.resetPrivate();
    else this.send({ op: "reset-private" });
  }

  dispose(): void {
    clearInterval(this.heartbeat);
    this.removeListeners();
    this.closePort();
    this.direct?.dispose();
  }

  subscribe(channel: string): void {
    if (this.direct) this.direct.subscribe(channel);
    else this.send({ op: "subscribe", channel });
  }

  unsubscribe(channel: string): void {
    if (this.direct) this.direct.unsubscribe(channel);
    else this.send({ op: "unsubscribe", channel });
  }

  retain(): void {
    if (this.direct) this.direct.retain();
    else this.send({ op: "retain" });
  }

  release(): void {
    if (this.direct) this.direct.release();
    else this.send({ op: "release" });
  }

  private open(): void {
    let connection: SharedConnection;
    try {
      connection = this.connect();
    } catch {
      this.fallBack();
      return;
    }
    const port = connection.port;
    this.port = port;
    this.welcomed = false;
    this.awaitingPongSince = null;
    connection.onError(() => {
      if (this.port === port) this.fallBack();
    });
    port.onmessage = (event) => {
      if (this.port === port) this.receive(event.data);
    };
    this.introduce();
    this.welcomeTimer = setTimeout(() => {
      if (this.port === port && !this.welcomed) this.fallBack();
    }, WELCOME_TIMEOUT_MS);
  }

  /** Tells the worker who this tab is and everything it is holding. */
  private introduce(): void {
    this.send({ op: "hello", version: WS_PROTOCOL_VERSION, visible: pageVisible() });
    for (const channel of this.proxies.public.channels.keys()) this.send({ op: "subscribe", channel });
    if (this.proxies.private.retains > 0) this.send({ op: "retain" });
  }

  private receive(message: HubMessage): void {
    switch (message.type) {
      case "welcome":
        this.welcomed = true;
        this.clearWelcomeTimer();
        this.proxies.public.setStatus(message.status.public);
        this.proxies.private.setStatus(message.status.private);
        break;
      case "incompatible":
        this.fallBack();
        break;
      case "frame":
        this.proxies[message.kind].emitFrame(message.frame);
        break;
      case "status":
        this.proxies[message.kind].setStatus(message.status);
        break;
      case "gap":
        this.proxies[message.kind].emitGap(message.stream);
        break;
      case "ticket-request":
        void this.issueTicket(message.id);
        break;
      case "session-expired":
        this.onSessionExpired();
        break;
      case "pong":
        this.awaitingPongSince = null;
        break;
      case "resync":
        // The worker forgot this tab (it sat frozen past the heartbeat timeout).
        this.markMissed();
        this.introduce();
        break;
    }
  }

  private async issueTicket(id: number): Promise<void> {
    const port = this.port;
    try {
      const ticket = await this.requestTicket();
      if (this.port === port) this.send({ op: "ticket-result", id, ticket });
    } catch (error) {
      if (this.port === port) this.send({ op: "ticket-result", id, error: ticketError(error) });
    }
  }

  /**
   * Frames may have been lost: report closed streams and gaps so every hook
   * reconciles now and again once its stream is open.
   */
  private markMissed(): void {
    for (const kind of ["public", "private"] as const) {
      this.proxies[kind].setStatus("closed");
      this.proxies[kind].emitGap(kind);
    }
  }

  private fallBack(): void {
    if (this.direct) return;
    const missed = this.welcomed;
    this.closePort();
    if (missed) this.markMissed();
    const direct = new DirectBackend(this.proxies, this.createSocket);
    this.direct = direct;
    for (const channel of this.proxies.public.channels.keys()) direct.subscribe(channel);
    if (this.proxies.private.retains > 0) direct.retain();
  }

  /** Starts over with a fresh worker connection. */
  private reconnect(): void {
    if (this.direct) return;
    this.closePort();
    this.markMissed();
    this.open();
  }

  private tick(): void {
    if (this.direct || !this.port) return;
    const now = Date.now();
    // A tick far behind schedule means the tab was frozen, not that the
    // worker stopped answering; its ping is judged from this tick on.
    const resumed = this.lastTickAt !== null && now - this.lastTickAt > HEARTBEAT_MS * 3;
    this.lastTickAt = now;
    if (resumed) this.awaitingPongSince = null;
    if (this.awaitingPongSince !== null && now - this.awaitingPongSince > PONG_TIMEOUT_MS && pageVisible()) {
      this.reconnect();
      return;
    }
    this.send({ op: "ping" });
    this.awaitingPongSince ??= now;
  }

  private listen(): () => void {
    if (typeof window === "undefined" || typeof document === "undefined") return () => {};
    const onVisibility = () => {
      const visible = pageVisible();
      this.send({ op: "visibility", visible });
      if (visible) this.tick();
    };
    const onPageHide = () => this.closePort();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) this.reconnect();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }

  private closePort(): void {
    this.clearWelcomeTimer();
    const port = this.port;
    if (!port) return;
    this.send({ op: "bye" });
    this.port = null;
    port.onmessage = null;
    try {
      port.close();
    } catch {
      /* already closed */
    }
  }

  private clearWelcomeTimer(): void {
    if (!this.welcomeTimer) return;
    clearTimeout(this.welcomeTimer);
    this.welcomeTimer = null;
  }

  private send(message: ClientMessage): void {
    try {
      this.port?.postMessage(message);
    } catch {
      // The heartbeat notices a worker that went away.
    }
  }
}
