"use client";

import { BellRing, Moon, Settings2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { Surface } from "@/components/primitives";
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
      <div>
        <div className="flex items-center gap-2">
          <Settings2 className="size-5 text-app-blue" />
          <h1 className="text-[24px] font-extrabold tracking-[-0.03em] text-app-gray-900">
            설정
          </h1>
        </div>
        <p className="mt-1 text-[13px] text-app-gray-500">
          화면 테마와 표시할 알림을 조절할 수 있어요
        </p>
      </div>

      <Surface className="space-y-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-app-blue-light text-app-blue">
            <Moon className="size-[18px]" />
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
              <BellRing className="size-[18px]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-app-gray-900">
                체결 완료 팝업
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-app-gray-500">
                주문이 체결됐어요 팝업을 표시해요
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
