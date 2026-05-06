"use client";

import { useEffect, useRef, useState } from "react";
import type { RelationshipAudience } from "@/lib/visibility/types";
import { PUBLIC_AUDIENCE_PICKER_ORDER } from "@/lib/visibility/types";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";

type Props = {
  value: RelationshipAudience;
  onChange: (next: RelationshipAudience) => void;
  disabled?: boolean;
  /**
   * Optional aria-label for the trigger button when surrounding text
   * does not already disambiguate this pill (e.g. inside a per-row
   * matrix where each row has its own field label).
   */
  ariaLabel?: string;
  /** Smaller variant for inline use inside artwork rows. */
  size?: "sm" | "md";
};

export function VisibilityAudiencePill({
  value,
  onChange,
  disabled,
  ariaLabel,
  size = "md",
}: Props) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const padding = size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs";
  const triggerCls = [
    "inline-flex items-center gap-1.5 rounded-full font-medium transition-colors",
    padding,
    disabled
      ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
      : "bg-zinc-900 text-white hover:bg-zinc-800",
  ].join(" ");

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={triggerCls}
      >
        <span>{t(`visibility.audience.${value}` as MessageKey)}</span>
        <span aria-hidden className="text-[10px] opacity-70">▾</span>
      </button>
      {open && !disabled && (
        <div
          ref={popoverRef}
          role="listbox"
          className="absolute right-0 top-[calc(100%+6px)] z-30 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg"
        >
          {PUBLIC_AUDIENCE_PICKER_ORDER.map((opt) => {
            const isActive = opt === value;
            return (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={[
                  "flex w-full items-center justify-between px-3 py-2 text-left text-xs",
                  isActive
                    ? "bg-zinc-50 font-semibold text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-50",
                ].join(" ")}
              >
                <span>{t(`visibility.audience.${opt}` as MessageKey)}</span>
                {isActive && (
                  <span aria-hidden className="text-zinc-900">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
