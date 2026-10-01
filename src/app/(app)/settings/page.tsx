"use client";

import { BellRing, Moon, Settings2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { PageHeader, Surface } from "@/components/primitives";
import { Segmented } from "@/components/segmented";
import { Switch } from "@/components/ui/switch";
import { useTradeExecutionPopupPreference } from "@/lib/preferences";

export default function SettingsPage() {
  const { enabled, setEnabled, hydrated } = useTradeExecutionPopupPreference();
  const { theme, setTheme } = useTheme();
  // The stored theme is only readable on the client; avoid a hydration mismatch.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  return (
    <div className="space-y-4">
      <PageHeader
        title="설정"
        subtitle="화면 테마와 표시할 알림을 조절할 수 있어요"
        icon={<Settings2 aria-hidden="true" className="size-5 text-app-blue" />}
      />

      <Surface className="space-y-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-app-blue-light text-app-blue">
            <Moon aria-hidden="true" className="size-[18px]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-app-gray-900">화면 테마</h2>
            <p className="mt-1 text-[13px] leading-5 text-app-gray-500">
              시스템 설정을 따르거나 라이트·다크 모드를 고를 수 있어요
            </p>
          </div>
        </div>
        <Segmented
          value={mounted ? (theme ?? "system") : "system"}
          onChange={setTheme}
          options={[
            { value: "system", label: "시스템" },
            { value: "light", label: "라이트" },
            { value: "dark", label: "다크" },
          ]}
        />
      </Surface>

      <Surface>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-app-blue-light text-app-blue">
              <BellRing aria-hidden="true" className="size-[18px]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-app-gray-900">
                체결 완료 팝업
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-app-gray-500">
                시장가 주문이 체결되면 결과를 팝업으로 보여줘요. 예약 주문 등록 결과는 항상 보여드려요.
              </p>
            </div>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!hydrated}
            aria-label="주문 체결 완료 팝업 표시"
          />
        </div>
      </Surface>
    </div>
  );
}
