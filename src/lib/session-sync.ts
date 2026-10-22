/**
 * Session changes (sign-in, sign-out, or a different account) must reach every
 * tab: private caches are not keyed by user, and the shared private socket is
 * one connection per origin.
 */
const CHANNEL = "tradex:session-sync";
const STORAGE_KEY = "tradex:session-epoch";

/** The account now signed in, or null after a sign-out. */
export type SessionIdentity = string | null;
// Undefined requests a fresh /me even when the account has not changed.
type Listener = (identity: SessionIdentity | undefined) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
let started = false;
const recentMessages = new Set<string>();
const MAX_RECENT_MESSAGES = 64;

type SessionMessage = {
  type: "changed";
  userId: SessionIdentity;
  nonce?: string;
} | {
  type: "refresh";
  userId?: never;
  nonce?: string;
};

function parse(data: unknown): SessionMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Partial<SessionMessage>;
  if (message.type === "refresh") {
    return { type: "refresh", nonce: typeof message.nonce === "string" ? message.nonce : undefined };
  }
  if (message.type !== "changed" ||
      !(message.userId === null || typeof message.userId === "string" && message.userId.length > 0)) return null;
  return { type: "changed", userId: message.userId, nonce: typeof message.nonce === "string" ? message.nonce : undefined };
}

function emit(message: SessionMessage): void {
  // BroadcastChannel and storage can deliver the same transition. Process it
  // once so the second delivery cannot cancel the fresh /me request.
  if (message.nonce) {
    if (recentMessages.has(message.nonce)) return;
    recentMessages.add(message.nonce);
    if (recentMessages.size > MAX_RECENT_MESSAGES) recentMessages.delete(recentMessages.values().next().value!);
  }
  for (const listener of listeners) listener(message.userId);
}

function onStorage(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    const message = parse(JSON.parse(event.newValue));
    if (message) emit(message);
  } catch {
    // A foreign or malformed value is not a session change.
  }
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (event) => {
        const message = parse(event.data);
        if (message) emit(message);
      };
    } catch {
      // Some browsers expose the API but deny it in restricted contexts.
    }
  }
  window.addEventListener("storage", onStorage);
}

function stop(): void {
  if (!started) return;
  window.removeEventListener("storage", onStorage);
  channel?.close();
  channel = null;
  started = false;
  recentMessages.clear();
}

/** Announces a completed session transition to every other tab. */
function broadcast(message: SessionMessage): void {
  if (typeof window === "undefined") return;
  start();
  message.nonce = `${Date.now()}-${Math.random()}`;
  try {
    channel?.postMessage(message);
  } catch {
    // The storage event can still deliver when the channel is unavailable.
  }
  try {
    // The nonce makes repeated identities still fire a storage event; removing
    // the key keeps the account ID from persisting in storage.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // BroadcastChannel still reaches tabs when storage is unavailable.
  }
  if (listeners.size === 0) stop();
}

export function broadcastSessionChange(userId: SessionIdentity): void {
  broadcast({ type: "changed", userId });
}

/** Cookies changed before /me can identify the account, including same-account logins. */
export function broadcastSessionRefresh(): void {
  broadcast({ type: "refresh" });
}

/** Registers a listener for session changes made by another tab. */
export function onSessionChange(handler: Listener): () => void {
  start();
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
    if (listeners.size === 0) stop();
  };
}
