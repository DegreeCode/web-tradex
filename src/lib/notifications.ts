import {
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
  FileText,
  Info,
  KeyRound,
  Landmark,
  LifeBuoy,
  LogOut,
  MonitorSmartphone,
  PlusCircle,
  Send,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import type { Notification } from "./types";

export type NotificationTone = "info" | "success" | "warning" | "danger" | "neutral";

export interface NotificationPresentation {
  title: string;
  body: string;
  label: string;
  symbol?: string;
  icon: LucideIcon;
  tone: NotificationTone;
}

export interface ParsedNotificationBody {
  eventKey?: string;
  symbol?: string;
  reason?: string;
  count?: number;
}

export interface NotificationEventConfig {
  title: string;
  label: string;
  /** Builds the sentence with the symbol woven in, so it never reads "X에서 …". */
  body: (symbol?: string) => string;
  icon: LucideIcon;
  tone: NotificationTone;
}

/** "AAA.M 종목의" / "종목의" style prefixes for symbol-aware sentences. */
const symbolOf = (symbol: string | undefined, noun = "종목") => (symbol ? `${symbol} ${noun}` : noun);
const symbolPrefix = (symbol: string | undefined) => (symbol ? `${symbol} ` : "");

export type TradingEventType =
  | "SYMBOL_HALTED"
  | "SYMBOL_RESUMED"
  | "GLOBAL_MARKET_HALTED"
  | "GLOBAL_MARKET_RESUMED"
  | "DELIST_SCHEDULED"
  | "DELIST_CANCELED"
  | "DELISTED"
  | "SYMBOL_LISTED"
  | "SYMBOL_METADATA_CHANGED"
  | "ICON_REVOKED";

export const TRADING_EVENT_TYPES: ReadonlySet<TradingEventType> = new Set<TradingEventType>([
  "SYMBOL_HALTED",
  "SYMBOL_RESUMED",
  "GLOBAL_MARKET_HALTED",
  "GLOBAL_MARKET_RESUMED",
  "DELIST_SCHEDULED",
  "DELIST_CANCELED",
  "DELISTED",
  "SYMBOL_LISTED",
  "SYMBOL_METADATA_CHANGED",
  "ICON_REVOKED",
]);

export function isTradingEventType(value: string): value is TradingEventType {
  return TRADING_EVENT_TYPES.has(value as TradingEventType);
}

export const EVENT_CONFIG: Record<string, NotificationEventConfig> = {
  ICON_REVOKED: {
    title: "종목 아이콘 게시가 중단됐어요", label: "아이콘 심사",
    body: (symbol) => `${symbolPrefix(symbol)}아이콘 게시가 중단됐어요. 발행사 관리에서 사유를 확인해주세요.`,
    icon: Info, tone: "warning",
  },
  ICON_REJECTED: {
    title: "아이콘이 승인되지 않았어요",
    label: "아이콘 심사",
    body: (symbol) => `${symbolPrefix(symbol)}아이콘 요청이 반려됐어요. 내용을 고쳐 다시 요청할 수 있어요.`,
    icon: Info,
    tone: "warning",
  },
  CURVE_CEILING_REACHED: {
    title: "가격 밴드 상단에 도달했어요",
    label: "종목",
    body: (symbol) => `${symbolPrefix(symbol)}가격이 밴드 상단에 닿았어요. 발행사 관리에서 추가 발행을 검토해보세요.`,
    icon: Info,
    tone: "warning",
  },
  GLOBAL_MARKET_HALTED: {
    title: "전체 시장 거래가 멈췄어요",
    label: "시장",
    body: () => "모든 종목의 거래가 일시 중지됐어요. 재개되면 다시 알려드릴게요.",
    icon: Bell,
    tone: "danger",
  },
  GLOBAL_MARKET_RESUMED: {
    title: "시장 거래가 다시 열렸어요",
    label: "시장",
    body: () => "이제 모든 종목을 다시 거래할 수 있어요.",
    icon: Check,
    tone: "success",
  },
  TRADE_EXECUTED: {
    title: "주문이 체결됐어요",
    label: "거래",
    body: (symbol) => `${symbolPrefix(symbol)}주문이 체결됐어요.`,
    icon: ArrowRight,
    tone: "success",
  },
  OWNER_TRADE: {
    title: "소유자 거래가 공시됐어요",
    label: "시장 공시",
    body: (symbol) => `${symbolOf(symbol)} 소유자의 거래 내역이 공시됐어요.`,
    icon: FileText,
    tone: "info",
  },
  OWNER_STOCK_TRANSFER: {
    title: "소유자 주식 이동이 공시됐어요",
    label: "시장 공시",
    body: (symbol) => `${symbolOf(symbol)} 소유자의 주식 이동 내역이 공시됐어요.`,
    icon: FileText,
    tone: "info",
  },
  "transfer.updated": {
    title: "송금 상태가 바뀌었어요",
    label: "송금",
    body: () => "송금 내역에서 자세한 상태를 확인해보세요.",
    icon: Send,
    tone: "info",
  },
  SYMBOL_LISTED: {
    title: "새 종목이 상장됐어요",
    label: "시장",
    body: (symbol) => `${symbolOf(symbol)}이 새로 상장됐어요. 지금 거래할 수 있어요.`,
    icon: PlusCircle,
    tone: "success",
  },
  SYMBOL_METADATA_CHANGED: {
    title: "종목 정보가 바뀌었어요",
    label: "시장",
    body: (symbol) => `${symbolOf(symbol)}의 이름이나 설명이 바뀌었어요.`,
    icon: FileText,
    tone: "info",
  },
  ISSUANCE_CREATED: {
    title: "추가 발행이 완료됐어요",
    label: "시장",
    body: (symbol) => `${symbolPrefix(symbol)}주식이 추가로 발행됐어요.`,
    icon: PlusCircle,
    tone: "info",
  },
  ADDITIONAL_ISSUANCE: {
    title: "추가 발행이 완료됐어요",
    label: "시장",
    body: (symbol) => `${symbolPrefix(symbol)}주식이 추가로 발행됐어요.`,
    icon: PlusCircle,
    tone: "info",
  },
  LOCKUP_RELEASE: {
    title: "락업 물량이 풀렸어요",
    label: "시장",
    body: (symbol) => `${symbolOf(symbol)}의 락업 물량이 해제돼 거래할 수 있게 됐어요.`,
    icon: Check,
    tone: "success",
  },
  MANAGER_CHANGED: {
    title: "종목 매니저가 바뀌었어요",
    label: "시장",
    body: (symbol) => `${symbolOf(symbol)}의 매니저가 바뀌었어요.`,
    icon: Landmark,
    tone: "info",
  },
  MANAGER_FORCED_CHANGE: {
    title: "종목 매니저가 변경됐어요",
    label: "시장",
    body: (symbol) => `관리자 조치로 ${symbolOf(symbol)}의 매니저가 변경됐어요.`,
    icon: Info,
    tone: "warning",
  },
  SYMBOL_HALTED: {
    title: "거래가 일시 중지됐어요",
    label: "시장",
    body: (symbol) => `${symbolOf(symbol)}의 거래가 일시 중지됐어요.`,
    icon: Info,
    tone: "danger",
  },
  SYMBOL_RESUMED: {
    title: "거래가 다시 열렸어요",
    label: "시장",
    body: (symbol) => `${symbolOf(symbol)}을 다시 거래할 수 있어요.`,
    icon: Check,
    tone: "success",
  },
  DELIST_SCHEDULED: {
    title: "상장폐지가 예정됐어요",
    label: "시장",
    body: (symbol) => `${symbolOf(symbol)}이 상장폐지될 예정이에요. 보유 수량을 확인해주세요.`,
    icon: Info,
    tone: "warning",
  },
  DELIST_CANCELED: {
    title: "상장폐지가 취소됐어요",
    label: "시장",
    body: (symbol) => `${symbolOf(symbol)}의 상장폐지 예정이 취소됐어요.`,
    icon: Check,
    tone: "success",
  },
  DELISTED: {
    title: "종목이 상장폐지됐어요",
    label: "시장",
    body: (symbol) => `${symbolOf(symbol)}이 상장폐지됐어요.`,
    icon: Info,
    tone: "danger",
  },
  TRIGGER_CREATED: {
    title: "예약 주문을 등록했어요",
    label: "거래",
    body: (symbol) => `${symbolPrefix(symbol)}예약 주문을 등록했어요. 조건에 닿으면 자동으로 주문해요.`,
    icon: CalendarClock,
    tone: "info",
  },
  TRIGGER_AMENDED: {
    title: "예약 주문을 정정했어요",
    label: "거래",
    body: (symbol) => `${symbolPrefix(symbol)}예약 주문을 정정했어요. 바뀐 조건에 따라 주문해요.`,
    icon: CalendarClock,
    tone: "info",
  },
  TRIGGER_CANCELED: {
    title: "예약 주문을 취소했어요",
    label: "거래",
    body: (symbol) => `${symbolPrefix(symbol)}예약 주문을 취소했어요. 묶여 있던 Credit이나 주식은 다시 쓸 수 있어요.`,
    icon: Trash2,
    tone: "info",
  },
  TRIGGER_FAILED: {
    title: "예약 주문을 실행하지 못했어요",
    label: "거래",
    body: (symbol) => `${symbolPrefix(symbol)}예약 주문의 조건은 충족됐지만 주문을 실행하지 못했어요. 묶여 있던 Credit이나 주식은 돌려드렸어요.`,
    icon: Info,
    tone: "warning",
  },
  TRIGGER_EXPIRED: {
    title: "예약 주문이 만료됐어요",
    label: "거래",
    body: (symbol) => `${symbolPrefix(symbol)}예약 주문이 유효 기간 안에 조건에 닿지 않아 만료됐어요. 묶여 있던 Credit이나 주식은 돌려드렸어요.`,
    icon: CalendarClock,
    tone: "neutral",
  },
  TRIGGER_ACTIVATED: {
    title: "예약 주문이 실행됐어요",
    label: "거래",
    body: (symbol) => `${symbolPrefix(symbol)}예약 주문의 조건이 충족돼 주문을 실행했어요.`,
    icon: ArrowRight,
    tone: "success",
  },
  "margin.warning": {
    title: "마진 포지션이 위험해요",
    label: "마진",
    body: (symbol) =>
      `${symbolPrefix(symbol)}포지션의 위험 비율이 경고 기준 아래로 내려갔어요. 담보를 추가하거나 포지션을 줄여주세요.`,
    icon: ShieldCheck,
    tone: "warning",
  },
  "margin.liquidation_started": {
    title: "강제청산이 시작됐어요",
    label: "마진",
    body: (symbol) => `${symbolPrefix(symbol)}포지션이 유지 기준 아래로 떨어져 강제청산을 시작했어요.`,
    icon: ShieldCheck,
    tone: "danger",
  },
  "margin.liquidation_completed": {
    title: "강제청산이 끝났어요",
    label: "마진",
    body: (symbol) => `${symbolPrefix(symbol)}포지션의 강제청산이 끝났어요. 마진 화면에서 정산 결과를 확인해보세요.`,
    icon: ShieldCheck,
    tone: "danger",
  },
  "inquiry.replied": {
    title: "문의에 답변이 달렸어요",
    label: "문의",
    body: () => "고객센터에서 답변을 확인해보세요.",
    icon: LifeBuoy,
    tone: "info",
  },
  AUTH_PASSKEY_ADDED: {
    title: "패스키가 등록됐어요",
    label: "보안",
    body: () => "계정에 새 패스키가 등록됐어요. 직접 하지 않았다면 보안 설정을 확인해주세요.",
    icon: KeyRound,
    tone: "success",
  },
  AUTH_PASSKEY_DELETED: {
    title: "패스키가 삭제됐어요",
    label: "보안",
    body: () => "계정에서 패스키가 삭제됐어요. 직접 하지 않았다면 보안 설정을 확인해주세요.",
    icon: Trash2,
    tone: "warning",
  },
  AUTH_LOGOUT: {
    title: "로그아웃했어요",
    label: "보안",
    body: () => "계정에서 로그아웃했어요.",
    icon: LogOut,
    tone: "info",
  },
  AUTH_SESSIONS_REVOKED: {
    title: "다른 기기에서 로그아웃됐어요",
    label: "보안",
    body: () => "다른 기기의 로그인이 모두 종료됐어요.",
    icon: LogOut,
    tone: "warning",
  },
  AUTH_RECOVERY_ROTATED: {
    title: "복구키가 새로 발급됐어요",
    label: "보안",
    body: () => "이전 복구키는 더 이상 쓸 수 없어요. 새 복구키를 안전하게 보관해주세요.",
    icon: ShieldCheck,
    tone: "warning",
  },
  AUTH_SIGNUP: {
    title: "가입을 환영해요",
    label: "보안",
    body: () => "TradeX 가입이 완료됐어요. 가상 Credit으로 거래를 시작해보세요.",
    icon: ShieldCheck,
    tone: "success",
  },
  AUTH_LOGIN: {
    title: "새 로그인이 있었어요",
    label: "보안",
    body: () => "계정에 로그인했어요. 직접 하지 않았다면 보안 설정을 확인해주세요.",
    icon: ShieldCheck,
    tone: "success",
  },
  AUTH_RECOVERY: {
    title: "복구키로 로그인했어요",
    label: "보안",
    body: () => "복구키로 계정에 로그인했어요. 사용한 복구키는 다시 쓸 수 없어요.",
    icon: ShieldCheck,
    tone: "success",
  },
  AUTH_DEVICE_LINK_APPROVED: {
    title: "기기 연결을 승인했어요",
    label: "보안",
    body: () => "다른 기기의 로그인 요청을 승인했어요. 직접 하지 않았다면 보안 메뉴에서 연결을 끊어주세요.",
    icon: MonitorSmartphone,
    tone: "warning",
  },
  AUTH_DEVICE_LINK_DENIED: {
    title: "기기 연결 요청을 거부했어요",
    label: "보안",
    body: () => "다른 기기의 로그인 요청을 거부했어요. 그 기기는 로그인되지 않아요.",
    icon: MonitorSmartphone,
    tone: "info",
  },
  AUTH_LINKED_SESSION_CREATED: {
    title: "연결된 기기가 로그인했어요",
    label: "보안",
    body: () => "승인한 기기가 로그인했어요. 보안 메뉴의 로그인 세션에서 확인하고 끊을 수 있어요.",
    icon: MonitorSmartphone,
    tone: "success",
  },
  AUTH_SUPER_ADMIN_BOOTSTRAP: {
    title: "최고 관리자 권한이 설정됐어요",
    label: "보안",
    body: () => "이 계정에 최고 관리자 권한이 설정됐어요.",
    icon: ShieldCheck,
    tone: "warning",
  },
  ACCOUNT_CREATED: {
    title: "계좌가 추가됐어요",
    label: "계좌",
    body: () => "새 계좌를 만들었어요. 계좌 화면에서 확인해보세요.",
    icon: Landmark,
    tone: "success",
  },
  ACCOUNT_DELETED: {
    title: "계좌가 삭제됐어요",
    label: "계좌",
    body: () => "계좌를 삭제했어요.",
    icon: Trash2,
    tone: "warning",
  },
};

export const TITLE_EVENT_KEYS: Record<string, string> = {
  "종목 아이콘 게시 중단": "ICON_REVOKED",
  "종목 아이콘 승인 거절": "ICON_REJECTED",
  "가격 밴드 상단 도달": "CURVE_CEILING_REACHED",
  "global market halted": "GLOBAL_MARKET_HALTED",
  "global market resumed": "GLOBAL_MARKET_RESUMED",
  "symbol halted": "SYMBOL_HALTED",
  "symbol resumed": "SYMBOL_RESUMED",
  "trade executed": "TRADE_EXECUTED",
  "trigger amended": "TRIGGER_AMENDED",
  "owner trade disclosure": "OWNER_TRADE",
  "owner stock transfer disclosure": "OWNER_STOCK_TRANSFER",
  "transfer updated": "transfer.updated",
  "symbol listed": "SYMBOL_LISTED",
  "symbol metadata changed": "SYMBOL_METADATA_CHANGED",
  "additional issuance": "ISSUANCE_CREATED",
  "lockup released": "LOCKUP_RELEASE",
  "delist scheduled": "DELIST_SCHEDULED",
  "delist canceled": "DELIST_CANCELED",
  "delist cancelled": "DELIST_CANCELED",
  "symbol delisted": "DELISTED",
  "inquiry reply": "inquiry.replied",
  // Titles earlier app versions showed, which may still come back as titles.
  "종목 아이콘 게시가 중단됐어요": "ICON_REVOKED",
  "종목 아이콘 승인이 거절됐어요": "ICON_REJECTED",
  "시장 전체 거래가 중지됐어요": "GLOBAL_MARKET_HALTED",
  "시장 거래가 재개됐어요": "GLOBAL_MARKET_RESUMED",
  "거래가 체결됐어요": "TRADE_EXECUTED",
  "소유자 거래 공시": "OWNER_TRADE",
  "소유자 주식 이동 공시": "OWNER_STOCK_TRANSFER",
  "송금 상태가 변경됐어요": "transfer.updated",
  "종목 정보가 변경됐어요": "SYMBOL_METADATA_CHANGED",
  "락업 물량이 해제됐어요": "LOCKUP_RELEASE",
  "매니저가 변경됐어요": "MANAGER_CHANGED",
  "매니저가 강제 변경됐어요": "MANAGER_FORCED_CHANGE",
  "종목 거래가 중지됐어요": "SYMBOL_HALTED",
  "종목 거래가 재개됐어요": "SYMBOL_RESUMED",
  "예약 주문이 발동됐어요": "TRIGGER_ACTIVATED",
  "담보 비율을 확인해주세요": "margin.warning",
  "강제 청산이 시작됐어요": "margin.liquidation_started",
  "강제 청산이 완료됐어요": "margin.liquidation_completed",
  "문의에 답변이 도착했어요": "inquiry.replied",
  "패스키가 추가됐어요": "AUTH_PASSKEY_ADDED",
  "로그아웃됐어요": "AUTH_LOGOUT",
  "다른 세션이 종료됐어요": "AUTH_SESSIONS_REVOKED",
  "복구 수단이 변경됐어요": "AUTH_RECOVERY_ROTATED",
  "가입이 완료됐어요": "AUTH_SIGNUP",
  "로그인됐어요": "AUTH_LOGIN",
  "복구 인증이 완료됐어요": "AUTH_RECOVERY",
  "관리자 권한이 설정됐어요": "AUTH_SUPER_ADMIN_BOOTSTRAP",
};

export const REASON_LABELS: Record<string, string> = {
  HALT_EXPIRED: "거래정지 기간 종료",
  MANUAL: "관리자 조치",
  MAINTENANCE: "시스템 점검",
  // Why a trigger order could not run once its condition was met.
  POOL_INVENTORY_EMPTY: "시장에 남은 물량이 없어요",
  INSUFFICIENT_CREDIT: "Credit 잔액이 부족해요",
  INSUFFICIENT_SHARES: "보유 수량이 부족해요",
  "held shares are no longer available": "보유 수량이 부족해요",
  "invalid position quantity": "보유 수량이 맞지 않아요",
  SLIPPAGE_EXCEEDED: "허용한 슬리피지를 벗어났어요",
  INVALID_PRICE_TICK: "주문 가격 단위가 맞지 않아요",
  NUMERIC_OVERFLOW: "주문 금액이 너무 커요",
  GLOBAL_HALTED: "전체 시장 거래가 멈춰 있어요",
  SYMBOL_HALTED: "종목 거래가 멈춰 있어요",
  PARTY_OR_SYMBOL_UNAVAILABLE: "계좌나 종목을 더 이상 쓸 수 없어요",
  GROUP_CANCELED: "묶음 주문을 취소했어요",
  CREDIT_LIMIT_EXHAUSTED: "예산을 모두 사용했어요",
  OCO_PEER_EXECUTED: "반대쪽 익절·손절 주문이 체결됐어요",
  "paired OCO order executed": "반대쪽 익절·손절 주문이 체결됐어요",
};

export const TONE_STYLES: Record<NotificationTone, { icon: string; body: string }> = {
  info: { icon: "bg-app-blue-light text-app-blue-dark", body: "text-app-gray-600" },
  success: { icon: "bg-app-green-light text-app-green", body: "text-app-gray-600" },
  warning: { icon: "bg-app-orange-light text-app-orange", body: "text-app-gray-600" },
  danger: { icon: "bg-app-red-light text-app-red", body: "text-app-gray-600" },
  neutral: { icon: "bg-app-gray-100 text-app-gray-600", body: "text-app-gray-500" },
};

export function isEnumToken(value: string): boolean {
  return (
    /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value) ||
    /^[a-z][a-z0-9]*(?:\.[a-z0-9_]+)+$/.test(value)
  );
}

export function parseNotificationBody(body: string): ParsedNotificationBody {
  const trimmed = body.trim();
  // "TRIGGER_FAILED: INSUFFICIENT_CREDIT" has no symbol; without this the
  // general pattern below reads the event as the symbol and the reason as the event.
  const unscoped = /^(?<event>[A-Za-z][A-Za-z0-9_.-]*)\s*:\s*(?<reason>.+)$/.exec(trimmed);
  if (unscoped?.groups?.event && EVENT_CONFIG[unscoped.groups.event]) {
    return { eventKey: unscoped.groups.event, reason: unscoped.groups.reason.trim() };
  }
  const batch = /^(?<symbol>[^\s:]+):\s*(?<count>\d+)\s+trade\(s\)\s+executed$/i.exec(
    trimmed,
  );
  if (batch?.groups?.symbol && batch.groups.count) {
    return {
      eventKey: "TRADE_EXECUTED",
      symbol: batch.groups.symbol,
      count: Number(batch.groups.count),
    };
  }

  const event = /^(?:(?<symbol>[^\s:]+)\s*:?\s+)?(?<event>[A-Za-z][A-Za-z0-9_.-]*)(?:\s+(?:알림|공시))?(?:\s*:\s*(?<reason>.+))?$/.exec(
    trimmed,
  );
  const eventKey = event?.groups?.event;
  if (!eventKey || (!EVENT_CONFIG[eventKey] && !isEnumToken(eventKey))) return {};
  return {
    eventKey,
    symbol: event.groups?.symbol,
    reason: event.groups?.reason?.trim(),
  };
}

export function eventKeyFromTitle(title: string): string | undefined {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    TITLE_EVENT_KEYS[normalized] ??
    Object.entries(EVENT_CONFIG).find(([, config]) => config.title.toLowerCase() === normalized)?.[0]
  );
}

/** Returns a readable reason, or null for an unknown code users can't act on. */
export function localizeReason(reason: string): string | null {
  if (REASON_LABELS[reason]) return REASON_LABELS[reason];
  return isEnumToken(reason) ? null : reason;
}

/** Stored OCO cancellation notices use prose; domain events can keep the token. */
export function isOcoPeerExecutedReason(reason: string | undefined): boolean {
  return reason === "OCO_PEER_EXECUTED" || reason === "paired OCO order executed";
}

export function presentNotification(notification: Notification): NotificationPresentation {
  const parsed = parseNotificationBody(notification.body);
  const titleEventKey = eventKeyFromTitle(notification.title);
  const eventKey = parsed.eventKey && EVENT_CONFIG[parsed.eventKey] ? parsed.eventKey : titleEventKey;
  const config = eventKey ? EVENT_CONFIG[eventKey] : undefined;

  if (config) {
    const symbol = parsed.symbol;
    const ocoPeerCanceled = eventKey === "TRIGGER_CANCELED" && isOcoPeerExecutedReason(parsed.reason);
    let body = config.body(symbol);
    if (ocoPeerCanceled) {
      body = `${symbolPrefix(symbol)}예약 주문이 반대쪽 익절·손절 주문 체결로 자동 취소됐어요.`;
    } else if (eventKey === "TRADE_EXECUTED" && parsed.count !== undefined) {
      body = `${symbol ? `${symbol} ` : ""}거래 ${parsed.count}건이 체결됐어요.`;
    }
    // Moderation reasons are user-facing text; other reasons are codes. An
    // expiry's reason only restates the deadline the body already explains.
    const reason = parsed.reason && eventKey !== "TRIGGER_EXPIRED" && !ocoPeerCanceled
      ? (eventKey === "ICON_REJECTED" || eventKey === "ICON_REVOKED") ? parsed.reason : localizeReason(parsed.reason)
      : null;
    if (reason) {
      body = eventKey === "ICON_REJECTED"
        ? `${symbol ? `${symbol} ` : ""}아이콘 요청이 반려됐어요. 사유: ${reason}`
        : `${body} 사유: ${reason}`;
    }
    return { ...config, body, symbol };
  }

  const hasRawEventBody = Boolean(parsed.eventKey && isEnumToken(parsed.eventKey));
  if (hasRawEventBody) {
    return {
      title: "새 알림이 도착했어요",
      body: parsed.symbol ? `${parsed.symbol} 종목에 새 소식이 있어요.` : "새 소식이 있어요.",
      label: notification.kind === "SYSTEM" ? "공지" : "알림",
      icon: notification.kind === "SYSTEM" ? Bell : Info,
      tone: "neutral",
      symbol: parsed.symbol,
    };
  }

  return {
    title: notification.title,
    body: notification.body,
    label: notification.kind === "SYSTEM" ? "공지" : "알림",
    icon: notification.kind === "SYSTEM" ? Bell : Info,
    tone: "neutral",
  };
}

export interface ParsedTradingNotification {
  eventType: TradingEventType;
  symbol?: string;
  reason?: string;
  halted_until?: string | null;
}

/**
 * Extracts explicit structured trading state event from a Notification.
 * NEVER infers trading changes from arbitrary prose.
 */
export function parseTradingNotification(
  notification: Notification | Record<string, unknown>,
): ParsedTradingNotification | null {
  if (!notification || typeof notification !== "object") return null;

  // 1. Check explicit structured payload if present
  const outerPayload = (notification as { payload?: Record<string, unknown> }).payload;
  if (outerPayload && typeof outerPayload === "object") {
    const pSymbol = typeof outerPayload.symbol === "string" ? outerPayload.symbol : undefined;
    const pReason = typeof outerPayload.reason === "string" ? outerPayload.reason : undefined;
    const pHaltedUntil = typeof outerPayload.halted_until === "string" ? outerPayload.halted_until : null;
    const pState = typeof outerPayload.state === "string" ? outerPayload.state : undefined;

    if (pState === "HALTED") {
      return { eventType: "SYMBOL_HALTED", symbol: pSymbol, reason: pReason, halted_until: pHaltedUntil };
    }
    if (pState === "TRADING") {
      return { eventType: "SYMBOL_RESUMED", symbol: pSymbol, reason: pReason };
    }
    if (pState === "DELIST_PENDING") {
      return { eventType: "DELIST_SCHEDULED", symbol: pSymbol, reason: pReason };
    }
    if (pState === "DELISTED") {
      return { eventType: "DELISTED", symbol: pSymbol, reason: pReason };
    }
    if (pState === "GLOBAL_HALTED") {
      return { eventType: "GLOBAL_MARKET_HALTED", symbol: pSymbol, reason: pReason, halted_until: pHaltedUntil };
    }
    if (pState === "RUNNING") {
      return { eventType: "GLOBAL_MARKET_RESUMED", symbol: pSymbol, reason: pReason };
    }
  }

  // 2. Check explicit event_type/event token on notification
  const explicitType = (notification as { event_type?: string; event?: string }).event_type ||
    (notification as { event_type?: string; event?: string }).event;
  if (explicitType && isTradingEventType(explicitType)) {
    const parsed = typeof notification.body === "string" ? parseNotificationBody(notification.body) : {};
    return {
      eventType: explicitType,
      symbol: parsed.symbol,
      reason: parsed.reason,
    };
  }

  // 3. Structured parsing from body
  const body = typeof notification.body === "string" ? notification.body : "";
  const parsed = parseNotificationBody(body);
  if (parsed.eventKey && isTradingEventType(parsed.eventKey)) {
    return {
      eventType: parsed.eventKey,
      symbol: parsed.symbol,
      reason: parsed.reason,
    };
  }

  // 4. Authoritative title match
  const title = typeof notification.title === "string" ? notification.title : "";
  const titleKey = eventKeyFromTitle(title);
  if (titleKey && isTradingEventType(titleKey)) {
    return {
      eventType: titleKey,
      symbol: parsed.symbol,
      reason: parsed.reason,
    };
  }

  // 5. Title exact enum match (e.g. title: "SYMBOL_HALTED")
  const titleTrimmed = title.trim();
  if (isTradingEventType(titleTrimmed)) {
    return {
      eventType: titleTrimmed,
      symbol: parsed.symbol,
      reason: parsed.reason,
    };
  }

  // Arbitrary prose or unrelated notifications return null
  return null;
}


export function formatUnreadBadge(count: number, hasMore: boolean): string | null {
  if (hasMore || count > 50) return "50+";
  return count > 0 ? String(count) : null;
}
