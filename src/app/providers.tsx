"use client";

import { ThemeProvider } from "next-themes";

/** Theme-only provider for every route; session providers live in app/auth groups. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}
