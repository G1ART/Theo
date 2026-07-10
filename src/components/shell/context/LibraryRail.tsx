"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { getMyStats, type MyStats } from "@/lib/supabase/me";

/**
 * Library context rail.
 *
 * Small summary (total / public / draft counts) + import/export/upload
 * quick links. The interactive filter panel stays in the main column
 * because it needs to drive the grid — this rail is passive glance data.
 */
export function LibraryRail() {
  const { t } = useT();
  const [stats, setStats] = useState<MyStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void getMyStats().then(({ data, error }) => {
        if (!cancelled && !error && data) setStats(data);
      });
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const total = stats?.artworksCount ?? null;
  const publicCount = stats?.postsCount ?? null;
  const draftCount =
    stats != null ? Math.max(0, stats.artworksCount - stats.postsCount) : null;

  return (
    <div className="flex flex-col gap-6 py-8 pl-2">
      <section aria-label={t("rail.library.heading")}>
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          {t("rail.library.heading")}
        </h2>
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
          <RailStat label={t("rail.library.total")} value={total} />
          <RailStat label={t("rail.library.public")} value={publicCount} />
          <RailStat label={t("rail.library.draft")} value={draftCount} />
        </ul>
      </section>

      <section aria-label={t("rail.library.actionsHeading")}>
        <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          {t("rail.library.actionsHeading")}
        </h2>
        <div className="flex flex-col gap-2">
          <Link
            href="/upload"
            className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
          >
            {t("rail.library.upload")}
          </Link>
          <Link
            href="/my/library/import"
            className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {t("rail.library.import")}
          </Link>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            {t("rail.library.tip")}
          </p>
        </div>
      </section>
    </div>
  );
}

function RailStat({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <li className="flex items-baseline justify-between px-3 py-2.5">
      <span className="text-sm text-zinc-600">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-zinc-900">
        {value == null ? "—" : value.toLocaleString()}
      </span>
    </li>
  );
}
