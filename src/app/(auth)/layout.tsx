import { SessionProviders } from "@/components/session-providers";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SessionProviders>{children}</SessionProviders>;
}
