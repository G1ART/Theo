"use client";

/**
 * TourHelpButton — small, subtle manual reopen affordance.
 *
 * Designed to sit near a page title without stealing attention. Uses a
 * question-mark glyph plus the localized label so screen readers and
 * visually oriented users both have a clear entry point.
 */

import { hitTarget } from "@/components/ds/buttonStyles";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import { useT } from "@/lib/i18n/useT";
import { TOUR_KO_CHROME, TOUR_POPOVER_FONT_FAMILY } from "@/lib/tours/tourKoCopy";
import { useTourController } from "./TourProvider";

type Props = {
  tourId: string;
  /**
   * Optional label override i18n key. Defaults to `tour.reopen` ("가이드 보기").
   */
  labelKey?: string;
  /** Visual variant; `ghost` blends in more, `subtle` has a soft pill. */
  variant?: "ghost" | "subtle";
  className?: string;
};

export function TourHelpButton({ tourId, labelKey = "tour.reopen", variant = "subtle", className }: Props) {
  const { t, locale } = useT();
  const label = locale === "ko" ? TOUR_KO_CHROME.reopen : t(labelKey);
  const { startTour, isActive, activeTourId } = useTourController();

  const busy = isActive && activeTourId === tourId;

  const baseClass =
    variant === "ghost"
      ? `inline-flex max-w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-900 ${hitTarget}`
      : `inline-flex max-w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-200 bg-white/70 px-3.5 py-2 text-[11px] font-medium text-zinc-600 shadow-sm hover:border-zinc-300 hover:bg-white hover:text-zinc-900 ${hitTarget}`;

  return (
    <button
      type="button"
      style={{ fontFamily: TOUR_POPOVER_FONT_FAMILY }}
      onClick={() => {
        if (busy) return;
        logBetaEventSync("tour_reopened", { tourId });
        startTour(tourId);
      }}
      className={`${baseClass} ${className ?? ""}`.trim()}
      aria-label={label}
      disabled={busy}
    >
      <svg className="shrink-0" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M6 6.2c.2-1 1-1.7 2-1.7 1.2 0 2 .8 2 1.8 0 1.1-1 1.3-1.6 1.8-.4.3-.4.6-.4.9"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <circle cx="8" cy="11.2" r="0.7" fill="currentColor" />
      </svg>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
