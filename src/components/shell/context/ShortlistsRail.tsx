"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { listMyShortlists } from "@/lib/supabase/shortlists";

/**
 * Shortlists / rooms context rail.
 *
 * Passive summary: total rooms + private/shared split, plus a light
 * tip about what a room is used for. The create form stays in the
 * main column because it's the primary conversion for this surface.
 */
export function ShortlistsRail() {
  const { t } = useT();
  const [total, setTotal] = useState<number | null>(null);
  const [privateCount, setPrivateCount] = useState<number | null>(null);
  const [sharedCount, setSharedCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void listMyShortlists().then(({ data, error }) => {
        if (cancelled || error) return;
        setTotal(data.length);
        setPrivateCount(data.filter((r) => r.is_private).length);
        setSharedCount(data.filter((r) => !r.is_private).length);
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

  return (
    <div className="flex flex-col gap-6 py-8 pl-2">
      <section aria-label={t("rail.shortlists.heading")}>
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          {t("rail.shortlists.heading")}
        </h2>
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
          <RailStat label={t("rail.shortlists.total")} value={total} />
          <RailStat label={t("rail.shortlists.shared")} value={sharedCount} />
          <RailStat label={t("rail.shortlists.private")} value={privateCount} />
        </ul>
      </section>

      <section aria-label={t("rail.shortlists.tipHeading")}>
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <p className="text-xs leading-relaxed text-zinc-500">
            {t("rail.shortlists.tip")}
          </p>
          <Link
            href="/my/network?tab=relationships"
            className="mt-3 inline-flex items-center text-xs font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
          >
            {t("rail.shortlists.openRelationships")} →
          </Link>
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
