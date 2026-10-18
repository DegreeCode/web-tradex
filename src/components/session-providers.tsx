"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ApiError } from "@/lib/api";
import { AuthProvider } from "@/components/auth-provider";
import { Toaster } from "@/components/ui/sonner";

export function createQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return error.status === 429 && failureCount < 2;
          }
          return failureCount < 2;
        },
        retryDelay: (attempt, error) =>
          error instanceof ApiError && error.retryAfterMs !== undefined
            ? error.retryAfterMs
            : Math.min(1000 * 2 ** attempt, 30_000),
        refetchOnWindowFocus: true,
      },
    },
  });
  // WS owns this cache without a query observer. Keep it for the client lifetime:
  // unchanged tickers may receive no updates for longer than the default 5m GC.
  client.setQueryDefaults(["ticker-cache"], { gcTime: Infinity });
  return client;
}

/**
 * Session-scoped providers. Public legal pages stay outside this boundary so
 * they do not download the query client, auth runtime, or toast renderer.
 */
export function SessionProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}
