"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { ROLE_OPTIONS } from "@/lib/supabase/artists";
import {
  getPersonaCounts,
  type PersonaCounts,
} from "@/lib/supabase/personaCounts";

/**
 * People-page context rail (right side of the 3-column shell).
 *
 * Kept intentionally small and non-interactive:
 *   - Live persona-slot counts (mirrors PersonaCountPanel — see also the
 *     mobile sticky bar which stays visible on <lg screens).
 *   - "Invite" CTA (deep-links to /people/invite).
 *   - One-sentence guide, so the panel earns its column without hijacking
 *     the primary connection surface.
 *
 * Self-fetching + light polling — deliberately does not share state with
 * PersonaCountPanel so the two can render independently without coupling.
 * Realtime is handled by the main-column panel; this one just polls on
 * focus to catch changes when the user returns to the tab.
 */
const EMPTY: PersonaCounts = { artist: 0, curator: 0, gallerist: 0, collector: 0 };

export function PeopleRail() {
  const { t } = useT();
  const [counts, setCounts] = useState<PersonaCounts>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void getPersonaCounts().then(({ data, error }) => {
        if (!cancelled && !error) setCounts(data);
      });
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const poll = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(poll);
    };
  }, []);

  return (
    <div className="flex flex-col gap-6 py-8 pl-2">
      <section aria-label={t("rail.people.heading")}>
        <div className="mb-3 flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            {t("rail.people.heading")}
          </h2>
        </div>
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
          {ROLE_OPTIONS.map((role) => (
            <li
              key={role}
              className="flex items-baseline justify-between px-3 py-2.5"
            >
              <span className="text-sm text-zinc-600">
                {t(`people.role.${role}`)}
              </span>
              <span className="text-sm font-semibold tabular-nums text-zinc-900">
                {counts[role].toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t("rail.people.inviteHeading")}>
        <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          {t("rail.people.inviteHeading")}
        </h2>
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <p className="text-xs leading-relaxed text-zinc-500">
            {t("rail.people.inviteHint")}
          </p>
          <Link
            href="/people/invite"
            className="mt-3 inline-flex items-center justify-center rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
          >
            {t("rail.people.inviteCta")}
          </Link>
        </div>
      </section>
    </div>
  );
}
