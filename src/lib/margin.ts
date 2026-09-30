"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import {
  ApiError,
  apiData,
  buildQuery,
  errorMessage,
  postIdempotentData,
} from "./api";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  isDecimalInput,
  isPositiveDecimal,
  multiplyDecimal,
  ppmFromPercent,
  toNumber,
} from "./format";
import { invalidateBatched } from "./query-batch";

export type MarginSide = "LONG" | "SHORT";

export type MarginStatus =
  | "OPEN"
  | "LIQUIDATING"
  | "CUSTODY"
  | "CLOSED"
  | "LIQUIDATED"
  | "DELISTED";

export interface MarginEligibility {
  valid_trading_days: number;
  max_long_leverage: string;
  max_short_leverage: string;
  strikes: number;
  manual_blocked: boolean;
  blocked_until: string | null;
  can_open: boolean;
}

export interface MarginPosition {
  position_id: string;
  account_id: string;
  symbol: string;
  side: MarginSide;
  status: MarginStatus;
  quantity: string;
  leverage: string;
  borrowed_credit: string;
  collateral: string;
  locked_proceeds: string;
  prepaid_interest: string;
  unpaid_interest: string;
  refundable_interest: string;
  debt_value: string;
  equity: string;
  risk_ratio_ppm: number | null;
  realized_pnl: string;
  settled_payout: string;
  next_interest_at: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface MarginPositionsPage {
  next_cursor: string | null;
  has_more: boolean;
}

export interface MarginPositionsData {
  positions: MarginPosition[];
  page: MarginPositionsPage;
  eligibility: MarginEligibility;
}

export interface MarginCreateRequest {
  account_id?: string;
  symbol: string;
  side: MarginSide;
  collateral: string;
  leverage: string;
  slippage_ppm?: number;
  slippage_reference_price?: string;
}

export interface MarginAddCollateralRequest {
  amount: string;
}

export interface MarginReductionRequest {
  quantity: string;
  slippage_ppm?: number;
  slippage_reference_price?: string;
}

export interface MarginClosureRequest {
  slippage_ppm?: number;
  slippage_reference_price?: string;
}

export interface MarginSimulation {
  action: "OPEN" | "REDUCE" | "CLOSE";
  account_id: string;
  symbol: string;
  side: MarginSide;
  trade_side: "BUY" | "SELL";
  quantity: string;
  remaining_quantity: string;
  average_price: string;
  principal: string;
  fee: string;
  total_debit: string;
  net_proceeds: string;
  borrowed_credit_after: string;
  cash_collateral_after: string;
  locked_proceeds_after: string;
  interest_prepaid: string;
  interest_paid: string;
  interest_refund: string;
  interest_waived: string;
  realized_pnl: string;
  equity_after: string;
  risk_ratio_ppm_after: number | null;
  curve_price_before: string;
  curve_price_after: string;
  price_change_percent: string;
  as_of: string;
}

const MARGIN_ERROR_MESSAGES: Record<string, string> = {
  MARGIN_NOT_ELIGIBLE: "마진 거래 자격(거래일 수 등)을 충족하지 않아요",
  MARGIN_BLOCKED: "마진 포지션 생성이 제한되어 있어요",
  MARGIN_MANAGER_OWN_SYMBOL: "발행사(매니저)는 자기 종목에 이 방향의 포지션을 열 수 없어요",
  MARGIN_BORROW_LIMIT: "차입 가능 한도를 초과했어요",
  MARGIN_POSITION_STATE: "현재 상태에서는 처리할 수 없는 포지션이에요",
  MARGIN_LIQUIDITY: "정산 유동성이 부족하여 주문을 체결할 수 없어요",
  MARGIN_RISK_LIMIT: "위험 비율이 기준 이하라 처리할 수 없어요. 유지 기준 이하에서는 전액 종료만 가능해요",
  MARGIN_INTEREST_PENDING: "이자 정산 작업이 진행 중이에요. 잠시 후 다시 시도해주세요",
  INSUFFICIENT_CREDIT: "Credit 잔액이 부족해요",
  SLIPPAGE_EXCEEDED: "허용한 슬리피지를 초과했어요",
  SYMBOL_HALTED: "이 종목은 거래가 정지됐어요",
  SYMBOL_DELIST_PENDING: "상장폐지가 예정된 종목이에요",
  SYMBOL_DELISTED: "상장폐지된 종목이에요",
  IDEMPOTENCY_KEY_REUSED: "동일한 요청이 이미 처리 중이거나 완료되었어요",
};

// risk_ratio_ppm = equity ÷ debt × 1,000,000; lower is riskier.
export function isMarginRiskAtOrBelow(
  riskRatioPpm: number | null,
  thresholdPpm: number | undefined,
): boolean {
  return riskRatioPpm !== null && thresholdPpm !== undefined && riskRatioPpm <= thresholdPpm;
}

/** Optional slippage fields shared by margin previews and their real requests. */
export function marginSlippageFields(
  slippagePercent: string,
  referencePrice: string,
): { slippage_ppm?: number; slippage_reference_price?: string } {
  return {
    ...(slippagePercent.trim() ? { slippage_ppm: ppmFromPercent(slippagePercent.trim()) } : {}),
    ...(referencePrice.trim() ? { slippage_reference_price: referencePrice.trim() } : {}),
  };
}

export type MarginRiskLevel = "SAFE" | "WARNING" | "MAINTENANCE";

export function marginRiskLevel(
  riskRatioPpm: number | null,
  policy?: { warning_ppm: number; maintenance_ppm: number },
): MarginRiskLevel | null {
  if (riskRatioPpm === null || !policy) return null;
  if (riskRatioPpm <= policy.maintenance_ppm) return "MAINTENANCE";
  if (riskRatioPpm <= policy.warning_ppm) return "WARNING";
  return "SAFE";
}

export function marginErrorMessage(error: unknown): string {
  if (error instanceof ApiError && MARGIN_ERROR_MESSAGES[error.code]) {
    return MARGIN_ERROR_MESSAGES[error.code];
  }
  return errorMessage(error);
}

export const MARGIN_QUERY_KEYS = {
  positions: (accountId?: string) => ["margin-positions", accountId ?? "all"] as const,
  positionsAll: () => ["margin-positions"] as const,
  position: (positionId: string | null) => ["margin-position", positionId] as const,
  positionAll: () => ["margin-position"] as const,
};

export function invalidateMarginQueries(
  queryClient: QueryClient,
  // balances: false for events that only change risk (e.g. margin.warning).
  options?: { positionId?: string; balances?: boolean },
) {
  invalidateBatched(queryClient, [
    MARGIN_QUERY_KEYS.positionsAll(),
    options?.positionId
      ? MARGIN_QUERY_KEYS.position(options.positionId)
      : MARGIN_QUERY_KEYS.positionAll(),
  ]);
  if (options?.balances === false) return;
  invalidateBatched(
    queryClient,
    [["accounts"], ["portfolio"], ["nav"], ["orders"], ["my-trades"], ["realized-pnl"]],
  );
  invalidateBatched(queryClient, [["nav-history"]], { passive: true });
}

export function estimateMarginReturnPercent(
  position: Pick<MarginPosition, "status" | "side" | "equity" | "collateral" | "borrowed_credit" | "leverage">,
): string | null {
  if (position.status !== "OPEN") return null;
  const decimal = (value: unknown): value is string =>
    typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value);
  if (!decimal(position.equity) || !decimal(position.collateral) || compareDecimal(position.collateral, "0") < 0) {
    return null;
  }

  let basis = position.collateral;
  if (position.side === "LONG") {
    if (!decimal(position.borrowed_credit) || compareDecimal(position.borrowed_credit, "0") < 0 ||
        !decimal(position.leverage) || compareDecimal(position.leverage, "1") <= 0) return null;
    // LONG collateral is residual cash, so recover the funded margin from
    // borrowing/leverage and include any remaining or subsequently added cash.
    basis = addDecimal(
      divideDecimal(position.borrowed_credit, addDecimal(position.leverage, "-1"), 16),
      position.collateral,
    );
  } else if (position.side !== "SHORT") {
    return null;
  }
  if (compareDecimal(basis, "0") <= 0) return null;
  const profit = addDecimal(position.equity, multiplyDecimal(basis, "-1", 16));
  return divideDecimal(multiplyDecimal(profit, "100", 16), basis, 16);
}

export function getLeverageOptions(side: MarginSide, maxLeverageStr: string): string[] {
  const max = toNumber(maxLeverageStr);
  const min = side === "LONG" ? 1.1 : 1.0;
  if (max < min) return [];
  const options: string[] = [];
  let current = Math.round(min * 10);
  const maxInt = Math.round(max * 10);
  while (current <= maxInt) {
    options.push((current / 10).toFixed(1));
    current += 1;
  }
  return options;
}

export function validateCollateralAmount(
  collateral: string,
  availableCredit?: string,
): string | null {
  if (!collateral || collateral.trim() === "") {
    return "담보 Credit을 입력해주세요";
  }
  if (!isDecimalInput(collateral, 16) || !isPositiveDecimal(collateral)) {
    return "담보는 0보다 큰 양수이며 소수점 이하 최대 16자리까지 입력할 수 있어요";
  }
  if (availableCredit !== undefined && compareDecimal(collateral, availableCredit) > 0) {
    return "계좌의 출금 가능 Credit이 부족해요";
  }
  return null;
}

export function validateLeverage(
  leverage: string,
  side: MarginSide,
  maxLeverageStr: string,
): string | null {
  if (!leverage || leverage.trim() === "") {
    return "레버리지를 선택하거나 입력해주세요";
  }
  if (!/^\d+(\.\d)?$/.test(leverage)) {
    return "레버리지는 0.1 단위로 입력해주세요 (예: 1.5)";
  }
  const levNum = toNumber(leverage);
  const maxNum = toNumber(maxLeverageStr);
  if (side === "LONG" && levNum <= 1.0) {
    return "LONG 레버리지는 1.0을 초과해야 해요 (최소 1.1)";
  }
  if (side === "SHORT" && levNum < 1.0) {
    return "SHORT 레버리지는 1.0 이상이어야 해요";
  }
  if (levNum > maxNum) {
    return `허용된 최대 레버리지(${maxLeverageStr}x)를 초과할 수 없어요`;
  }
  return null;
}

export function validateReductionQuantity(
  quantity: string,
  remainingQuantity: string,
): string | null {
  if (!quantity || quantity.trim() === "") {
    return "정산할 수량을 입력해주세요";
  }
  if (!isDecimalInput(quantity, 8) || !isPositiveDecimal(quantity)) {
    return "수량은 0보다 큰 양수이며 소수점 이하 최대 8자리까지 입력할 수 있어요";
  }
  if (compareDecimal(quantity, remainingQuantity) >= 0) {
    return "부분 정산 수량은 남은 보유 수량보다 엄격히 작아야 해요 (전체 정산은 '전액 종료'를 이용하세요)";
  }
  return null;
}

const LIVE_MARGIN_STATUSES = new Set<MarginStatus>(["OPEN", "LIQUIDATING"]);

export function useMarginPositions(
  options: { accountId?: string; limit?: number; enabled?: boolean; poll?: boolean } = {},
) {
  const { accountId, limit = 50, enabled = true, poll = true } = options;
  return useInfiniteQuery({
    queryKey: [...MARGIN_QUERY_KEYS.positions(accountId), limit],
    queryFn: ({ pageParam }) =>
      apiData<MarginPositionsData>(
        `/api/v1/margin/positions${buildQuery({
          limit,
          cursor: pageParam,
          account_id: accountId || undefined,
        })}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page?.has_more ? last.page.next_cursor : null),
    // Equity and risk move with prices, so poll only while a position is live.
    refetchInterval: (query) =>
      poll &&
      query.state.data?.pages.some((page) =>
        page.positions.some((position) => LIVE_MARGIN_STATUSES.has(position.status)),
      )
        ? 10_000
        : false,
    enabled,
  });
}

export function useMarginPosition(positionId: string | null) {
  return useQuery({
    queryKey: MARGIN_QUERY_KEYS.position(positionId),
    queryFn: () => apiData<MarginPosition>(`/api/v1/margin/positions/${positionId}`),
    enabled: Boolean(positionId),
    refetchInterval: (query) =>
      query.state.data && LIVE_MARGIN_STATUSES.has(query.state.data.status) ? 5_000 : false,
  });
}

/** Read-only preview; requested explicitly and never reused after the inputs change. */
export function useMarginSimulation(path: string | null, payload: object | null) {
  return useQuery({
    queryKey: ["margin-simulation", path, payload],
    queryFn: ({ signal }) =>
      apiData<MarginSimulation>(path ?? "", { method: "POST", body: payload, signal }),
    enabled: false,
    gcTime: 0,
    retry: false,
  });
}

export function useCreateMarginPosition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MarginCreateRequest) =>
      postIdempotentData<MarginPosition>("/api/v1/margin/positions", payload),
    onSuccess: (data) => {
      invalidateMarginQueries(queryClient, { positionId: data.position_id });
    },
  });
}

export function useAddMarginCollateral(positionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MarginAddCollateralRequest) =>
      postIdempotentData<MarginPosition>(
        `/api/v1/margin/positions/${positionId}/collateral`,
        payload,
      ),
    onSuccess: () => {
      invalidateMarginQueries(queryClient, { positionId });
    },
  });
}

export function useReduceMarginPosition(positionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MarginReductionRequest) =>
      postIdempotentData<MarginPosition>(
        `/api/v1/margin/positions/${positionId}/reductions`,
        payload,
      ),
    onSuccess: () => {
      invalidateMarginQueries(queryClient, { positionId });
    },
  });
}

export function useCloseMarginPosition(positionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MarginClosureRequest = {}) =>
      postIdempotentData<MarginPosition>(
        `/api/v1/margin/positions/${positionId}/closure`,
        payload,
      ),
    onSuccess: () => {
      invalidateMarginQueries(queryClient, { positionId });
    },
  });
}
