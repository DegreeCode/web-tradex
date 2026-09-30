import { ApiError, API_BASE_URL, markSessionExpired, postData } from "./api";
import type { WsFrame } from "./types";

export type WsKind = "public" | "private";
export type WsStatus = "connecting" | "open" | "closed";

type FrameHandler = (frame: WsFrame) => void;
type StatusHandler = (status: WsStatus) => void;
type GapHandler = (stream: string) => void;

const MAX_BACKOFF_MS = 30_000;

export function socketUrl(kind: WsKind): string {
  return `${API_BASE_URL.replace(/^http/, "ws")}/ws/v1/${kind}`;
}

export class TradexSocket {
  private readonly kind: WsKind;
  private socket: WebSocket | null = null;
  private readonly channels = new Map<string, number>();
  private readonly frameHandlers = new Set<FrameHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private readonly gapHandlers = new Set<GapHandler>();
  private readonly publicSeq = new Map<string, number>();
  private privateSeq: number | undefined;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: Promise<void> | null = null;
  private privateConsumers = 0;
  private stopped = false;
  private gapClosedSocket = false;
  private status: WsStatus = "closed";

  constructor(kind: WsKind) {
    this.kind = kind;
  }

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

  /** Retain a private connection until the last authenticated consumer leaves. */
  retain(): () => void {
    if (this.kind !== "private") return () => {};
    this.privateConsumers += 1;
    this.connect();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.privateConsumers = Math.max(0, this.privateConsumers - 1);
      if (this.privateConsumers === 0) this.close();
    };
  }

  connect(): void {
    if (typeof window === "undefined") return;
    this.stopped = false;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.connectPromise) return;
    this.connectPromise = this.openConnection().finally(() => {
      this.connectPromise = null;
      // A consumer can leave and return before the previous connection settles.
      // Resume that demand without bypassing failed-connection backoff.
      if (!this.stopped && !this.socket && !this.timer &&
          (this.kind === "public" ? this.channels.size > 0 : this.privateConsumers > 0)) {
        this.connect();
      }
    });
  }

  private async openConnection(): Promise<void> {
    this.setStatus("connecting");
    let ticket: string | undefined;
    if (this.kind === "private") {
      try {
        const response = await postData<{ ticket: string; expires_at: string; path: string }>(
          "/api/v1/me/ws-tickets",
          {},
        );
        if (!response || typeof response.ticket !== "string" || response.ticket.length === 0) {
          throw new Error("Invalid private websocket ticket response");
        }
        ticket = response.ticket;
      } catch (error) {
        if (this.stopped) return;
        if (isAuthenticationError(error)) {
          this.handleAuthenticationFailure();
          return;
        }
        this.setStatus("closed");
        this.scheduleReconnect();
        return;
      }
    }

    if (this.stopped) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl(this.kind));
    } catch {
      this.setStatus("closed");
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.kind === "private") {
        // The ticket is kept only in this closure and is never put in the URL,
        // headers, logs, or any other client-visible protocol field.
        this.send({ op: "auth", ticket });
      } else {
        for (const channel of this.channels.keys()) this.send({ op: "subscribe", channel });
      }
      this.setStatus("open");
    };
    socket.onmessage = (event) => {
      let frame: WsFrame;
      const raw = String(event.data);
      try {
        if (hasUnsafeProtocolInteger(raw)) throw new Error("unsafe websocket sequence");
        frame = JSON.parse(raw) as WsFrame;
      } catch {
        this.handleGap();
        return;
      }
      if (frame.type === "error" && frame.code === "SNAPSHOT_UNAVAILABLE") {
        this.handleGap();
        return;
      }
      if (
        this.kind === "private" &&
        frame.type === "error" &&
        (frame.code === "AUTH_FAILED" || frame.code === "SESSION_INVALID")
      ) {
        this.handleAuthenticationFailure();
        return;
      }
      if (!this.acceptSequence(frame)) return;
      for (const handler of this.frameHandlers) handler(frame);
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      const wasGapClosed = this.gapClosedSocket;
      this.gapClosedSocket = false;
      this.resetSequences();
      if (!this.stopped && !wasGapClosed) {
        for (const handler of this.gapHandlers) handler(this.kind);
      }
      this.setStatus("closed");
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      if (this.socket === socket) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }
    };
  }

  close(): void {
    this.stopped = true;
    this.gapClosedSocket = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    this.setStatus("closed");
    this.resetSequences();
  }

  private handleAuthenticationFailure(): void {
    this.stopped = true;
    this.gapClosedSocket = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    this.setStatus("closed");
    this.resetSequences();
    markSessionExpired();
  }

  subscribe(channel: string): void {
    if (this.kind === "private") return;
    const count = this.channels.get(channel) ?? 0;
    this.channels.set(channel, count + 1);
    if (count > 0) return;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({ op: "subscribe", channel });
    } else {
      this.connect();
    }
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
    this.publicSeq.delete(channel);
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ op: "unsubscribe", channel });
    if (this.kind === "public" && this.channels.size === 0) this.close();
  }

  hasChannels(): boolean {
    return this.channels.size > 0;
  }

  private send(payload: Record<string, unknown>): void {
    try {
      this.socket?.send(JSON.stringify(payload));
    } catch {
      /* socket closed between checks */
    }
  }

  private setStatus(status: WsStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of this.statusHandlers) handler(status);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt) + Math.floor(Math.random() * 400);
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }

  private acceptSequence(frame: WsFrame): boolean {
    if (frame.type !== "snapshot" && frame.type !== "update") return true;
    if (!frame.stream || !Number.isSafeInteger(frame.seq) || frame.version !== frame.seq) {
      this.handleGap();
      return false;
    }

    const seq = frame.seq as number;
    if (this.kind === "private") {
      // Private has no snapshot. The first live update starts the
      // connection-global sequence baseline at 1.
      if (frame.type === "snapshot") {
        this.handleGap();
        return false;
      }
      if (this.privateSeq === undefined) {
        if (seq !== 1) {
          this.handleGap();
          return false;
        }
        this.privateSeq = seq;
        this.attempt = 0;
        return true;
      }
      if (seq !== this.privateSeq + 1) {
        this.handleGap();
        return false;
      }
      this.privateSeq = seq;
      return true;
    }

    if (frame.type === "snapshot") {
      this.attempt = 0;
      this.publicSeq.set(frame.stream, seq);
      return true;
    }
    const previous = this.publicSeq.get(frame.stream);
    if (previous === undefined || seq !== previous + 1) {
      this.handleGap();
      return false;
    }
    this.publicSeq.set(frame.stream, seq);
    return true;
  }

  private handleGap(): void {
    // A protocol gap closes the whole connection, so every subscribed stream
    // needs to reconcile the updates it can miss while reconnecting.
    for (const handler of this.gapHandlers) handler(this.kind);
    this.resetSequences();
    const socket = this.socket;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      this.gapClosedSocket = true;
      socket.close();
    }
  }

  private resetSequences(): void {
    this.publicSeq.clear();
    this.privateSeq = undefined;
  }
}

// Only integers of 16+ digits can exceed Number.MAX_SAFE_INTEGER, so the
// common short values never reach the BigInt comparison.
function hasUnsafeProtocolInteger(raw: string): boolean {
  const matches = raw.matchAll(/"(?:seq|version|sequence)"\s*:\s*(-?\d{16,})/g);
  for (const match of matches) {
    try {
      const value = BigInt(match[1]);
      if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function isAuthenticationError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 401 || error.code === "SESSION_INVALID" || error.code === "AUTH_FAILED")
  );
}

const sockets = new Map<WsKind, TradexSocket>();

export function getSocket(kind: WsKind): TradexSocket {
  let socket = sockets.get(kind);
  if (!socket) {
    socket = new TradexSocket(kind);
    sockets.set(kind, socket);
  }
  return socket;
}

export function closeSocket(kind: WsKind): void {
  const socket = sockets.get(kind);
  if (!socket) return;
  socket.close();
  sockets.delete(kind);
}
