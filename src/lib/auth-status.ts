import type { User } from "./types";

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "recovery";

/**
 * A failed refetch keeps the previous data, so a recovery restriction has to
 * win over it: after a recovery key sign-in the cached value is still the
 * anonymous null from the login page.
 */
export function authStatus(data: User | null | undefined, isError: boolean, errorCode?: string): AuthStatus {
  if (isError && errorCode === "RECOVERY_RESTRICTED") return "recovery";
  if (data) return "authenticated";
  if (data === null || isError) return "anonymous";
  return "loading";
}
