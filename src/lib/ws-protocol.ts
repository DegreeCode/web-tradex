import type { WsFrame } from "./types";
import type { WsKind, WsStatus } from "./ws-transport";

/** Bumped whenever a message below changes shape; a tab and worker that differ don't talk. */
export const WS_PROTOCOL_VERSION = 2;

/** An ApiError flattened so it survives postMessage. */
export interface TicketError {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ClientMessage =
  | { op: "hello"; version: number; visible: boolean }
  | { op: "subscribe"; channel: string }
  | { op: "unsubscribe"; channel: string }
  | { op: "resubscribe"; channel: string }
  | { op: "retain" }
  | { op: "release" }
  | { op: "reset-private"; resetId: number }
  | { op: "ticket-result"; id: number; ticket: string }
  | { op: "ticket-result"; id: number; error: TicketError }
  | { op: "visibility"; visible: boolean }
  | { op: "ping" }
  | { op: "bye" };

type StreamScope = { kind: "public" } | { kind: "private"; generation: number };

export type HubMessage =
  | { type: "welcome"; generation: number; status: Record<WsKind, WsStatus> }
  | { type: "incompatible" }
  | ({ type: "frame"; frame: WsFrame } & StreamScope)
  | ({ type: "status"; status: WsStatus } & StreamScope)
  | ({ type: "gap"; stream: string } & StreamScope)
  | { type: "ticket-request"; id: number; generation: number }
  | { type: "session-expired"; generation: number }
  | { type: "private-reset"; generation: number; resetId?: number }
  | { type: "pong" }
  | { type: "resync" };

/** The part of a MessagePort both ends use, so tests can pass a fake. */
export interface PortLike<In, Out> {
  postMessage(message: Out): void;
  onmessage: ((event: { data: In }) => void) | null;
  close(): void;
}
