"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiData, clearIdempotencyKeys, csrfToken, deleteData, postData } from "../api";
import { updatePreferences } from "../preferences";
import type { Passkey, SessionList, User } from "../types";
import { closeSocket } from "../ws";

/**
 * The CSRF cookie is issued and cleared together with the session cookie, so
 * without it there is no session to ask about and a guest never calls /me.
 */
export function fetchMe(signal?: AbortSignal): Promise<User | null> {
  if (!csrfToken()) return Promise.resolve(null);
  return apiData<User>("/api/v1/me", { signal });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
    staleTime: 60_000,
  });
}

export function useSessions() {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: ({ signal }) => apiData<SessionList>("/api/v1/me/sessions?limit=50", { signal }),
    staleTime: 15_000,
  });
}

export function usePasskeys(enabled = true) {
  return useQuery({
    queryKey: ["passkeys"],
    queryFn: ({ signal }) => apiData<Passkey[]>("/api/v1/me/passkeys", { signal }),
    enabled,
    staleTime: 15_000,
  });
}

export function useRevokeSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionIds: string[]) =>
      postData<{ revoked_count: number; current_revoked: boolean }>(
        "/api/v1/me/sessions/revoke",
        { session_ids: sessionIds },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useRevokeAllSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      postData<{ revoked_count: number; current_revoked: boolean }>(
        "/api/v1/me/sessions/revoke-all",
        {},
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useDeletePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (passkeyId: string) =>
      deleteData<{ status: string }>(`/api/v1/me/passkeys/${encodeURIComponent(passkeyId)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
    },
  });
}

export function useRotateRecoveryKeys() {
  return useMutation({
    mutationFn: () =>
      postData<{ recovery_keys: string[] }>(
        "/api/v1/me/recovery-keys/rotate",
        {},
      ),
  });
}

/**
 * Drops everything cached under the current session except the observed auth
 * query, so the next account never sees the previous one's data.
 */
export async function clearSessionCache(queryClient: QueryClient): Promise<void> {
  const notMe = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== "me";
  closeSocket("private");
  clearIdempotencyKeys();
  await queryClient.cancelQueries({ predicate: notMe });
  queryClient.removeQueries({ predicate: notMe });
  queryClient.getMutationCache().clear();
}

/** Reset existing observers when the browser switches directly to another account. */
export function resetSessionCache(queryClient: QueryClient): Promise<void> {
  closeSocket("private");
  clearIdempotencyKeys();
  queryClient.getMutationCache().clear();
  return queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== "me" });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postData<{ status: string }>("/api/v1/auth/logout", {}),
    // A failed logout may leave the HttpOnly session cookie valid. Clearing the
    // local cache and showing the login screen then would be a fail-open on a
    // shared device, so only a confirmed sign-out changes local state.
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ["me"], exact: true });
      queryClient.setQueryData(["me"], null);
      updatePreferences({ selectedAccount: undefined });
      await clearSessionCache(queryClient);
    },
  });
}
