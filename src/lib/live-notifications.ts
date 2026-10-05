/**
 * Decides which notifications that arrive while the app is open deserve a
 * toast, and what that toast says and links to. Kept free of React so the
 * rules can be tested on their own.
 */
import {
  EVENT_CONFIG,
  eventKeyFromTitle,
  isOcoPeerExecutedReason,
  parseNotificationBody,
  presentNotification,
  type NotificationTone,
} from "./notifications";
import { symbolHref } from "./routes";
import type { Notification } from "./types";

export interface LiveToastAction {
  label: string;
  href: string;
}

export interface LiveToast {
  /** Toasts sharing an id replace each other, e.g. a resume replaces its halt. */
  id: string;
  title: string;
  description: string;
  tone: NotificationTone;
  /** Infinity keeps the toast until it is closed. */
  duration: number;
  action?: LiveToastAction;
}

interface LiveToastRule {
  action?: (symbol: string | undefined) => LiveToastAction | undefined;
  /** Shares one toast slot per symbol (or globally) so a later state replaces it. */
  slot?: (symbol: string | undefined) => string;
  /** Stays until closed: the user has to act or should not miss it. */
  sticky?: boolean;
  /** Longer than the default for warnings worth reading in full. */
  long?: boolean;
}

const ORDERS: LiveToastAction = { label: "주문 보기", href: "/orders" };
const OCO_PEER_CANCELED_RULE: LiveToastRule = { action: () => ORDERS };
const MARGIN: LiveToastAction = { label: "마진 보기", href: "/margin" };
const SECURITY: LiveToastAction = { label: "보안 확인", href: "/security" };
const symbolAction = (symbol: string | undefined): LiveToastAction | undefined =>
  symbol ? { label: "종목 보기", href: symbolHref(symbol) } : undefined;
const symbolSlot = (prefix: string) => (symbol: string | undefined) => `${prefix}:${symbol ?? "?"}`;

/**
 * Only events the user didn't just cause here and would want to know about
 * right away. Echoes of the user's own actions (logins, created orders,
 * created accounts) stay in the notification list.
 */
export const LIVE_TOAST_RULES: Record<string, LiveToastRule> = {
  TRADE_EXECUTED: { action: () => ORDERS },
  TRIGGER_ACTIVATED: { action: () => ORDERS },
  TRIGGER_FAILED: { action: () => ORDERS, long: true },
  TRIGGER_EXPIRED: { action: () => ORDERS },
  "margin.warning": { action: () => MARGIN, slot: symbolSlot("margin"), long: true },
  "margin.liquidation_started": { action: () => MARGIN, slot: symbolSlot("margin"), sticky: true },
  "margin.liquidation_completed": { action: () => MARGIN, slot: symbolSlot("margin"), sticky: true },
  GLOBAL_MARKET_HALTED: { slot: () => "market", sticky: true },
  GLOBAL_MARKET_RESUMED: { slot: () => "market" },
  SYMBOL_HALTED: { action: symbolAction, slot: symbolSlot("symbol"), long: true },
  SYMBOL_RESUMED: { action: symbolAction, slot: symbolSlot("symbol") },
  DELIST_SCHEDULED: { action: symbolAction, slot: symbolSlot("delist"), long: true },
  DELIST_CANCELED: { action: symbolAction, slot: symbolSlot("delist") },
  DELISTED: { action: () => ({ label: "투자 보기", href: "/portfolio" }), slot: symbolSlot("delist"), long: true },
  MANAGER_FORCED_CHANGE: { action: symbolAction, long: true },
  ICON_REJECTED: { action: symbolAction, long: true },
  "transfer.updated": { action: () => ({ label: "송금 내역", href: "/transfers" }) },
  "inquiry.replied": { action: () => ({ label: "답변 보기", href: "/support" }) },
  AUTH_PASSKEY_DELETED: { action: () => SECURITY, long: true },
  AUTH_SESSIONS_REVOKED: { action: () => SECURITY, long: true },
  AUTH_RECOVERY_ROTATED: { action: () => SECURITY, long: true },
  AUTH_DEVICE_LINK_APPROVED: { action: () => SECURITY, long: true },
  AUTH_LINKED_SESSION_CREATED: { action: () => SECURITY },
};

const DEFAULT_DURATION_MS = 6_000;
const LONG_DURATION_MS = 10_000;

/** How long an action taken in this tab silences the notification it produces. */
export const SELF_ACTION_WINDOW_MS = 30_000;

const selfActions: { event: string; symbol?: string; at: number }[] = [];

/**
 * Records that this tab just did something whose notification would only
 * repeat the result it already showed (a market fill, a sent transfer, a
 * deleted passkey).
 */
export function noteSelfAction(event: string, symbol?: string, now = Date.now()): void {
  pruneSelfActions(now);
  selfActions.push({ event, symbol, at: now });
}

function pruneSelfActions(now: number): void {
  while (selfActions.length > 0 && now - selfActions[0].at > SELF_ACTION_WINDOW_MS) selfActions.shift();
}

export function isSelfAction(event: string, symbol: string | undefined, now = Date.now()): boolean {
  pruneSelfActions(now);
  return selfActions.some((entry) =>
    entry.event === event && (!entry.symbol || !symbol || entry.symbol === symbol));
}

export function clearSelfActions(): void {
  selfActions.length = 0;
}

function eventOf(notification: Notification): { eventKey?: string; symbol?: string; reason?: string } {
  const parsed = parseNotificationBody(notification.body);
  const eventKey = parsed.eventKey && EVENT_CONFIG[parsed.eventKey]
    ? parsed.eventKey
    : eventKeyFromTitle(notification.title);
  return { eventKey, symbol: parsed.symbol, reason: parsed.reason };
}

/** The toast for a newly created notification, or null when it shouldn't interrupt. */
export function liveToastFor(notification: Notification, now = Date.now()): LiveToast | null {
  if (notification.read) return null;
  if (notification.expires_at && Date.parse(notification.expires_at) <= now) return null;
  const { eventKey, symbol, reason } = eventOf(notification);
  const ocoPeerCanceled = eventKey === "TRIGGER_CANCELED" && isOcoPeerExecutedReason(reason);
  const rule = ocoPeerCanceled ? OCO_PEER_CANCELED_RULE : eventKey ? LIVE_TOAST_RULES[eventKey] : undefined;
  if (!eventKey || !rule) return null;
  // An OCO peer fill cancels automatically, even if this tab just canceled another order.
  if (!ocoPeerCanceled && isSelfAction(eventKey, symbol, now)) return null;
  const presentation = presentNotification(notification);
  return {
    id: rule.slot ? `live:${rule.slot(symbol)}` : `live:${notification.notification_id}`,
    title: presentation.title,
    description: presentation.body,
    tone: presentation.tone,
    duration: rule.sticky ? Infinity : rule.long ? LONG_DURATION_MS : DEFAULT_DURATION_MS,
    action: rule.action?.(symbol),
  };
}
