"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { ApiError } from "@/lib/api";
import { AuthProvider } from "@/components/auth-provider";
import { Toaster } from "@/components/ui/sonner";

// The unminified file is served as stored in the tagged release; jsDelivr's
// .min.css is generated on the fly, so its bytes (and hash) are not stable.
const FONT_STYLESHEET = {
  href: "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css",
  integrity: "sha384-2nNKoOPayicGa+aRguOQuiZP+RqQ4G3jalfDeOgftkKD7zBM2gJXTwcFqCZltdv0",
};

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

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(createQueryClient);
  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_STYLESHEET.href}"]`)) return;
    // The system font renders the shell immediately, even if the font CDN is slow.
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.crossOrigin = "anonymous";
    stylesheet.integrity = FONT_STYLESHEET.integrity;
    stylesheet.href = FONT_STYLESHEET.href;
    document.head.appendChild(stylesheet);
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <AuthProvider>{children}</AuthProvider>
        <Toaster position="top-center" richColors />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
