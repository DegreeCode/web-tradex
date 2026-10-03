"use client";

import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

/** ⓘ next to a label: opens on hover, and on tap for touch screens. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        aria-label={`${label} 설명`}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-app-gray-400 hover:text-app-gray-600 focus-visible:outline-2 focus-visible:outline-app-blue data-popup-open:text-app-blue"
      >
        <Info className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        {/* Above dialogs (z-50) so tips work inside the margin dialogs. */}
        <Popover.Positioner side="top" sideOffset={6} collisionPadding={16} className="z-[60]">
          <Popover.Popup className="max-w-[min(18rem,calc(100vw-2rem))] rounded-lg bg-app-gray-900 px-3 py-2 text-[12px] font-normal leading-relaxed text-white shadow-lg outline-none origin-(--transform-origin) duration-150 ease-out data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-100">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
