import { compareDecimal, fmtDecimal } from "@/lib/format";
import { estimateMarginReturnPercent, type MarginPosition } from "@/lib/margin";

export function MarginReturn({ position }: { position: MarginPosition }) {
  const percent = estimateMarginReturnPercent(position);
  const formatted = percent === null ? null : fmtDecimal(percent, 2);
  const direction = percent === null || formatted === "0" ? 0 : compareDecimal(percent, "0");
  return (
    <span className={`numeric min-w-0 break-all font-bold ${direction > 0 ? "text-app-red" : direction < 0 ? "text-app-blue" : "text-app-gray-700"}`}>
      {formatted === null ? "—" : `${direction > 0 ? "+" : ""}${formatted}%`}
    </span>
  );
}
