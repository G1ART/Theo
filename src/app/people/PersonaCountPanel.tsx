"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useT } from "@/lib/i18n/useT";
import { supabase } from "@/lib/supabase/client";
import { ROLE_OPTIONS } from "@/lib/supabase/artists";
import { getPersonaCounts, type PersonaCounts } from "@/lib/supabase/personaCounts";

// Poll fallback in case the realtime channel is dropped or the table is not
// broadcasting for a given client. Cheap at our scale; realtime is primary.
const POLL_MS = 60_000;
// Coalesce bursts of profile changes into a single refetch.
const REFETCH_DEBOUNCE_MS = 700;

const EMPTY: PersonaCounts = { artist: 0, curator: 0, gallerist: 0, collector: 0 };

/**
 * Live persona-slot counter for the People page.
 *
 * Kept intentionally small — People's job is connection, so this is a slim
 * sticky bar (sits just under the global header, persists on scroll) rather
 * than a large hero panel. Counts animate up on entry and tick in real time
 * as members sign up / change roles. Multi-persona members count once per
 * role (server-side `count_personas`).
 */
export function PersonaCountPanel() {
  const { t } = useT();
  const [counts, setCounts] = useState<PersonaCounts>(EMPTY);
  const [ready, setReady] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refetch() {
      const { data, error } = await getPersonaCounts();
      if (cancelled || error) return;
      setCounts(data);
      setReady(true);
    }

    function scheduleRefetch() {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        void refetch();
      }, REFETCH_DEBOUNCE_MS);
    }

    void refetch();

    // Primary: realtime on new signups / role edits.
    const channel: RealtimeChannel = supabase
      .channel("persona-counts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => scheduleRefetch(),
      )
      .subscribe();

    // Fallbacks: periodic poll + refresh when the tab regains focus.
    const poll = window.setInterval(() => void refetch(), POLL_MS);
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="sticky top-14 z-30 -mx-1 mb-6 pt-2">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-full border border-zinc-200 bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur">
        <span className="mr-1 inline-flex items-center gap-1.5 pl-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          {t("people.counts.heading")}
        </span>
        {ROLE_OPTIONS.map((role, i) => (
          <span key={role} className="inline-flex items-center">
            {i > 0 && <span aria-hidden className="mx-1 text-zinc-200">·</span>}
            <PersonaStat
              label={t(`people.role.${role}`)}
              value={counts[role]}
              animate={ready}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

function PersonaStat({
  label,
  value,
  animate,
}: {
  label: string;
  value: number;
  animate: boolean;
}) {
  const display = useCountUp(value, animate);
  return (
    <span className="inline-flex items-baseline gap-1 px-1">
      <span className="text-sm font-semibold tabular-nums text-zinc-900">
        {display.toLocaleString()}
      </span>
      <span className="text-xs text-zinc-500">{label}</span>
    </span>
  );
}

/**
 * Animate an integer from its previous value to `target` (easeOutCubic).
 * Honours `prefers-reduced-motion` and skips animating until `enabled`
 * so the number doesn't flash before the first real fetch lands.
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
