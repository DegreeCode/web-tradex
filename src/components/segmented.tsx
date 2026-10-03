"use client";

import { cn } from "cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  tone?: "default" | "buy" | "sell";
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-1 rounded-xl bg-app-gray-100 p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "min-h-9 min-w-0 rounded-sm px-1 py-2 text-[12px] leading-tight font-semibold whitespace-normal break-words focus-visible:outline-2 focus-visible:outline-app-blue sm:px-2 sm:text-[14px]",
              active
                ? "bg-card shadow-raised dark:bg-app-gray-300"
                : "text-app-gray-500 hover:text-app-gray-700",
              active && option.tone === "buy" && "text-app-red",
              active && option.tone === "sell" && "text-app-blue",
              active && (!option.tone || option.tone === "default") && "text-app-gray-900",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
