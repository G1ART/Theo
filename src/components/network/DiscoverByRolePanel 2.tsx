"use client";

/**
 * Full-width "Browse by role" surface — reached via
 * `/my/network?tab=discover&role={artist|collector|curator|gallerist}`.
 *
 * URL-only entry point: no sidebar tile, no tab in the strip. Entered
 * from the "전체 보기 →" links under each `RoleDiscoveryPanel` group.
 * Paginated with a "24 more" pager against `get_people_by_role`.
 */

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { SuggestionCard } from "@/components/network/SuggestionsGroupedPanel";
import {
  getPeopleByRole,
  type RoleDiscoveryKey,
} from "@/lib/supabase/peopleByRole";
import type { PeopleRec } from "@/lib/supabase/peopleRecs";

const PAGE_SIZE = 24;

export function DiscoverByRolePanel({ role }: { role: RoleDiscoveryKey }) {
  const { t } = useT();
  const [rows, setRows] = useState<PeopleRec[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows([]);
    setOffset(0);
    setHasMore(false);
    setLoading(true);
    void (async () => {
      const res = await getPeopleByRole({ role, limit: PAGE_SIZE, offset: 0 });
      if (cancelled) return;
      const data = res.data ?? [];
      setRows(data);
      setOffset(data.length);
      setHasMore(data.length >= PAGE_SIZE);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const res = await getPeopleByRole({
      role,
      limit: PAGE_SIZE,
      offset,
    });
    const nextRows = res.data ?? [];
    setRows((prev) => [...prev, ...nextRows]);
    setOffset((prev) => prev + nextRows.length);
    setHasMore(nextRows.length >= PAGE_SIZE);
    setLoadingMore(false);
  }, [role, offset, loadingMore, hasMore]);

  const roleLabel = t(`people.role.${role}`);

  return (
    <section
      aria-labelledby="discover-role-heading"
      className="space-y-4"
      data-tour="network-discover"
    >
      <header className="rounded-2xl border border-zinc-200 bg-white px-5 py-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          {t("connections.discovery.sectionHeading")}
        </p>
        <h2
          id="discover-role-heading"
          className="mt-1 text-lg font-semibold text-zinc-900"
        >
          {roleLabel}
        </h2>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white">
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">…</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">
            {t("connections.discovery.empty")}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <SuggestionCard key={row.id} row={row} lane="role" />
            ))}
          </ul>
        )}

        {hasMore && !loading && (
          <div className="border-t border-zinc-100 px-4 py-3 text-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-50"
            >
              {loadingMore ? "…" : t("connections.discovery.loadMore")}
            </button>
          </div>
        )}
      </section>
    </section>
  );
}
