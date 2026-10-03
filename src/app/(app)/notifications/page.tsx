"use client";

import { useState } from "react";
import { Bell, CheckCheck, MailOpen } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorBlock, LoadMoreButton, PageHeader, SkeletonRows } from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import { errorMessage } from "@/lib/api";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMarkNotificationsRead,
  useNotifications,
} from "@/lib/hooks";
import {
  presentNotification,
  TONE_STYLES,
} from "@/lib/notifications";
import type { Notification } from "@/lib/types";

export default function NotificationsPage() {
  const [filter, setFilter] = useState<"ALL" | "UNREAD">("ALL");
  const [selected, setSelected] = useState<Notification | null>(null);
  const notifications = useNotifications({ unread: filter === "UNREAD", limit: 30 });
  const markRead = useMarkNotificationRead();
  const markBatch = useMarkNotificationsRead();
  const markAll = useMarkAllNotificationsRead();

  const rows = notifications.data?.pages.flatMap((page) => page.data) ?? [];
  const unreadRows = rows.filter((row) => !row.read);
  const selectedPresentation = selected ? presentNotification(selected) : null;
  const SelectedIcon = selectedPresentation?.icon ?? Bell;
  const selectedTone = selectedPresentation
    ? TONE_STYLES[selectedPresentation.tone]
    : TONE_STYLES.neutral;

  function handleOpen(item: Notification) {
    setSelected(item);
    if (!item.read) {
      markRead.mutate(item.notification_id, {
        onError: (error) => toast.error(errorMessage(error)),
      });
    }
  }

  function handleMarkAll() {
    markAll.mutate(undefined, {
      onSuccess: (result) => toast.success(`${result.read_count}건을 읽음으로 표시했어요`),
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  function handleMarkLoaded() {
    if (unreadRows.length === 0) return;
    markBatch.mutate(
      unreadRows.slice(0, 100).map((row) => row.notification_id),
      {
        onSuccess: (result) => toast.success(`${result.read_count}건을 읽음으로 표시했어요`),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="알림"
        subtitle="공지와 체결·송금·문의 소식을 확인하세요"
        action={
        <button
          type="button"
          onClick={filter === "UNREAD" ? handleMarkLoaded : handleMarkAll}
          disabled={notifications.isPending || markAll.isPending || markBatch.isPending || (filter === "UNREAD" && unreadRows.length === 0)}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-app-gray-100 px-3.5 text-[13px] font-semibold text-app-gray-700 hover:bg-app-gray-200 disabled:opacity-50"
        >
          <CheckCheck aria-hidden="true" className="size-4" />
          {filter === "UNREAD" ? "목록 읽음" : "모두 읽음"}
        </button>
        }
      />

      <Segmented<"ALL" | "UNREAD">
        value={filter}
        onChange={setFilter}
        options={[
          { value: "ALL", label: "전체" },
          { value: "UNREAD", label: `안 읽음${unreadRows.length > 0 ? ` ${unreadRows.length}` : ""}` },
        ]}
      />

      {notifications.isError && rows.length > 0 ? <ErrorBlock message={errorMessage(notifications.error)} onRetry={() => void notifications.refetch()} /> : null}

      {notifications.isLoading ? (
        <SkeletonRows rows={5} />
      ) : notifications.isError && rows.length === 0 ? (
        <ErrorBlock
          message={errorMessage(notifications.error)}
          onRetry={() => void notifications.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filter === "UNREAD" ? "안 읽은 알림이 없어요" : "알림이 없어요"}
          description="체결·송금·공지가 생기면 이곳에 도착해요"
          icon={<Bell aria-hidden="true" className="size-6" />}
        />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2">
          {rows.map((item) => (
            <NotificationCard key={item.notification_id} item={item} onOpen={handleOpen} />
          ))}
          <LoadMoreButton
            hasMore={notifications.hasNextPage}
            loading={notifications.isFetchingNextPage}
            onLoad={() => void notifications.fetchNextPage()}
            className="xl:col-span-2"
          />
        </div>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          {selected ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <span
                    className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${selectedTone.icon}`}
                    aria-hidden="true"
                  >
                    <SelectedIcon className="size-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <DialogTitle className="[overflow-wrap:anywhere] pr-6">{selectedPresentation?.title}</DialogTitle>
                    <DialogDescription className="mt-1 flex flex-wrap items-center gap-1.5">
                      {selectedPresentation?.label ? (
                        <span className="rounded-md bg-app-blue-light px-1.5 py-0.5 text-[11px] font-semibold text-app-blue-dark">
                          {selectedPresentation.label}
                        </span>
                      ) : null}
                      {selectedPresentation?.symbol ? (
                        <span className="numeric font-semibold text-app-gray-700">
                          {selectedPresentation.symbol}
                        </span>
                      ) : null}
                      <span>{fmtDateTime(selected.created_at)}</span>
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <p className="max-h-[50vh] [overflow-wrap:anywhere] overflow-y-auto text-[14px] leading-relaxed whitespace-pre-wrap text-app-gray-700">
                {selectedPresentation?.body}
              </p>
              {selected.read ? null : (
                <p className="flex items-center gap-1.5 text-[12px] text-app-gray-400">
                  <MailOpen aria-hidden="true" className="size-3.5" />
                  읽음으로 표시했어요
                </p>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NotificationCard({
  item,
  onOpen,
}: {
  item: Notification;
  onOpen: (item: Notification) => void;
}) {
  const presentation = presentNotification(item);
  const Icon = presentation.icon;
  const tone = TONE_STYLES[presentation.tone];

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`${presentation.title}, ${item.read ? "읽음" : "안 읽음"}`}
      aria-haspopup="dialog"
      className={`group min-w-0 w-full rounded-2xl p-4 text-left shadow-card hover:bg-app-gray-50 ${
        item.read
          ? "bg-card"
          : "border border-app-blue/15 bg-app-blue-faint"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone.icon}`}
          aria-hidden="true"
        >
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {!item.read ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-app-red" /> : null}
              <span className="rounded-md bg-app-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-app-gray-600">
                {presentation.label}
              </span>
              <span
                className={
                  item.read
                    ? "rounded-md bg-app-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-app-gray-500"
                    : "rounded-md bg-app-blue-light px-1.5 py-0.5 text-[10px] font-semibold text-app-blue-dark"
                }
              >
                {item.read ? "읽음" : "안 읽음"}
              </span>
              {item.pinned ? (
                <span className="shrink-0 rounded-md bg-app-blue-light px-1.5 py-0.5 text-[10px] font-semibold text-app-blue-dark">
                  고정
                </span>
              ) : null}
            </div>
            <span className="shrink-0 text-[11px] text-app-gray-400">
              {fmtRelative(item.created_at)}
            </span>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="min-w-0 [overflow-wrap:anywhere] text-[15px] font-bold text-app-gray-900">{presentation.title}</p>
            {presentation.symbol ? (
              <span className="numeric break-all text-[12px] font-semibold text-app-gray-500">
                {presentation.symbol}
              </span>
            ) : null}
          </div>
          <p className={`mt-1 [overflow-wrap:anywhere] line-clamp-2 text-[13px] leading-relaxed ${tone.body}`}>
            {presentation.body}
          </p>
        </div>
      </div>
    </button>
  );
}
