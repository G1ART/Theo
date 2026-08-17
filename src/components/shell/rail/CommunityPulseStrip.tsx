"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import { ROLE_OPTIONS } from "@/lib/supabase/artists";
import { usePersonaCounts } from "@/lib/hooks/usePersonaCounts";
import type { PersonaCounts } from "@/lib/supabase/personaCounts";

// Emerald ramp mirrored from `PersonaCommunityCard` so this compact
// strip and the full `/my/network` bar read as the same "community"
// gradient. Re-declared (not imported) because the source map is local
// to that component and not exported.
const ROLE_COLOR: Record<(typeof ROLE_OPTIONS)[number], string> = {
  artist: "bg-emerald-700",
  curator: "bg-emerald-600",
  gallerist: "bg-emerald-500",
  collector: "bg-emerald-400",
};

/**
 * Right-rail "community pulse" strip — sits at the top of the
 * "My Connection" card in the main feed. Reuses the same live
 * persona-count stream (`usePersonaCounts`) that powers `/my/network`
 * and links there to drive click-through.
 *
 * The trailing divider is owned here (not by the caller) so the empty
 * state can return a clean `null` without leaving a stray bordered gap
 * at the top of the card.
 */
export function CommunityPulseStrip() {
  const { t } = useT();
  const { counts, ready } = usePersonaCounts();

  const total =
    counts.artist + counts.curator + counts.gallerist + counts.collector;

  // Empty community — stay out of the rail entirely (no divider).
  if (ready && total === 0) return null;

  return (
    <div className="mb-3 border-b border-zinc-100 pb-3">
      {!ready ? (
        // Skeleton over null so the card top doesn't jump once counts
        // land; never flash a "0".
        <div className="px-2 py-1.5">
          <div className="h-1.5 w-full animate-pulse rounded-full bg-zinc-100" />
        </div>
      ) : (
        <Link
          href="/my/network"
          className="group block rounded-md px-2 py-1.5 hover:bg-zinc-50"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              {t("rail.community.title")}
            </span>
            <span className="text-xs font-semibold tabular-nums text-zinc-900">
              {t("rail.community.active").replace(
                "{count}",
                total.toLocaleString(),
              )}
            </span>
          </div>

          <div
            role="img"
            aria-label={buildA11yLabel(t("network.persona.a11yBar"), counts)}
            className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-100"
          >
            {ROLE_OPTIONS.map((role) => {
              const pct = (counts[role] / total) * 100;
              if (pct <= 0) return null;
              return (
                <span
                  key={role}
                  className={`h-full ${ROLE_COLOR[role]}`}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
          </div>

          <div className="mt-1.5 flex items-center justify-end gap-1 text-[11px] text-zinc-500 group-hover:text-zinc-900">
            {t("rail.community.cta")}
            <span aria-hidden>→</span>
          </div>
        </Link>
      )}
    </div>
  );
}

function buildA11yLabel(template: string, counts: PersonaCounts): string {
  return template
    .replace("{artist}", counts.artist.toLocaleString())
    .replace("{curator}", counts.curator.toLocaleString())
    .replace("{gallerist}", counts.gallerist.toLocaleString())
    .replace("{collector}", counts.collector.toLocaleString());
}
