import { SessionProviders } from "@/components/session-providers";
import AppLayout from "./app-layout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProviders>
      <AppLayout>{children}</AppLayout>
    </SessionProviders>
  );
}
