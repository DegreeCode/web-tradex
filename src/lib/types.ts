export interface PageInfo {
  next_cursor: string | null;
  has_more: boolean;
}

export interface Page<T> {
  data: T[];
  page: PageInfo;
}

export type LinkedPermission = "READ" | "TRADE" | "TRANSFER" | "MARGIN";

/** What a device-linked (LINKED) session may do, as the server reports it. */
export interface SessionScope {
  name: string;
  permissions: LinkedPermission[];
  account_ids: string[];
  network_bound: boolean;
  idle_timeout_minutes: number;
  expires_at: string;
}

export interface User {
  user_id: string;
  username: string;
  role: string;
  status: string;
  created_at: string;
  /** NORMAL, RECOVERY or LINKED; older servers omit it. */
  session_type?: string;
  /** Present only for a LINKED session. */
  scope?: SessionScope | null;
}

export interface Account {
  account_id: string;
  is_primary: boolean;
  available_credit: string;
  locked_credit: string;
  total_credit: string;
  created_at: string;
}

export interface SessionInfo {
  session_id: string;
  /** "NORMAL"/"RECOVERY" for full sessions; the scope object for a LINKED one. */
  scope: string | SessionScope;
  session_type?: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  is_current: boolean;
}

export interface SessionList {
  sessions: SessionInfo[];
  next_cursor: string | null;
}

export interface Passkey {
  passkey_id: string;
  created_at: string;
  last_used_at?: string;
}

export interface MarketSymbol {
  icon_url?: string | null;
  symbol: string;
  manager_user_id?: string;
  name: string;
  description: string;
  tags: string[];
  state: InstrumentState;
  total_supply: string;
  circulating_supply: string;
  locked_supply: string;
  /** Current curve bounds from the public symbol metadata contract. */
  curve_floor_price?: string | null;
  curve_ceiling_price?: string | null;
  listing_sequence: number;
  listed_at: string;
  updated_at: string;
  halt_reason: string | null;
  halted_at: string | null;
  halted_until: string | null;
  version: string;
}

export interface Ticker {
  symbol: string;
  last_price: string;
  curve_spot_price: string;
  market_value: string;
  holder_count: number;
  open: string;
  high: string;
  low: string;
  volume_shares: string;
  volume_credit: string;
  change_ppm: number;
  trade_count: number;
  window_start: string;
}

/** Server-supported ranking keys for GET /market/tickers. */
export type TickerSort = "alphabetical" | "recent" | "popular" | "market_value" | "volume" | "gainers" | "losers";

/** View model composed from the separate symbol metadata and ticker contracts. */
export interface Instrument extends MarketSymbol, Ticker {}

export type InstrumentState = "TRADING" | "HALTED" | "DELIST_PENDING" | "DELISTED";

export interface MarketState {
  state: "RUNNING" | "GLOBAL_HALTED";
  reason: string | null;
  halted_at: string | null;
  halted_until: string | null;
  changed_at: string;
}

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "TRIGGER";
export type OrderStatus =
  | "FILLED"
  | "PARTIALLY_FILLED"
  | "REJECTED"
  | "PENDING"
  | "ACTIVATED"
  | "CANCELED"
  | "EXPIRED"
  | "FAILED";

type FutureOrderToken = string & Record<never, never>;

export interface Order {
  order_id: string;
  symbol: string;
  account_id: string;
  side: OrderSide;
  order_type: OrderType;
  status: OrderStatus;
  requested_credit?: string;
  requested_quantity?: string;
  filled_quantity: string;
  principal: string;
  fee: string;
  average_price: string;
  trigger_condition?: "GTE" | "LTE";
  trigger_price?: string;
  slippage_reference_price?: string;
  max_credit_amount?: string;
  fee_ppm?: number;
  revision?: number;
  on_partial_fill?: "TERMINATE" | "KEEP" | FutureOrderToken;
  on_slippage_exceeded?: "FAIL" | "RETRY" | FutureOrderToken;
  slippage_ppm?: number;
  fill_count?: number;
  activation_count?: number;
  remaining_quantity?: string;
  remaining_credit?: string;
  held_credit?: string;
  held_quantity?: string;
  hold_scope?: "ORDER" | "GROUP" | FutureOrderToken;
  group_id?: string;
  group_role?: "ENTRY" | "TAKE_PROFIT" | "STOP_LOSS" | FutureOrderToken;
  parent_group_id?: string;
  wait_reason?: "PARTIAL_FILL" | "SLIPPAGE_EXCEEDED" | FutureOrderToken;
  terminal_reason?: string;
  trailing_ppm?: number;
  trailing_watermark_price?: string;
  expires_at?: string;
  created_at: string;
}

export interface OrderRequest {
  account_id?: string;
  symbol: string;
  order_type?: OrderType | "";
  side: OrderSide;
  credit_amount?: string;
  quantity?: string;
  trigger_condition?: "GTE" | "LTE";
  trigger_price?: string;
  expires_at?: string;
  slippage_ppm?: number;
  slippage_reference_price?: string;
}

export type OrderSimulationRequest = Omit<
  OrderRequest,
  "order_type" | "trigger_condition" | "trigger_price" | "expires_at"
> & { order_type: "MARKET" };

export interface OrderSimulation {
  symbol: string;
  side: OrderSide;
  order_type: "MARKET";
  requested_credit?: string;
  requested_quantity?: string;
  filled_quantity: string;
  average_price: string;
  principal: string;
  fee: string;
  total_debit: string;
  net_proceeds: string;
  curve_price_before: string;
  curve_price_after: string;
  price_change_percent: string;
  fee_ppm: number;
  slippage_ppm: number;
  partially_filled: boolean;
  limit_reasons: string[];
  as_of: string;
}

export interface Trade {
  trade_id: string;
  symbol: string;
  side: OrderSide;
  price: string;
  quantity: string;
  credit: string;
  fee: string;
  timestamp: string;
  sequence: number;
}

export interface PublicTrade {
  symbol: string;
  side: OrderSide;
  price: string;
  quantity: string;
  credit: string;
  fee: string;
  timestamp: string;
  sequence: number;
}

export interface Position {
  symbol: string;
  name: string;
  available_quantity: string;
  locked_quantity: string;
  total_quantity: string;
  average_cost_basis: string;
  cost_basis: string;
  realized_pnl: string;
}

export interface Portfolio {
  account_id: string;
  available_credit: string;
  locked_credit: string;
  total_credit: string;
  positions: Position[];
  updated_at: string;
}

export interface RealizedPnL {
  symbol: string;
  realized_pnl: string;
  trade_id: string;
  at: string;
}

export type TransferStatus = "PENDING" | "REJECTED" | "CANCELED" | "EXPIRED" | "COMPLETED";

export interface Transfer {
  transfer_id: string;
  asset: "CREDIT" | "STOCK";
  status: TransferStatus;
  deadline: string;
  created_at: string;
  sender_user_id?: string;
  sender_account_id?: string;
  recipient_user_id?: string;
  recipient_account_id?: string;
  symbol?: string;
  amount?: string;
  quantity?: string;
  fee_credit: string;
  approval_mode: "MANUAL" | "AUTO" | "NONE";
  recipient_accepted: boolean;
  admin_approved: boolean;
}

export interface TransferRequest {
  account_id?: string;
  recipient_account_id: string;
  asset: "CREDIT" | "STOCK";
  amount?: string;
  symbol?: string;
  quantity?: string;
}

export interface IssuancePreview {
  requested_deposit: string;
  accepted: boolean;
  estimated_locked_shares: string;
  estimated_pool_shares: string;
  estimated_total_shares: string;
  price_before: string;
  price_after: string;
  price_dilution_ppm: number;
  supply_increase_ppm: number;
  rolling_24h_supply_increase_ppm: number;
  maximum_acceptable_deposit: string;
  /** Present only while the symbol's issuance cooldown is running. */
  cooldown_until?: string;
  reason?: string;
}

export interface Issuance {
  issuance_id: string;
  symbol: string;
  deposit_credit: string;
  price_before: string;
  price_after: string;
  price_dilution_ppm: number;
  goal_price_before: string;
  goal_price_after: string;
  locked_shares_issued: string;
  pool_shares_issued: string;
  total_shares_issued: string;
  total_supply_before: string;
  total_supply_after: string;
  rolling_24h_supply_increase_ppm: number;
  forced: boolean;
  issued_at: string;
}

export interface ManagerRequest {
  request_id: string;
  symbol: string;
  target_user_id: string;
  status: string;
  reason: string;
  created_at: string;
  responded_at?: string;
}

export interface ListingRequest {
  icon_url?: string;
  symbol: string;
  name: string;
  description: string;
  tags: string[];
  deposit_credit: string;
  /** Share of supply locked to the lister; omitted to use the server default. */
  locked_supply_ppm?: number;
}

export interface Candle {
  symbol: string;
  interval: string;
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume_shares: string;
  volume_credit: string;
  trade_count: number;
  /** Client-generated no-trade gap filler; never sent by the API. */
  synthetic?: boolean;
}

export type CandleInterval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w" | "1M" | "1y" | "1s";

export interface Disclosure {
  disclosure_id: string;
  type: string;
  symbol: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface NavAccount {
  account_id: string;
  available_credit: string;
  locked_credit: string;
  total_credit: string;
  available_asset_value: string;
  locked_asset_value: string;
  asset_value: string;
  margin_adjustment: string;
  total_value: string;
}

export interface Nav {
  user_id: string;
  available_credit: string;
  locked_credit: string;
  total_credit: string;
  available_asset_value: string;
  locked_asset_value: string;
  asset_value: string;
  margin_adjustment: string;
  total_value: string;
  accounts: NavAccount[];
  updated_at: string;
}

export interface NavPoint {
  timestamp: string;
  value: string;
}

export type NavRange = "1d" | "1w" | "1mo" | "3mo" | "6mo" | "1y" | "5y" | "all";

export interface Notification {
  notification_id: string;
  kind: string;
  title: string;
  body: string;
  version: number;
  pinned: boolean;
  read: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export type InquiryCategory = "ACCOUNT" | "TRADE" | "TRANSFER" | "LISTING" | "SECURITY" | "OTHER";
export type InquiryStatus = "WAITING_ADMIN" | "WAITING_USER" | "RESOLVED" | "CLOSED";

export interface Inquiry {
  ticket: string;
  user_id: string;
  category: InquiryCategory;
  subject: string;
  status: InquiryStatus;
  created_at: string;
  updated_at: string;
}

export interface InquiryMessage {
  id: string;
  ticket: string;
  author_user_id: string;
  author_acl: string;
  body: string;
  created_at: string;
}

export interface InquiryDetail extends Inquiry {
  messages: InquiryMessage[];
}

export interface WsFrame<T = unknown> {
  type: "snapshot" | "update" | "pong" | "error";
  stream?: string;
  version?: number;
  seq?: number;
  event?: string;
  data?: T;
  code?: string;
}
