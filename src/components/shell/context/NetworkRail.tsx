"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { supabase } from "@/lib/supabase/client";
import { getMyStats } from "@/lib/supabase/me";
import { listAccessRequestsForMe } from "@/lib/supabase/relationshipAccess";

/**
 * Network hub context rail.
 *
 * Summary counts (followers / following / pending access requests) with
 * one-click links to the matching tab. Kept read-only and self-fetching
 * so it does not couple to the main column's tab state — the page
 * remains the source of truth for the active view.
 */
export function NetworkRail() {
  const { t } = useT();
  const [followers, setFollowers] = useState<number | null>(null);
  const [following, setFollowing] = useState<number | null>(null);
  const [pendingRequests, setPendingRequests] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) return;

      const [statsRes, reqRes] = await Promise.all([
        getMyStats(),
        listAccessRequestsForMe({
          ownerProfileId: session.user.id,
          status: "pending",
          limit: 100,
        }),
      ]);
      if (cancelled) return;
      if (statsRes.data) {
        setFollowers(statsRes.data.followersCount);
        setFollowing(statsRes.data.followingCount);
      }
      if (!reqRes.error) setPendingRequests(reqRes.data.length);
    }

    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const rows: Array<{ label: string; value: number | null; href: string; badge?: boolean }> = [
    {
      label: t("network.tabs.followers"),
      value: followers,
      href: "/my/network?tab=followers",
    },
    {
      label: t("network.tabs.following"),
      value: following,
      href: "/my/network?tab=following",
    },
    {
      label: t("network.tabs.requests"),
      value: pendingRequests,
      href: "/my/network?tab=requests",
      badge: !!pendingRequests && pendingRequests > 0,
    },
  ];

  return (
    <div className="flex flex-col gap-6 py-8 pl-2">
      <section aria-label={t("rail.network.heading")}>
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          {t("rail.network.heading")}
        </h2>
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
          {rows.map((row) => (
            <li key={row.href}>
              <Link
                href={row.href}
                className="flex items-center justify-between px-3 py-2.5 hover:bg-zinc-50"
              >
                <span className="inline-flex items-center gap-2 text-sm text-zinc-600">
                  {row.label}
                  {row.badge && (
                    <span
                      aria-hidden
                      className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                    />
                  )}
                </span>
                <span className="text-sm font-semibold tabular-nums text-zinc-900">
                  {row.value == null ? "—" : row.value.toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t("rail.network.tipHeading")}>
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <p className="text-xs leading-relaxed text-zinc-500">
            {t("rail.network.tip")}
          </p>
          <Link
            href="/my/network?tab=relationships"
            className="mt-3 inline-flex items-center text-xs font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
          >
            {t("rail.network.openDesk")} →
          </Link>
        </div>
      </section>
    </div>
  );
}
