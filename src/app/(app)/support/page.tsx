"use client";

import { useState } from "react";
import { LifeBuoy, Plus, Send } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorBlock, SkeletonRows } from "@/components/primitives";
import { errorMessage } from "@/lib/api";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import {
  useCreateInquiry,
  useInquiries,
  useInquiry,
  useReplyInquiry,
  useResolveInquiry,
} from "@/lib/hooks";
import type { Inquiry, InquiryCategory, InquiryStatus } from "@/lib/types";
import { cn } from "cn";

const CATEGORIES: { value: InquiryCategory; label: string }[] = [
  { value: "ACCOUNT", label: "계좌" },
  { value: "TRADE", label: "거래" },
  { value: "TRANSFER", label: "송금" },
  { value: "LISTING", label: "상장" },
  { value: "SECURITY", label: "보안" },
  { value: "OTHER", label: "기타" },
];

const STATUS_LABEL: Record<InquiryStatus, string> = {
  WAITING_ADMIN: "답변 대기",
  WAITING_USER: "답변 도착",
  RESOLVED: "해결됨",
  CLOSED: "종료",
};

function statusClass(status: InquiryStatus): string {
  if (status === "WAITING_USER") return "bg-app-blue-light text-app-blue-dark";
  if (status === "WAITING_ADMIN") return "bg-app-orange-light text-app-orange";
  if (status === "RESOLVED") return "bg-app-green-light text-app-green";
  return "bg-app-gray-100 text-app-gray-500";
}

export default function SupportPage() {
  const inquiries = useInquiries();
  const [createOpen, setCreateOpen] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);

  const rows = inquiries.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] font-extrabold tracking-[-0.03em] text-app-gray-900">
            고객센터
          </h1>
          <p className="mt-1 text-[13px] text-app-gray-500">궁금한 점을 남기면 답변을 드려요</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-app-blue px-3.5 text-[14px] font-bold text-white hover:bg-app-blue-hover"
        >
          <Plus className="size-4" />
          문의하기
        </button>
      </div>

      {inquiries.isError ? (
        <ErrorBlock
          message={errorMessage(inquiries.error)}
          onRetry={() => void inquiries.refetch()}
        />
      ) : null}
      {inquiries.isLoading ? (
        <SkeletonRows rows={4} />
      ) : !inquiries.data ? null : rows.length === 0 ? (
        <EmptyState
          title="문의 내역이 없어요"
          description="계좌·거래·송금 관련 문의를 남겨보세요"
          icon={<LifeBuoy className="size-6" />}
        />
      ) : (
        <div className="grid gap-2 xl:grid-cols-2">
          {rows.map((inquiry) => (
            <button
              key={inquiry.ticket}
              type="button"
              onClick={() => setTicket(inquiry.ticket)}
              className="min-w-0 w-full rounded-2xl bg-card p-4 text-left shadow-[0_1px_2px_0_rgba(25,31,40,0.03)] transition-colors hover:bg-app-gray-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded-md bg-app-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-app-gray-600">
                    {CATEGORIES.find((item) => item.value === inquiry.category)?.label ??
                      inquiry.category}
                  </span>
                  <p className="truncate text-[15px] font-semibold text-app-gray-900">
                    {inquiry.subject}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                    statusClass(inquiry.status),
                  )}
                >
                  {STATUS_LABEL[inquiry.status]}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-app-gray-400">
                {fmtRelative(inquiry.updated_at)} 업데이트
              </p>
            </button>
          ))}
          {inquiries.hasNextPage ? (
            <button
              type="button"
              onClick={() => void inquiries.fetchNextPage()}
              disabled={inquiries.isFetchingNextPage}
              className="h-11 w-full rounded-xl bg-card text-[13px] font-semibold text-app-gray-600 shadow-[0_1px_2px_0_rgba(25,31,40,0.03)] disabled:opacity-50"
            >
              {inquiries.isFetchingNextPage ? "불러오는 중…" : "더보기"}
            </button>
          ) : null}
        </div>
      )}

      <CreateInquiryDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setTicket} />
      <InquiryDialog ticket={ticket} onClose={() => setTicket(null)} />
    </div>
  );
}

function CreateInquiryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (ticket: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <CreateInquiryForm
          onDone={(ticket) => {
            onOpenChange(false);
            onCreated(ticket);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function CreateInquiryForm({ onDone }: { onDone: (ticket: string) => void }) {
  const [category, setCategory] = useState<InquiryCategory>("ACCOUNT");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const createInquiry = useCreateInquiry();

  function submit() {
    if (!subject.trim()) {
      toast.error("제목을 입력해주세요");
      return;
    }
    if (!body.trim()) {
      toast.error("문의 내용을 입력해주세요");
      return;
    }
    createInquiry.mutate(
      { category, subject: subject.trim(), body: body.trim() },
      {
        onSuccess: (inquiry) => {
          toast.success("문의를 접수했어요");
          onDone(inquiry.ticket);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>문의하기</DialogTitle>
        <DialogDescription>영업일 기준으로 순차 답변드려요</DialogDescription>
      </DialogHeader>

      <div className="mt-3 space-y-3.5">
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-app-gray-500">분류</p>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setCategory(item.value)}
                aria-pressed={category === item.value}
                className={cn(
                  "rounded-xl px-3 py-2 text-[13px] font-semibold",
                  category === item.value
                    ? "bg-app-blue-light text-app-blue-dark"
                    : "bg-app-gray-100 text-app-gray-600",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inquiry-subject">제목</Label>
          <Input
            id="inquiry-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="문의 제목"
            className="h-11 rounded-xl"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inquiry-body">내용</Label>
          <Textarea
            id="inquiry-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            placeholder="문의 내용을 자세히 적어주세요"
            className="rounded-xl"
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={createInquiry.isPending}
          className="h-12 w-full rounded-xl bg-app-blue text-[15px] font-bold text-white hover:bg-app-blue-hover disabled:opacity-40"
        >
          {createInquiry.isPending ? "접수 중…" : "문의 접수"}
        </button>
      </div>
    </>
  );
}

function InquiryDialog({ ticket, onClose }: { ticket: string | null; onClose: () => void }) {
  const inquiry = useInquiry(ticket);
  return (
    <Dialog open={Boolean(ticket)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-2xl">
        {!inquiry.data ? (
          <DialogHeader>
            <DialogTitle>문의 내역</DialogTitle>
            <DialogDescription>문의 내용과 답변을 확인하세요</DialogDescription>
          </DialogHeader>
        ) : null}
        {inquiry.isError ? (
          <ErrorBlock message={errorMessage(inquiry.error)} onRetry={() => void inquiry.refetch()} />
        ) : null}
        {inquiry.isLoading ? (
          <SkeletonRows rows={3} />
        ) : inquiry.data ? (
          <InquiryThread inquiry={inquiry.data} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function InquiryThread({ inquiry }: { inquiry: Inquiry & { messages: { id: string; author_user_id: string; author_acl: string; body: string; created_at: string }[] } }) {
  const [reply, setReply] = useState("");
  const sendReply = useReplyInquiry(inquiry.ticket);
  const resolve = useResolveInquiry(inquiry.ticket);
  const closed = inquiry.status === "CLOSED";

  function submitReply() {
    if (!reply.trim()) {
      toast.error("답변 내용을 입력해주세요");
      return;
    }
    sendReply.mutate(reply.trim(), {
      onSuccess: () => {
        toast.success("메시지를 보냈어요");
        setReply("");
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="break-words [overflow-wrap:anywhere]">{inquiry.subject}</DialogTitle>
        <DialogDescription>
          {CATEGORIES.find((item) => item.value === inquiry.category)?.label ?? inquiry.category} ·{" "}
          {STATUS_LABEL[inquiry.status]} · {fmtDateTime(inquiry.created_at)}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-3 max-h-[45vh] space-y-2.5 overflow-y-auto">
        {inquiry.messages.map((message) => {
          const staff = message.author_acl !== "USER";
          return (
            <div
              key={message.id}
              className={cn(
                "rounded-xl px-3 py-2.5",
                staff ? "bg-app-blue-light" : "bg-app-gray-100",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-[12px] font-bold",
                    staff ? "text-app-blue-dark" : "text-app-gray-700",
                  )}
                >
                  {staff ? "상담원" : "나"}
                </span>
                <span className="text-[11px] text-app-gray-400">
                  {fmtRelative(message.created_at)}
                </span>
              </div>
              <p className="mt-1 break-words text-[13px] leading-relaxed whitespace-pre-wrap text-app-gray-800 [overflow-wrap:anywhere]">
                {message.body}
              </p>
            </div>
          );
        })}
      </div>

      {closed ? (
        <p className="mt-3 rounded-xl bg-app-gray-100 px-3 py-2 text-[12px] text-app-gray-500">
          종료된 문의에는 새 메시지를 보낼 수 없어요
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <Textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={3}
            placeholder="추가로 궁금한 점을 남겨주세요"
            className="rounded-xl"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitReply}
              disabled={sendReply.isPending}
              className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-app-blue text-[14px] font-bold text-white hover:bg-app-blue-hover disabled:opacity-40"
            >
              <Send className="size-4" />
              {sendReply.isPending ? "전송 중…" : "메시지 보내기"}
            </button>
            {inquiry.status !== "RESOLVED" ? (
              <button
                type="button"
                onClick={() =>
                  resolve.mutate(undefined, {
                    onSuccess: () => toast.success("문의를 해결됨으로 표시했어요"),
                    onError: (error) => toast.error(errorMessage(error)),
                  })
                }
                disabled={resolve.isPending}
                className="h-11 rounded-xl bg-app-gray-100 px-4 text-[14px] font-semibold text-app-gray-700 hover:bg-app-gray-200 disabled:opacity-40"
              >
                해결됨
              </button>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
