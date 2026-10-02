import type { User } from "./types";

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "recovery" | "linked-blocked";

/**
 * A failed refetch keeps the previous data, so a recovery or linked-session
 * restriction has to win over it: after a recovery key sign-in the cached
 * value is still the anonymous null from the login page.
 */
export function authStatus(data: User | null | undefined, isError: boolean, errorCode?: string): AuthStatus {
  if (isError && errorCode === "RECOVERY_RESTRICTED") return "recovery";
  // /me is open to every LINKED scope, so this answer means the session's
  // network binding no longer matches: the cookie is valid but unusable.
  if (isError && errorCode === "SESSION_SCOPE_FORBIDDEN") return "linked-blocked";
  if (data) return "authenticated";
  if (data === null || isError) return "anonymous";
  return "loading";
}
