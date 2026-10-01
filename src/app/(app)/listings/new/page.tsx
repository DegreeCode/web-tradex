"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { IconUrlField } from "@/components/symbol-icons";
import { ErrorBlock, PageHeader, Surface } from "@/components/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useExchangeInfo,
  tagPolicyError,
  iconPolicyError,
  lockedSupplyPpmFromPercent,
  LOCKED_SUPPLY_STEP_PPM,
  type ExchangeInfo,
  type ListingEvaluationCriteria,
} from "@/lib/exchange-info";
import { errorMessage } from "@/lib/api";
import { isDecimalInput, toNumber, fmtCredit, fmtPercentFromPPM } from "@/lib/format";
import { useCreateListing } from "@/lib/hooks";
import { symbolHref } from "@/lib/routes";

function criteriaText(criteria: ListingEvaluationCriteria) {
  return `외부 보유자 ${criteria.min_external_holders}명 이상, 외부 거래자 ${criteria.min_external_traders}명 이상, 외부 거래량이 총발행량의 ${fmtPercentFromPPM(criteria.min_qualified_activity_ppm)} 이상`;
}

function lockedSupplyRange(listing: ExchangeInfo["listing"] | undefined) {
  const min = listing?.min_locked_supply_ppm;
  const max = listing?.max_locked_supply_ppm;
  const defaultPpm = listing?.default_locked_supply_ppm;
  if (min === undefined || max === undefined || defaultPpm === undefined || min > max) return null;
  return { min, max, defaultPpm };
}

function percentText(ppm: number) {
  return String(ppm / 10_000);
}

function periodText(hours: number) {
  return hours % 24 === 0 ? `${hours / 24}일` : `${hours}시간`;
}

export default function NewListingPage() {
  const router = useRouter();
  const exchangeQuery = useExchangeInfo();
  const exchangeInfo = exchangeQuery.data;
  const maintenance = exchangeInfo?.listing.maintenance;
  const createListing = useCreateListing();
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [tags, setTags] = useState("");
  const [deposit, setDeposit] = useState("");
  // null keeps the server default; only an explicit choice is sent.
  const [lockedPpm, setLockedPpm] = useState<number | null>(null);
  // Text typed into the percent field; null shows the committed ratio.
  const [lockedDraft, setLockedDraft] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const lockedRange = lockedSupplyRange(exchangeInfo?.listing);

  // Commits the typed percent: 0.1% steps, clamped to the published range.
  function commitLockedDraft() {
    if (lockedDraft === null || !lockedRange) return;
    const text = lockedDraft.trim();
    setLockedDraft(null);
    if (text === "") return;
    const ppm = lockedSupplyPpmFromPercent(text, lockedRange.min, lockedRange.max);
    if (ppm === null) {
      toast.error("락업 비율은 0.1% 단위 숫자로 입력해주세요");
      return;
    }
    setLockedPpm(ppm);
  }

  function submit() {
    if (!/^[A-Za-z]{1,8}$/.test(symbol.trim())) {
      toast.error("심볼은 영문 1~8자로 입력해주세요");
      return;
    }
    if (!name.trim()) {
      toast.error("종목 이름을 입력해주세요");
      return;
    }
    if (!isDecimalInput(deposit, 16) || toNumber(deposit) <= 0) {
      toast.error("초기 예치 금액을 입력해주세요");
      return;
    }
    const parsedTags = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    const policyError = tagPolicyError(parsedTags, exchangeInfo?.metadata) || iconPolicyError(iconUrl, exchangeInfo?.metadata);
    if (policyError) { toast.error(policyError); return; }
    createListing.mutate(
      {
        symbol: symbol.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim(),
        tags: parsedTags,
        deposit_credit: deposit.trim(),
        ...(iconUrl.trim() ? { icon_url: iconUrl.trim() } : {}),
        ...(lockedPpm !== null ? { locked_supply_ppm: lockedPpm } : {}),
      },
      {
        onSuccess: (instrument) => {
          toast.success(`${instrument.name} 종목을 상장했어요`);
          router.push(symbolHref(instrument.symbol));
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="종목 상장" subtitle="Credit을 예치해 새로운 종목을 만들고 발행사가 되어보세요" />

      <Surface className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="listing-symbol">심볼</Label>
          <Input
            id="listing-symbol"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            placeholder="ABC"
            maxLength={8}
            autoCapitalize="characters"
            autoComplete="off"
            className="h-11 rounded-xl"
          />
          <p className="text-[12px] text-app-gray-400">영문 1~8자, 대문자로 저장돼요</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="listing-name">종목 이름</Label>
          <Input
            id="listing-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="ABC Corp"
            className="h-11 rounded-xl"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="listing-description">설명</Label>
          <Textarea
            id="listing-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="종목에 대한 소개를 적어주세요"
            rows={4}
            className="rounded-xl"
          />
        </div>

        <IconUrlField value={iconUrl} onChange={setIconUrl} />

        <div className="space-y-1.5">
          <Label htmlFor="listing-tags">태그 (선택)</Label>
          <Input
            id="listing-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder={exchangeInfo ? `쉼표로 구분 · 최대 ${exchangeInfo.metadata.max_tags}개` : "게임, 테크 (쉼표로 구분)"}
            className="h-11 rounded-xl"
          />
          <p className="text-[12px] text-app-gray-500">태그 없이도 상장할 수 있어요.{exchangeInfo && ` 태그당 ${exchangeInfo.metadata.tag_max_bytes}바이트 (${exchangeInfo.metadata.tag_encoding})까지 입력할 수 있어요.`}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="listing-deposit">초기 예치 금액 (Credit)</Label>
          <Input
            id="listing-deposit"
            value={deposit}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "" || isDecimalInput(next, 16)) setDeposit(next);
            }}
            inputMode="decimal"
            placeholder="0"
            className="numeric h-11 rounded-xl"
          />
          <p className="text-[12px] text-app-gray-400">
            예치한 Credit은 종목 풀의 유동성이 돼요.
          </p>
        </div>

        {lockedRange ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="listing-locked-ratio">발행사 락업 비율</Label>
              <span className="flex items-center gap-1">
                <Input
                  value={lockedDraft ?? percentText(lockedPpm ?? lockedRange.defaultPpm)}
                  onChange={(event) => setLockedDraft(event.target.value)}
                  onBlur={commitLockedDraft}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitLockedDraft();
                    }
                  }}
                  inputMode="decimal"
                  aria-label="발행사 락업 비율 직접 입력 (%)"
                  className="numeric h-8 w-20 rounded-lg text-right text-[14px] font-bold text-app-gray-900"
                />
                <span className="text-[14px] font-bold text-app-gray-900">%</span>
              </span>
            </div>
            <input
              id="listing-locked-ratio"
              type="range"
              min={lockedRange.min}
              max={lockedRange.max}
              step={LOCKED_SUPPLY_STEP_PPM}
              value={lockedPpm ?? lockedRange.defaultPpm}
              onChange={(event) => {
                setLockedDraft(null);
                setLockedPpm(Number(event.target.value));
              }}
              aria-valuetext={fmtPercentFromPPM(lockedPpm ?? lockedRange.defaultPpm)}
              className="h-2 w-full cursor-pointer accent-app-blue"
            />
            <p className="text-[12px] leading-5 text-app-gray-500">
              총 발행량 중 발행사에게 락업으로 배분되는 비율이에요 ({fmtPercentFromPPM(lockedRange.min)}~{fmtPercentFromPPM(lockedRange.max)}, 기본 {fmtPercentFromPPM(lockedRange.defaultPpm)}).
              낮을수록 같은 예치금으로 풀 유동성이 커져요. 상장 후에는 바꿀 수 없고 추가 발행에도 같은 비율이 적용돼요.
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span className="shrink-0 text-app-gray-500">상장 수수료</span>
          <span className="numeric min-w-0 break-all text-right font-semibold text-app-gray-900">{exchangeInfo ? `${fmtCredit(exchangeInfo.listing.user_fee_credit)} Credit` : exchangeQuery.isError ? "확인 실패" : "확인 중…"}</span>
        </div>

        {exchangeQuery.isError ? <ErrorBlock message={errorMessage(exchangeQuery.error)} onRetry={() => void exchangeQuery.refetch()} /> : null}

        {exchangeInfo && <p className="text-[12px] text-app-gray-500">일반 사용자 상장은 하루 최대 {exchangeInfo.listing.user_daily_limit}회예요.</p>}

        <div role="note" className="space-y-2 rounded-xl bg-app-red-light p-4 text-[12px] leading-relaxed text-app-gray-700">
          <p className="text-[13px] font-bold text-app-red">상장 유지 평가 안내</p>
          <p>사용자 상장 종목은 상장 후 <b>24시간</b>, <b>72시간</b> 시점에 평가를 받고, 이후 <b>{maintenance ? periodText(maintenance.periodic.interval_hours) : "주기적으로"}</b>{maintenance ? "마다" : ""} 정기 평가를 받아요. 기준을 하나라도 채우지 못하면 상장 폐지가 예약될 수 있어요. 외부 사용자는 발행사(Manager)를 제외한 사용자예요.</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li><b>24시간 평가</b>{maintenance ? `: ${criteriaText(maintenance.after_24h)}` : ""}. 한 번만 미달해도 상장 폐지가 예약돼요.</li>
            <li><b>72시간 평가</b>{maintenance ? `: ${criteriaText(maintenance.after_72h)}` : ""}. 한 번만 미달해도 상장 폐지가 예약돼요.</li>
            <li><b>정기 평가</b>: {maintenance ? `${maintenance.periodic.max_consecutive_failures}회 연속` : "연속으로 여러 번"} 미달하면 상장 폐지가 예약돼요.</li>
          </ul>
          <p className="font-semibold text-app-red">상장 폐지되면 아직 해제되지 않은 락업 물량은 정산 없이 모두 환수(소각)돼요. 풀 정산금은 거래 가능한 보유 수량에만 분배돼요.</p>
          <label className="flex cursor-pointer items-center gap-2 pt-1 text-[13px] font-semibold text-app-gray-900">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="h-4 w-4 accent-app-blue"
            />
            위 내용을 확인했어요
          </label>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={createListing.isPending || !acknowledged}
          className="h-12 w-full rounded-xl bg-app-blue text-[15px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {createListing.isPending ? "상장 중…" : "종목 상장하기"}
        </button>
      </Surface>
    </div>
  );
}
