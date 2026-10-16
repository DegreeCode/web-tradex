"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth-provider";
import { ScopeNotice, useSessionAccess } from "@/components/session-access";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  apiData,
  buildQuery,
  onLinkedNetworkChanged,
  onSessionExpired,
  postIdempotentData,
} from "@/lib/api";
import { fmtCredit, fmtQuantity } from "@/lib/format";
import { noteSelfAction } from "@/lib/live-notifications";
import {
  estimateMarginReturnPercent,
  invalidateMarginQueries,
  marginErrorMessage,
  marginPartialFillText,
  type MarginPosition,
  type MarginPositionsData,
  type MarginSide,
} from "@/lib/margin";
import {
  canRetryMarginClosure,
  classifyMarginClosureReturn,
  executeMarginClosures,
  marginClosureSummary,
  prepareMarginClosures,
  reconcileMarginClosures,
  type MarginClosureAttempt,
} from "@/lib/margin-close-all";
import { MarginReturn } from "./margin-return";
import { MarginSideBadge } from "./margin-status-chip";

type ProfitLossFilter = "ALL" | "PROFIT" | "LOSS";

const outlineStyle = "min-h-10 rounded-xl border border-app-gray-200 px-3 py-2 text-[13px] font-semibold text-app-gray-700 hover:bg-app-gray-50 disabled:opacity-50 pressable";
const selectStyle = "mt-1 min-h-10 w-full rounded-xl border border-app-gray-200 bg-card px-3 text-[13px] text-app-gray-900";

export function MarginCloseAllDialog({ accountId, accountName }: { accountId: string; accountName: string }) {
  const { status, user, linkedScope } = useAuth();
  // Never carry a confirmation or results into another authenticated session.
  const identity = JSON.stringify([status, user?.user_id, user?.session_type, linkedScope]);
  return (
    <MarginCloseAllAccounts
      key={identity}
      accountId={accountId}
      accountName={accountName}
      authenticated={status === "authenticated"}
    />
  );
}

type AccountProps = {
  accountId: string;
  accountName: string;
  authenticated: boolean;
};

function MarginCloseAllAccounts(props: AccountProps) {
  const [snapshots, setSnapshots] = useState<Record<string, MarginClosureAttempt[] | null>>({});
  return (
    <MarginCloseAllFlow
      key={props.accountId}
      {...props}
      initialResults={snapshots[props.accountId] ?? null}
      onResultsChange={(results) => setSnapshots((previous) => ({ ...previous, [props.accountId]: results }))}
    />
  );
}

function MarginCloseAllFlow({ accountId, accountName, authenticated, initialResults, onResultsChange }: AccountProps & {
  initialResults: MarginClosureAttempt[] | null;
  onResultsChange: (results: MarginClosureAttempt[] | null) => void;
}) {
  const queryClient = useQueryClient();
  const access = useSessionAccess("MARGIN");
  const [open, setOpen] = useState(initialResults !== null);
  const [preparing, setPreparing] = useState(false);
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [targets, setTargets] = useState<MarginClosureAttempt[]>([]);
  const [results, setResults] = useState<MarginClosureAttempt[] | null>(initialResults);
  const [side, setSide] = useState<MarginSide | "ALL">("ALL");
  const [symbols, setSymbols] = useState<string[] | null>(null);
  const [profitLoss, setProfitLoss] = useState<ProfitLossFilter>("ALL");
  const busy = useRef(false);
  const generation = useRef(0);

  useLayoutEffect(() => {
    generation.current++;
    const invalidate = () => { generation.current++; };
    const offExpired = onSessionExpired(invalidate);
    const offNetwork = onLinkedNetworkChanged(invalidate);
    return () => {
      invalidate();
      offExpired();
      offNetwork();
    };
  }, []);

  const allowed = Boolean(accountId) && authenticated && access.allowed;
  const working = running || checking;
  const unresolved = results?.some((attempt) => attempt.state === "unknown") ?? false;
  const retryable = results?.some(canRetryMarginClosure) ?? false;
  const retryUnavailable = results?.some((attempt) => attempt.state === "unknown" && !canRetryMarginClosure(attempt)) ?? false;
  const selection = targets.filter(({ position }) =>
    (side === "ALL" || position.side === side) &&
    (symbols === null || symbols.includes(position.symbol)) &&
    (profitLoss === "ALL" || classifyMarginClosureReturn(estimateMarginReturnPercent(position)) === profitLoss));
  const symbolOptions = [...new Set(targets.map(({ position }) => position.symbol))].sort();
  const everything = side === "ALL" && symbols === null && profitLoss === "ALL";

  async function prepare() {
    if (!allowed || busy.current || unresolved) return;
    busy.current = true;
    setPreparing(true);
    const token = generation.current;
    const isCurrent = () => generation.current === token;
    try {
      const collected = await prepareMarginClosures(
        (accountId, cursor) => apiData<MarginPositionsData>(
          `/api/v1/margin/positions${buildQuery({ limit: 50, cursor, account_id: accountId })}`,
        ),
        accountId,
        isCurrent,
      );
      if (!isCurrent()) return;
      setTargets(collected);
      setResults(null);
      onResultsChange(null);
      setSide("ALL");
      setSymbols(null);
      setProfitLoss("ALL");
      setOpen(true);
    } catch (error) {
      if (isCurrent()) toast.error(marginErrorMessage(error));
    } finally {
      if (isCurrent()) {
        busy.current = false;
        setPreparing(false);
      }
    }
  }

  async function checkUnknown() {
    if (!allowed || busy.current || !results || !unresolved) return;
    busy.current = true;
    setChecking(true);
    const token = generation.current;
    const isCurrent = () => generation.current === token;
    try {
      const checked = await reconcileMarginClosures(
        (position) => apiData<MarginPosition>(`/api/v1/margin/positions/${position.position_id}`),
        results,
        isCurrent,
        (progress) => {
          setResults(progress);
          rememberResults(progress);
          invalidateMarginQueries(queryClient);
        },
      );
      if (!isCurrent()) return;
      const description = marginClosureSummary(checked);
      if (checked.some((attempt) => attempt.state === "unknown")) {
        toast.warning("일부 포지션의 현재 상태를 확인하지 못했어요", { description });
      } else {
        toast.success("포지션의 현재 상태를 확인했어요", { description });
      }
    } catch (error) {
      if (isCurrent()) toast.error(marginErrorMessage(error));
    } finally {
      if (isCurrent()) {
        busy.current = false;
        setChecking(false);
      }
    }
  }

  async function execute(attempts: MarginClosureAttempt[]) {
    if (!allowed || busy.current || !attempts.some((attempt) => attempt.state === "pending")) return;
    busy.current = true;
    setRunning(true);
    setResults(attempts);
    const token = generation.current;
    const isCurrent = () => generation.current === token;
    let latest = attempts;
    let stopError: unknown;
    try {
      latest = await executeMarginClosures(
        (position) => {
          // Keep a conservative snapshot before sending. Switching accounts must
          // not discard an uncertain request and unlock a fresh close-all later.
          rememberResults(latest, position.position_id);
          noteSelfAction("TRADE_EXECUTED", position.symbol);
          // The shared API client owns retry keys; {} uses server-default slippage.
          return postIdempotentData<MarginPosition>(`/api/v1/margin/positions/${position.position_id}/closure`, {});
        },
        attempts,
        isCurrent,
        (progress) => {
          latest = progress;
          setResults(progress);
          rememberResults(progress);
          invalidateMarginQueries(queryClient);
        },
      );
    } catch (error) {
      if (!isCurrent()) return;
      stopError = error;
    } finally {
      if (isCurrent()) {
        busy.current = false;
        setRunning(false);
      }
    }
    if (!isCurrent()) return;
    const description = `${marginClosureSummary(latest)}${stopError ? ` · ${marginErrorMessage(stopError)}` : ""}`;
    if (latest.every((attempt) => attempt.state === "closed")) {
      toast.success("선택한 포지션을 모두 정산했어요", { description });
    } else {
      toast.warning("전량 청산 결과를 확인해주세요", { description });
    }
  }

  function rememberResults(attempts: MarginClosureAttempt[], inFlightId?: string) {
    onResultsChange(attempts.map((attempt) => {
      if (attempt.state !== "pending") return attempt;
      const inFlight = attempt.position.position_id === inFlightId;
      return {
        ...attempt,
        state: inFlight ? "unknown" : "skipped",
        error: new Error(inFlight
          ? "계좌를 전환해 요청 결과를 확인하지 못했어요"
          : "요청을 실행하기 전에 작업이 중단됐어요"),
      };
    }));
  }

  function changeOpen(next: boolean) {
    if (busy.current) return;
    setOpen(next);
    if (!next && !unresolved) {
      setResults(null);
      onResultsChange(null);
    }
  }

  function retryUnknown() {
    if (!results) return;
    void execute(results.map((attempt) => canRetryMarginClosure(attempt)
      ? { ...attempt, state: "pending", error: undefined, reconciliationError: undefined }
      : attempt));
  }

  return (
    <>
      <button
        type="button"
        disabled={!allowed || preparing || working || unresolved}
        onClick={() => void prepare()}
        title={unresolved ? "결과 미확인 요청을 먼저 확인해주세요" : undefined}
        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-app-red/30 px-3 text-[13px] font-semibold text-app-red hover:bg-app-red-light disabled:opacity-50 pressable"
      >
        {preparing ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
        {preparing ? "청산 대상 확인 중…" : "전량 청산"}
      </button>
      {unresolved && !open ? <button type="button" onClick={() => setOpen(true)} className={outlineStyle}>청산 결과</button> : null}

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent showCloseButton={!working} className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {results
                ? (checking ? "현재 상태 확인 중" : running ? "전량 청산 처리 중" : "전량 청산 결과")
                : targets.length ? "청산할 포지션을 선택해주세요" : "청산할 포지션이 없어요"}
            </DialogTitle>
            <DialogDescription>
              현재 선택한 계좌({accountName})의 보유 포지션에만 적용해요. 시스템이 정산 중인 포지션은 제외해요.
            </DialogDescription>
          </DialogHeader>

          {!access.allowed ? <ScopeNotice reason={access.reason} /> : null}

          {results ? (
            <div className="min-w-0 space-y-3">
              <p role="status" className="numeric break-words text-[13px] font-semibold text-app-gray-900">
                {checking ? "현재 상태 확인 중 · " : running ? "전량 청산 처리 중 · " : "전량 청산 결과 · "}{marginClosureSummary(results)}
              </p>
              <ul aria-label="포지션별 청산 결과" className="max-h-64 space-y-2 overflow-y-auto">
                {results.map((attempt) => (
                  <li key={attempt.position.position_id} className="min-w-0 rounded-xl bg-app-gray-50 p-3">
                    <PositionHeading position={attempt.position} />
                    <p className="mt-1 break-words text-[12px] text-app-gray-600">
                      {resultLabel(attempt)}
                      {attempt.result?.execution ? ` · ${marginPartialFillText(attempt.result.execution)}` : ""}
                      {attempt.error ? ` · ${marginErrorMessage(attempt.error)}` : ""}
                      {attempt.reconciliationError ? ` · 현재 상태 확인 실패: ${marginErrorMessage(attempt.reconciliationError)}` : ""}
                      {attempt.result?.status === "CLOSED" ? ` · 정산금 ${fmtCredit(attempt.result.settled_payout, 4)} Credit` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              {results.some((attempt) => attempt.state === "open") ? (
                <p className="text-[12px] leading-relaxed text-app-gray-600">
                  현재 보유 상태를 확인했어요. 앞서 진행 중이던 청산 요청이 잠시 후 체결될 수 있어요. 새 전량 청산을 시작하면 포지션을 다시 조회해요.
                </p>
              ) : null}
              {unresolved ? (
                <div className="space-y-2 rounded-xl bg-app-red-light p-3">
                  <p className="text-[12px] leading-relaxed text-app-red">
                    응답을 받지 못한 요청은 이미 체결됐을 수 있어요. 결과 미확인 요청을 확인한 뒤 새 전량 청산을 시작할 수 있어요.
                  </p>
                  {retryUnavailable ? (
                    <p className="text-[12px] leading-relaxed text-app-red">
                      안전하게 재시도할 수 없는 미확인 요청이 있어요. 현재 상태를 확인해주세요.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={!allowed || working || !retryable}
                    className={`${outlineStyle} w-full`}
                    onClick={retryUnknown}
                  >
                    결과 미확인 요청 재시도
                  </button>
                  <button
                    type="button"
                    disabled={!allowed || working}
                    className={`${outlineStyle} flex w-full items-center justify-center gap-1.5`}
                    onClick={() => void checkUnknown()}
                  >
                    {checking ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                    {checking ? "현재 상태 확인 중…" : "현재 상태 확인"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : targets.length > 0 ? (
            <div className="min-w-0 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="min-w-0 text-[12px] font-semibold text-app-gray-600">
                  청산 방향
                  <select
                    value={side}
                    onChange={(event) => setSide(event.target.value as MarginSide | "ALL")}
                    className={selectStyle}
                    disabled={!allowed}
                  >
                    <option value="ALL">전체</option>
                    <option value="LONG">롱만</option>
                    <option value="SHORT">숏만</option>
                  </select>
                </label>
                <label className="min-w-0 text-[12px] font-semibold text-app-gray-600">
                  청산 종목
                  <select
                    value={symbols === null ? "ALL" : "SELECTED"}
                    onChange={(event) => setSymbols(event.target.value === "ALL" ? null : [])}
                    className={selectStyle}
                    disabled={!allowed}
                  >
                    <option value="ALL">전체 종목</option>
                    <option value="SELECTED">특정 종목</option>
                  </select>
                </label>
                <label className="min-w-0 text-[12px] font-semibold text-app-gray-600">
                  손익
                  <select
                    value={profitLoss}
                    onChange={(event) => setProfitLoss(event.target.value as ProfitLossFilter)}
                    className={selectStyle}
                    disabled={!allowed}
                  >
                    <option value="ALL">전체</option>
                    <option value="PROFIT">수익 중만</option>
                    <option value="LOSS">손실 중만</option>
                  </select>
                </label>
              </div>
              {symbols !== null ? (
                <fieldset disabled={!allowed} className="space-y-2">
                  <legend className="text-[12px] font-semibold text-app-gray-600">종목 선택 (복수 선택)</legend>
                  <div className="grid max-h-32 grid-cols-2 gap-2 overflow-y-auto">
                    {symbolOptions.map((symbol) => (
                      <label key={symbol} className="flex min-w-0 items-center gap-2 rounded-xl border border-app-gray-200 p-2 text-[13px] text-app-gray-900">
                        <input
                          type="checkbox"
                          name="margin-close-symbol"
                          value={symbol}
                          checked={symbols.includes(symbol)}
                          className="size-4 shrink-0 accent-app-red"
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSymbols((previous) => checked
                              ? [...(previous ?? []), symbol]
                              : (previous ?? []).filter((value) => value !== symbol));
                          }}
                        />
                        <span className="min-w-0 break-all">{symbol}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <p role="status" className="numeric text-[13px] font-semibold text-app-gray-900">
                청산 대상 {selection.length}개 / 보유 중 {targets.length}개
              </p>
              <p className="text-[12px] leading-relaxed text-app-gray-500">
                손익 조건은 조회 시점의 추정 수익률로 판단해요. 각 청산을 실행하기 전 가격이 바뀌면 표시된 손익과 다르게 정산될 수 있어요.
                수익률이 0%로 표시되거나 추정할 수 없는 포지션은 손익 ‘전체’에만 포함해요.
              </p>
              {selection.length === 0 ? (
                <p className="text-[12px] text-app-gray-500">선택 조건에 맞는 포지션이 없어요. 방향·종목·손익 조건을 다시 선택해주세요.</p>
              ) : null}
              <ul aria-label="전량 청산 대상" className="max-h-48 space-y-2 overflow-y-auto">
                {selection.map(({ position }) => (
                  <li key={position.position_id} className="min-w-0 rounded-xl bg-app-gray-50 p-3">
                    <PositionHeading position={position} />
                    <p className="numeric mt-1 break-all text-[12px] text-app-gray-600">잔여 수량 {fmtQuantity(position.quantity)}주</p>
                    <p className="mt-1 text-[12px] text-app-gray-500">추정 수익률 <MarginReturn position={position} /></p>
                  </li>
                ))}
              </ul>
              <div className="flex items-start gap-2.5 rounded-xl bg-app-red-light p-3 text-[12px] text-app-red">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <p className="leading-relaxed">
                  선택한 방향·종목·손익 조건에 모두 맞는 포지션의 남은 수량 전체를 순서대로 시장가 정산해요. 서버 기본 슬리피지를 적용하고, 수수료와 이자를 제외한 Credit을 이 계좌로 돌려받아요.
                  일부만 체결되거나 실패한 포지션은 남을 수 있어요. 전체 종료된 포지션의 예약 종료 주문은 자동 취소돼요.
                </p>
              </div>
            </div>
          ) : <p className="text-[13px] text-app-gray-500">이 계좌에는 직접 청산할 수 있는 보유 포지션이 없어요.</p>}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" disabled={working} onClick={() => changeOpen(false)} className={outlineStyle}>
              {results || targets.length === 0 ? "닫기" : "취소"}
            </button>
            {!results && targets.length > 0 ? (
              <button
                type="button"
                disabled={!allowed || selection.length === 0}
                onClick={() => void execute(selection)}
                className="min-h-10 rounded-xl bg-app-red px-4 py-2.5 text-[14px] font-bold text-white hover:opacity-90 disabled:bg-app-gray-200 disabled:text-app-gray-400 pressable"
              >
                {everything ? "전량 청산 실행" : "선택 포지션 청산 실행"}
              </button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function resultLabel(attempt: MarginClosureAttempt): string {
  switch (attempt.state) {
    case "closed": return "전체 종료";
    case "partial": return `일부 종료 · 잔여 ${fmtQuantity(attempt.result?.quantity)}주`;
    case "open": return `보유 중 · 잔여 ${fmtQuantity(attempt.result?.quantity)}주`;
    case "system": return attempt.result?.status === "LIQUIDATING" ? "시스템 정산 중"
      : attempt.result?.status === "CUSTODY" ? "보호보관 · 시스템 정산 대기" : "시스템 정산 완료";
    case "failed": return "실패";
    case "unknown": return "결과 미확인";
    case "skipped": return "미실행 · 작업이 중단됐어요";
    case "pending": return "미실행 · 순서를 기다리고 있어요";
  }
}

function PositionHeading({ position }: { position: MarginPosition }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="min-w-0 break-all text-[14px] font-bold text-app-gray-900">{position.symbol}</span>
      <MarginSideBadge side={position.side} />
      <span className="numeric text-[12px] font-semibold text-app-gray-500">{position.leverage}x</span>
      <span className="text-[11px] text-app-gray-400">포지션 {position.position_id.slice(-8)}</span>
    </div>
  );
}
