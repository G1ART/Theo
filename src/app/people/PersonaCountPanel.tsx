"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useT } from "@/lib/i18n/useT";
import { FloorPanel } from "@/components/ds/FloorPanel";
import { SectionLabel } from "@/components/ds/SectionLabel";
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
 * Shows current per-persona headcount on entry (animating up from 0) and
 * ticks up in real time as new members sign up / change roles. Multi-persona
 * members count once per role (server-side `count_personas`).
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
    <FloorPanel padding="sm" className="mb-6">
      <SectionLabel className="mb-4">{t("people.counts.heading")}</SectionLabel>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ROLE_OPTIONS.map((role) => (
          <PersonaStat
            key={role}
            label={t(`people.role.${role}`)}
            value={counts[role]}
            animate={ready}
          />
        ))}
      </div>
    </FloorPanel>
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
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums text-zinc-900 sm:text-3xl">
        {display.toLocaleString()}
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">{label}</div>
    </div>
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
