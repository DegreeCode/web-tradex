"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { compareDecimal, fmtCredit, isDecimalInput } from "@/lib/format";
import {
  marginErrorMessage,
  useAddMarginCollateral,
  validateCollateralAmount,
  type MarginPosition,
} from "@/lib/margin";

export function MarginCollateralDialog({
  position,
  open,
  onOpenChange,
  availableCredit,
}: {
  position: MarginPosition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableCredit?: string;
}) {
  const [amount, setAmount] = useState("");
  const inputId = useId();
  const addCollateral = useAddMarginCollateral(position?.position_id ?? "");

  if (!position) return null;

  const errorText = validateCollateralAmount(amount, availableCredit);
  const isValid = !errorText;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || !position) return;
    try {
      await addCollateral.mutateAsync({ amount: amount.trim() });
      toast.success("담보를 추가했어요");
      setAmount("");
      onOpenChange(false);
    } catch (err) {
      toast.error(marginErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>담보 Credit 추가</DialogTitle>
          <DialogDescription>
            {position.symbol} 포지션에 담보를 더해 위험 비율을 낮춰요. 빌린 원금은 그대로예요.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="rounded-xl bg-app-gray-50 p-3 text-[13px] text-app-gray-600 space-y-1">
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <span>현재 담보</span>
              <span className="numeric min-w-0 break-all font-semibold text-app-gray-900">
                {fmtCredit(position.collateral, 4)} Credit
              </span>
            </div>
            {availableCredit !== undefined ? (
              <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
                <span>계좌 출금가능 Credit</span>
                <span className="numeric min-w-0 break-all font-semibold text-app-gray-900">
                  {fmtCredit(availableCredit, 4)} Credit
                </span>
              </div>
            ) : null}
          </div>

          <div>
            <label htmlFor={inputId} className="block text-[13px] font-medium text-app-gray-700">
              추가할 담보 금액 (Credit)
            </label>
            <div className="relative mt-1.5">
              <input
                id={inputId}
                type="text"
                inputMode="decimal"
                value={amount}
                placeholder="0"
                aria-invalid={Boolean(amount && errorText)}
                onChange={(e) => {
                  const val = e.target.value.replace(/,/g, "");
                  if (val === "" || isDecimalInput(val, 16)) {
                    setAmount(val);
                  }
                }}
                className="w-full rounded-xl border border-app-gray-200 pl-3.5 pr-16 py-2.5 text-base md:text-[15px] font-semibold text-app-gray-900 placeholder:text-app-gray-400 focus:border-app-blue focus:outline-none"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] font-medium text-app-gray-500">
                Credit
              </span>
            </div>
            {amount && errorText ? (
              <p className="mt-1 text-[12px] font-medium text-app-red">{errorText}</p>
            ) : null}
          </div>

          <div role="group" aria-label="빠른 금액 입력" className="flex gap-2">
            {["1", "5", "10", "50"].map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => setAmount(step)}
                aria-pressed={Boolean(amount) && compareDecimal(amount, step) === 0}
                className="min-h-11 flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-app-blue border border-app-gray-200 aria-pressed:border-app-blue aria-pressed:bg-app-blue-light aria-pressed:text-app-blue py-1.5 text-[12px] font-semibold text-app-gray-600 hover:bg-app-gray-50"
              >
                {step}
              </button>
            ))}
            {availableCredit ? (
              <button
                type="button"
                onClick={() => setAmount(availableCredit)}
                aria-pressed={Boolean(amount) && compareDecimal(amount, availableCredit) === 0}
                className="min-h-11 rounded-lg focus-visible:outline-2 focus-visible:outline-app-blue border border-app-gray-200 aria-pressed:border-app-blue aria-pressed:bg-app-blue-light px-2 py-1.5 text-[12px] font-semibold text-app-blue hover:bg-app-blue-light"
              >
                최대
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl border border-app-gray-200 px-4 py-2.5 text-[14px] font-semibold text-app-gray-700 hover:bg-app-gray-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!isValid || addCollateral.isPending}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-app-blue px-4 py-2.5 text-[14px] font-bold text-white hover:bg-app-blue-hover disabled:bg-app-gray-200 disabled:text-app-gray-400"
            >
              {addCollateral.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              담보 추가하기
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
