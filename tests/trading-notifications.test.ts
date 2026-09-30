import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";

import {
  parseTradingNotification,
} from "../src/lib/notifications";
import {
  applyTradingNotification,
  cacheSymbolMetadata,
  lastTradingEventTimestamps,
  readMarketStateCache,
  reconcileNotificationData,
} from "../src/lib/hooks";
import { clearSymbolMetadataCache } from "../src/lib/symbol-metadata";
import type { MarketSymbol, MarketState, Instrument, Notification } from "../src/lib/types";

// Setup browser storage mock for Node environment
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, String(value));
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
};

// Install mock window before testing cache paths
(globalThis as unknown as { window: unknown }).window = {
  localStorage: localStorageMock,
};

const SYMBOL_METADATA_CACHE_KEY = "tradex:public-symbol-metadata:v1";

function seedSymbolMetadataCache(symbols: MarketSymbol[]) {
  clearSymbolMetadataCache();
  const cache = {
    schema_version: 3,
    symbols,
    next_since_version: "100",
    saved_at: Date.now(),
  };
  localStorageMock.setItem(SYMBOL_METADATA_CACHE_KEY, JSON.stringify(cache));
}

function createSampleSymbol(symbol: string, state: "TRADING" | "HALTED" = "TRADING"): MarketSymbol {
  return {
    symbol,
    name: `${symbol} Synthetic`,
    description: "Synthetic token",
    tags: ["defi"],
    state,
    total_supply: "1000000",
    circulating_supply: "500000",
    locked_supply: "0",
    curve_floor_price: "100.000000",
    curve_ceiling_price: "200.000000",
    listing_sequence: 1,
    listed_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    halt_reason: state === "HALTED" ? "maintenance" : null,
    halted_at: state === "HALTED" ? "2026-09-01T00:00:00Z" : null,
    halted_until: null,
    version: "1",
  };
}

test("metadata notifications refresh each symbol once across both reconciliation handlers", async (t) => {
  const client = new QueryClient();
  const symbol = createSampleSymbol("ALPHA.M");
  seedSymbolMetadataCache([symbol]);
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ data: [symbol] }));
  });
  try {
    for (const event of ["SYMBOL_METADATA_CHANGED", "SYMBOL_LISTED"]) {
      requests.length = 0;
      const notification: Notification = {
        notification_id: `ntf_${event}`,
        kind: "USER",
        title: event,
        body: `ALPHA.M ${event}`,
        version: 1,
        pinned: false,
        read: false,
        created_at: "2026-09-22T00:00:00Z",
        updated_at: "2026-09-22T00:00:00Z",
        expires_at: null,
      };
      applyTradingNotification(client, notification);
      reconcileNotificationData(client, notification);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(requests.length, 1, event);
      assert.match(requests[0], /\/symbols\/batch\?symbols=ALPHA.M$/);
    }
  } finally {
    client.clear();
    clearSymbolMetadataCache();
    lastTradingEventTimestamps.clear();
  }
});

// -----------------------------------------------------------------------------
// 1. Structured Notification Parsing Tests (Never Infer From Prose)
// -----------------------------------------------------------------------------

test("parseTradingNotification parses SYMBOL_HALTED from body, title, or payload", () => {
  // From body with reason
  const n1: Notification = {
    notification_id: "ntf_1",
    kind: "USER",
    title: "SYMBOL_HALTED",
    body: "ALPHA.M SYMBOL_HALTED: 점검",
    version: 1,
    pinned: false,
    read: false,
    created_at: "2026-09-16T10:00:00Z",
    updated_at: "2026-09-16T10:00:00Z",
    expires_at: null,
  };
  const parsed1 = parseTradingNotification(n1);
  assert.equal(parsed1?.eventType, "SYMBOL_HALTED");
  assert.equal(parsed1?.symbol, "ALPHA.M");
  assert.equal(parsed1?.reason, "점검");

  // From Korean title
  const n2: Notification = {
    ...n1,
    title: "종목 거래가 중지됐어요",
    body: "BETA.M SYMBOL_HALTED",
  };
  const parsed2 = parseTradingNotification(n2);
  assert.equal(parsed2?.eventType, "SYMBOL_HALTED");
  assert.equal(parsed2?.symbol, "BETA.M");

  // From explicit structured payload
  const n3: Notification & { payload?: Record<string, unknown> } = {
    ...n1,
    payload: {
      symbol: "GAMMA.M",
      state: "HALTED",
      reason: "긴급 점검",
      halted_until: "2026-09-17T00:00:00Z",
    },
  };
  const parsed3 = parseTradingNotification(n3);
  assert.equal(parsed3?.eventType, "SYMBOL_HALTED");
  assert.equal(parsed3?.symbol, "GAMMA.M");
  assert.equal(parsed3?.reason, "긴급 점검");
  assert.equal(parsed3?.halted_until, "2026-09-17T00:00:00Z");
});

test("parseTradingNotification parses SYMBOL_RESUMED correctly", () => {
  const n: Notification = {
    notification_id: "ntf_2",
    kind: "USER",
    title: "SYMBOL_RESUMED",
    body: "ALPHA.M SYMBOL_RESUMED",
    version: 1,
    pinned: false,
    read: false,
    created_at: "2026-09-16T10:05:00Z",
    updated_at: "2026-09-16T10:05:00Z",
    expires_at: null,
  };
  const parsed = parseTradingNotification(n);
  assert.equal(parsed?.eventType, "SYMBOL_RESUMED");
  assert.equal(parsed?.symbol, "ALPHA.M");
});

test("parseTradingNotification parses GLOBAL_MARKET_HALTED and RESUMED", () => {
  const halt: Notification = {
    notification_id: "ntf_3",
    kind: "SYSTEM",
    title: "Global market halted",
    body: "GLOBAL_MARKET_HALTED: 정기 점검",
    version: 1,
    pinned: true,
    read: false,
    created_at: "2026-09-16T10:00:00Z",
    updated_at: "2026-09-16T10:00:00Z",
    expires_at: null,
  };
  const parsedHalt = parseTradingNotification(halt);
  assert.equal(parsedHalt?.eventType, "GLOBAL_MARKET_HALTED");
  assert.equal(parsedHalt?.reason, "정기 점검");

  const resume: Notification = {
    notification_id: "ntf_4",
    kind: "SYSTEM",
    title: "Global market resumed",
    body: "GLOBAL_MARKET_RESUMED",
    version: 1,
    pinned: true,
    read: false,
    created_at: "2026-09-16T10:30:00Z",
    updated_at: "2026-09-16T10:30:00Z",
    expires_at: null,
  };
  const parsedResume = parseTradingNotification(resume);
  assert.equal(parsedResume?.eventType, "GLOBAL_MARKET_RESUMED");
});

test("parseTradingNotification parses DELIST_SCHEDULED, DELIST_CANCELED, and DELISTED", () => {
  const d1 = parseTradingNotification({
    title: "Delist scheduled",
    body: "ALPHA.M DELIST_SCHEDULED: 심사 탈락",
  });
  assert.equal(d1?.eventType, "DELIST_SCHEDULED");
  assert.equal(d1?.symbol, "ALPHA.M");
  assert.equal(d1?.reason, "심사 탈락");

  const d2 = parseTradingNotification({
    title: "Delist canceled",
    body: "ALPHA.M DELIST_CANCELED",
  });
  assert.equal(d2?.eventType, "DELIST_CANCELED");
  assert.equal(d2?.symbol, "ALPHA.M");

  const d3 = parseTradingNotification({
    title: "Symbol delisted",
    body: "ALPHA.M DELISTED",
  });
  assert.equal(d3?.eventType, "DELISTED");
  assert.equal(d3?.symbol, "ALPHA.M");
});

test("parseTradingNotification REJECTS arbitrary prose without explicit structured token", () => {
  // Korean prose announcement
  const p1 = parseTradingNotification({
    title: "정기 점검 안내",
    body: "내일 새벽 거래 서비스 점검이 예정되어 있습니다. 이용에 유의하시기 바랍니다.",
  });
  assert.equal(p1, null);

  // English prose announcement
  const p2 = parseTradingNotification({
    title: "Maintenance announcement",
    body: "Please be advised that trading activities may experience interruptions.",
  });
  assert.equal(p2, null);

  // Random user chat or notice
  const p3 = parseTradingNotification({
    title: "공지사항",
    body: "새로운 기능이 추가되었습니다.",
  });
  assert.equal(p3, null);
});

test("parseTradingNotification REJECTS unrelated events (trades, transfers, logins)", () => {
  // Trade execution
  assert.equal(
    parseTradingNotification({
      title: "Trade executed",
      body: "ALPHA.M: 1 trade(s) executed",
    }),
    null,
  );

  // Transfer
  assert.equal(
    parseTradingNotification({
      title: "Transfer updated",
      body: "transfer.updated",
    }),
    null,
  );

  // Login / security
  assert.equal(
    parseTradingNotification({
      title: "Login success",
      body: "AUTH_LOGIN",
    }),
    null,
  );
});

// -----------------------------------------------------------------------------
// 2. Immediate Cache Updates and Replay Protection Tests
// -----------------------------------------------------------------------------

test("applyTradingNotification immediately updates symbol cache to HALTED and back to TRADING", () => {
  const queryClient = new QueryClient();
  storage.clear();
  lastTradingEventTimestamps.clear();

  const alpha = createSampleSymbol("ALPHA.M", "TRADING");
  seedSymbolMetadataCache([alpha]);

  // Seed TanStack query caches
  queryClient.setQueryData<Instrument[]>(["instruments"], [alpha as unknown as Instrument]);
  queryClient.setQueryData<Instrument>(["instrument", "ALPHA.M"], alpha as unknown as Instrument);

  // 1. Private WS notification arrival: SYMBOL_HALTED
  const haltNotif: Notification = {
    notification_id: "ntf_h1",
    kind: "USER",
    title: "SYMBOL_HALTED",
    body: "ALPHA.M SYMBOL_HALTED: 긴급 점검",
    version: 1,
    pinned: false,
    read: false,
    created_at: "2026-09-16T12:00:00Z",
    updated_at: "2026-09-16T12:00:00Z",
    expires_at: null,
  };
  applyTradingNotification(queryClient, haltNotif);

  // Check persistent storage cache
  const storedAfterHalt = JSON.parse(localStorageMock.getItem(SYMBOL_METADATA_CACHE_KEY)!);
  const updatedAlpha = storedAfterHalt.symbols.find((s: MarketSymbol) => s.symbol === "ALPHA.M");
  assert.equal(updatedAlpha.state, "HALTED");
  assert.equal(updatedAlpha.halt_reason, "긴급 점검");
  assert.equal(updatedAlpha.halted_at, "2026-09-16T12:00:00Z");

  // Check TanStack Query caches
  const instrumentsAfterHalt = queryClient.getQueryData<Instrument[]>(["instruments"]);
  assert.equal(instrumentsAfterHalt?.[0].state, "HALTED");

  const instrumentDetailAfterHalt = queryClient.getQueryData<Instrument>(["instrument", "ALPHA.M"]);
  assert.equal(instrumentDetailAfterHalt?.state, "HALTED");
  assert.equal(instrumentDetailAfterHalt?.halt_reason, "긴급 점검");

  // 2. Private WS notification arrival: SYMBOL_RESUMED
  const resumeNotif: Notification = {
    notification_id: "ntf_r1",
    kind: "USER",
    title: "SYMBOL_RESUMED",
    body: "ALPHA.M SYMBOL_RESUMED",
    version: 1,
    pinned: false,
    read: false,
    created_at: "2026-09-16T12:10:00Z",
    updated_at: "2026-09-16T12:10:00Z",
    expires_at: null,
  };
  applyTradingNotification(queryClient, resumeNotif);

  // Check persistent storage cache after resume
  const storedAfterResume = JSON.parse(localStorageMock.getItem(SYMBOL_METADATA_CACHE_KEY)!);
  const resumedAlpha = storedAfterResume.symbols.find((s: MarketSymbol) => s.symbol === "ALPHA.M");
  assert.equal(resumedAlpha.state, "TRADING");
  assert.equal(resumedAlpha.halt_reason, null);
  assert.equal(resumedAlpha.halted_at, null);

  // Check TanStack Query caches after resume
  const instrumentsAfterResume = queryClient.getQueryData<Instrument[]>(["instruments"]);
  assert.equal(instrumentsAfterResume?.[0].state, "TRADING");

  const instrumentDetailAfterResume = queryClient.getQueryData<Instrument>(["instrument", "ALPHA.M"]);
  assert.equal(instrumentDetailAfterResume?.state, "TRADING");
});

test("Replaying older halt notification or read notification CANNOT revert newer resumed state", () => {
  const queryClient = new QueryClient();
  storage.clear();
  lastTradingEventTimestamps.clear();

  const alpha = createSampleSymbol("ALPHA.M", "TRADING");
  alpha.updated_at = "2026-09-16T12:10:00Z";
  seedSymbolMetadataCache([alpha]);

  queryClient.setQueryData<Instrument[]>(["instruments"], [alpha as unknown as Instrument]);
  queryClient.setQueryData<Instrument>(["instrument", "ALPHA.M"], alpha as unknown as Instrument);

  // Set the latest processed timestamp for ALPHA.M to 12:10:00
  lastTradingEventTimestamps.set("ALPHA.M", Date.parse("2026-09-16T12:10:00Z"));

  // 1. Replay older halt notification from 12:00:00
  const oldHaltNotif: Notification = {
    notification_id: "ntf_h1",
    kind: "USER",
    title: "SYMBOL_HALTED",
    body: "ALPHA.M SYMBOL_HALTED: 구 점검",
    version: 1,
    pinned: false,
    read: false,
    created_at: "2026-09-16T12:00:00Z",
    updated_at: "2026-09-16T12:00:00Z",
    expires_at: null,
  };
  applyTradingNotification(queryClient, oldHaltNotif);

  // Must still be TRADING
  const detail1 = queryClient.getQueryData<Instrument>(["instrument", "ALPHA.M"]);
  assert.equal(detail1?.state, "TRADING");

  // 2. Read status notification update on old notification:
  // When user marks old notification as read, updated_at is now (12:15:00) but created_at is 12:00:00
  const readStatusUpdatedNotif: Notification = {
    ...oldHaltNotif,
    read: true,
    created_at: "2026-09-16T12:00:00Z", // original event time remains 12:00:00
    updated_at: "2026-09-16T12:15:00Z", // marked as read later
  };
  applyTradingNotification(queryClient, readStatusUpdatedNotif);

  // Must still be TRADING (created_at 12:00:00 cannot revert newer 12:10:00 state)
  const detail2 = queryClient.getQueryData<Instrument>(["instrument", "ALPHA.M"]);
  assert.equal(detail2?.state, "TRADING");

  // 3. Legitimate new notification created with read: true
  // (contract allows notifications created already read; must NOT ignore solely due to read flag)
  const newReadHaltNotif: Notification = {
    notification_id: "ntf_h2",
    kind: "USER",
    title: "SYMBOL_HALTED",
    body: "ALPHA.M SYMBOL_HALTED: 신규 점검",
    version: 1,
    pinned: false,
    read: true,
    created_at: "2026-09-16T12:20:00Z",
    updated_at: "2026-09-16T12:20:00Z",
    expires_at: null,
  };
  applyTradingNotification(queryClient, newReadHaltNotif);

  // Must update to HALTED because created_at (12:20:00) is legitimately newer than 12:10:00
  const detail3 = queryClient.getQueryData<Instrument>(["instrument", "ALPHA.M"]);
  assert.equal(detail3?.state, "HALTED");
  assert.equal(detail3?.halt_reason, "신규 점검");

  // 4. Unknown/missing timestamp must NOT be promoted by Date.now() to overwrite newer state
  const invalidTimeNotif: Notification = {
    notification_id: "ntf_h3",
    kind: "USER",
    title: "SYMBOL_RESUMED",
    body: "ALPHA.M SYMBOL_RESUMED",
    version: 1,
    pinned: false,
    read: false,
    created_at: "invalid-date",
    updated_at: "invalid-date",
    expires_at: null,
  };
  applyTradingNotification(queryClient, invalidTimeNotif);

  // Must STILL be HALTED (invalid date must not be promoted by Date.now() to supersede 12:20:00)
  const detail4 = queryClient.getQueryData<Instrument>(["instrument", "ALPHA.M"]);
  assert.equal(detail4?.state, "HALTED");
});

test("applyTradingNotification immediately updates GLOBAL_MARKET_HALTED and RESUMED", () => {
  const queryClient = new QueryClient();
  storage.clear();
  lastTradingEventTimestamps.clear();

  queryClient.setQueryData<MarketState>(["market-state"], {
    state: "RUNNING",
    reason: null,
    halted_at: null,
    halted_until: null,
    changed_at: "2026-09-16T09:00:00Z",
  });

  // Global halt arrival
  const haltNotif: Notification = {
    notification_id: "ntf_gh",
    kind: "SYSTEM",
    title: "Global market halted",
    body: "GLOBAL_MARKET_HALTED: 거래소 전체 점검",
    version: 1,
    pinned: true,
    read: false,
    created_at: "2026-09-16T10:00:00Z",
    updated_at: "2026-09-16T10:00:00Z",
    expires_at: null,
  };
  applyTradingNotification(queryClient, haltNotif);

  const marketAfterHalt = queryClient.getQueryData<MarketState>(["market-state"]);
  assert.equal(marketAfterHalt?.state, "GLOBAL_HALTED");
  assert.equal(marketAfterHalt?.reason, "거래소 전체 점검");
  assert.equal(marketAfterHalt?.halted_at, "2026-09-16T10:00:00Z");

  // Check persistent cross-tab storage
  const cachedMarketState = readMarketStateCache();
  assert.equal(cachedMarketState?.state, "GLOBAL_HALTED");

  // Global resume arrival
  const resumeNotif: Notification = {
    notification_id: "ntf_gr",
    kind: "SYSTEM",
    title: "Global market resumed",
    body: "GLOBAL_MARKET_RESUMED",
    version: 1,
    pinned: true,
    read: false,
    created_at: "2026-09-16T10:30:00Z",
    updated_at: "2026-09-16T10:30:00Z",
    expires_at: null,
  };
  applyTradingNotification(queryClient, resumeNotif);

  const marketAfterResume = queryClient.getQueryData<MarketState>(["market-state"]);
  assert.equal(marketAfterResume?.state, "RUNNING");
  assert.equal(marketAfterResume?.reason, null);
  assert.equal(marketAfterResume?.halted_at, null);

  const cachedMarketStateResume = readMarketStateCache();
  assert.equal(cachedMarketStateResume?.state, "RUNNING");
});

test("Symbol versions and timestamps protect against rollback, but allow refreshed server metadata", () => {
  const queryClient = new QueryClient();
  storage.clear();
  lastTradingEventTimestamps.clear();

  // Baseline symbol version 10 at 10:00:00
  const alphaV10 = createSampleSymbol("ALPHA.M", "TRADING");
  alphaV10.version = "10";
  alphaV10.updated_at = "2026-09-16T10:00:00Z";
  seedSymbolMetadataCache([alphaV10]);

  queryClient.setQueryData<Instrument[]>(["instruments"], [alphaV10 as unknown as Instrument]);
  queryClient.setQueryData<Instrument>(["instrument", "ALPHA.M"], alphaV10 as unknown as Instrument);

  // Set watermark
  lastTradingEventTimestamps.set("ALPHA.M", Date.parse("2026-09-16T10:00:00Z"));

  // 1. Notification with older version 9 should NOT supersede version 10
  const olderVersionNotif: Notification & { payload?: Record<string, unknown> } = {
    notification_id: "ntf_old_v",
    kind: "USER",
    title: "SYMBOL_HALTED",
    body: "ALPHA.M SYMBOL_HALTED",
    version: 1,
    pinned: false,
    read: false,
    created_at: "2026-09-16T10:05:00Z",
    updated_at: "2026-09-16T10:05:00Z",
    expires_at: null,
    payload: { symbol: "ALPHA.M", state: "HALTED", version: "9" },
  };
  applyTradingNotification(queryClient, olderVersionNotif);

  const detailOld = queryClient.getQueryData<Instrument>(["instrument", "ALPHA.M"]);
  assert.equal(detailOld?.state, "TRADING", "Older version 9 cannot overwrite version 10");

  // 2. Notification with newer version 11 at 10:10:00 succeeds
  const newerVersionNotif: Notification & { payload?: Record<string, unknown> } = {
    notification_id: "ntf_new_v",
    kind: "USER",
    title: "SYMBOL_HALTED",
    body: "ALPHA.M SYMBOL_HALTED: 점검",
    version: 1,
    pinned: false,
    read: false,
    created_at: "2026-09-16T10:10:00Z",
    updated_at: "2026-09-16T10:10:00Z",
    expires_at: null,
    payload: { symbol: "ALPHA.M", state: "HALTED", version: "11" },
  };
  applyTradingNotification(queryClient, newerVersionNotif);

  const detailNew = queryClient.getQueryData<Instrument>(["instrument", "ALPHA.M"]);
  assert.equal(detailNew?.state, "HALTED", "Newer version 11 successfully halts");
  assert.equal(detailNew?.version, "11");
});


test("listing and metadata responses immediately update cached symbols and approved icons", () => {
  const client = new QueryClient();
  const old = createSampleSymbol("OLD.M");
  seedSymbolMetadataCache([old]);
  client.setQueryData(["instruments"], [old]);
  const listed = { ...createSampleSymbol("NEW.M"), icon_url: null };
  cacheSymbolMetadata(client, listed);
  assert.equal(client.getQueryData<Instrument[]>(["instruments"])?.length, 2);
  const updated = { ...listed, name: "Updated name", icon_url: "/api/v1/market/icons/ico_approved", version: "101" };
  cacheSymbolMetadata(client, updated);
  const persisted = JSON.parse(localStorageMock.getItem(SYMBOL_METADATA_CACHE_KEY)!);
  assert.equal(persisted.symbols.find((row: MarketSymbol) => row.symbol === "NEW.M").icon_url, updated.icon_url);
  assert.equal(client.getQueryData<Instrument[]>(["instruments"])?.find((row) => row.symbol === "NEW.M")?.name, "Updated name");
  cacheSymbolMetadata(client, listed);
  assert.equal(client.getQueryData<Instrument[]>(["instruments"])?.find((row) => row.symbol === "NEW.M")?.icon_url, updated.icon_url);
  client.clear();
});
