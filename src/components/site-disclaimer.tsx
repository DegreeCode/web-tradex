import { cn } from "cn";
import Link from "next/link";

export function SiteDisclaimer({
  className,
  innerClassName,
  stacked = false,
}: {
  className?: string;
  innerClassName?: string;
  /** Centered one-column layout for the narrow sign-in screens. */
  stacked?: boolean;
}) {
  return (
    <footer
      aria-label="서비스 안내"
      className={cn("text-[11px] leading-relaxed text-app-gray-400", className)}
    >
      <div
        className={cn(
          stacked
            ? "flex flex-col items-center gap-1 text-center"
            : "flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
          innerClassName,
        )}
      >
        <p className="min-w-0">
          TradeX는 모의 투자 서비스로, Credit은 실제 돈이 아니며 현금으로 바꿀 수 없어요.
          Credit·계정을 현금 등과 거래해 생긴 법적 책임은 당사자에게 있어요.
        </p>
        <p className="flex shrink-0 items-center gap-3">
          <Link href="/terms" prefetch={false} className="hover:text-app-gray-600">
            이용약관
          </Link>
          <Link
            href="/privacy"
            prefetch={false}
            className="font-semibold text-app-gray-500 hover:text-app-gray-700"
          >
            개인정보 처리방침
          </Link>
          <span>© 2026 TradeX</span>
        </p>
      </div>
    </footer>
  );
}
