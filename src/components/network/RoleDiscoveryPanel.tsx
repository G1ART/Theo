"use client";

/**
 * Role-first discovery — 2026-08-12 network Overview polish.
 * 2026-08-13 — Refactored to horizontal-carousel-per-role layout to
 * visually differentiate this "browse-wide" surface from the
 * "signal-deep" `SuggestionsGroupedPanel` vertical-stack lanes above.
 * Benchmark: LinkedIn "Companies to follow" / Instagram "Explore People"
 * / Behance category rows — a scroller with chevron ◀▶ controls and a
 * soft loop (scrollTo(0)) on wrap.
 *
 * Data source: `get_people_by_role` (see the 20260812000000 migration).
 * Ranking mixes persona-pairing boost, mutual follows, and freshness so
 * each role row is populated with people the viewer will find most
 * relevant, not just latest-signup.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import { SuggestionCardCompact } from "@/components/network/SuggestionsGroupedPanel";
import {
  ROLE_DISCOVERY_ORDER,
  getPeopleByRole,
  type RoleDiscoveryKey,
} from "@/lib/supabase/peopleByRole";
import type { PeopleRec } from "@/lib/supabase/peopleRecs";

type GroupState = {
  key: RoleDiscoveryKey;
  rows: PeopleRec[];
  loading: boolean;
};

// Carousel absorbs more cards than the old 6-card grid without visual weight.
const CARDS_PER_ROLE = 8;

// Compact card width + gap; keep in sync with `SuggestionCardCompact`
// (`w-[176px]`) and the scroller (`gap-3` = 12px). Used to compute the
// "scroll 2 cards at a time" step, matching LinkedIn's carousel cadence.
const CARD_WIDTH = 176;
const CARD_GAP = 12;
const SCROLL_STEP = (CARD_WIDTH + CARD_GAP) * 2;

export function RoleDiscoveryPanel() {
  const { t } = useT();

  const [groups, setGroups] = useState<Record<RoleDiscoveryKey, GroupState>>(
    () =>
      ROLE_DISCOVERY_ORDER.reduce(
        (acc, k) => {
          acc[k] = { key: k, rows: [], loading: true };
          return acc;
        },
        {} as Record<RoleDiscoveryKey, GroupState>,
      ),
  );

  useEffect(() => {
    let cancelled = false;
    ROLE_DISCOVERY_ORDER.forEach((role) => {
      void (async () => {
        const res = await getPeopleByRole({ role, limit: CARDS_PER_ROLE });
        if (cancelled) return;
        setGroups((prev) => ({
          ...prev,
          [role]: {
            ...prev[role],
            rows: res.data ?? [],
            loading: false,
          },
        }));
      })();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const orderedGroups = useMemo(
    () => ROLE_DISCOVERY_ORDER.map((r) => groups[r]),
    [groups],
  );

  return (
    <section aria-labelledby="role-discovery-heading" className="space-y-4">
      <h2
        id="role-discovery-heading"
        className="px-1 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500"
      >
        {t("connections.discovery.sectionHeading")}
      </h2>

      {orderedGroups.map((group) => (
        <RoleGroupCard key={group.key} group={group} />
      ))}
    </section>
  );
}

function RoleGroupCard({ group }: { group: GroupState }) {
  const { t } = useT();
  const roleLabel = t(`people.role.${group.key}`);
  const browseHref = `/my/network?tab=discover&role=${group.key}`;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">{roleLabel}</h3>
        <Link
          href={browseHref}
          className="text-xs font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
        >
          {t("connections.discovery.browseAll")}
        </Link>
      </header>

      {group.loading ? (
        <p className="px-5 py-6 text-sm text-zinc-500">…</p>
      ) : group.rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-zinc-500">
          {t("connections.discovery.empty")}
        </p>
      ) : (
        <RoleCarousel rows={group.rows} />
      )}
    </section>
  );
}

function RoleCarousel({ rows }: { rows: PeopleRec[] }) {
  const { t } = useT();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [edges, setEdges] = useState<{ atStart: boolean; atEnd: boolean }>({
    atStart: true,
    atEnd: false,
  });

  const readEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 0;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setEdges((prev) =>
      prev.atStart === atStart && prev.atEnd === atEnd
        ? prev
        : { atStart, atEnd },
    );
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    readEdges();

    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        readEdges();
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", readEdges);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", readEdges);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [readEdges, rows.length]);

  const handlePrev = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (el.scrollLeft <= 0) {
      // Soft-loop wrap to end (chevron is hidden at start by default, so
      // this branch is only reachable if the caller invokes it via
      // keyboard focus; kept for symmetry with next-chevron wrap).
      el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
      return;
    }
    el.scrollBy({ left: -SCROLL_STEP, behavior: "smooth" });
  }, []);

  const handleNext = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 4) {
      // Soft loop back to the start — spec explicitly asks scrollTo(0)
      // over a duplicated-DOM infinite scroll.
      el.scrollTo({ left: 0, behavior: "smooth" });
      return;
    }
    el.scrollBy({ left: SCROLL_STEP, behavior: "smooth" });
  }, []);

  const nextLabel = edges.atEnd
    ? t("connections.discovery.carouselWrapStart")
    : t("connections.discovery.carouselNext");
  const prevLabel = edges.atStart
    ? t("connections.discovery.carouselWrapEnd")
    : t("connections.discovery.carouselPrev");

  return (
    <div className="relative">
      {!edges.atStart && (
        <button
          type="button"
          onClick={handlePrev}
          aria-label={prevLabel}
          className="absolute left-2 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white/95 text-zinc-700 shadow-sm hover:bg-white hover:text-zinc-900 md:flex"
        >
          <ChevronIcon direction="left" />
        </button>
      )}
      <button
        type="button"
        onClick={handleNext}
        aria-label={nextLabel}
        className="absolute right-2 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white/95 text-zinc-700 shadow-sm hover:bg-white hover:text-zinc-900 md:flex"
      >
        <ChevronIcon direction="right" />
      </button>
      <div
        ref={scrollerRef}
        className="snap-x snap-mandatory scroll-smooth overflow-x-auto px-4 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex gap-3">
          {rows.map((row) => (
            <SuggestionCardCompact key={row.id} row={row} lane="role" />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === "left" ? (
        <polyline points="10 3 5 8 10 13" />
      ) : (
        <polyline points="6 3 11 8 6 13" />
      )}
    </svg>
  );
}
