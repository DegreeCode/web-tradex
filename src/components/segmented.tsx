"use client";

import { useLayoutEffect, useRef } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const optionKey = options.map((option) => option.value).join("|");

  // The highlight slides to the selected button. It is measured rather than
  // computed from the index because callers may wrap the options onto rows.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;
    let frame = 0;
    const place = () => {
      const active = container.querySelector<HTMLElement>(':scope > button[aria-pressed="true"]');
      indicator.style.opacity = active ? "1" : "0";
      // Hidden (display: none) controls measure 0; wait until they are shown.
      if (!active || active.offsetWidth === 0) return;
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.height = `${active.offsetHeight}px`;
      indicator.style.translate = `${active.offsetLeft}px ${active.offsetTop}px`;
      // The first placement lands without sliding in from the corner.
      if (!("placed" in indicator.dataset)) {
        frame = requestAnimationFrame(() => indicator.setAttribute("data-placed", ""));
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [value, optionKey]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative grid gap-1 rounded-xl bg-app-gray-100 p-1",
        // Until the highlight is placed (before hydration), the button paints its own.
        "[&:not(:has(>[data-placed]))>[aria-pressed=true]]:bg-card [&:not(:has(>[data-placed]))>[aria-pressed=true]]:shadow-raised dark:[&:not(:has(>[data-placed]))>[aria-pressed=true]]:bg-app-gray-300",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        ref={indicatorRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 rounded-sm bg-card opacity-0 shadow-raised data-placed:transition-[translate,width,height] data-placed:duration-250 data-placed:ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none dark:bg-app-gray-300"
      />
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "relative min-h-9 min-w-0 rounded-sm px-1 py-2 text-[12px] leading-tight font-semibold whitespace-normal break-words focus-visible:outline-2 focus-visible:outline-app-blue sm:px-2 sm:text-[14px]",
              active ? null : "text-app-gray-500 hover:text-app-gray-700",
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
