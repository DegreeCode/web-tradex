"use client";

import Image from "next/image";
import { useExchangeInfo } from "@/lib/exchange-info";
import { ExchangeInfoNotice } from "@/components/exchange-policy";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { API_BASE_URL, apiPage, buildQuery, errorMessage } from "@/lib/api";
import { ErrorBlock } from "@/components/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function IconUrlField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { data } = useExchangeInfo();
  const policy = data?.metadata;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="symbol-icon-url">아이콘 URL (선택)</Label>
      <Input
        id="symbol-icon-url"
        type="url"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://…/icon.png"
        className="h-11"
      />
      {policy && <div className="space-y-1 text-[12px] leading-5 text-app-gray-500">
        <p>{policy.icon_formats.join(" · ")} · 최대 {policy.icon_max_width}×{policy.icon_max_height}px · {policy.icon_max_bytes.toLocaleString()}바이트</p>
        <p>아이콘 심사 요청은 사용자당 분당 {policy.icon_requests_per_minute_per_user}회까지 가능해요.</p>
        <p className="break-all">{policy.icon_allowed_hosts.length ? `허용 HTTPS 호스트: ${policy.icon_allowed_hosts.join(", ")}` : "현재 허용된 호스트가 없어 새 아이콘을 등록할 수 없어요."}</p>
        <p>{policy.icon_requires_approval ? "심사 승인 후 표시돼요." : "별도 승인 없이 적용돼요."} URL을 입력하지 않으면 기존 아이콘을 유지해요.</p>
      </div>}
      <ExchangeInfoNotice />
    </div>
  );
}

interface IconRequest {
  request_id: string;
  symbol: string;
  source_url: string;
  state: "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  width: number;
  height: number;
  created_at: string;
  reason: string | null;
}
const states = {
  PENDING: "심사 대기",
  APPROVED: "승인",
  REJECTED: "거절",
  SUPERSEDED: "새 요청으로 대체",
};

function IconPreview({ request }: { request: IconRequest }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (request.state === "REJECTED" || request.state === "SUPERSEDED")
    return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          setFailed(false);
        }}
        className="text-[12px] font-semibold text-app-blue"
      >
        {open ? "미리보기 닫기" : "제출 이미지 확인"}
      </button>
      {open &&
        (failed ? (
          <p className="text-[12px] text-app-gray-500">
            이미지를 불러오지 못했어요. 심사 상태를 새로고침해주세요.
          </p>
        ) : (
          <Image
            unoptimized
            crossOrigin="use-credentials"
            src={`${API_BASE_URL}/api/v1/symbols/${encodeURIComponent(request.symbol)}/icon-requests/${encodeURIComponent(request.request_id)}/image`}
            alt="제출한 종목 아이콘"
            width={64}
            height={64}
            onError={() => setFailed(true)}
            className="mt-2 rounded-lg"
          />
        ))}
    </div>
  );
}

export function IconRequestHistory({ symbol }: { symbol: string }) {
  const query = useInfiniteQuery({
    queryKey: ["icon-requests", symbol],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<IconRequest>(
        `/api/v1/symbols/${encodeURIComponent(symbol)}/icon-requests${buildQuery({ cursor: pageParam })}`,
      ),
    getNextPageParam: (page) =>
      page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined,
  });
  return (
    <div className="space-y-3 border-t border-app-gray-100 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-bold">내 아이콘 심사 내역</h3>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="text-[12px] text-app-blue"
        >
          새로고침
        </button>
      </div>
      {query.isPending && (
        <p className="text-[13px] text-app-gray-500">
          내역을 불러오고 있어요…
        </p>
      )}
      {query.isError && (
        <ErrorBlock
          message={errorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data?.pages
        .flatMap((page) => page.data)
        .map((request) => (
          <div
            key={request.request_id}
            className="space-y-2 rounded-lg bg-app-gray-50 p-3 text-[12px]"
          >
            <div className="flex justify-between gap-2">
              <span className="font-semibold">{states[request.state]}</span>
              <time>
                {new Date(request.created_at).toLocaleString("ko-KR")}
              </time>
            </div>
            <p className="break-all text-app-gray-500">{request.source_url}</p>
            {request.reason && <p>심사 사유: {request.reason}</p>}
            <IconPreview request={request} />
          </div>
        ))}
      {query.data?.pages[0]?.data.length === 0 && (
        <p className="text-[13px] text-app-gray-500">
          제출한 아이콘이 없어요.
        </p>
      )}
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          className="text-[13px] text-app-blue"
        >
          {query.isFetchingNextPage ? "불러오는 중…" : "이전 내역 더 보기"}
        </button>
      )}
    </div>
  );
}
