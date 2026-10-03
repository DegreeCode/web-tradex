"use client";

import { useId } from "react";
import { Popover } from "@base-ui/react/popover";
import { Settings } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export function ChartSettingsButton({
  showAverageCost,
  onShowAverageCostChange,
  logarithmic,
  onLogarithmicChange,
  disabled,
}: {
  showAverageCost: boolean;
  onShowAverageCostChange: (show: boolean) => void;
  logarithmic: boolean;
  onLogarithmicChange: (enabled: boolean) => void;
  disabled?: boolean;
}) {
  const toggleId = useId();
  const logarithmicId = useId();
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="차트 설정"
        title="차트 설정"
        disabled={disabled}
        className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-lg text-app-gray-500 hover:bg-app-gray-100 focus-visible:outline-2 focus-visible:outline-app-blue disabled:opacity-50"
      >
        <Settings aria-hidden="true" className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="w-60 rounded-2xl border border-app-gray-100 bg-popover p-4 text-app-gray-900 shadow-lg outline-none">
            <Popover.Title className="mb-3 text-[14px] font-bold">차트 설정</Popover.Title>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <label htmlFor={toggleId} className="cursor-pointer text-[13px] font-semibold">평균단가 표시</label>
                <Switch id={toggleId} aria-label="평균단가 표시" checked={showAverageCost} onCheckedChange={onShowAverageCostChange} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <label htmlFor={logarithmicId} className="cursor-pointer text-[13px] font-semibold">로그 스케일</label>
                <Switch id={logarithmicId} aria-label="로그 스케일" checked={logarithmic} onCheckedChange={onLogarithmicChange} />
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
