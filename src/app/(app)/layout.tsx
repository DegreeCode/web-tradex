"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { AppShell } from "@/components/app-shell";
import { isGuestRoute } from "@/lib/navigation";
import { loginHref } from "@/lib/routes";
import Loading from "./loading";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const browsing = status === "anonymous" && isGuestRoute(pathname);

  useEffect(() => {
    if (status === "anonymous" && !isGuestRoute(pathname)) {
      router.replace(loginHref(window.location.pathname + window.location.search));
    } else if (status === "recovery") {
      router.replace("/recover");
    } else if (status === "linked-blocked") {
      router.replace("/login?reconnect=1");
    }
  }, [status, pathname, router]);

  return <AppShell>{status === "authenticated" || browsing ? children : <Loading />}</AppShell>;
}
