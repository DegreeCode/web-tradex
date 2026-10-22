import { ApiError } from "./api";
import { compareDecimal, fmtDecimal } from "./format";
import type { MarginPosition, MarginPositionsData } from "./margin";

export type MarginClosureAttempt = {
  position: MarginPosition;
  state: "pending" | "skipped" | "closed" | "partial" | "failed" | "unknown" | "open" | "system";
  result?: MarginPosition;
  error?: unknown;
  // A failed read must not change the closure's retry-key eligibility.
  reconciliationError?: unknown;
};

export type MarginClosureReturn = "PROFIT" | "LOSS" | "NEUTRAL" | "UNKNOWN";

/** Accept estimateMarginReturnPercent's output without importing its React module. */
export function classifyMarginClosureReturn(percent: string | null): MarginClosureReturn {
  if (percent === null) return "UNKNOWN";
  // Match MarginReturn: values displayed as zero at two decimals are neutral.
  if (fmtDecimal(percent, 2) === "0") return "NEUTRAL";
  const direction = compareDecimal(percent, "0");
  return direction > 0 ? "PROFIT" : direction < 0 ? "LOSS" : "NEUTRAL";
}

type LoadMarginPage = (
  accountId: string,
  cursor: string | null,
) => Promise<Pick<MarginPositionsData, "positions" | "page">>;

function checkCurrent(isCurrent: () => boolean) {
  if (!isCurrent()) throw new DOMException("마진 작업이 취소됐어요", "AbortError");
}

/** Finish the account's entire scan before offering any positions for closure. */
export async function prepareMarginClosures(
  loadPage: LoadMarginPage,
  accountId: string,
  isCurrent: () => boolean,
): Promise<MarginClosureAttempt[]> {
  checkCurrent(isCurrent);
  if (!accountId) throw new Error("청산할 계좌를 선택해주세요");
  const positions = new Map<string, MarginPosition>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  while (true) {
    checkCurrent(isCurrent);
    const data = await loadPage(accountId, cursor);
    checkCurrent(isCurrent);
    if (!Array.isArray(data?.positions) || typeof data.page?.has_more !== "boolean") {
      throw new Error("전체 포지션을 조회하지 못했어요. 다시 불러와주세요");
    }
    for (const position of data.positions) {
      // Fail closed if an endpoint ever ignores the account filter.
      if (position.account_id !== accountId) throw new Error("선택한 계좌의 포지션인지 확인하지 못했어요");
      positions.set(position.position_id, position);
    }
    if (!data.page.has_more) break;
    const nextCursor = data.page.next_cursor;
    if (typeof nextCursor !== "string" || !nextCursor.trim() || cursors.has(nextCursor)) {
      throw new Error("전체 포지션을 조회하지 못했어요. 다시 불러와주세요");
    }
    cursors.add(nextCursor);
    cursor = nextCursor;
  }
  return [...positions.values()]
    .filter((position) => position.status === "OPEN")
    .map((position) => ({ position, state: "pending" }));
}

export function marginClosureFailureState(error: unknown): "failed" | "unknown" {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 &&
    !["IDEMPOTENCY_IN_PROGRESS", "IDEMPOTENCY_KEY_REUSED", "INVALID_RESPONSE"].includes(error.code)
    ? "failed"
    : "unknown";
}

/** Match postIdempotentData's existing key-retention rules; never replay with a new key. */
export function canRetryMarginClosure(attempt: MarginClosureAttempt): boolean {
  if (attempt.state !== "unknown" || !(attempt.error instanceof ApiError)) return false;
  const { status, code } = attempt.error;
  return !(status >= 400 && status < 500 && code !== "IDEMPOTENCY_KEY_REUSED" && code !== "IDEMPOTENCY_IN_PROGRESS");
}

/** One request per pending position. Partial fills are never automatically retried. */
export async function executeMarginClosures(
  closePosition: (position: MarginPosition) => Promise<MarginPosition>,
  attempts: MarginClosureAttempt[],
  isCurrent: () => boolean,
  onProgress: (attempts: MarginClosureAttempt[]) => void,
): Promise<MarginClosureAttempt[]> {
  const results = [...attempts];
  for (let index = 0; index < results.length; index++) {
    checkCurrent(isCurrent);
    const attempt = results[index];
    if (attempt.state !== "pending") continue;
    let stopError: ApiError | undefined;
    try {
      const result = await closePosition(attempt.position);
      checkCurrent(isCurrent);
      if (result?.position_id !== attempt.position.position_id ||
        result.account_id !== attempt.position.account_id ||
        (result.status !== "OPEN" && result.status !== "CLOSED")) {
        throw new Error("청산 결과를 확인할 수 없어요");
      }
      results[index] = {
        ...attempt, result, state: result.status === "CLOSED" ? "closed" : "partial",
        error: undefined, reconciliationError: undefined,
      };
    } catch (error) {
      checkCurrent(isCurrent);
      results[index] = {
        ...attempt, result: undefined, state: marginClosureFailureState(error), error, reconciliationError: undefined,
      };
      if (error instanceof ApiError && [401, 403, 429].includes(error.status)) stopError = error;
    }
    if (stopError) {
      for (let remaining = index + 1; remaining < results.length; remaining++) {
        if (results[remaining].state === "pending") {
          results[remaining] = { ...results[remaining], state: "skipped", error: stopError };
        }
      }
    }
    checkCurrent(isCurrent);
    onProgress([...results]);
    if (stopError) throw stopError;
  }
  checkCurrent(isCurrent);
  return results;
}

/** A GET observes current state; OPEN alone does not prove a partial fill. */
export function marginClosureFromPosition(attempt: MarginClosureAttempt, position: MarginPosition): MarginClosureAttempt {
  if (position?.position_id !== attempt.position.position_id || position.account_id !== attempt.position.account_id) {
    throw new Error("같은 계좌의 포지션인지 확인하지 못했어요");
  }
  let state: MarginClosureAttempt["state"];
  switch (position.status) {
    case "CLOSED": state = "closed"; break;
    case "OPEN":
      if (typeof position.quantity !== "string" || !/^\d+(?:\.\d+)?$/.test(position.quantity)) {
        throw new Error("남은 포지션 수량을 확인하지 못했어요");
      }
      state = "open";
      break;
    case "LIQUIDATING":
    case "CUSTODY":
    case "LIQUIDATED":
    case "DELISTED": state = "system"; break;
    default: throw new Error("포지션의 현재 상태를 확인하지 못했어요");
  }
  return { ...attempt, state, result: position, error: undefined, reconciliationError: undefined };
}

/** Read unknown positions sequentially, leaving unsuccessful checks available for another try. */
export async function reconcileMarginClosures(
  loadPosition: (position: MarginPosition) => Promise<MarginPosition>,
  attempts: MarginClosureAttempt[],
  isCurrent: () => boolean,
  onProgress: (attempts: MarginClosureAttempt[]) => void,
): Promise<MarginClosureAttempt[]> {
  const results = [...attempts];
  for (let index = 0; index < results.length; index++) {
    checkCurrent(isCurrent);
    const attempt = results[index];
    if (attempt.state !== "unknown") continue;
    let stopError: ApiError | undefined;
    try {
      const position = await loadPosition(attempt.position);
      checkCurrent(isCurrent);
      results[index] = marginClosureFromPosition(attempt, position);
    } catch (error) {
      checkCurrent(isCurrent);
      results[index] = { ...attempt, reconciliationError: error };
      if (error instanceof ApiError && [401, 403, 429].includes(error.status)) stopError = error;
    }
    checkCurrent(isCurrent);
    onProgress([...results]);
    if (stopError) throw stopError;
  }
  checkCurrent(isCurrent);
  return results;
}

export function marginClosureSummary(attempts: MarginClosureAttempt[]): string {
  const count = (state: MarginClosureAttempt["state"]) => attempts.filter((attempt) => attempt.state === state).length;
  const observed = `${count("open") ? ` · 보유 중 ${count("open")}건` : ""}${count("system") ? ` · 시스템 정산 중/완료 ${count("system")}건` : ""}`;
  return `전체 종료 ${count("closed")}건 · 일부 종료 ${count("partial")}건${observed} · 실패 ${count("failed")}건 · 결과 미확인 ${count("unknown")}건 · 미실행 ${count("pending") + count("skipped")}건`;
}
