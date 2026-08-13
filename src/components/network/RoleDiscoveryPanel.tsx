"use client";

/**
 * Role-first discovery — 2026-08-12 network Overview polish.
 *
 * Stacks four card groups (artist → collector → curator → gallerist)
 * under the "역할별 찾기" section heading. Each group is visually
 * identical to a `SuggestionsGroupedPanel` lane: header + 6 cards +
 * "전체 보기 →" link that opens the URL-driven discovery surface
 * (`/my/network?tab=discover&role={role}`).
 *
 * Data source: `get_people_by_role` (see the 20260812000000 migration).
 * Ranking mixes persona-pairing boost, mutual follows, and freshness so
 * each role card is populated with people the viewer will find most
 * relevant, not just latest-signup.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import { SuggestionCard } from "@/components/network/SuggestionsGroupedPanel";
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

const CARDS_PER_ROLE = 6;

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
        <span className="text-[11px] text-zinc-500">
          {t("connections.discovery.bestMatches")}
        </span>
      </header>

      {group.loading ? (
        <p className="px-5 py-6 text-sm text-zinc-500">…</p>
      ) : group.rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-zinc-500">
          {t("connections.discovery.empty")}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {group.rows.map((row) => (
            <SuggestionCard key={row.id} row={row} lane="role" />
          ))}
        </ul>
      )}

      <div className="border-t border-zinc-100 px-4 py-3 text-right">
        <Link
          href={browseHref}
          className="text-xs font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
        >
          {t("connections.discovery.browseAll")}
        </Link>
      </div>
    </section>
  );
}
