"use client";

import { useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  FilePenLine,
  FileText,
  Landmark,
  LockKeyhole,
  Megaphone,
  OctagonAlert,
  RefreshCw,
  ShieldAlert,
  UserRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { ErrorBlock, LoadMoreButton, SkeletonRows, Surface } from "@/components/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api";
import {
  fmtCompact,
  fmtCompactQuantity,
  fmtCredit,
  fmtDateTime,
  fmtPercentFromPPM,
  fmtPrice,
  fmtQuantity,
  fmtRelative,
  shortId,
} from "@/lib/format";
import { useDisclosures } from "@/lib/hooks";
import type { Disclosure } from "@/lib/types";

type DisclosureTone = "blue" | "green" | "orange" | "red" | "gray";

interface DisclosurePresentation {
  title: string;
  description: string;
  icon: LucideIcon;
  tone: DisclosureTone;
}

interface DisclosureDetail {
  label: string;
  value: string;
  /** Unit-compacted value for the one-line list summary. */
  short?: string;
}

const DISCLOSURE_PRESENTATION: Record<string, DisclosurePresentation> = {
  ADDITIONAL_ISSUANCE: {
    title: "추가 발행",
    description: "새로운 발행 내역이 공시되었어요",
    icon: Landmark,
    tone: "blue",
  },
  ISSUANCE_CREATED: {
    title: "추가 발행",
    description: "새로운 발행 내역이 공시되었어요",
    icon: Landmark,
    tone: "blue",
  },
  LOCKUP_RELEASE: {
    title: "락업 해제",
    description: "잠금 물량이 유통 물량으로 전환되었어요",
    icon: LockKeyhole,
    tone: "green",
  },
  MANAGER_CHANGED: {
    title: "매니저 변경",
    description: "종목 매니저가 변경되었어요",
    icon: UserRound,
    tone: "blue",
  },
  MANAGER_FORCED_CHANGE: {
    title: "매니저 변경",
    description: "운영에 의해 종목 매니저가 변경되었어요",
    icon: ShieldAlert,
    tone: "orange",
  },
  SYMBOL_HALTED: {
    title: "거래 정지",
    description: "종목 거래가 일시 정지되었어요",
    icon: OctagonAlert,
    tone: "red",
  },
  SYMBOL_RESUMED: {
    title: "거래 재개",
    description: "종목 거래가 다시 시작되었어요",
    icon: RefreshCw,
    tone: "green",
  },
  DELIST_SCHEDULED: {
    title: "상장폐지 예정",
    description: "상장폐지 일정이 공시되었어요",
    icon: CalendarClock,
    tone: "orange",
  },
  DELIST_CANCELED: {
    title: "상장폐지 취소",
    description: "예정된 상장폐지가 취소되었어요",
    icon: RefreshCw,
    tone: "green",
  },
  DELISTED: {
    title: "상장폐지 완료",
    description: "종목의 상장폐지가 완료되었어요",
    icon: OctagonAlert,
    tone: "red",
  },
  SYMBOL_METADATA_CHANGED: {
    title: "종목 정보 변경",
    description: "종목 이름이나 설명이 변경되었어요",
    icon: FilePenLine,
    tone: "blue",
  },
  GLOBAL_MARKET_HALTED: {
    title: "시장 거래 정지",
    description: "전체 시장 거래가 일시 정지되었어요",
    icon: Megaphone,
    tone: "red",
  },
  GLOBAL_MARKET_RESUMED: {
    title: "시장 거래 재개",
    description: "전체 시장 거래가 다시 시작되었어요",
    icon: Activity,
    tone: "green",
  },
  OWNER_TRADE: {
    title: "소유자 거래 공시",
    description: "소유자 관련 거래 내역이 공개되었어요",
    icon: ArrowUpRight,
    tone: "orange",
  },
  OWNER_STOCK_TRANSFER: {
    title: "소유자 주식 이동",
    description: "소유자 관련 주식 이동 내역이 공개되었어요",
    icon: WalletCards,
    tone: "orange",
  },
};

const FALLBACK_DISCLOSURE: DisclosurePresentation = {
  title: "시장 공시",
  description: "새로운 시장 소식이 등록되었어요",
  icon: FileText,
  tone: "gray",
};

const DISCLOSURE_TONE_CLASS: Record<DisclosureTone, { icon: string; badge: string }> = {
  blue: { icon: "bg-app-blue-light text-app-blue", badge: "bg-app-blue-light text-app-blue-dark" },
  green: { icon: "bg-app-green-light text-app-green", badge: "bg-app-green-light text-app-green" },
  orange: { icon: "bg-app-orange-light text-app-orange", badge: "bg-app-orange-light text-app-orange" },
  red: { icon: "bg-app-red-light text-app-red", badge: "bg-app-red-light text-app-red" },
  gray: { icon: "bg-app-gray-100 text-app-gray-500", badge: "bg-app-gray-100 text-app-gray-600" },
};

const STATE_LABEL: Record<string, string> = {
  HALTED: "거래 정지",
  TRADING: "거래 중",
  RESUMED: "거래 재개",
};

const SIDE_LABEL: Record<string, string> = { BUY: "매수", SELL: "매도" };
const DIRECTION_LABEL: Record<string, string> = {
  SEND: "보냄",
  RECEIVE: "받음",
  BOTH: "보냄·받음",
  SELF_TRANSFER: "본인 계정 간 이동",
};

function payloadText(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function addDisclosureDetail(
  details: DisclosureDetail[],
  label: string,
  value: string | null,
  short?: string,
): void {
  if (value && value !== "-") details.push({ label, value, short });
}

function participantsLabel(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const roles = new Set<string>();
  for (const participant of value) {
    if (!participant || typeof participant !== "object") continue;
    const item = participant as Record<string, unknown>;
    const role = typeof item.role === "string" ? item.role : null;
    const transferRole = typeof item.transfer_role === "string" ? item.transfer_role : null;
    if (role === "CURRENT_OWNER") roles.add("현재 소유자");
    if (role === "PREVIOUS_OWNER") roles.add("이전 소유자");
    if (transferRole === "SEND") roles.add("송신");
    if (transferRole === "RECEIVE") roles.add("수신");
    if (transferRole === "BOTH") roles.add("송수신");
  }
  const roleText = roles.size > 0 ? ` · ${Array.from(roles).join("·")}` : "";
  return `${value.length}명${roleText}`;
}

function disclosureDetails(disclosure: Disclosure): DisclosureDetail[] {
  const { payload } = disclosure;
  const details: DisclosureDetail[] = [];
  const addText = (label: string, key: string) => addDisclosureDetail(details, label, payloadText(payload, key));
  const addPrice = (label: string, key: string) => {
    const value = payloadText(payload, key);
    addDisclosureDetail(details, label, value ? `${fmtPrice(value)} Credit` : null);
  };
  const addQuantity = (label: string, key: string) => {
    const value = payloadText(payload, key);
    addDisclosureDetail(details, label, value ? `${fmtQuantity(value)}주` : null, value ? `${fmtCompactQuantity(value)}주` : undefined);
  };
  const addCredit = (label: string, key: string) => {
    const value = payloadText(payload, key);
    addDisclosureDetail(details, label, value ? `${fmtCredit(value)} Credit` : null, value ? `${fmtCompact(value)} Credit` : undefined);
  };
  const addDate = (label: string, key: string) => addDisclosureDetail(details, label, fmtDateTime(payloadText(payload, key)));
  const addPpm = (label: string, key: string) => {
    const value = payloadNumber(payload, key);
    addDisclosureDetail(details, label, value === null ? null : fmtPercentFromPPM(value));
  };

  switch (disclosure.type) {
    case "ADDITIONAL_ISSUANCE":
    case "ISSUANCE_CREATED":
      addCredit("예치 금액", "deposit_credit");
      addPrice("발행 전 가격", "price_before");
      addPrice("발행 후 가격", "price_after");
      addPpm("가격 희석률", "price_dilution_ppm");
      addQuantity("잠금 발행량", "locked_shares_issued");
      addQuantity("풀 발행량", "pool_shares_issued");
      addQuantity("총 발행량", "total_shares_issued");
      addQuantity("발행 후 총 공급량", "total_supply_after");
      addPpm("24시간 공급 증가율", "rolling_24h_supply_increase_ppm");
      addDisclosureDetail(details, "강제 발행", payloadText(payload, "forced") === "true" ? "예" : null);
      addDate("발행 시각", "issued_at");
      break;
    case "LOCKUP_RELEASE":
      addQuantity("해제 물량", "released_quantity");
      addQuantity("해제 후 락업 물량", "locked_supply_after");
      addQuantity("해제 후 유통 물량", "circulating_supply_after");
      addDate("해제 시각", "released_at");
      break;
    case "MANAGER_CHANGED":
    case "MANAGER_FORCED_CHANGE":
      addDisclosureDetail(details, "이전 매니저", shortId(payloadText(payload, "previous_manager_user_id")));
      addDisclosureDetail(details, "새 매니저", shortId(payloadText(payload, "manager_user_id")));
      addText("변경 사유", "reason");
      break;
    case "SYMBOL_HALTED":
    case "SYMBOL_RESUMED":
      addDisclosureDetail(details, "상태", STATE_LABEL[payloadText(payload, "state") ?? ""] ?? "상태 변경");
      addText("사유", "reason");
      addDate("예정 시각", "halted_until");
      break;
    case "DELIST_SCHEDULED":
      addDate("예정 시각", "scheduled_at");
      addText("사유", "reason");
      break;
    case "DELIST_CANCELED":
      addText("사유", "reason");
      break;
    case "DELISTED":
      addQuantity("정산 대상 물량", "eligible_unlocked_shares");
      addCredit("정산 풀", "pool_credit");
      addPrice("주당 분배금", "distribution_per_share");
      addDate("완료 시각", "delisted_at");
      break;
    case "SYMBOL_METADATA_CHANGED":
      addText("새 이름", "name");
      addText("새 설명", "description");
      break;
    case "GLOBAL_MARKET_HALTED":
    case "GLOBAL_MARKET_RESUMED":
      addDisclosureDetail(details, "상태", STATE_LABEL[payloadText(payload, "state") ?? ""] ?? "시장 상태 변경");
      addText("사유", "reason");
      addDate("변경 시각", "changed_at");
      addDate("예정 시각", "halted_until");
      break;
    case "OWNER_TRADE":
      addDisclosureDetail(details, "거래", SIDE_LABEL[payloadText(payload, "side") ?? ""] ?? "거래");
      addQuantity("수량", "quantity");
      addPrice("가격", "price");
      addCredit("거래 금액", "credit");
      addCredit("수수료", "fee");
      addDisclosureDetail(details, "공개 참여자", participantsLabel(payload.owner_participants));
      addDate("체결 시각", "completed_at");
      break;
    case "OWNER_STOCK_TRANSFER":
      addDisclosureDetail(details, "이동", DIRECTION_LABEL[payloadText(payload, "direction") ?? ""] ?? "주식 이동");
      addQuantity("수량", "quantity");
      addCredit("이동 금액", "credit");
      addCredit("수수료", "fee");
      addDisclosureDetail(details, "본인 계정 간 이동", payloadText(payload, "self_transfer") === "true" ? "예" : null);
      addDisclosureDetail(details, "공개 참여자", participantsLabel(payload.owner_participants));
      addDate("완료 시각", "completed_at");
      break;
    default:
      break;
  }
  return details;
}

function disclosureSummary(disclosure: Disclosure): string | null {
  return disclosureDetails(disclosure)
    .slice(0, 2)
    .map(({ label, value, short }) => `${label} ${short ?? value}`)
    .join(" · ") || null;
}

/** A symbol's public disclosures, newest first, each openable for its details. */
export function SymbolDisclosures({ symbol }: { symbol: string }) {
  const [selectedDisclosure, setSelectedDisclosure] = useState<Disclosure | null>(null);
  const disclosuresQuery = useDisclosures({ symbol, limit: 10 });
  const disclosures = disclosuresQuery.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <>
    <Surface>
      <h2 className="mb-2 flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em] text-app-gray-900">
        <FileText aria-hidden="true" className="size-4 text-app-gray-400" />
        공시
      </h2>
      {disclosuresQuery.isLoading ? (
        <SkeletonRows rows={2} />
      ) : disclosuresQuery.isError && disclosures.length === 0 ? (
        <ErrorBlock message={errorMessage(disclosuresQuery.error)} onRetry={() => void disclosuresQuery.refetch()} />
      ) : disclosures.length === 0 ? (
        <p className="text-[13px] text-app-gray-400">아직 공시가 없어요</p>
      ) : (
        <div className="space-y-2">
          {disclosures.map((disclosure) => {
            const presentation = DISCLOSURE_PRESENTATION[disclosure.type] ?? FALLBACK_DISCLOSURE;
            const tone = DISCLOSURE_TONE_CLASS[presentation.tone];
            const Icon = presentation.icon;
            const summary = disclosureSummary(disclosure);
            return (
              <button
                key={disclosure.disclosure_id}
                type="button"
                aria-haspopup="dialog"
                onClick={() => setSelectedDisclosure(disclosure)}
                className="group flex w-full items-start gap-3 rounded-xl border border-app-gray-100 bg-card p-3 text-left transition hover:border-app-gray-200 hover:bg-app-gray-50 focus-visible:ring-2 focus-visible:ring-app-blue focus-visible:outline-none"
              >
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${tone.icon}`} aria-hidden="true">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone.badge}`}>
                      {presentation.title}
                    </span>
                    <span className="text-[11px] text-app-gray-400">
                      {fmtRelative(disclosure.occurred_at)}
                    </span>
                  </span>
                  <span className="mt-1 block text-[13px] font-medium text-app-gray-800">
                    {presentation.description}
                  </span>
                  {summary ? (
                    <span className="numeric mt-1 block truncate text-[12px] text-app-gray-500">{summary}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
          <LoadMoreButton
            hasMore={disclosuresQuery.hasNextPage}
            loading={disclosuresQuery.isFetchingNextPage}
            onLoad={() => void disclosuresQuery.fetchNextPage()}
            label="공시 더보기"
            className="h-10 bg-app-gray-50 text-[12px] shadow-none hover:bg-app-gray-100"
          />
        </div>
      )}
    </Surface>

    <Dialog
      open={Boolean(selectedDisclosure)}
      onOpenChange={(open) => {
        if (!open) setSelectedDisclosure(null);
      }}
    >
      {selectedDisclosure ? (() => {
        const presentation = DISCLOSURE_PRESENTATION[selectedDisclosure.type] ?? FALLBACK_DISCLOSURE;
        const tone = DISCLOSURE_TONE_CLASS[presentation.tone];
        const Icon = presentation.icon;
        const details = disclosureDetails(selectedDisclosure);
        return (
          <DialogContent className="max-h-[min(620px,calc(100vh-2rem))] overflow-y-auto sm:max-w-lg">
            <DialogHeader className="pr-8">
              <div className="flex items-center gap-3">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone.icon}`} aria-hidden="true">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <DialogTitle>{presentation.title}</DialogTitle>
                  <DialogDescription className="mt-1">{presentation.description}</DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="rounded-xl bg-app-gray-50 px-3 py-2.5">
              <p className="text-[12px] font-semibold text-app-gray-500">{selectedDisclosure.symbol || symbol}</p>
              <p className="mt-0.5 text-[12px] text-app-gray-400">
                {fmtDateTime(selectedDisclosure.occurred_at)} · {fmtRelative(selectedDisclosure.occurred_at)}
              </p>
            </div>
            {details.length > 0 ? (
              <div className="divide-y divide-app-gray-100 rounded-xl border border-app-gray-100 px-3">
                {details.map((detail) => (
                  <div key={`${detail.label}-${detail.value}`} className="flex items-start justify-between gap-4 py-2.5">
                    <span className="shrink-0 text-[13px] text-app-gray-500">{detail.label}</span>
                    <span className="numeric max-w-[70%] text-right text-[13px] font-medium break-words text-app-gray-900">
                      {detail.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-app-gray-50 px-3 py-3 text-[13px] text-app-gray-500">
                자세한 내용은 공시 원문에서 확인할 수 있어요.
              </p>
            )}
          </DialogContent>
        );
      })() : null}
    </Dialog>
    </>
  );
}
