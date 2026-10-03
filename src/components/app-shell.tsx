"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Bell, ChevronRight, LogOut } from "lucide-react";
import { cn } from "cn";

import { useExchangeInfo } from "@/lib/exchange-info";
import { useAuth } from "@/components/auth-provider";
import {
  useLogout,
  useDisclosureStream,
  useMarketStateStream,
  usePrivateStream,
  useSymbolMetadataSync,
  useTickerStream,
  useUnreadNotifications,
} from "@/lib/hooks";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useConnectionToast, useLiveNotificationToasts } from "@/lib/live-toasts";
import { formatUnreadBadge } from "@/lib/notifications";
import { SiteDisclaimer } from "@/components/site-disclaimer";
import { BrandLogo } from "@/components/brand-logo";
import { LinkedSessionBanner } from "@/components/linked-session-banner";
import { MORE_NAV, PRIMARY_NAV, moreNavFor } from "@/lib/navigation";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

type NavItem = (typeof PRIMARY_NAV)[number];

function SidebarLink({ item, active, badge }: { item: NavItem; active: boolean; badge?: string | null }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-app-blue",
        active ? "bg-app-blue-light text-app-blue-dark" : "text-app-gray-600 hover:bg-app-gray-100",
      )}
    >
      <item.icon aria-hidden="true" className="size-[18px]" />
      {item.label}
      {badge ? <UnreadBadge label={badge} className="ml-auto" /> : null}
    </Link>
  );
}

function UnreadBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      aria-label={`안 읽은 알림 ${label}개`}
      className={cn("rounded-full bg-app-red px-1.5 py-0.5 text-[11px] leading-none font-bold text-white", className)}
    >
      {label}
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, status, linkedScope } = useAuth();
  const authenticated = status === "authenticated";
  const linked = linkedScope !== null;
  const moreNav = moreNavFor(linked);
  const logout = useLogout();
  const [moreOpen, setMoreOpen] = useState(false);
  const unread = useUnreadNotifications(authenticated);
  const unreadCount = authenticated ? (unread.data?.data.length ?? 0) : 0;
  const unreadOverflow = authenticated && (unread.data?.page.has_more ?? false);
  const unreadBadgeLabel = formatUnreadBadge(unreadCount, unreadOverflow);

  useExchangeInfo(true);
  useTickerStream();
  useMarketStateStream();
  useDisclosureStream();
  useSymbolMetadataSync();
  // A linked session gets the same stream; the server leaves out events for
  // accounts outside its scope.
  usePrivateStream(authenticated);
  useLiveNotificationToasts(authenticated);
  useConnectionToast(authenticated);

  const initial = user?.username.slice(0, 1).toUpperCase() ?? "⋯";
  const currentTitle =
    [...PRIMARY_NAV, ...MORE_NAV].find((item) => isActive(pathname, item.href))?.label ?? "";
  const moreActive = moreNav.some((item) => isActive(pathname, item.href));

  function handleLogout() {
    logout.mutate(undefined, {
      onSettled: () => {
        setMoreOpen(false);
        router.replace("/login");
      },
    });
  }

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-app-gray-200 bg-card lg:flex">
        <div className="shrink-0 px-6 pt-7 pb-6">
          <Link
            href="/"
            className="text-[21px] font-extrabold tracking-[-0.04em] text-app-gray-900"
          >
            <BrandLogo />
          </Link>
        </div>
        <nav aria-label="주 메뉴" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3">
          {PRIMARY_NAV.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
          <p className="px-3 pt-5 pb-1 text-[12px] font-semibold text-app-gray-400">더보기</p>
          {moreNav.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              badge={item.href === "/notifications" ? unreadBadgeLabel : null}
            />
          ))}
        </nav>
        <div className="shrink-0 border-t border-app-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-app-gray-100 text-[14px] font-bold text-app-gray-700">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-app-gray-900">
                {user?.username ?? "로그인 확인 중…"}
              </p>
              {user ? <p className="text-[12px] text-app-gray-400">@{user.role.toLowerCase()}</p> : null}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={!authenticated || logout.isPending}
              aria-label="로그아웃"
              title="로그아웃"
              className="rounded-lg p-2.5 text-app-gray-400 hover:bg-app-gray-100 hover:text-app-gray-700 focus-visible:outline-2 focus-visible:outline-app-blue disabled:pointer-events-none disabled:opacity-40"
            >
              <LogOut aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-app-gray-200 bg-background/90 px-4 backdrop-blur-md lg:hidden">
          {currentTitle ? (
            // The page renders its own h1; this is only the bar's label.
            <p className="min-w-0 truncate text-[17px] font-bold tracking-[-0.02em] text-app-gray-900">
              {currentTitle}
            </p>
          ) : (
            <Link
              href="/"
              className="text-[19px] font-extrabold tracking-[-0.04em] text-app-gray-900"
            >
              <BrandLogo />
            </Link>
          )}
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/notifications"
              aria-label="알림"
              aria-current={isActive(pathname, "/notifications") ? "page" : undefined}
              className={cn(
                "relative flex size-9 items-center justify-center rounded-full shadow-raised focus-visible:outline-2 focus-visible:outline-app-blue",
                isActive(pathname, "/notifications") ? "bg-app-blue-light text-app-blue" : "bg-card text-app-gray-700",
              )}
            >
              <Bell aria-hidden="true" className="size-4" />
              {unreadBadgeLabel ? (
                <UnreadBadge
                  label={unreadBadgeLabel}
                  className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center px-1 text-[9px]"
                />
              ) : null}
            </Link>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-controls="more-navigation"
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-[13px] font-bold shadow-raised focus-visible:outline-2 focus-visible:outline-app-blue",
                moreOpen ? "bg-app-blue-light text-app-blue" : "bg-card text-app-gray-700",
              )}
              aria-label="더보기"
            >
              {initial}
            </button>
          </div>
        </header>

        <main className="mx-auto min-w-0 w-full max-w-[1280px] flex-1 px-4 pt-4 pb-10 lg:px-8 lg:pt-8 lg:pb-12 xl:px-10">
          {linkedScope ? <LinkedSessionBanner scope={linkedScope} /> : null}
          {children}
        </main>

        {/* The bottom padding clears the mobile tab bar and the symbol page's order bar. */}
        <SiteDisclaimer
          className="border-t border-app-gray-200 pb-[calc(8rem+env(safe-area-inset-bottom))] lg:pb-0"
          innerClassName="mx-auto w-full max-w-[1280px] px-4 py-3 lg:px-8 xl:px-10"
        />

        <nav aria-label="하단 메뉴" className="fixed inset-x-0 bottom-0 z-30 border-t border-app-gray-200 bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
          <div className="grid grid-cols-5">
            {PRIMARY_NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-app-blue focus-visible:-outline-offset-2",
                    active ? "text-app-gray-900" : "text-app-gray-400",
                  )}
                >
                  <item.icon aria-hidden="true" className={cn("size-5", active && "text-app-blue")} />
                  {item.label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-controls="more-navigation"
              data-active={moreActive || moreOpen}
              aria-label="더보기"
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-app-blue focus-visible:-outline-offset-2",
                moreActive || moreOpen ? "text-app-gray-900" : "text-app-gray-400",
              )}
            >
              <span className={cn(
                "flex size-5 items-center justify-center rounded-full text-[10px] font-bold",
                moreActive || moreOpen ? "bg-app-blue-light text-app-blue" : "bg-app-gray-100 text-app-gray-600",
              )}>
                {initial}
              </span>
              더보기
            </button>
          </div>
        </nav>
      </div>

      <Drawer open={moreOpen} onOpenChange={setMoreOpen} swipeDirection="down" showSwipeHandle>
        <DrawerContent id="more-navigation" className="max-h-[85dvh]">
          <DrawerHeader className="pb-2">
            <DrawerTitle>더보기</DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="mb-4 flex items-center gap-3 rounded-2xl bg-app-gray-100 p-4">
              <div aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-card text-[15px] font-bold text-app-gray-700">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-app-gray-900">{user?.username ?? "로그인 확인 중…"}</p>
                <p className="truncate text-[12px] text-app-gray-500">{user?.user_id}</p>
              </div>
            </div>
            <div className="space-y-1">
              {moreNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-3 focus-visible:outline-2 focus-visible:outline-app-blue",
                    isActive(pathname, item.href) ? "bg-app-blue-light" : "hover:bg-app-gray-100",
                  )}
                >
                  <div className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full",
                    isActive(pathname, item.href) ? "bg-card text-app-blue" : "bg-app-gray-100 text-app-gray-600",
                  )}>
                    <item.icon className="size-[18px]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[15px] font-semibold", isActive(pathname, item.href) ? "text-app-blue-dark" : "text-app-gray-900")}>{item.label}</p>
                    <p className="text-[12px] text-app-gray-500">{item.description}</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-app-gray-300" />
                </Link>
              ))}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={!authenticated || logout.isPending}
              className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-app-gray-100 focus-visible:outline-2 focus-visible:outline-app-blue disabled:pointer-events-none disabled:opacity-40"
            >
              <div className="flex size-9 items-center justify-center rounded-full bg-app-gray-100 text-app-gray-600">
                <LogOut className="size-[18px]" />
              </div>
              <p className="text-[15px] font-semibold text-app-gray-900">로그아웃</p>
            </button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
