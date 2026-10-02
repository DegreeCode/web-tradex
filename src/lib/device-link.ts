import { ApiError } from "./api";
import type { LinkedPermission } from "./types";

export const DEVICE_LINKS_PATH = "/api/v1/auth/device-links";
export const DEVICE_LINK_CURRENT_PATH = "/api/v1/auth/device-links/current";

export type DeviceLinkStatus = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CONSUMED";

export interface DeviceLinkStart {
  link_id: string;
  user_code: string;
  verification_path: string;
  expires_at: string;
  poll_interval_seconds: number;
}

export interface DeviceLinkPoll {
  status: DeviceLinkStatus;
  expires_at: string;
}

export type DeviceLinkOutcome = "waiting" | "signed-in" | "denied" | "expired" | "failed";

const DEFAULT_POLL_MS = 5_000;
const MIN_POLL_MS = 1_000;
const MAX_POLL_MS = 60_000;
// RFC 8628 slow_down: each rate-limit answer permanently widens the interval.
const SLOW_DOWN_STEP_MS = 5_000;

/** The approving device's answer, read from one poll. */
export function deviceLinkOutcome(status: string): DeviceLinkOutcome {
  switch (status) {
    case "PENDING":
      return "waiting";
    // APPROVED is the poll that set the session cookies; CONSUMED means an
    // earlier poll already did, so the session check decides either way.
    case "APPROVED":
    case "CONSUMED":
      return "signed-in";
    case "DENIED":
      return "denied";
    case "EXPIRED":
      return "expired";
    default:
      return "failed";
  }
}

export function pollIntervalMs(seconds: number | undefined): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, seconds * 1000));
}

export type PollFailure =
  | { kind: "retry"; intervalMs: number; delayMs: number }
  | { kind: "stop"; outcome: "expired" | "failed" };

/** Decides whether a failed poll is worth repeating, and when. */
export function pollFailure(error: unknown, intervalMs: number): PollFailure {
  if (error instanceof ApiError) {
    if (error.code === "DEVICE_LINK_EXPIRED") return { kind: "stop", outcome: "expired" };
    if (error.code === "DEVICE_LINK_INVALID") return { kind: "stop", outcome: "failed" };
    if (error.status === 429) {
      const widened = Math.min(MAX_POLL_MS, intervalMs + SLOW_DOWN_STEP_MS);
      const delayMs = Math.min(MAX_POLL_MS, Math.max(widened, error.retryAfterMs ?? 0));
      return { kind: "retry", intervalMs: widened, delayMs };
    }
    if (error.status === 0 || error.status >= 500) {
      return { kind: "retry", intervalMs, delayMs: Math.min(MAX_POLL_MS, intervalMs * 2) };
    }
    return { kind: "stop", outcome: "failed" };
  }
  return { kind: "retry", intervalMs, delayMs: Math.min(MAX_POLL_MS, intervalMs * 2) };
}

/**
 * The approval address shown to the user. Only a same-origin `/link` path is
 * accepted, so a server value can never turn the copy button into a link
 * elsewhere.
 */
export function verificationUrl(origin: string, path: string | null | undefined): string | null {
  if (!path || !/^\/link(?:[?#][^\s\\]*)?$/.test(path)) return null;
  return `${origin}${path}`;
}

export function remainingSeconds(expiresAt: string, now: number): number {
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

export function formatRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

// --- Approving side (a signed-in device) -----------------------------------

export const DEVICE_LINK_LOOKUP_PATH = "/api/v1/me/device-links/lookup";
export const DEVICE_LINK_APPROVE_OPTIONS_PATH = "/api/v1/me/device-links/approve-options";
export const DEVICE_LINK_APPROVE_PATH = "/api/v1/me/device-links/approve";
export const DEVICE_LINK_DENY_PATH = "/api/v1/me/device-links/deny";

export interface DeviceScopeLimits {
  max_ttl_minutes: number;
  max_idle_minutes: number;
  default_ttl_minutes: number;
  default_idle_minutes: number;
}

export interface DeviceLinkLookup {
  same_network: boolean;
  device_summary: string;
  created_at: string;
  expires_at: string;
  /** Newer servers only; the documented defaults stand in when it's missing. */
  limits?: DeviceScopeLimits;
}

export interface DeviceLinkScopeRequest {
  name: string;
  permissions: LinkedPermission[];
  account_ids: string[];
  bind_to_requester_network: boolean;
  ttl_minutes: number;
  idle_timeout_minutes: number;
}

export const FALLBACK_SCOPE_LIMITS: DeviceScopeLimits = {
  max_ttl_minutes: 10080,
  max_idle_minutes: 1440,
  default_ttl_minutes: 1440,
  default_idle_minutes: 120,
};

export const TTL_CHOICES = [60, 480, 1440, 10080] as const;
export const IDLE_CHOICES = [30, 120, 480, 1440] as const;

export const PERMISSION_ORDER: readonly LinkedPermission[] = ["READ", "TRADE", "TRANSFER", "MARGIN"];

export const PERMISSION_LABELS: Record<LinkedPermission, string> = {
  READ: "조회",
  TRADE: "주문",
  TRANSFER: "송금",
  MARGIN: "마진",
};

/**
 * The server's implication rules: everything includes READ and MARGIN needs
 * TRADE. Applied after every toggle so the form never shows a set the server
 * would silently widen.
 */
export function withImpliedPermissions(selected: Iterable<LinkedPermission>): LinkedPermission[] {
  const set = new Set<LinkedPermission>(selected);
  set.add("READ");
  if (set.has("MARGIN")) set.add("TRADE");
  return PERMISSION_ORDER.filter((permission) => set.has(permission));
}

/** Whether a checkbox is fixed on by another choice (READ always, TRADE under MARGIN). */
export function permissionLocked(permission: LinkedPermission, selected: readonly LinkedPermission[]): boolean {
  return permission === "READ" || (permission === "TRADE" && selected.includes("MARGIN"));
}

export function togglePermission(selected: readonly LinkedPermission[], permission: LinkedPermission): LinkedPermission[] {
  if (permissionLocked(permission, selected)) return withImpliedPermissions(selected);
  const next = selected.includes(permission)
    ? selected.filter((value) => value !== permission)
    : [...selected, permission];
  return withImpliedPermissions(next);
}

/** "조회만" for READ alone, otherwise the labels joined: "조회·주문". */
export function permissionSummary(permissions: readonly string[]): string {
  const known = PERMISSION_ORDER.filter((permission) => permissions.includes(permission));
  if (known.length <= 1) return "조회만";
  return known.map((permission) => PERMISSION_LABELS[permission]).join("·");
}

export function scopeLimits(lookup: Pick<DeviceLinkLookup, "limits"> | null | undefined): DeviceScopeLimits {
  const limits = lookup?.limits;
  if (
    !limits ||
    ![limits.max_ttl_minutes, limits.max_idle_minutes, limits.default_ttl_minutes, limits.default_idle_minutes].every(
      (value) => Number.isInteger(value) && value > 0,
    )
  ) {
    return FALLBACK_SCOPE_LIMITS;
  }
  return limits;
}

/** TTL choices the server accepts; the server's own max is offered when no preset fits. */
export function ttlChoices(limits: DeviceScopeLimits): number[] {
  const choices: number[] = TTL_CHOICES.filter((minutes) => minutes <= limits.max_ttl_minutes);
  return choices.length > 0 ? choices : [limits.max_ttl_minutes];
}

/** Idle choices must stay under the operator cap and strictly under the chosen TTL. */
export function idleChoices(limits: DeviceScopeLimits, ttlMinutes: number): number[] {
  const cap = Math.min(limits.max_idle_minutes, ttlMinutes - 1);
  const choices: number[] = IDLE_CHOICES.filter((minutes) => minutes <= cap);
  return choices.length > 0 ? choices : cap >= 5 ? [cap] : [];
}

/** The preset nearest to `preferred` without going over; the smallest one otherwise. */
export function pickChoice(choices: readonly number[], preferred: number): number | null {
  if (choices.length === 0) return null;
  const fitting = choices.filter((minutes) => minutes <= preferred);
  return fitting.length > 0 ? fitting[fitting.length - 1] : choices[0];
}

export function formatMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}일`;
  if (minutes % 60 === 0) return `${minutes / 60}시간`;
  return `${minutes}분`;
}

/**
 * Normalises what the person typed into the server's XXXX-XXXX form, or null
 * while it isn't eight code characters yet. The server decides validity.
 */
export function normalizeUserCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[0-9A-Z_]{8}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}
