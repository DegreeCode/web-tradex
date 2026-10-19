"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { onLinkedNetworkChanged, onSessionExpired } from "@/lib/api";
import { authStatus, type AuthStatus } from "@/lib/auth-status";
import { clearSessionCache, resetSessionCache, useMe } from "@/lib/hooks/session";
import { broadcastSessionChange, onSessionChange, type SessionIdentity } from "@/lib/session-sync";
import { setSignedIn } from "@/lib/session-mode";
import type { SessionScope, User } from "@/lib/types";



interface AuthValue {
  status: AuthStatus;
  user: User | null;
  /** The scope of a device-linked session; null for a full (passkey) session. */
  linkedScope: SessionScope | null;
  refresh: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const query = useMe();
  const queryClient = useQueryClient();

  useEffect(
    () =>
      onSessionExpired(() => {
        setSignedIn(false);
        // Cancel before replacing data: a /me response already in flight must
        // not restore the account after another request invalidated its session.
        void queryClient.cancelQueries({ queryKey: ["me"], exact: true }).then(() => {
          queryClient.setQueryData(["me"], null);
        });
      }),
    [queryClient],
  );

  // The account this tab last confirmed; undefined until /me first resolves.
  const confirmedIdentity = useRef<SessionIdentity | undefined>(undefined);

  // Another tab signed in, signed out, or switched accounts. Cancel the local
  // /me answer, drop the old account's private cache, and ask again with the
  // new cookies before showing anything. A tab already on that account keeps
  // its cache, sockets and pending idempotency keys.
  useEffect(
    () =>
      onSessionChange((identity) => {
        if (confirmedIdentity.current === identity) return;
        setSignedIn(false);
        void queryClient.cancelQueries({ queryKey: ["me"], exact: true }).then(() => {
          void clearSessionCache(queryClient).then(() => {
            // Invalidation retains the previous user while /me is loading.
            // Reset hides that identity until the new cookies are confirmed.
            void queryClient.resetQueries({ queryKey: ["me"], exact: true });
          });
        });
      }),
    [queryClient],
  );

  // Any request refused for a changed network means /me will be refused too;
  // re-reading it moves the app to the linked-blocked state.
  useEffect(
    () =>
      onLinkedNetworkChanged(() => {
        // /me emits this event too. Reuse an active check so it can settle
        // instead of repeatedly canceling and restarting its own refusal.
        void queryClient.invalidateQueries({ queryKey: ["me"] }, { cancelRefetch: false });
      }),
    [queryClient],
  );

  const auth = useMemo<AuthValue>(() => {
    const data = query.data as User | null | undefined;
    const errorCode =
      query.error && typeof query.error === "object" && "code" in query.error
        ? String((query.error as { code?: string }).code)
        : undefined;

    const status = authStatus(data, query.isError, errorCode);

    const user = status === "authenticated" ? data ?? null : null;
    return {
      status,
      user,
      linkedScope: user?.session_type === "LINKED" ? user.scope ?? null : null,
      refresh: () => {
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      },
    };
  }, [query.data, query.error, query.isError, queryClient]);

  const [cacheUserId, setCacheUserId] = useState<string | null>(null);
  const userId = auth.status === "authenticated" ? auth.user?.user_id ?? null : null;
  const value = useMemo<AuthValue>(
    () => auth.status === "authenticated" && cacheUserId !== userId
      ? { ...auth, status: "loading", user: null, linkedScope: null }
      : auth,
    [auth, cacheUserId, userId],
  );

  // Streams and session-only requests start only once the session is
  // confirmed; until then (and after it ends) the app browses as a guest.
  useEffect(() => {
    setSignedIn(value.status === "authenticated");
  }, [value.status]);

  // A confirmed account change (including sign-in and sign-out) is announced
  // to the other tabs, which then re-read /me and clear their private caches.
  // The first answer only learns the current session: opening or reloading a
  // tab must not reset the others.
  useEffect(() => {
    if (auth.status === "loading") return;
    const previous = confirmedIdentity.current;
    confirmedIdentity.current = userId;
    if (previous === undefined || previous === userId) return;
    broadcastSessionChange(userId);
  }, [auth.status, userId]);

  // Private queries aren't keyed by user, so the cache must not outlive the
  // account that filled it: a session that ends drops it, and a different
  // account signing in refetches what is on screen.
  useEffect(() => {
    if (auth.status === "loading" || cacheUserId === userId) return;
    let cancelled = false;
    async function synchronizeSession() {
      if (cacheUserId !== null) {
        if (userId === null) {
          await clearSessionCache(queryClient);
        } else {
          // Reset synchronously, preserving mounted query observers. Fresh
          // requests may finish after the next account becomes visible.
          void resetSessionCache(queryClient);
        }
      }
      // Keep the next account hidden until the previous session's state is
      // cleared; don't let a superseded transition reveal another account.
      await Promise.resolve();
      if (!cancelled) setCacheUserId(userId);
    }
    void synchronizeSession();
    return () => {
      cancelled = true;
    };
  }, [auth.status, cacheUserId, userId, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
