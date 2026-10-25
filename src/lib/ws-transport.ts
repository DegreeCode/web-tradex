import { ApiError, API_BASE_URL, markSessionExpired, postData } from "./api";
import type { WsFrame } from "./types";

export type WsKind = "public" | "private";
export type WsStatus = "connecting" | "open" | "closed";

type FrameHandler = (frame: WsFrame) => void;
type StatusHandler = (status: WsStatus) => void;
type GapHandler = (stream: string) => void;

const MAX_BACKOFF_MS = 30_000;

interface WireFrame extends WsFrame {
  part?: number;
  parts?: number;
}

interface PendingSnapshot {
  seq: number;
  parts: number;
  nextPart: number;
  data: unknown[];
}

/** What the stream hooks need from a socket, whether it is this tab's own or shared. */
export interface StreamSocket {
  getStatus(): WsStatus;
  onFrame(handler: FrameHandler): () => void;
  onStatus(handler: StatusHandler): () => void;
  onGap(handler: GapHandler): () => void;
  subscribe(channel: string): void;
  unsubscribe(channel: string): void;
  resubscribe(channel: string): void;
  retain(): () => void;
}

export interface SocketHooks {
  /** Issues a private ticket; a worker has no cookies to send the CSRF token from. */
  fetchTicket?: () => Promise<string>;
  /** An authenticated transport was rejected. */
  onAuthFailure?: () => void;
}

/** Issues a one-time private websocket ticket over REST. */
export async function requestWsTicket(): Promise<string> {
  const response = await postData<{ ticket: string; expires_at: string; path: string }>(
    "/api/v1/me/ws-tickets",
    {},
  );
  if (!response || typeof response.ticket !== "string" || response.ticket.length === 0) {
    throw new Error("Invalid private websocket ticket response");
  }
  return response.ticket;
}

function socketUrl(kind: WsKind): string {
  return `${API_BASE_URL.replace(/^http/, "ws")}/ws/v1/${kind}`;
}

export class TradexSocket implements StreamSocket {
  private readonly kind: WsKind;
  private readonly hooks: SocketHooks;
  private socket: WebSocket | null = null;
  private readonly channels = new Map<string, number>();
  private readonly frameHandlers = new Set<FrameHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private readonly gapHandlers = new Set<GapHandler>();
  private readonly publicSeq = new Map<string, number>();
  private readonly resubscribing = new Set<string>();
  private readonly partialSnapshots = new Map<string, PendingSnapshot>();
  private privateSeq: number | undefined;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: Promise<void> | null = null;
  private generation = 0;
  private privateConsumers = 0;
  private stopped = false;
  private gapClosedSocket = false;
  private status: WsStatus = "closed";

  constructor(kind: WsKind, hooks: SocketHooks = {}) {
    this.kind = kind;
    this.hooks = hooks;
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
    if (typeof WebSocket === "undefined") return;
    this.stopped = false;
    // A closing connection still owns its close callback and reconnect timer.
    if (this.socket) return;
    if (this.connectPromise || this.timer) return;
    this.connectPromise = this.openConnection(this.generation).finally(() => {
      this.connectPromise = null;
      // A consumer can leave and return before the previous connection settles.
      // Resume that demand without bypassing failed-connection backoff.
      if (!this.stopped && !this.socket && !this.timer &&
          (this.kind === "public" ? this.channels.size > 0 : this.privateConsumers > 0)) {
        this.connect();
      }
    });
  }

  private async openConnection(generation: number): Promise<void> {
    this.setStatus("connecting");
    let ticket: string | undefined;
    if (this.kind === "private") {
      try {
        ticket = await (this.hooks.fetchTicket ?? requestWsTicket)();
      } catch (error) {
        if (this.stopped || generation !== this.generation) return;
        if (isAuthenticationError(error)) {
          this.handleAuthenticationFailure();
          return;
        }
        // A session the server won't give a ticket to is refused on every
        // attempt; stay closed until the next retain so the private queries
        // poll REST instead.
        if (error instanceof ApiError && error.code === "SESSION_SCOPE_FORBIDDEN") {
          this.stopped = true;
          this.setStatus("closed");
          return;
        }
        this.setStatus("closed");
        this.scheduleReconnect();
        return;
      }
    }

    if (this.stopped || generation !== this.generation) return;
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
      if (this.socket !== socket) return;
      if (this.kind === "private") {
        // The ticket is kept only in this closure and is never put in the URL,
        // headers, logs, or any other client-visible protocol field.
        this.send({ op: "auth", ticket });
        // The server reads application commands only after consuming the ticket.
        // Its pong confirms authentication even when the account has no events.
        this.send({ op: "ping" });
      } else {
        for (const channel of this.channels.keys()) this.send({ op: "subscribe", channel });
      }
      if (this.kind === "public") this.setStatus("open");
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      let frame: WireFrame;
      const raw = String(event.data);
      try {
        if (hasUnsafeProtocolInteger(raw)) throw new Error("unsafe websocket sequence");
        const parsed: unknown = JSON.parse(raw);
        if (!isWsFrame(parsed)) throw new Error("invalid websocket frame");
        frame = parsed;
      } catch {
        this.handleGap();
        return;
      }
      // Unsubscribe acknowledgements can race with already queued updates.
      // They must not reset the sequences of channels still in use.
      if (this.kind === "public" && frame.stream && !this.channels.has(frame.stream)) return;
      const assembled = this.assembleSnapshot(frame);
      if (!assembled) return;
      frame = assembled;
      if (frame.type === "error" && frame.code === "SNAPSHOT_UNAVAILABLE") {
        this.handleGap();
        return;
      }
      if (
        this.kind === "private" &&
        frame.type === "error" &&
        frame.code === "SESSION_INVALID"
      ) {
        this.handleAuthenticationFailure();
        return;
      }
      if (this.kind === "private" && frame.type === "error" && frame.code === "AUTH_FAILED") {
        // Ticket consumption also fails for expiry and handshake timeouts.
        this.handleGap();
        return;
      }
      if (!this.acceptSequence(frame)) return;
      if (this.kind === "private" && (frame.type === "pong" || frame.type === "update")) {
        this.attempt = 0;
        this.setStatus("open");
      }
      for (const handler of [...this.frameHandlers]) {
        if (this.socket !== socket) break;
        handler(frame);
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      const generation = this.generation;
      this.socket = null;
      const wasGapClosed = this.gapClosedSocket;
      this.gapClosedSocket = false;
      this.resetSequences();
      if (!this.stopped && !wasGapClosed) {
        this.emitGap();
      }
      // A gap handler may have closed the socket for good.
      if (generation !== this.generation) return;
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
    this.generation += 1;
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
  }

  private handleAuthenticationFailure(): void {
    this.close();
    (this.hooks.onAuthFailure ?? markSessionExpired)();
  }

  subscribe(channel: string): void {
    if (this.kind === "private") return;
    const count = this.channels.get(channel) ?? 0;
    this.channels.set(channel, count + 1);
    if (count > 0) return;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
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
    this.resubscribing.delete(channel);
    this.partialSnapshots.delete(channel);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.send({ op: "unsubscribe", channel });
    if (this.kind === "public" && this.channels.size === 0) this.close();
  }

  /**
   * Asks again for a subscribed channel's snapshot; the server ignores a
   * repeated subscribe. Updates still in flight from before are dropped until
   * the new snapshot arrives instead of counting as a gap.
   */
  resubscribe(channel: string): void {
    if (this.kind === "private" || !this.channels.has(channel)) return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.publicSeq.delete(channel);
    this.resubscribing.add(channel);
    this.partialSnapshots.delete(channel);
    this.send({ op: "unsubscribe", channel });
    this.send({ op: "subscribe", channel });
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
    const generation = this.generation;
    for (const handler of [...this.statusHandlers]) {
      if (generation !== this.generation) break;
      handler(status);
    }
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
    if (!frame.stream || !isPositiveSafeInteger(frame.seq) || frame.version !== frame.seq) {
      this.handleGap();
      return false;
    }

    const seq = frame.seq;
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
      this.resubscribing.delete(frame.stream);
      this.publicSeq.set(frame.stream, seq);
      return true;
    }
    if (this.resubscribing.has(frame.stream)) return false;
    const previous = this.publicSeq.get(frame.stream);
    if (previous === undefined || seq !== previous + 1) {
      this.handleGap();
      return false;
    }
    this.publicSeq.set(frame.stream, seq);
    return true;
  }

  /** The server splits large array snapshots; publish only their complete contents. */
  private assembleSnapshot(frame: WireFrame): WireFrame | null {
    const stream = frame.stream;
    if (frame.part === undefined && frame.parts === undefined) {
      if (stream && this.partialSnapshots.has(stream)) {
        this.handleGap();
        return null;
      }
      return frame;
    }
    const { part, parts, seq } = frame;
    if (this.kind !== "public" || frame.type !== "snapshot" || !stream ||
        !isPositiveSafeInteger(seq) || frame.version !== seq ||
        !isPositiveSafeInteger(part) || !isPositiveSafeInteger(parts) || part > parts || !Array.isArray(frame.data)) {
      this.handleGap();
      return null;
    }
    let pending = this.partialSnapshots.get(stream);
    if (!pending && part === 1) {
      // Reuse the first part and append later rows without retaining raw frames
      // or repeatedly copying the already accumulated snapshot.
      pending = { seq, parts, nextPart: 1, data: frame.data };
      this.partialSnapshots.set(stream, pending);
    }
    if (!pending || pending.seq !== seq || pending.parts !== parts || pending.nextPart !== part) {
      this.handleGap();
      return null;
    }
    if (part !== 1) for (const row of frame.data) pending.data.push(row);
    pending.nextPart += 1;
    if (part !== parts) return null;
    this.partialSnapshots.delete(stream);
    const complete = { ...frame, data: pending.data };
    delete complete.part;
    delete complete.parts;
    return complete;
  }

  private emitGap(): void {
    const generation = this.generation;
    for (const handler of [...this.gapHandlers]) {
      if (generation !== this.generation) break;
      handler(this.kind);
    }
  }

  private handleGap(): void {
    // A protocol gap closes the whole connection, so every subscribed stream
    // needs to reconcile the updates it can miss while reconnecting.
    const socket = this.socket;
    const generation = this.generation;
    this.emitGap();
    if (generation !== this.generation || this.socket !== socket) return;
    this.resetSequences();
    if (socket && socket.readyState < WebSocket.CLOSING) {
      this.gapClosedSocket = true;
      socket.close();
    }
  }

  private resetSequences(): void {
    this.publicSeq.clear();
    this.resubscribing.clear();
    this.privateSeq = undefined;
    this.partialSnapshots.clear();
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isWsFrame(value: unknown): value is WireFrame {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const frame = value as Record<string, unknown>;
  return (
    (frame.type === "snapshot" || frame.type === "update" || frame.type === "pong" || frame.type === "error") &&
    (frame.stream === undefined || (typeof frame.stream === "string" && frame.stream.length > 0)) &&
    (frame.code === undefined || typeof frame.code === "string") &&
    (frame.event === undefined || typeof frame.event === "string")
  );
}

// Only 16+ digits can lose integer precision. Inspect those literals before
// JSON.parse rounds them, including large fractions rounded to a safe integer.
function hasUnsafeProtocolInteger(raw: string): boolean {
  const matches = raw.matchAll(/"(?:seq|version|sequence)"\s*:\s*(-?\d{16,})([.eE]?)/g);
  for (const match of matches) {
    if (match[2] || !Number.isSafeInteger(Number(match[1]))) return true;
  }
  return false;
}

function isAuthenticationError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 401 || error.code === "SESSION_INVALID" || error.code === "AUTH_FAILED")
  );
}
