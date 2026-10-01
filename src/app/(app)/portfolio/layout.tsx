import type { Metadata } from "next";

export const metadata: Metadata = { title: "투자" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
