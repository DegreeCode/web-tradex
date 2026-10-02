import type { WsFrame } from "./types";
import type { WsKind, WsStatus } from "./ws-transport";

/** Bumped whenever a message below changes shape; a tab and worker that differ don't talk. */
export const WS_PROTOCOL_VERSION = 1;

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
  | { op: "retain" }
  | { op: "release" }
  | { op: "reset-private" }
  | { op: "ticket-result"; id: number; ticket: string }
  | { op: "ticket-result"; id: number; error: TicketError }
  | { op: "visibility"; visible: boolean }
  | { op: "ping" }
  | { op: "bye" };

export type HubMessage =
  | { type: "welcome"; status: Record<WsKind, WsStatus> }
  | { type: "incompatible" }
  | { type: "frame"; kind: WsKind; frame: WsFrame }
  | { type: "status"; kind: WsKind; status: WsStatus }
  | { type: "gap"; kind: WsKind; stream: string }
  | { type: "ticket-request"; id: number }
  | { type: "session-expired" }
  | { type: "pong" }
  | { type: "resync" };

/** The part of a MessagePort both ends use, so tests can pass a fake. */
export interface PortLike<In, Out> {
  postMessage(message: Out): void;
  onmessage: ((event: { data: In }) => void) | null;
  close(): void;
}
