import type { Metadata, Viewport } from "next";
import "./globals.css";
import { API_BASE_URL } from "@/lib/api";
import { FONT_ORIGIN, FONT_STYLESHEET } from "@/lib/fonts";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "TradeX", template: "%s · TradeX" },
  description: "본딩커브 기반 종목 거래 플랫폼",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f4f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1216" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full" suppressHydrationWarning>
      <head>
        {/* Every screen calls the API and loads the web font right after
            hydration; opening both connections early saves a round trip. */}
        <link rel="preconnect" href={API_BASE_URL} crossOrigin="use-credentials" />
        <link rel="preconnect" href={FONT_ORIGIN} crossOrigin="anonymous" />
        {/* Load the stylesheet in the initial document so text does not swap
            after hydration (avoids a late layout shift). */}
        <link
          rel="stylesheet"
          href={FONT_STYLESHEET.href}
          integrity={FONT_STYLESHEET.integrity}
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
