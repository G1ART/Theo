"use client";

import { useT } from "@/lib/i18n/useT";

/**
 * QA 2026-07-29 — subtle "not yet on Theo" badge shown next to an external
 * (invited, not-yet-onboarded) artist's name. Two sizes:
 *   - `compact` (default false → full pill) for section headers / detail
 *     surfaces with room to breathe.
 *   - `compact=true` renders just the sprout glyph with a title/aria-label
 *     tooltip — used inside tight overlay chips (explore grid card) where
 *     a full pill would overflow the available width.
 */
export function UnonboardedBadge({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { t } = useT();
  const fullLabel = t("artist.unonboarded.badge");
  if (compact) {
    return (
      <span
        role="img"
        aria-label={fullLabel}
        title={fullLabel}
        className={`shrink-0 select-none ${className ?? ""}`}
      >
        🌱
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ${
        className ?? ""
      }`}
      title={fullLabel}
    >
      🌱 {t("artist.unonboarded.badgeShort")}
    </span>
  );
}
