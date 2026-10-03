import { useSyncExternalStore } from "react";

/**
 * Whether a signed-in session is confirmed. Until it is, the app browses as a
 * guest: no websocket, no session-only or exchange-info requests, and market
 * data is polled within the anonymous per-IP rate limit (60 requests/minute).
 * Signed-in requests carry the session cookie, public routes included, so they
 * count against the account's own limit instead.
 */
let signedIn = false;
const listeners = new Set<() => void>();

export function setSignedIn(next: boolean): void {
  if (signedIn === next) return;
  signedIn = next;
  for (const listener of listeners) listener();
}

export function isSignedIn(): boolean {
  return signedIn;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribe, isSignedIn, () => false);
}
