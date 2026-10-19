"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiData, apiPage, buildQuery, postData } from "../api";
import type { Inquiry, InquiryCategory, InquiryDetail, InquiryMessage } from "../types";
import { useSocketStatus, privateStaleTime } from "./socket";

export function useInquiries(limit = 30) {
  const privateStatus = useSocketStatus("private");
  return useInfiniteQuery({
    queryKey: ["inquiries", limit],
    queryFn: ({ pageParam, signal }) =>
      apiPage<Inquiry>(`/api/v1/inquiries${buildQuery({ limit, cursor: pageParam })}`, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    refetchInterval: privateStatus === "open" ? false : 60_000,
    staleTime: privateStaleTime(privateStatus),
  });
}

export function useInquiry(ticket: string | null) {
  return useQuery({
    queryKey: ["inquiry", ticket],
    queryFn: ({ signal }) => apiData<InquiryDetail>(`/api/v1/inquiries/${encodeURIComponent(ticket ?? "")}`, { signal }),
    enabled: Boolean(ticket),
  });
}

export function useCreateInquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { category: InquiryCategory; subject: string; body: string }) =>
      postData<Inquiry>("/api/v1/inquiries", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inquiries"] });
    },
  });
}

export function useReplyInquiry(ticket: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      postData<InquiryMessage>(`/api/v1/inquiries/${encodeURIComponent(ticket)}/messages`, { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inquiry", ticket] });
      void queryClient.invalidateQueries({ queryKey: ["inquiries"] });
    },
  });
}

export function useResolveInquiry(ticket: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      postData<{ status: string }>(`/api/v1/inquiries/${encodeURIComponent(ticket)}/resolution`, {
        status: "RESOLVED",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inquiry", ticket] });
      void queryClient.invalidateQueries({ queryKey: ["inquiries"] });
    },
  });
}
