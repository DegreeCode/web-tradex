"use client";

// Replaces the root layout when it fails, so it renders its own document. It
// is loaded on every route, so it stays dependency-free (no CSS, icons, Link).
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", background: "#f2f4f6", color: "#191f28" }}>
        <div role="alert" style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>화면을 표시하지 못했어요</h1>
          <p style={{ fontSize: 14, color: "#6b7684", margin: "8px 0 20px" }}>잠시 후 다시 시도해주세요.</p>
          <button type="button" onClick={reset} style={{ height: 44, padding: "0 20px", border: 0, borderRadius: 12, background: "#3182f6", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            다시 시도
          </button>{" "}
          {/* A full page load is the right recovery once the root layout has failed. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" style={{ marginLeft: 8, fontSize: 14, color: "#3182f6", fontWeight: 600 }}>홈으로</a>
        </div>
      </body>
    </html>
  );
}
