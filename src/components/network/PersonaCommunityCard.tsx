"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { ROLE_OPTIONS } from "@/lib/supabase/artists";
import { usePersonaCounts } from "@/lib/hooks/usePersonaCounts";
import type { PersonaCounts } from "@/lib/supabase/personaCounts";

// Per-role palette. Kept in one place so the stacked bar segments and
// the legend dots stay in lock-step; if a segment gets a new colour,
// its legend swatch updates automatically.
//
// 2026-08-12 — Swapped from neutral zinc greys to a monochromatic
// emerald ramp so the bar reads as a single "community" gradient
// (living / active vibe) rather than four unrelated slabs. The live
// dot in the header header is already emerald; the bar now matches.
const ROLE_COLOR: Record<(typeof ROLE_OPTIONS)[number], string> = {
  artist: "bg-emerald-700",
  curator: "bg-emerald-600",
  gallerist: "bg-emerald-500",
  collector: "bg-emerald-400",
};

/**
 * Right-rail widget — "Theo 커뮤니티" (2026-08 network hub polish).
 *
 * Compact stacked bar + 4-persona legend, shown right under the
 * personal "네 네트워크" stats card on `/my/network`. Consumes the
 * same live persona-count stream that powers the `/people` sticky
 * pill (`usePersonaCounts`) so multi-persona members are counted
 * once per role and the numbers tick as members sign up.
 */
export function PersonaCommunityCard() {
  const { t } = useT();
  const { counts, ready } = usePersonaCounts();

  const total =
    counts.artist + counts.curator + counts.gallerist + counts.collector;
  const isEmpty = total === 0;

  const a11yLabel = buildA11yLabel(t("network.persona.a11yBar"), counts);

  return (
    <section aria-label={t("network.persona.title")}>
      <div className="rounded-lg border border-zinc-200 bg-white p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">
            {t("network.persona.title")}
          </h2>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {t("network.persona.live")}
          </span>
        </div>

        <div
          role="img"
          aria-label={a11yLabel}
          className="mb-3 flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100"
        >
          {isEmpty ? (
            <span
              className="h-full w-full bg-zinc-100"
              title={t("network.persona.empty")}
            />
          ) : (
            ROLE_OPTIONS.map((role) => {
              const pct = (counts[role] / total) * 100;
              if (pct <= 0) return null;
              return (
                <span
                  key={role}
                  className={`h-full ${ROLE_COLOR[role]}`}
                  style={{ width: `${pct}%` }}
                />
              );
            })
          )}
        </div>

        {isEmpty && (
          <p className="mb-2 text-[11px] text-zinc-400">
            {t("network.persona.empty")}
          </p>
        )}

        <ul className="grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-2">
          {ROLE_OPTIONS.map((role) => (
            <LegendRow
              key={role}
              color={ROLE_COLOR[role]}
              label={t(`people.role.${role}`)}
              value={counts[role]}
              animate={ready}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function LegendRow({
  color,
  label,
  value,
  animate,
}: {
  color: string;
  label: string;
  value: number;
  animate: boolean;
}) {
  const display = useCountUp(value, animate);
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span className="inline-flex min-w-0 items-center gap-2 text-zinc-600">
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${color}`}
        />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-semibold tabular-nums text-zinc-900">
        {display.toLocaleString()}
      </span>
    </li>
  );
}

function buildA11yLabel(template: string, counts: PersonaCounts): string {
  return template
    .replace("{artist}", counts.artist.toLocaleString())
    .replace("{curator}", counts.curator.toLocaleString())
    .replace("{gallerist}", counts.gallerist.toLocaleString())
    .replace("{collector}", counts.collector.toLocaleString());
}

/**
 * Animate an integer from its previous value to `target` (easeOutCubic).
 * Same shape as the sibling helper in `PersonaCountPanel.tsx`; kept
 * local because it is UI-specific presentation, not shared logic.
 */
function useCountUp(target: number, enabled: boolean, durationMs = 900): number {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    if (reduce || from === target) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, enabled, durationMs]);

  return display;
}
