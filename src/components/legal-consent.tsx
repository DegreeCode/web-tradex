import { cn } from "cn";
import Link from "next/link";

/** Required sign-up consent. Links open in a new tab so typed input survives. */
export function LegalConsent({
  checked,
  onChange,
  className = "mt-4",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 text-[13px] leading-5 text-app-gray-700", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-app-blue"
      />
      <span>
        [필수] 만 14세 이상이며,{" "}
        <Link href="/terms" target="_blank" rel="noopener" className="font-semibold text-app-blue underline-offset-2 hover:underline">
          이용약관
        </Link>
        에 동의하고{" "}
        <Link href="/privacy" target="_blank" rel="noopener" className="font-semibold text-app-blue underline-offset-2 hover:underline">
          개인정보 처리방침
        </Link>
        을 확인했어요
      </span>
    </label>
  );
}
