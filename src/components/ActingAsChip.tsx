"use client";

import { useEffect, useState } from "react";
import { useActingAs } from "@/context/ActingAsContext";
import { useT } from "@/lib/i18n/useT";
import { formatDisplayName } from "@/lib/identity/format";
import { getMyProfile } from "@/lib/supabase/profiles";

type ChipMode = "posting" | "editing" | "replying";

type Props = {
  /** Choose the verb tense / connotation. Defaults to "editing". */
  mode?: ChipMode;
  /** Optional className passthrough for tight spacing on dense forms. */
  className?: string;
};

/**
 * Per-form persona affordance. When acting-as is *active*, this chip
 * surfaces a clear "X 명의로 게시·편집 중 · 운영자: Y" line at the top
 * of every mutation entry point so the user is never confused about
 * whose data the next save will land on. When acting-as is inactive,
 * the component renders nothing — solo flows are completely
 * untouched (zero regression risk for non-delegate users).
 *
 * Why a separate component rather than inlining the banner everywhere
 *   - The Header banner is global; we still want a *local* affordance
 *     anchored to the form so the user notices it at the moment of
 *     mutation, not just when they enter the page.
 *   - Tour anchor (`data-tour="acting-as-chip"`) lets the delegation
 *     tour walk the user through the affordance once.
 */
export function ActingAsChip({ mode = "editing", className }: Props) {
  const { actingAsProfileId, actingAsLabel } = useActingAs();
  const { t, locale } = useT();
  const [operatorLabel, setOperatorLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!actingAsProfileId) {
      setOperatorLabel(null);
      return;
    }
    let cancelled = false;
    void getMyProfile().then(({ data }) => {
      if (cancelled) return;
      const p = data as {
        display_name?: string | null;
        display_name_ko?: string | null;
        display_name_en?: string | null;
        username?: string | null;
      } | null;
      if (!p) {
        setOperatorLabel(null);
        return;
      }
      const dn = formatDisplayName(p, t, locale);
      setOperatorLabel(dn || p.username || null);
    });
    return () => {
      cancelled = true;
    };
  }, [actingAsProfileId, t, locale]);

  if (!actingAsProfileId) return null;

  const principal = actingAsLabel ?? t("acting.chip.principalFallback");
  const operator = operatorLabel ?? t("acting.chip.operatorFallback");
  const key =
    mode === "posting"
      ? "acting.chip.posting"
      : mode === "replying"
        ? "acting.chip.replying"
        : "acting.chip.editing";
  const text = t(key).replace("{principal}", principal).replace("{operator}", operator);

  const base =
    "flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900";
  return (
    <aside
      role="status"
      aria-live="polite"
      data-tour="acting-as-chip"
      className={className ? `${base} ${className}` : `${base} mb-4`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
      />
      <span className="truncate">{text}</span>
    </aside>
  );
}
