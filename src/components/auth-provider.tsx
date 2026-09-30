"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { onSessionExpired } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import type { User } from "@/lib/types";

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "recovery";

interface AuthValue {
  status: AuthStatus;
  user: User | null;
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

  const value = useMemo<AuthValue>(() => {
    const data = query.data as User | null | undefined;
    const errorCode =
      query.error && typeof query.error === "object" && "code" in query.error
        ? String((query.error as { code?: string }).code)
        : undefined;

    let status: AuthStatus = "loading";
    if (data) status = "authenticated";
    else if (data === null) status = "anonymous";
    else if (query.isError) status = errorCode === "RECOVERY_RESTRICTED" ? "recovery" : "anonymous";

    return {
      status,
      user: data ?? null,
      refresh: () => {
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      },
    };
  }, [query.data, query.error, query.isError, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
