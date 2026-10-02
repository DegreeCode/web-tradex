import { SharedSockets, type ClientPort } from "./ws-shared";
import { WS_PROTOCOL_VERSION } from "./ws-protocol";
import { TradexSocket, type StreamSocket, type WsKind } from "./ws-transport";

export { socketUrl, TradexSocket } from "./ws-transport";
export type { StreamSocket, WsKind, WsStatus } from "./ws-transport";

let shared: SharedSockets | null | undefined;

/**
 * Every tab of this origin shares one public and one private connection
 * through a SharedWorker; the server caps private connections per account.
 * Without SharedWorker each tab keeps its own.
 */
function sharedSockets(): SharedSockets | null {
  if (shared !== undefined) return shared;
  if (typeof window === "undefined") return null;
  shared = null;
  if (typeof SharedWorker === "undefined") return null;
  shared = new SharedSockets({
    connect: () => {
      const worker = new SharedWorker(new URL("./ws-worker.ts", import.meta.url), {
        name: `tradex-ws-v${WS_PROTOCOL_VERSION}`,
      });
      return {
        port: worker.port as unknown as ClientPort,
        onError: (handler) => worker.addEventListener("error", handler),
      };
    },
  });
  return shared;
}

const sockets = new Map<WsKind, TradexSocket>();

export function getSocket(kind: WsKind): StreamSocket {
  const hub = sharedSockets();
  if (hub) return hub.socket(kind);
  let socket = sockets.get(kind);
  if (!socket) {
    socket = new TradexSocket(kind);
    sockets.set(kind, socket);
  }
  return socket;
}

export function closeSocket(kind: WsKind): void {
  const hub = sharedSockets();
  if (hub) {
    // Public channels belong to their subscribers; only a session ends here.
    if (kind === "private") hub.resetPrivate();
    return;
  }
  const socket = sockets.get(kind);
  if (!socket) return;
  socket.close();
  sockets.delete(kind);
}
