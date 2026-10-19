"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiData, buildQuery, postData } from "../api";
import {
  isNotification,
  loadNotificationPage,
  markNotificationsReadInCaches,
  notificationIdsInCaches,
  updateNotificationCaches,
} from "../notification-cache";
import type { Notification } from "../types";

export function useNotifications(options: { unread?: boolean; limit?: number } = {}) {
  const queryClient = useQueryClient();
  const { unread = false, limit = 30 } = options;
  return useInfiniteQuery({
    queryKey: ["notifications", "list", unread ? "unread" : "all", limit],
    queryFn: ({ pageParam, signal, queryKey }) =>
      loadNotificationPage(queryClient,
        `/api/v1/notifications${buildQuery({
          sort: "pinned",
          unread: unread ? "true" : undefined,
          limit,
          cursor: pageParam,
        })}`,
        { unreadOnly: unread, cursor: pageParam, signal, queryKey },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    staleTime: Infinity,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useUnreadNotifications(enabled = true) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["notifications", "unread"],
    // The badge caps at 50+, so one full page tells the shell everything it needs.
    queryFn: ({ signal }) =>
      loadNotificationPage(queryClient, `/api/v1/notifications${buildQuery({ sort: "pinned", unread: "true", limit: 50 })}`, { unreadOnly: true, signal }),
    enabled,
    staleTime: Infinity,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      postData<Notification>(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`, {}),
    onSuccess: (notification, notificationId) => {
      if (isNotification(notification)) updateNotificationCaches(queryClient, notification);
      else markNotificationsReadInCaches(queryClient, new Set([notificationId]));
    },
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationIds: string[]) =>
      postData<{ read_count: number }>("/api/v1/notifications/read-batch", {
        notification_ids: notificationIds,
      }),
    onSuccess: (_result, notificationIds) =>
      markNotificationsReadInCaches(queryClient, new Set(notificationIds)),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiData<{ read_count: number }>("/api/v1/notifications/read-all", { method: "POST", timeoutMs: 65_000 }),
    onMutate: () => notificationIdsInCaches(queryClient),
    onSuccess: (_result, _variables, ids) => {
      // Rows arriving during this request may have been created after the
      // server's cutoff. Preserve them until an authoritative refresh agrees.
      markNotificationsReadInCaches(queryClient, ids ?? new Set());
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
