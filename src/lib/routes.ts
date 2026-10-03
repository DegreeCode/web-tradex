export function symbolHref(symbol: string): string {
  return `/market/symbol?symbol=${encodeURIComponent(symbol)}`;
}

/** The sign-in page, returning to `next` (a path on this site) afterwards. */
export function loginHref(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}

/**
 * Returns `target` only when it is a path on this site; anything else (another
 * origin, a protocol-relative `//host`, `javascript:`) falls back to `/`, so a
 * crafted `?next=` link cannot send a freshly signed-in user off-site.
 */
export function safeRedirectPath(target: string | null | undefined): string {
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return "/";
  try {
    const base = "https://app.invalid";
    const url = new URL(target, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
