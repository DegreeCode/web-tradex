"use client";

import { useAuth } from "@/components/auth-provider";
import { managerMarginSideBlocked, useExchangeInfo, slippageError } from "@/lib/exchange-info";
import { TradePolicy, MarginInterestPolicy } from "@/components/exchange-policy";
import { InfoTip } from "@/components/info-tip";
import { SlippageFields } from "@/components/slippage-fields";
import { useSlippagePreference } from "@/lib/preferences";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { ErrorBlock, InstrumentStateChip, Surface } from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import { MarginSimulationPreview } from "./margin-simulation-preview";
import {
  addDecimal,
  compareDecimal,
  fmtCredit,
  fmtDateTime,
  fmtPrice,
  isDecimalInput,
  multiplyDecimal,
  scaleDecimal,
} from "@/lib/format";
import { defaultAccountId as pickDefaultAccount } from "@/lib/accounts";
import { useAccounts, useInstrument, useInstruments, useMarketState } from "@/lib/hooks";
import {
  getLeverageOptions,
  marginErrorMessage,
  marginPartialFillText,
  marginSlippageFields,
  useCreateMarginPosition,
  validateCollateralAmount,
  validateLeverage,
  type MarginEligibility,
  type MarginSide,
} from "@/lib/margin";

export function MarginCreateForm({
  eligibility,
  eligibilityPending = false,
  initialSymbol,
  selectedAccountId,
  onCreated,
}: {
  eligibility?: MarginEligibility;
  eligibilityPending?: boolean;
  initialSymbol?: string;
  selectedAccountId?: string;
  onCreated?: () => void;
}) {
  const { data: exchangeInfo } = useExchangeInfo();
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const instrumentsQuery = useInstruments();
  const instruments = instrumentsQuery.data ?? [];
  const marketStateQuery = useMarketState();
  const marketState = marketStateQuery.data;

  // Account resolution
  const currentAccountId = selectedAccountId || pickDefaultAccount(accounts);
  const currentAccount = accounts.find((a) => a.account_id === currentAccountId);

  // Form states
  const [symbol, setSymbol] = useState(initialSymbol ?? "");
  const resolvedSymbol = symbol || initialSymbol || instruments[0]?.symbol || "";
  const [side, setSide] = useState<MarginSide>("LONG");
  const [collateral, setCollateral] = useState("");
  const [leverage, setLeverage] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [slippagePercent, setSlippagePercent] = useSlippagePreference();
  const [referencePrice, setReferencePrice] = useState("");

  const selectedInstrument = useInstrument(resolvedSymbol).data;
  const createMutation = useCreateMarginPosition();

  // Active leverage cap from eligibility
  const maxLeverageStr = useMemo(() => {
    if (!eligibility) return "1.0";
    return side === "LONG" ? eligibility.max_long_leverage : eligibility.max_short_leverage;
  }, [eligibility, side]);

  const leverageOptions = useMemo(() => {
    return getLeverageOptions(side, maxLeverageStr);
  }, [side, maxLeverageStr]);

  // Adjust default leverage when side or options change if current leverage is invalid
  const resolvedLeverage = useMemo(() => {
    if (leverage && leverageOptions.includes(leverage)) return leverage;
    return leverageOptions[0] ?? "";
  }, [leverage, leverageOptions]);

  // Validations
  const collateralError = validateCollateralAmount(collateral, currentAccount?.available_credit);
  const leverageError = validateLeverage(resolvedLeverage, side, maxLeverageStr);

  const isGlobalHalted = marketState?.state === "GLOBAL_HALTED";
  const isSymbolTrading = Boolean(selectedInstrument && selectedInstrument.state === "TRADING");
  const isEligibleToOpen = Boolean(eligibility?.can_open);
  const { user } = useAuth();
  const managerSideBlocked = Boolean(
    user &&
    selectedInstrument?.manager_user_id === user.user_id &&
    managerMarginSideBlocked(side, exchangeInfo?.margin.manager_own_symbol_block),
  );

  const payload =
    !collateralError &&
    !leverageError &&
    currentAccountId &&
    resolvedSymbol &&
    !slippageError(slippagePercent, exchangeInfo?.trade)
      ? {
          account_id: currentAccountId,
          symbol: resolvedSymbol,
          side,
          collateral: collateral.trim(),
          leverage: resolvedLeverage,
          ...marginSlippageFields(slippagePercent, referencePrice),
        }
      : null;

  const canSubmit =
    !collateralError &&
    !leverageError &&
    !isGlobalHalted &&
    isSymbolTrading &&
    isEligibleToOpen &&
    !managerSideBlocked &&
    Boolean(currentAccountId) &&
    Boolean(resolvedSymbol) &&
    Boolean(collateral) &&
    !createMutation.isPending;

  // Estimation
  const estimatedNotional = useMemo(() => {
    if (!collateral || !resolvedLeverage) return null;
    return multiplyDecimal(collateral, resolvedLeverage, 4);
  }, [collateral, resolvedLeverage]);

  const estimatedBorrow = useMemo(() => {
    if (!collateral || !resolvedLeverage) return null;
    if (side === "LONG") {
      // LONG borrows the part of the position above the collateral itself.
      return multiplyDecimal(collateral, addDecimal(resolvedLeverage, "-1"), 4);
    }
    // SHORT: Borrowing shares equivalent to collateral * leverage
    return multiplyDecimal(collateral, resolvedLeverage, 4);
  }, [collateral, resolvedLeverage, side]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const invalidSlippage = slippageError(slippagePercent, exchangeInfo?.trade);
    if (invalidSlippage) { toast.error(invalidSlippage); return; }
    if (!canSubmit || !payload) return;

    try {
      const position = await createMutation.mutateAsync(payload);
      const label = `${resolvedSymbol} ${side === "LONG" ? "롱" : "숏"} 포지션`;
      // The server clips entry to the executable collateral; the rest stays in the account.
      if (position.execution?.partially_filled) {
        toast.warning(`${label}을 일부만 열었어요`, {
          description: `${marginPartialFillText(position.execution)}. 사용하지 않은 담보는 차감되지 않아요.`,
        });
      } else {
        toast.success(`${label}을 열었어요`);
      }
      setCollateral("");
      onCreated?.();
    } catch (err) {
      toast.error(marginErrorMessage(err));
    }
  }

  const availableCredit = currentAccount?.available_credit;
  const leverageIndex = Math.max(0, leverageOptions.indexOf(resolvedLeverage));
  const blockedReason = eligibility && !isEligibleToOpen
    ? eligibility.manual_blocked
      ? "관리자가 신규 개설을 막아 둔 계정이에요."
      : eligibility.blocked_until
        ? `강제청산이 누적되어 ${fmtDateTime(eligibility.blocked_until)}까지 신규 개설이 제한돼요.`
        : "신규 개설 요건(유효 거래일 수 등)을 아직 충족하지 않았어요."
    : null;
  const defaultSlippage = exchangeInfo ? `${exchangeInfo.trade.default_slippage_ppm / 10_000}%` : null;

  return (
    <Surface className="min-w-0 break-words">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-bold tracking-[-0.02em] text-app-gray-900">
          새 포지션 열기
        </h2>
        {eligibility ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${
              isEligibleToOpen ? "bg-app-green-light text-app-green" : "bg-app-red-light text-app-red"
            }`}
          >
            {isEligibleToOpen ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            {isEligibleToOpen ? "개설 가능" : "개설 제한"}
          </span>
        ) : eligibilityPending ? (
          <span className="text-[12px] text-app-gray-400">자격 확인 중…</span>
        ) : null}
      </div>
      {eligibility ? (
        <p className="numeric mt-1 text-[12px] text-app-gray-500">
          유효 거래일 {eligibility.valid_trading_days}일 · 청산 누적 {eligibility.strikes}회 · 최대 롱{" "}
          {eligibility.max_long_leverage}x / 숏 {eligibility.max_short_leverage}x
        </p>
      ) : null}

      {isGlobalHalted ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-app-red-light p-3 text-[13px] text-app-red">
          <AlertCircle className="size-4 shrink-0" />
          <span>전체 시장이 일시 정지되어 신규 포지션을 열 수 없어요.</span>
        </div>
      ) : null}
      {blockedReason ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-app-red-light p-3 text-[13px] text-app-red">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{blockedReason}</span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 space-y-5">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="margin-symbol" className="text-[13px] font-semibold text-app-gray-500">종목</label>
            {selectedInstrument ? (
              <span className="numeric text-[12px] text-app-gray-500">
                현재가 <b className="font-bold text-app-gray-900">{fmtPrice(selectedInstrument.curve_spot_price)}</b>
              </span>
            ) : null}
          </div>
          <select
            id="margin-symbol"
            disabled={instrumentsQuery.isPending || instruments.length === 0}
            value={resolvedSymbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="mt-1.5 w-full min-w-0 max-w-full rounded-xl bg-app-gray-100 px-3 py-2.5 text-base md:text-[15px] font-semibold text-app-gray-900 focus:outline-2 focus:outline-app-blue"
          >
            {instruments.length === 0 ? <option value="">{instrumentsQuery.isPending ? "종목 불러오는 중…" : "선택할 종목이 없어요"}</option> : null}
            {instruments.map((inst) => (
              <option key={inst.symbol} value={inst.symbol}>
                {inst.symbol === inst.name ? inst.symbol : `${inst.symbol} · ${inst.name}`}{inst.state !== "TRADING" ? " (거래 제한)" : ""}
              </option>
            ))}
          </select>
          {instrumentsQuery.isError ? <ErrorBlock message="종목 목록을 불러오지 못했어요." onRetry={() => void instrumentsQuery.refetch()} /> : null}
          {selectedInstrument && selectedInstrument.state !== "TRADING" ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <InstrumentStateChip state={selectedInstrument.state} />
              <span className="text-[12px] font-medium text-app-red">
                거래가 제한된 종목이라 포지션을 열 수 없어요.
              </span>
            </div>
          ) : null}
        </div>

        <Segmented
          value={side}
          onChange={(val) => setSide(val as MarginSide)}
          options={[
            { value: "LONG", label: "롱 · 오르면 수익", tone: "buy" },
            { value: "SHORT", label: "숏 · 내리면 수익", tone: "sell" },
          ]}
        />
        {managerSideBlocked ? (
          <p role="note" className="-mt-2 text-[12px] font-medium text-app-red">
            발행사(매니저)는 자기 종목에 {side === "LONG" ? "롱" : "숏"} 포지션을 열 수 없어요.
          </p>
        ) : null}

        <div>
          <div className="flex items-center gap-0.5">
            <label htmlFor="margin-collateral" className="text-[13px] font-semibold text-app-gray-500">담보</label>
            <InfoTip label="담보">
              차입 한도·풀 유동성·슬리피지·잔고를 넘으면 요청한 담보 중 체결 가능한 만큼만 사용해요. 쓰지 않은 담보는
              차감되지 않아요. 예상 결과 확인에서 지금 가능한 최대 담보를 볼 수 있어요.
            </InfoTip>
          </div>
          <div className="mt-1 flex items-baseline gap-1 border-b-2 border-app-gray-200 pb-1.5 focus-within:border-app-blue">
            <input
              id="margin-collateral"
              type="text"
              inputMode="decimal"
              value={collateral}
              placeholder="0"
              aria-invalid={Boolean(collateral && collateralError)}
              aria-describedby="margin-collateral-hint"
              onChange={(e) => {
                const val = e.target.value.replace(/,/g, "");
                if (val === "" || isDecimalInput(val, 16)) {
                  setCollateral(val);
                }
              }}
              className="numeric w-full min-w-0 bg-transparent text-right text-[26px] font-bold text-app-gray-900 outline-none placeholder:text-app-gray-300"
            />
            <span className="shrink-0 text-[14px] font-semibold text-app-gray-400">Credit</span>
          </div>
          <div role="group" aria-label="사용 가능 금액 비율" className="mt-2.5 grid grid-cols-4 gap-1.5">
            {[10, 25, 50, 100].map((percent) => {
              const value = availableCredit
                ? percent === 100 ? availableCredit : scaleDecimal(availableCredit, percent / 100, 16)
                : null;
              return (
                <button
                  key={percent}
                  type="button"
                  disabled={!value}
                  onClick={() => value && setCollateral(value)}
                  aria-pressed={Boolean(value && collateral) && compareDecimal(collateral, value ?? "0") === 0}
                  className="min-h-9 rounded-lg bg-app-gray-100 text-[12px] font-semibold text-app-gray-600 hover:bg-app-gray-200 aria-pressed:bg-app-blue-light aria-pressed:text-app-blue-dark disabled:opacity-40"
                >
                  {percent === 100 ? "최대" : `${percent}%`}
                </button>
              );
            })}
          </div>
          <p id="margin-collateral-hint" className={`numeric mt-2 text-[12px] ${collateral && collateralError ? "font-medium text-app-red" : "text-app-gray-500"}`}>
            {collateral && collateralError
              ? collateralError
              : availableCredit
                ? `사용 가능 ${fmtCredit(availableCredit, 2)} Credit`
                : "사용 가능 금액 확인 중…"}
          </p>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="margin-leverage" className="text-[13px] font-semibold text-app-gray-500">레버리지</label>
            <span className="numeric text-[22px] font-bold text-app-gray-900">
              {resolvedLeverage ? `${resolvedLeverage}x` : "—"}
            </span>
          </div>
          {leverageOptions.length > 0 ? (
            <>
              <input
                id="margin-leverage"
                type="range"
                min={0}
                max={leverageOptions.length - 1}
                step={1}
                value={leverageIndex}
                disabled={leverageOptions.length < 2}
                onChange={(e) => setLeverage(leverageOptions[Number(e.target.value)] ?? "")}
                aria-valuetext={`${resolvedLeverage}배`}
                className={`mt-2 h-2 w-full cursor-pointer ${side === "LONG" ? "accent-app-red" : "accent-app-blue"}`}
              />
              <div className="numeric mt-1 flex justify-between text-[11px] text-app-gray-400">
                <span>{leverageOptions[0]}x</span>
                <span>최대 {leverageOptions[leverageOptions.length - 1]}x</span>
              </div>
            </>
          ) : (
            <div className="mt-1.5 rounded-lg bg-app-gray-100 p-2.5 text-[12px] text-app-gray-500">
              {eligibilityPending ? "마진 거래 자격을 확인하고 있어요." : eligibility ? `지금은 ${side === "LONG" ? "롱" : "숏"} 레버리지를 쓸 수 없어요.` : "마진 거래 자격을 확인한 뒤 배율을 고를 수 있어요."}
            </div>
          )}
          {resolvedLeverage && leverageError ? (
            <p className="mt-1 text-[12px] font-medium text-app-red">{leverageError}</p>
          ) : null}
        </div>

        {collateral && resolvedLeverage && !collateralError && !leverageError ? (
          <div className="space-y-1.5 rounded-xl bg-app-gray-50 p-3 text-[13px]">
            <div className="flex items-center justify-between gap-3 text-app-gray-500">
              <span>포지션 규모</span>
              <span className="numeric break-all font-bold text-app-gray-900">
                {fmtCredit(estimatedNotional ?? "0", 4)} Credit
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-app-gray-500">
              <span>{side === "LONG" ? "빌리는 Credit" : "빌리는 주식 가치"}</span>
              <span className="numeric break-all font-bold text-app-gray-900">
                {fmtCredit(estimatedBorrow ?? "0", 4)} Credit
              </span>
            </div>
          </div>
        ) : null}

        <MarginSimulationPreview
          path="/api/v1/margin/positions/simulation"
          payload={payload}
          onApplyMaxCollateral={setCollateral}
        />

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            aria-expanded={showAdvanced}
            className="flex w-full items-center justify-between gap-3 text-[13px] font-semibold text-app-gray-500"
          >
            고급 설정
            <span className="flex items-center gap-1 font-medium text-app-gray-400">
              {slippagePercent.trim() ? `슬리피지 ${slippagePercent.trim()}%` : defaultSlippage ? `슬리피지 ${defaultSlippage}` : null}
              <ChevronDown className={`size-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            </span>
          </button>
          {showAdvanced ? (
            <div className="space-y-2.5 rounded-xl bg-app-gray-50 p-3">
              <SlippageFields
                slippage={slippagePercent}
                onSlippageChange={setSlippagePercent}
                referencePrice={referencePrice}
                onReferencePriceChange={setReferencePrice}
              />
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setShowPolicy(!showPolicy)}
            aria-expanded={showPolicy}
            className="flex w-full items-center justify-between gap-3 text-[13px] font-semibold text-app-gray-500"
          >
            수수료·이자·청산 규칙
            <ChevronDown className={`size-4 text-app-gray-400 transition-transform ${showPolicy ? "rotate-180" : ""}`} />
          </button>
          {showPolicy ? (
            <div className="space-y-2">
              <MarginInterestPolicy />
              <TradePolicy />
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[16px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40 ${
              side === "LONG" ? "bg-app-red" : "bg-app-blue"
            }`}
          >
            {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {side === "LONG" ? "롱 포지션 열기" : "숏 포지션 열기"}
          </button>
          <p className="text-center text-[11px] text-app-gray-400">
            마진 거래는 담보를 잃을 수 있고, 위험 비율이 유지 기준 이하로 떨어지면 강제청산될 수 있어요.
          </p>
        </div>
      </form>
    </Surface>
  );
}
