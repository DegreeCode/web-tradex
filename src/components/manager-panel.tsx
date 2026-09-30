"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useExchangeInfo, iconPolicyError, tagPolicyError } from "@/lib/exchange-info";
import { IconUrlField, IconRequestHistory } from "@/components/symbol-icons";
import { UserNameLookup } from "@/components/user-name-lookup";
import { Surface, DataRow } from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  errorMessage,
  isApiError,
} from "@/lib/api";
import { fmtCredit, fmtDateTime, fmtPercentFromPPM, fmtPrice, isDecimalInput, isPositiveDecimal } from "@/lib/format";
import {
  useCreateIssuance,
  useCreateManagerRequest,
  useIssuancePreview,
  useManagerRequests,
  useRespondManagerRequest,
  useUpdateMetadata,
} from "@/lib/hooks";
import type { Instrument, IssuancePreview } from "@/lib/types";

export function ManagerPanel({ instrument, userId }: { instrument: Instrument; userId: string }) {
  const [tab, setTab] = useState<"ISSUANCE" | "METADATA" | "TRANSFER">("ISSUANCE");

  return (
    <Surface>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[17px] font-bold tracking-[-0.02em] text-app-gray-900">발행사 관리</h2>
        <span className="rounded-md bg-app-blue-light px-1.5 py-0.5 text-[11px] font-semibold text-app-blue-dark">
          MANAGER
        </span>
      </div>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "ISSUANCE", label: "추가 발행" },
          { value: "METADATA", label: "정보 수정" },
          { value: "TRANSFER", label: "매니저 이전" },
        ]}
        className="mb-4"
      />
      {tab === "ISSUANCE" ? <IssuanceSection instrument={instrument} /> : null}
      {tab === "METADATA" ? <MetadataSection instrument={instrument} /> : null}
      {tab === "TRANSFER" ? <TransferSection instrument={instrument} userId={userId} /> : null}
    </Surface>
  );
}

export function ManagerTransferInbox({
  instrument,
  userId,
}: {
  instrument: Instrument;
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  // Rarely relevant, so it stays a single line until the user checks it.
  return (
    <div className="px-1 text-[12px] text-app-gray-500">
      <div className="flex items-center justify-between gap-3">
        <span>발행사 매니저 권한 요청을 받았나요?</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={open}
          className="shrink-0 font-semibold text-app-blue disabled:text-app-gray-400"
        >
          요청 확인
        </button>
      </div>
      {open ? <ManagerTransferInboxResults instrument={instrument} userId={userId} /> : null}
    </div>
  );
}

function ManagerTransferInboxResults({ instrument, userId }: { instrument: Instrument; userId: string }) {
  const requests = useManagerRequests(instrument.symbol);
  const respond = useRespondManagerRequest(instrument.symbol);
  const rows = (requests.data?.data ?? []).filter(
    (request) => request.target_user_id === userId && request.status === "PENDING",
  );

  if (requests.isLoading) return <p className="mt-3 text-[12px] text-app-gray-400">확인 중…</p>;
  if (requests.isError) {
    return (
      <p className="mt-3 text-[12px] text-app-gray-400">
        {isApiError(requests.error, "ACL_FORBIDDEN") ? "도착한 요청이 없어요" : errorMessage(requests.error)}
      </p>
    );
  }
  if (rows.length === 0) return <p className="mt-3 text-[12px] text-app-gray-400">도착한 요청이 없어요</p>;

  return (
    <div className="mt-3 space-y-2">
      {rows.map((request) => (
        <div key={request.request_id} className="rounded-xl bg-card p-3">
          <p className="text-[12px] text-app-gray-600">{request.reason}</p>
          <div className="mt-2 flex gap-2">
            {(["ACCEPT", "REJECT"] as const).map((decision) => (
              <Button
                key={decision}
                type="button"
                size="sm"
                variant={decision === "ACCEPT" ? "default" : "outline"}
                disabled={respond.isPending}
                onClick={() =>
                  respond.mutate(
                    { requestId: request.request_id, decision },
                    {
                      onSuccess: () => toast.success(decision === "ACCEPT" ? "요청을 수락했어요" : "요청을 거절했어요"),
                      onError: (error) => toast.error(errorMessage(error)),
                    },
                  )
                }
                className="h-8 flex-1 rounded-lg text-[12px] font-bold"
              >
                {decision === "ACCEPT" ? "수락" : "거절"}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function issuanceRejection(preview: IssuancePreview, maxDilutionPpm: number | undefined): string {
  if (preview.cooldown_until) {
    return `직전 발행 후 쿨다운 중이에요. ${fmtDateTime(preview.cooldown_until)}부터 다시 발행할 수 있어요.`;
  }
  const limit = maxDilutionPpm !== undefined ? `(${fmtPercentFromPPM(maxDilutionPpm)})` : "";
  return `가격 희석이 한도${limit}를 넘어요. 예치 금액을 최대 예치 가능 금액 이하로 줄여주세요.`;
}

function IssuanceSection({ instrument }: { instrument: Instrument }) {
  const { data: exchangeInfo } = useExchangeInfo();
  const maxDilutionPpm = exchangeInfo?.listing.issuance_max_price_dilution_ppm;
  const cooldownHours = exchangeInfo?.listing.issuance_cooldown_hours;
  const [deposit, setDeposit] = useState("");
  const [debouncedDeposit, setDebouncedDeposit] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedDeposit(deposit);
    }, 400);
    return () => clearTimeout(timer);
  }, [deposit]);

  const activeDeposit = deposit === debouncedDeposit ? debouncedDeposit : "";
  const preview = useIssuancePreview(instrument.symbol, activeDeposit);
  const issuance = useCreateIssuance(instrument.symbol);

  function submit() {
    if (!isDecimalInput(deposit, 16) || !isPositiveDecimal(deposit)) {
      toast.error("발행 금액을 입력해주세요");
      return;
    }
    issuance.mutate(deposit, {
      onSuccess: (result) => {
        toast.success(
          `발행 완료 · 총 발행량 ${fmtCredit(result.total_supply_after, 2)}주`,
        );
        setDeposit("");
        setDebouncedDeposit("");
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  const isStale =
    deposit !== debouncedDeposit ||
    preview.isLoading ||
    preview.isFetching;
  const data = isStale ? null : preview.data;
  const previewError =
    !isStale && preview.isError && isApiError(preview.error) && preview.error.code !== "NOT_FOUND"
      ? errorMessage(preview.error)
      : null;

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-app-gray-500">
        Credit을 예치하면 커브 용량이 늘어나고 새 주식이 발행돼요. 발행된 주식은 상장 때 정한 락업
        비율대로 락업과 풀에 배분돼요.
        {maxDilutionPpm !== undefined ? ` 한 번에 가격을 ${fmtPercentFromPPM(maxDilutionPpm)}까지 희석할 수 있고,` : ""}
        {cooldownHours !== undefined ? ` 발행 후 ${cooldownHours}시간 동안은 다시 발행할 수 없어요.` : ""}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="issuance-deposit">예치 금액 (Credit)</Label>
        <Input
          id="issuance-deposit"
          value={deposit}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "" || isDecimalInput(next, 16)) setDeposit(next);
          }}
          inputMode="decimal"
          placeholder="0"
          className="numeric h-11 rounded-xl"
        />
      </div>

      {data ? (
        <div className="rounded-xl bg-app-gray-50 p-3">
          <DataRow label="발행 후 가격" value={fmtPrice(data.price_after)} />
          <DataRow label="현재 가격" value={fmtPrice(data.price_before)} />
          <DataRow label="가격 희석" value={fmtPercentFromPPM(data.price_dilution_ppm)} />
          <DataRow label="공급 증가 (참고)" value={fmtPercentFromPPM(data.supply_increase_ppm)} />
          <DataRow label="24시간 공급 증가 (참고)" value={fmtPercentFromPPM(data.rolling_24h_supply_increase_ppm)} />
          <DataRow label="최대 예치 가능" value={`${fmtCredit(data.maximum_acceptable_deposit, 4)} Credit`} />
          {!data.accepted ? (
            <p className="mt-2 text-[12px] font-medium text-app-red">
              {issuanceRejection(data, maxDilutionPpm)}
            </p>
          ) : null}
        </div>
      ) : null}
      {previewError ? <p className="text-[12px] text-app-red">{previewError}</p> : null}

      <Button
        type="button"
        onClick={submit}
        disabled={
          issuance.isPending ||
          !deposit ||
          !isPositiveDecimal(deposit) ||
          (data ? !data.accepted : false)
        }
        className="h-11 w-full rounded-xl bg-app-blue text-[14px] font-bold text-white hover:bg-app-blue-hover"
      >
        {issuance.isPending ? "발행 중…" : "추가 발행하기"}
      </Button>
    </div>
  );
}

function MetadataSection({ instrument }: { instrument: Instrument }) {
  const { data: exchangeInfo } = useExchangeInfo();
  const [name, setName] = useState(instrument.name);
  const [description, setDescription] = useState(instrument.description);
  const [tags, setTags] = useState(instrument.tags.join(", "));
  const [iconUrl, setIconUrl] = useState("");
  const update = useUpdateMetadata(instrument.symbol);

  function submit() {
    if (!name.trim()) {
      toast.error("종목 이름을 입력해주세요");
      return;
    }
    const parsedTags = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    const policyError = tagPolicyError(parsedTags, exchangeInfo?.metadata) || iconPolicyError(iconUrl, exchangeInfo?.metadata);
    if (policyError) { toast.error(policyError); return; }
    update.mutate(
      { name: name.trim(), description, tags: parsedTags, ...(iconUrl.trim() ? { icon_url: iconUrl.trim() } : {}) },
      {
        onSuccess: () => {
          toast.success(iconUrl.trim() ? (exchangeInfo?.metadata.icon_requires_approval ? "종목 정보를 저장하고 아이콘 심사를 요청했어요" : "종목 정보와 아이콘을 저장했어요") : "종목 정보를 수정했어요");
          setIconUrl("");
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="metadata-name">종목 이름</Label>
        <Input
          id="metadata-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-11 rounded-xl"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="metadata-description">설명</Label>
        <Textarea
          id="metadata-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          className="rounded-xl"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="metadata-tags">태그 (선택)</Label>
        <Input
          id="metadata-tags"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="게임, 테크 (쉼표로 구분)"
          className="h-11 rounded-xl"
        />
        <p className="text-[12px] text-app-gray-500">
          비워서 저장하면 기존 태그를 모두 삭제해요.
          {exchangeInfo && ` 최대 ${exchangeInfo.metadata.max_tags}개, 태그당 ${exchangeInfo.metadata.tag_max_bytes}바이트 (${exchangeInfo.metadata.tag_encoding})까지 입력할 수 있어요.`}
        </p>
      </div>
      <IconUrlField value={iconUrl} onChange={setIconUrl} />
      <Button
        type="button"
        onClick={submit}
        disabled={update.isPending}
        className="h-11 w-full rounded-xl bg-app-blue text-[14px] font-bold text-white hover:bg-app-blue-hover"
      >
        {update.isPending ? "저장 중…" : "저장하기"}
      </Button>
      <IconRequestHistory symbol={instrument.symbol} />
    </div>
  );
}

function TransferSection({ instrument, userId }: { instrument: Instrument; userId: string }) {
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const createRequest = useCreateManagerRequest(instrument.symbol);
  const respond = useRespondManagerRequest(instrument.symbol);
  const requests = useManagerRequests(instrument.symbol);
  const rows = requests.data?.data ?? [];

  function submit() {
    if (!target.trim()) {
      toast.error("이전받을 사용자 ID를 입력해주세요");
      return;
    }
    if (!reason.trim()) {
      toast.error("매니저 이전 사유를 입력해주세요");
      return;
    }
    createRequest.mutate(
      { target_user_id: target.trim(), reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success("매니저 이전 요청을 보냈어요");
          setTarget("");
          setReason("");
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-app-gray-500">
        종목 발행사 권한을 다른 사용자에게 넘길 수 있어요. 상대방이 수락하면 권한이 이전됩니다.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="manager-target">이전받을 사용자 ID</Label>
        <Input
          id="manager-target"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder="usr_..."
          className="numeric h-11 rounded-xl"
        />
      </div>
      <div className="space-y-1.5">
        <UserNameLookup userId={target} />
        <Label htmlFor="manager-reason">사유</Label>
        <Input
          id="manager-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="h-11 rounded-xl"
        />
      </div>
      <Button
        type="button"
        onClick={submit}
        disabled={createRequest.isPending}
        className="h-11 w-full rounded-xl bg-app-blue text-[14px] font-bold text-white hover:bg-app-blue-hover"
      >
        {createRequest.isPending ? "요청 중…" : "이전 요청 보내기"}
      </Button>

      {rows.length > 0 ? (
        <div className="space-y-2 pt-2">
          <p className="text-[13px] font-semibold text-app-gray-500">요청 내역</p>
          {rows.map((request) => (
            <div key={request.request_id} className="rounded-xl bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="numeric text-[12px] text-app-gray-600">
                  {request.target_user_id}
                </span>
                <span className="text-[11px] font-semibold text-app-gray-500">
                  {request.status}
                </span>
              </div>
              {request.status === "PENDING" && request.target_user_id === userId ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      respond.mutate(
                        { requestId: request.request_id, decision: "ACCEPT" },
                        {
                          onSuccess: () => toast.success("이전 요청을 수락했어요"),
                          onError: (error) => toast.error(errorMessage(error)),
                        },
                      )
                    }
                    className="h-8 flex-1 rounded-lg bg-app-blue text-[12px] font-bold"
                  >
                    수락
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      respond.mutate(
                        { requestId: request.request_id, decision: "REJECT" },
                        {
                          onSuccess: () => toast.success("이전 요청을 거절했어요"),
                          onError: (error) => toast.error(errorMessage(error)),
                        },
                      )
                    }
                    className="h-8 flex-1 rounded-lg text-[12px] font-bold"
                  >
                    거절
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
