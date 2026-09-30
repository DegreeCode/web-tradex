"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiData, errorMessage } from "@/lib/api";

export function UserNameLookup({ userId }: { userId: string }) {
  const [selectedId, setSelectedId] = useState("");
  const query = useQuery({
    queryKey: ["public-user", selectedId],
    queryFn: () =>
      apiData<{ user_id: string; username: string }>(
        `/api/v1/users/${encodeURIComponent(selectedId)}`,
      ),
    enabled: Boolean(selectedId),
    // Usernames never change; only the explicit button asks again.
    staleTime: Infinity,
    retry: false,
  });
  const matches = Boolean(selectedId) && selectedId === userId.trim();
  return (
    <div className="space-y-1 pb-2 text-[13px]">
      <button
        type="button"
        disabled={!userId.trim() || query.isFetching}
        onClick={() => {
          if (matches) void query.refetch();
          else setSelectedId(userId.trim());
        }}
        className="font-semibold text-app-blue disabled:opacity-50"
      >
        {query.isFetching ? "확인 중…" : "사용자 이름 확인"}
      </button>
      {matches && query.data && (
        <p>
          받는 사용자: <strong>{query.data.username}</strong>
        </p>
      )}
      {matches && query.isError && (
        <p role="alert" className="text-app-red">
          {errorMessage(query.error)}
        </p>
      )}
    </div>
  );
}
