import type { Page } from "./types";

const SESSION_EXPIRED_EVENT = "tradex:session-expired";

const configuredBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

export const API_BASE_URL = (
  configuredBase && configuredBase.length > 0 ? configuredBase : "http://localhost:8080"
).replace(/\/+$/, "");

/**
 * Resolves a server-relative asset path (e.g. an approved icon) against the
 * API origin. Anything that is not a plain `/path` is refused, so a value like
 * `@other.host/x` or `//other.host/x` cannot turn into a request elsewhere.
 */
export function apiAssetUrl(path: string | null | undefined): string | null {
  if (!path || !/^\/(?![/\\])[^\s]*$/.test(path)) return null;
  return `${API_BASE_URL}${path}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly details?: Record<string, unknown>;
  readonly retryAfterMs?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId = "",
    details?: Record<string, unknown>,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
    this.retryAfterMs = retryAfterMs;
  }
}

const MESSAGES: Record<string, string> = {
  ICON_INVALID: "아이콘 URL과 이미지 형식·크기가 현재 거래소 규격에 맞는지 확인해주세요",
  ICON_REQUEST_CONFLICT: "아이콘 심사 상태가 변경됐어요. 내역을 새로고침해주세요",
  ISSUANCE_LIMIT: "가격 희석 한도를 넘어요. 예치 금액을 줄여주세요",
  ISSUANCE_COOLDOWN: "상장 직후 발행 금지 기간이거나 직전 발행 후 쿨다운 중이에요. 발행 가능 시각 이후에 다시 시도해주세요",
  USER_LISTING_DAILY_LIMIT: "오늘 상장할 수 있는 횟수를 모두 사용했어요",
  NETWORK_ERROR: "네트워크에 연결하지 못했어요",
  INVALID_RESPONSE: "서버 응답을 확인하지 못했어요",
  INVALID_REQUEST: "입력한 내용을 다시 확인해주세요",
  INVALID_BODY: "요청 형식이 올바르지 않아요",
  IDEMPOTENCY_REQUIRED: "요청을 다시 시도해주세요",
  IDEMPOTENCY_KEY_REUSED: "이미 처리된 요청이에요",
  AUTH_FAILED: "본인 확인에 실패했어요",
  SESSION_INVALID: "로그인이 만료됐어요. 다시 로그인해주세요",
  ORIGIN_INVALID: "허용되지 않은 접근이에요",
  ORIGIN_FORBIDDEN: "허용되지 않은 접근이에요",
  CSRF_INVALID: "보안 토큰이 만료됐어요. 새로고침 후 다시 시도해주세요",
  RECOVERY_RESTRICTED: "복구 모드에서는 사용할 수 없어요",
  ACCESS_DENIED: "접근 권한이 없어요",
  ACL_FORBIDDEN: "접근 권한이 없어요",
  NOT_FOUND: "대상을 찾을 수 없어요",
  USERNAME_TAKEN: "이미 사용 중인 아이디예요",
  PASSKEY_LIMIT_REACHED: "패스키는 최대 개수까지 등록할 수 있어요",
  LAST_PASSKEY_CANNOT_BE_DELETED: "마지막 패스키는 삭제할 수 없어요",
  PRIMARY_ACCOUNT_CANNOT_BE_DELETED: "대표 계좌는 삭제할 수 없어요",
  ACCOUNT_BALANCE_NOT_ZERO: "잔액이 남아 있는 계좌는 삭제할 수 없어요",
  ACCOUNT_LIMIT_REACHED: "더 이상 계좌를 만들 수 없어요",
  INSUFFICIENT_CREDIT: "Credit 잔액이 부족해요",
  INSUFFICIENT_SHARES: "보유 수량이 부족해요",
  SLIPPAGE_EXCEEDED: "허용한 슬리피지를 벗어났어요",
  GLOBAL_MARKET_HALTED: "전체 시장이 일시 정지됐어요",
  SYMBOL_HALTED: "이 종목은 거래가 정지됐어요",
  SYMBOL_DELIST_PENDING: "상장폐지가 예정된 종목이에요",
  SYMBOL_DELISTED: "상장폐지된 종목이에요",
  SYMBOL_BLACKLISTED: "사용할 수 없는 심볼이에요",
  ORDER_NOT_CANCELABLE: "취소할 수 없는 주문이에요",
  TRIGGER_EXPIRED: "이미 만료된 예약주문이에요",
  TRIGGER_FAILED: "예약주문이 실패했어요",
  TRANSFER_STATE_CONFLICT: "이미 처리된 요청이에요",
  TRANSFER_EXPIRED: "만료된 요청이에요",
  TRANSFER_POLICY_DISABLED: "송금 기능이 사용 중지됐어요",
  CONFIG_VERSION_CONFLICT: "설정이 변경됐어요. 다시 시도해주세요",
  RATE_LIMITED: "요청이 너무 많아요. 잠시 후 다시 시도해주세요",
  REGISTRATION_RATE_LIMITED: "가입 요청이 너무 많아요. 잠시 후 다시 시도해주세요",
  SERVICE_NOT_READY: "서비스가 준비 중이에요. 잠시 후 다시 시도해주세요",
  INTERNAL_ERROR: "일시적인 오류가 발생했어요",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return MESSAGES[error.code] ?? error.message ?? "요청을 처리하지 못했어요";
  }
  if (error instanceof Error) return error.message || "요청을 처리하지 못했어요";
  return "알 수 없는 오류가 발생했어요";
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code ? error.code === code : true);
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const target = `${name}=`;
  for (const part of document.cookie.split("; ")) {
    if (!part.startsWith(target)) continue;
    try {
      return decodeURIComponent(part.slice(target.length));
    } catch {
      // A malformed cookie must not break every mutating request.
      return null;
    }
  }
  return null;
}

export function csrfToken(): string | null {
  return readCookie("tradex_csrf");
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions {
  method?: Method;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
    details?: Record<string, unknown>;
  };
}

async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  const hasBody = options.body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    const csrf = csrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      cache: "no-store",
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError" && options.signal?.aborted) throw error;
    throw new ApiError(0, "NETWORK_ERROR", "네트워크에 연결하지 못했어요");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
  }

  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const envelope = (payload ?? {}) as ErrorEnvelope;
    const code = envelope.error?.code ?? "INTERNAL_ERROR";
    if (response.status === 401 && code === "SESSION_INVALID" && typeof window !== "undefined") {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(
      response.status,
      code,
      envelope.error?.message ?? "요청을 처리하지 못했어요",
      envelope.error?.request_id ?? "",
      envelope.error?.details,
      retryAfterMilliseconds(response.headers.get("Retry-After")),
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(response.status, "INVALID_RESPONSE", "서버 응답 형식이 올바르지 않아요");
  }
  const successEnvelope = payload as ErrorEnvelope;
  if (successEnvelope.error) {
    throw new ApiError(
      response.status,
      successEnvelope.error.code ?? "INVALID_RESPONSE",
      successEnvelope.error.message ?? "서버 응답 형식이 올바르지 않아요",
      successEnvelope.error.request_id ?? "",
      successEnvelope.error.details,
    );
  }

  return payload;
}

function retryAfterMilliseconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export function onSessionExpired(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SESSION_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
}

/** Notify the authenticated shell that an authenticated transport was rejected. */
export function markSessionExpired(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

export async function apiData<T>(path: string, options?: RequestOptions): Promise<T> {
  const payload = (await request(path, options)) as { data?: T };
  if (!("data" in payload)) {
    throw new ApiError(200, "INVALID_RESPONSE", "서버 응답에 data가 없어요");
  }
  return payload.data as T;
}

export async function apiPage<T>(path: string, options?: RequestOptions): Promise<Page<T>> {
  const payload = (await request(path, options)) as Page<T>;
  if (!Array.isArray(payload.data) || !payload.page || typeof payload.page.has_more !== "boolean") {
    throw new ApiError(200, "INVALID_RESPONSE", "서버 페이지 응답 형식이 올바르지 않아요");
  }
  return payload;
}

export function postData<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return apiData<T>(path, { method: "POST", body, idempotencyKey });
}

const logicalMutationKeys = new Map<string, { key: string; touchedAt: number }>();

async function idempotentData<T>(method: "POST" | "PATCH", path: string, body: unknown): Promise<T> {
  const signature = `${method}:${path}:${JSON.stringify(body)}`;
  const now = Date.now();
  for (const [candidate, entry] of logicalMutationKeys) {
    if (now - entry.touchedAt > 86_400_000) logicalMutationKeys.delete(candidate);
  }
  const existing = logicalMutationKeys.get(signature);
  const entry = existing ?? { key: newIdempotencyKey(), touchedAt: now };
  entry.touchedAt = now;
  logicalMutationKeys.set(signature, entry);

  try {
    const data = await apiData<T>(path, { method, body, idempotencyKey: entry.key });
    if (logicalMutationKeys.get(signature)?.key === entry.key) logicalMutationKeys.delete(signature);
    return data;
  } catch (error) {
    const definitiveClientFailure =
      error instanceof ApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.code !== "IDEMPOTENCY_KEY_REUSED";
    if (definitiveClientFailure && logicalMutationKeys.get(signature)?.key === entry.key) {
      logicalMutationKeys.delete(signature);
    }
    throw error;
  }
}

export function postIdempotentData<T>(path: string, body: unknown): Promise<T> {
  return idempotentData<T>("POST", path, body);
}

export function patchIdempotentData<T>(path: string, body: unknown): Promise<T> {
  return idempotentData<T>("PATCH", path, body);
}

export function deleteData<T>(path: string): Promise<T> {
  return apiData<T>(path, { method: "DELETE" });
}
