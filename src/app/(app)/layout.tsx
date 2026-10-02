"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { AppShell } from "@/components/app-shell";
import Loading from "./loading";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?next=${next}`);
    } else if (status === "recovery") {
      router.replace("/recover");
    } else if (status === "linked-blocked") {
      router.replace("/login?reconnect=1");
    }
  }, [status, router]);

  return <AppShell>{status === "authenticated" ? children : <Loading />}</AppShell>;
}
