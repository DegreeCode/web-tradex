/**
 * Session changes (sign-in, sign-out, or a different account) must reach every
 * tab: private caches are not keyed by user, and the shared private socket is
 * one connection per origin.
 */
const CHANNEL = "tradex:session-sync";
const STORAGE_KEY = "tradex:session-epoch";

/** The account now signed in, or null after a sign-out. */
export type SessionIdentity = string | null;
type Listener = (identity: SessionIdentity) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
let started = false;

interface SessionMessage {
  type: "changed";
  userId: SessionIdentity;
}

function parse(data: unknown): SessionMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Partial<SessionMessage>;
  if (message.type !== "changed") return null;
  return { type: "changed", userId: typeof message.userId === "string" ? message.userId : null };
}

function emit(identity: SessionIdentity): void {
  for (const listener of listeners) listener(identity);
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event) => {
      const message = parse(event.data);
      if (message) emit(message.userId);
    };
  }
  window.addEventListener("storage", (event: StorageEvent) => {
    // The key is removed right after it is written; ignore that removal.
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const message = parse(JSON.parse(event.newValue));
      if (message) emit(message.userId);
    } catch {
      // A foreign or malformed value is not a session change.
    }
  });
}

/** Announces a completed session transition to every other tab. */
export function broadcastSessionChange(userId: SessionIdentity): void {
  if (typeof window === "undefined") return;
  start();
  const message: SessionMessage = { type: "changed", userId };
  channel?.postMessage(message);
  try {
    // The nonce makes repeated identities still fire a storage event; removing
    // the key keeps the account ID from persisting in storage.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...message, nonce: `${Date.now()}-${Math.random()}` }));
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // BroadcastChannel still reaches tabs when storage is unavailable.
  }
}

/** Test seam: clears module state between sessions in one process. */
export function resetSessionSyncForTests(): void {
  listeners.clear();
  channel?.close();
  channel = null;
  started = false;
}

/** Registers a listener for session changes made by another tab. */
export function onSessionChange(handler: Listener): () => void {
  start();
  listeners.add(handler);
  return () => listeners.delete(handler);
}
