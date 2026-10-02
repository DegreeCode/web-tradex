"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { onLinkedNetworkChanged, onSessionExpired } from "@/lib/api";
import { authStatus, type AuthStatus } from "@/lib/auth-status";
import { clearSessionCache, useMe } from "@/lib/hooks";
import type { SessionScope, User } from "@/lib/types";

export type { AuthStatus };

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
        queryClient.setQueryData(["me"], null);
      }),
    [queryClient],
  );

  // Any request refused for a changed network means /me will be refused too;
  // re-reading it moves the app to the linked-blocked state.
  useEffect(
    () =>
      onLinkedNetworkChanged(() => {
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      }),
    [queryClient],
  );

  const value = useMemo<AuthValue>(() => {
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

  // Private queries aren't keyed by user, so the cache must not outlive the
  // account that filled it: a session that ends drops it, and a different
  // account signing in refetches what is on screen.
  const signedInUserId = useRef<string | null>(null);
  const userId = value.status === "authenticated" ? value.user?.user_id ?? null : null;
  useEffect(() => {
    if (value.status === "loading") return;
    const previous = signedInUserId.current;
    signedInUserId.current = userId;
    if (previous === null || previous === userId) return;
    if (userId === null) {
      void clearSessionCache(queryClient);
    } else {
      void queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== "me" });
    }
  }, [value.status, userId, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
