"use client";

import { useId, useMemo, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Segmented } from "@/components/segmented";
import { Collapse, ErrorBlock, OrderStatusChip, SideBadge } from "@/components/primitives";
import { useExchangeInfo } from "@/lib/exchange-info";
import { TradePolicy } from "@/components/exchange-policy";
import { SlippageFields } from "@/components/slippage-fields";
import { accountLabel } from "@/lib/accounts";
import { errorMessage, isApiError } from "@/lib/api";
import { noteSelfAction } from "@/lib/live-notifications";
import { marginLimitReasonLabel } from "@/lib/margin";
import { shouldShowTradeExecutionPopup } from "@/lib/preferences";
import {
  liveReferencePrice,
  slippageRequestFields,
  slippageSettingsError,
  slippageSummary,
  useSlippageSettings,
} from "@/lib/slippage";
import {
  fmtCredit,
  fmtPrice,
  fmtQuantity,
  compareDecimal,
  isDecimalInput,
  isPositiveDecimal,
  scaleDecimal,
} from "@/lib/format";
import { findPosition, useOrderSimulation, usePlaceOrder } from "@/lib/hooks";
import { ScopeNotice, useSessionAccess } from "@/components/session-access";
import type { Account, Instrument, Order, OrderRequest, OrderSimulationRequest, Portfolio } from "@/lib/types";

type Side = "BUY" | "SELL";
type OrderMode = "MARKET" | "TRIGGER";
type AmountMode = "CREDIT" | "QUANTITY";

/** The symbol screen owns one account/portfolio query for both chart and form. */
export interface OrderAccountState {
  accountId: string;
  accounts: UseQueryResult<Account[]>;
  portfolio: UseQueryResult<Portfolio>;
  onAccountChange: (accountId: string) => void;
}

export function OrderForm({
  instrument,
  defaultSide = "BUY",
  accountState,
}: {
  instrument: Instrument;
  defaultSide?: Side;
  accountState: OrderAccountState;
}) {
  const { data: exchangeInfo } = useExchangeInfo();
  const { accounts, portfolio, accountId: resolvedAccountId, onAccountChange } = accountState;
  const accountList = accounts.data ?? [];
  const [side, setSide] = useState<Side>(defaultSide);
  const [orderMode, setOrderMode] = useState<OrderMode>("MARKET");
  const [amountMode, setAmountMode] = useState<AmountMode>("QUANTITY");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("");
  // A selected ratio button keeps the input tied to the live balance until the
  // user edits it or changes side, account, or amount mode.
  const [linkedPercent, setLinkedPercent] = useState<number | null>(null);
  const [condition, setCondition] = useState<"GTE" | "LTE">("LTE");
  const [targetPrice, setTargetPrice] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { settings: slippageSettings, setMode: setSlippageMode, setSlippage, setLimitPrice } = useSlippageSettings();
  const [result, setResult] = useState<Order | null>(null);
  const fieldId = useId();

  const placeOrder = usePlaceOrder();
  // Simulation shares the order route, so a session without TRADE can't quote either.
  const tradeAccess = useSessionAccess("TRADE");

  const effectiveAmountMode: AmountMode = side === "SELL" ? "QUANTITY" : amountMode;
  const availableCredit = portfolio.data?.available_credit ?? "0";
  const position = portfolio.data ? findPosition(portfolio.data, instrument.symbol) : undefined;
  const availableQuantity = position?.available_quantity ?? "0";
  const balanceReady = Boolean(resolvedAccountId && portfolio.data);
  const balanceError = accounts.isError ? accounts.error : portfolio.isError ? portfolio.error : null;
  const spot = instrument.curve_spot_price;

  const { orderAmount, orderQuantity } = useMemo(() => {
    if (linkedPercent === null) return { orderAmount: amount, orderQuantity: quantity };
    return side === "BUY"
      ? { orderAmount: scaleDecimal(availableCredit, linkedPercent / 100, 16), orderQuantity: quantity }
      : { orderAmount: amount, orderQuantity: scaleDecimal(availableQuantity, linkedPercent / 100, 8) };
  }, [linkedPercent, side, amount, quantity, availableCredit, availableQuantity]);

  const trading = instrument.state === "TRADING";

  const inputError = useMemo(() => {
    if (!trading) return "현재 거래할 수 없는 종목이에요";
    if (effectiveAmountMode === "CREDIT") {
      if (!isDecimalInput(orderAmount, 16) || !isPositiveDecimal(orderAmount)) {
        return "주문할 금액을 입력해주세요";
      }
    } else {
      if (!isDecimalInput(orderQuantity, 8) || !isPositiveDecimal(orderQuantity)) {
        return "주문할 수량을 입력해주세요";
      }
    }
    if (orderMode === "TRIGGER") {
      if (!isDecimalInput(targetPrice, 8) || !isPositiveDecimal(targetPrice)) {
        return "목표 가격을 입력해주세요";
      }
    }
    const slippageValidation = slippageSettingsError(slippageSettings, side, exchangeInfo?.trade);
    if (slippageValidation) return slippageValidation;
    // The order fills at the target price, so a limit on the wrong side of it can never fill.
    if (
      orderMode === "TRIGGER" &&
      slippageSettings.mode === "PRICE_LIMIT" &&
      compareDecimal(slippageSettings.limitPrice.trim(), targetPrice) * (side === "BUY" ? 1 : -1) < 0
    ) {
      return side === "BUY" ? "매수 상한가는 목표 가격 이상이어야 해요" : "매도 하한가는 목표 가격 이하여야 해요";
    }
    return null;
  }, [
    trading,
    exchangeInfo?.trade,
    effectiveAmountMode,
    orderAmount,
    orderQuantity,
    orderMode,
    targetPrice,
    slippageSettings,
    side,
  ]);

  const accountFeedback = balanceError
    ? "주문 계좌 정보를 확인하지 못했어요"
    : accounts.isLoading || (resolvedAccountId && portfolio.isPending)
      ? "주문 계좌 정보를 불러오는 중이에요"
      : !resolvedAccountId ? "주문할 계좌가 없어요" : null;
  const validationError = accountFeedback ?? inputError ?? (
    effectiveAmountMode === "CREDIT" && compareDecimal(orderAmount, availableCredit) > 0
      ? "Credit 잔액이 부족해요"
      : side === "SELL" && compareDecimal(orderQuantity, availableQuantity) > 0
        ? "보유 수량이 부족해요"
        : null
  );
  const simulationPayload = useMemo<OrderSimulationRequest | null>(() => {
    if (!tradeAccess.allowed || orderMode !== "MARKET" || inputError || !balanceReady) return null;
    return {
      symbol: instrument.symbol,
      side,
      order_type: "MARKET",
      ...(resolvedAccountId ? { account_id: resolvedAccountId } : {}),
      ...(effectiveAmountMode === "CREDIT"
        ? { credit_amount: orderAmount.trim() }
        : { quantity: orderQuantity.trim() }),
      ...slippageRequestFields(slippageSettings),
    };
  }, [tradeAccess.allowed, orderMode, inputError, balanceReady, instrument.symbol, side, resolvedAccountId, effectiveAmountMode, orderAmount, orderQuantity, slippageSettings]);
  // Trigger orders leave the reference to the server, which uses the target price.
  const referencePrice = orderMode === "MARKET" ? liveReferencePrice(slippageSettings, spot) : undefined;
  const simulation = useOrderSimulation(simulationPayload, referencePrice);
  const quote = simulation.data;

  function submit() {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    if (orderMode === "TRIGGER" && expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      toast.error("만료 시각은 지금 이후로 정해주세요");
      return;
    }
    const payload: OrderRequest = {
      symbol: instrument.symbol,
      side,
      order_type: orderMode,
      ...slippageRequestFields(slippageSettings),
    };
    if (resolvedAccountId) payload.account_id = resolvedAccountId;
    if (orderMode === "TRIGGER") {
      payload.trigger_condition = condition;
      payload.trigger_price = targetPrice.trim();
      if (expiresAt) payload.expires_at = new Date(expiresAt).toISOString();
    }
    if (effectiveAmountMode === "CREDIT") payload.credit_amount = orderAmount.trim();
    else payload.quantity = orderQuantity.trim();
    if (referencePrice) payload.slippage_reference_price = referencePrice;

    // The fill notification can beat the response. With the result dialog on it
    // would repeat the dialog; with it off the toast is the only confirmation.
    if (orderMode === "MARKET" && shouldShowTradeExecutionPopup()) {
      noteSelfAction("TRADE_EXECUTED", instrument.symbol);
    }
    placeOrder.mutate(payload, {
      onSuccess: (order) => {
        if (order.status === "PENDING" || shouldShowTradeExecutionPopup()) {
          setResult(order);
        }
        setAmount("");
        setQuantity("");
        setLinkedPercent(null);
        setTargetPrice("");
        setExpiresAt("");
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  function applyPercent(percent: number) {
    // Tapping the selected ratio again releases it and clears what it filled in.
    if (linkedPercent === percent) {
      setLinkedPercent(null);
      if (side === "BUY") setAmount("");
      else setQuantity("");
      return;
    }
    if (side === "BUY") setAmountMode("CREDIT");
    setLinkedPercent(percent);
  }

  const inputValue = effectiveAmountMode === "CREDIT" ? orderAmount : orderQuantity;
  // An empty form already reads as "enter an amount"; only surface problems
  // once there is something to correct.
  const feedback = !inputValue.trim() && !accountFeedback && trading ? null : validationError;

  return (
    <>
      <div className="overflow-hidden rounded-2xl bg-card shadow-card">
        <div className="p-3">
          <Segmented<Side>
            value={side}
            onChange={(next) => {
              setSide(next);
              setLinkedPercent(null);
              // A buy cap means nothing as a sell floor.
              setLimitPrice("");
              setResult(null);
            }}
            options={[
              { value: "BUY", label: "매수", tone: "buy" },
              { value: "SELL", label: "매도", tone: "sell" },
            ]}
          />
        </div>

        <div className="space-y-5 px-4 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="주문 방식" className="flex gap-1">
              {([
                ["MARKET", "시장가"],
                ["TRIGGER", "예약"],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setOrderMode(mode)}
                  aria-pressed={orderMode === mode}
                  className="min-h-9 rounded-lg px-2 text-[15px] font-bold text-app-gray-400 hover:text-app-gray-600 aria-pressed:text-app-gray-900"
                >
                  {label}
                </button>
              ))}
            </div>
            {accountList.length > 1 ? (
              <div role="group" className="flex gap-1.5 overflow-x-auto" aria-label="주문 계좌">
                {accountList.map((account) => (
                  <button
                    key={account.account_id}
                    type="button"
                    onClick={() => {
                      onAccountChange(account.account_id);
                      setLinkedPercent(null);
                    }}
                    aria-pressed={resolvedAccountId === account.account_id}
                    className="min-h-8 shrink-0 rounded-lg bg-app-gray-100 px-2.5 text-[12px] font-semibold text-app-gray-500 aria-pressed:bg-app-blue-light aria-pressed:text-app-blue-dark"
                  >
                    {accountLabel(account, accountList)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {orderMode === "TRIGGER" ? (
            <div className="space-y-3 rounded-xl bg-app-gray-50 p-3">
              <Segmented<"GTE" | "LTE">
                value={condition}
                onChange={setCondition}
                options={[
                  { value: "LTE", label: "이하로 내려가면" },
                  { value: "GTE", label: "이상으로 오르면" },
                ]}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5">
                <label htmlFor={`${fieldId}-target`} className="text-[13px] font-semibold text-app-gray-500">목표 가격</label>
                <div className="flex min-w-0 max-w-full items-baseline gap-1">
                  <input
                    id={`${fieldId}-target`}
                    value={targetPrice}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next === "" || isDecimalInput(next, 8)) setTargetPrice(next);
                    }}
                    inputMode="decimal"
                    placeholder={fmtPrice(spot)}
                    className="numeric w-32 min-w-0 bg-transparent text-right text-[16px] font-bold text-app-gray-900 outline-none placeholder:text-app-gray-300"
                  />
                  <span className="text-[12px] font-semibold text-app-gray-400">Credit</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5">
                <label htmlFor={`${fieldId}-expiry`} className="text-[13px] font-semibold text-app-gray-500">만료 (선택)</label>
                <input
                  id={`${fieldId}-expiry`}
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  className="numeric min-w-0 max-w-full bg-transparent text-right text-base md:text-[13px] text-app-gray-900 outline-none"
                />
              </div>
            </div>
          ) : null}

          <div>
            {/* Fixed to the toggle's height so switching to sell (no toggle) keeps the form still. */}
            <div className="flex min-h-8 items-center justify-between gap-3">
              <label htmlFor={`${fieldId}-amount`} className="text-[14px] font-semibold text-app-gray-500">
                {effectiveAmountMode === "CREDIT" ? "주문 금액" : "주문 수량"}
              </label>
              {side === "BUY" ? (
                <button
                  type="button"
                  onClick={() => {
                    setAmountMode(amountMode === "CREDIT" ? "QUANTITY" : "CREDIT");
                    setLinkedPercent(null);
                  }}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-app-blue hover:bg-app-blue-light"
                >
                  <ArrowLeftRight aria-hidden="true" className="size-3.5" />
                  {amountMode === "CREDIT" ? "수량으로 입력" : "금액으로 입력"}
                </button>
              ) : null}
            </div>
            <div className="mt-1 flex items-baseline gap-1 border-b-2 border-app-gray-200 pb-1.5 focus-within:border-app-blue">
              <input
                id={`${fieldId}-amount`}
                value={inputValue}
                onChange={(event) => {
                  const next = event.target.value;
                  if (effectiveAmountMode === "CREDIT") {
                    if (next === "" || isDecimalInput(next, 16)) {
                      setAmount(next);
                      setLinkedPercent(null);
                    }
                  } else if (next === "" || isDecimalInput(next, 8)) {
                    setQuantity(next);
                    setLinkedPercent(null);
                  }
                }}
                inputMode="decimal"
                placeholder="0"
                className="numeric w-full min-w-0 bg-transparent text-right text-[26px] font-bold text-app-gray-900 outline-none placeholder:text-app-gray-300"
              />
              <span className="shrink-0 text-[14px] font-semibold text-app-gray-400">
                {effectiveAmountMode === "CREDIT" ? "Credit" : "주"}
              </span>
            </div>
            <div role="group" aria-label="잔고 비율로 입력" className="mt-2.5 grid grid-cols-4 gap-1.5">
              {[10, 25, 50, 100].map((percent) => (
                <button
                  key={percent}
                  type="button"
                  onClick={() => applyPercent(percent)}
                  disabled={!balanceReady || Boolean(balanceError)}
                  aria-pressed={linkedPercent === percent}
                  className="min-h-9 rounded-lg bg-app-gray-100 text-[12px] font-semibold text-app-gray-600 hover:bg-app-gray-200 aria-pressed:bg-app-blue-light aria-pressed:text-app-blue-dark disabled:opacity-40"
                >
                  {percent === 100 ? "최대" : `${percent}%`}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px]">
              <p className={linkedPercent !== null ? "numeric min-w-0 text-app-blue" : "numeric min-w-0 text-app-gray-500"}>
                {!balanceReady
                  ? "주문 가능 확인 중…"
                  : linkedPercent !== null
                    ? `보유 잔고의 ${linkedPercent === 100 ? "전부" : `${linkedPercent}%`} · 잔고에 맞춰 바뀌어요`
                    : side === "BUY"
                      ? `주문 가능 ${fmtCredit(availableCredit, 2)} Credit`
                      : `주문 가능 ${fmtQuantity(availableQuantity)}주`}
              </p>
              <p className="numeric text-app-gray-400">현재가 {fmtPrice(spot)}</p>
            </div>
          </div>

          {orderMode === "MARKET" ? (
            <div className="rounded-xl bg-app-gray-50 p-3 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-app-gray-600">예상 체결</span>
                <button
                  type="button"
                  disabled={!simulationPayload || simulation.isFetching}
                  onClick={() => void simulation.refetch()}
                  className="min-h-8 rounded-lg px-1 font-semibold text-app-blue disabled:text-app-gray-400"
                >
                  {simulation.isFetching ? "계산 중…" : "예상 체결 확인"}
                </button>
              </div>
              {simulation.isError ? (
                <p role="status" className="mt-2 text-app-red">
                  {isApiError(simulation.error, "INSUFFICIENT_CREDIT")
                    ? "입력한 금액으로 최소 주문 수량을 살 수 없어요"
                    : errorMessage(simulation.error)}
                </p>
              ) : quote && !simulation.isFetching ? (
                <div role="group" className="mt-2 space-y-2 border-t border-app-gray-200 pt-2" aria-label="예상 체결 결과">
                  <ResultRow label="예상 체결 수량" value={`${fmtQuantity(quote.filled_quantity)}주`} />
                  <ResultRow label="예상 평균가" value={`${fmtPrice(quote.average_price)} Credit`} />
                  <ResultRow label="예상 수수료" value={`${fmtCredit(quote.fee)} Credit`} />
                  <ResultRow
                    label={side === "BUY" ? "예상 총 결제액" : "예상 수령액"}
                    value={`${fmtCredit(side === "BUY" ? quote.total_debit : quote.net_proceeds)} Credit`}
                  />
                  <ResultRow label="거래 후 커브 가격" value={`${fmtPrice(quote.curve_price_after)} Credit`} />
                  {quote.partially_filled ? (
                    <p className="text-app-red">
                      {quote.limit_reasons.length > 0
                        ? `${quote.limit_reasons.map(marginLimitReasonLabel).join("·")} 한도로 일부만 체결될 수 있어요.`
                        : "일부만 체결될 수 있어요."}
                    </p>
                  ) : null}
                  <p className="text-[12px] text-app-gray-500">현재 시점의 예상 결과예요. 실제 주문 시 가격·잔고·유동성을 다시 확인해요.</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              aria-expanded={advancedOpen}
              className="flex min-h-9 w-full items-center justify-between gap-3 text-[13px] font-semibold text-app-gray-500 hover:text-app-gray-800"
            >
              고급 설정
              <span className="flex items-center gap-1 font-medium text-app-gray-400">
                {slippageSummary(slippageSettings, side, exchangeInfo?.trade.default_slippage_ppm, fmtPrice)}
                <ChevronDown
                  aria-hidden="true"
                  className={advancedOpen ? "size-4 rotate-180 transition-transform duration-250" : "size-4 transition-transform duration-250"}
                />
              </span>
            </button>

            <Collapse open={advancedOpen}>
              <div className="mt-2 space-y-2.5 rounded-xl bg-app-gray-50 p-3">
                <SlippageFields
                  side={side}
                  settings={slippageSettings}
                  onModeChange={setSlippageMode}
                  onSlippageChange={setSlippage}
                  onLimitPriceChange={setLimitPrice}
                  currentPrice={orderMode === "MARKET" ? spot : undefined}
                  trigger={orderMode === "TRIGGER"}
                />
                <div className="border-t border-app-gray-200 pt-2">
                  <TradePolicy />
                </div>
              </div>
            </Collapse>
          </div>

          {balanceError ? (
            <ErrorBlock message={errorMessage(balanceError)} onRetry={() => void (accounts.isError ? accounts.refetch() : portfolio.refetch())} />
          ) : null}

          <div className="space-y-2">
            {tradeAccess.allowed ? null : <ScopeNotice reason={tradeAccess.reason} />}
            {feedback ? (
              <p role="status" aria-live="polite" className="text-center text-[13px] font-medium text-app-gray-500">{feedback}</p>
            ) : null}
            <button
              type="button"
              onClick={submit}
              disabled={!tradeAccess.allowed || placeOrder.isPending || Boolean(validationError)}
              className={
                side === "BUY"
                  ? "h-12 w-full rounded-xl bg-app-red text-[16px] font-bold text-white hover:opacity-90 disabled:opacity-40 pressable"
                  : "h-12 w-full rounded-xl bg-app-blue text-[16px] font-bold text-white hover:opacity-90 disabled:opacity-40 pressable"
              }
            >
              {placeOrder.isPending
                ? "처리 중…"
                : orderMode === "TRIGGER"
                  ? "예약주문 등록"
                  : side === "BUY"
                    ? "매수하기"
                    : "매도하기"}
            </button>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(result)} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent className="rounded-2xl">
          {result ? <OrderResultDialog order={result} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function OrderResultDialog({ order }: { order: Order }) {
  const pending = order.status === "PENDING";
  const partial = order.status === "PARTIALLY_FILLED";
  return (
    <div>
      <DialogHeader>
        <DialogTitle>{pending ? "예약주문을 등록했어요" : "주문이 체결됐어요"}</DialogTitle>
        <DialogDescription>
          {pending
            ? "조건이 충족되면 자동으로 체결돼요. 주문 내역에서 취소할 수 있어요."
            : partial
              ? "슬리피지·재고 한도 때문에 일부만 체결됐어요."
              : "자세한 내용은 주문 내역에서 확인할 수 있어요."}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <SideBadge side={order.side} />
            <span className="text-[14px] font-semibold text-app-gray-900">{order.symbol}</span>
          </div>
          <OrderStatusChip status={order.status} />
        </div>

        {pending ? (
          <>
            <ResultRow
              label="목표 가격"
              value={`${fmtPrice(order.trigger_price ?? "0")} ${
                order.trigger_condition === "GTE" ? "이상" : "이하"
              }`}
            />
            {order.requested_credit ? (
              <ResultRow label="주문 금액" value={`${fmtCredit(order.requested_credit)} Credit`} />
            ) : null}
            {order.requested_quantity ? (
              <ResultRow label="주문 수량" value={`${fmtQuantity(order.requested_quantity)}주`} />
            ) : null}
            {order.max_credit_amount ? (
              <ResultRow
                label="예약 금액"
                value={`${fmtCredit(order.max_credit_amount)} Credit`}
              />
            ) : null}
          </>
        ) : (
          <>
            <ResultRow label="체결 수량" value={`${fmtQuantity(order.filled_quantity)}주`} />
            <ResultRow label="평균 체결가" value={`${fmtPrice(order.average_price)} Credit`} />
            <ResultRow label="주문 금액" value={`${fmtCredit(order.principal)} Credit`} />
            <ResultRow label="수수료" value={`${fmtCredit(order.fee)} Credit`} />
          </>
        )}
      </div>
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-[13px] text-app-gray-500">{label}</span>
      <span className="numeric min-w-0 break-all text-right text-[13px] font-semibold text-app-gray-900">{value}</span>
    </div>
  );
}
