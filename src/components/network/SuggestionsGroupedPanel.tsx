"use client";

/**
 * Sprint C.M / 2026-08-03 — grouped "People you might know" cards.
 *
 * Wireframe (Connections page, images 3 & 5) stacks multiple
 * "People you might know from XXX" card groups below the Invitations
 * card. Each group is a lane sourced by `get_people_recs`:
 *   • from mutual follows        (`follow_graph`)
 *   • from your liked artworks   (`likes_based`)
 *   • from your exhibition network (`expand`)
 *
 * Each card carries: avatar / name / @handle / recent role or bio /
 * mutual count / [X] dismiss / [+ Follow] action. Dismiss is a client-
 * only session hide — the persistent `people_dismiss` RPC stays for
 * future patches when we want the hide to stick server-side.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { FollowButton } from "@/components/FollowButton";
import {
  getPeopleRecs,
  type PeopleRec,
  type PeopleRecMode,
} from "@/lib/supabase/peopleRecs";
import { formatRoleChips } from "@/lib/identity/format";

type LaneKey = PeopleRecMode;

type Lane = {
  key: LaneKey;
  label: string;
  rows: PeopleRec[];
  loading: boolean;
};

const LANE_ORDER: LaneKey[] = ["follow_graph", "likes_based", "expand"];

const DISMISS_SESSION_KEY = "connections.suggestions.dismissed";

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(DISMISS_SESSION_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed))
      return new Set(parsed.filter((v) => typeof v === "string"));
  } catch {
    /* best-effort */
  }
  return new Set();
}

function writeDismissed(next: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      DISMISS_SESSION_KEY,
      JSON.stringify(Array.from(next)),
    );
  } catch {
    /* best-effort */
  }
}

function avatarSrc(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.startsWith("http")) return v;
  return getArtworkImageUrl(v, "avatar");
}

export function SuggestionsGroupedPanel() {
  const { t } = useT();
  const laneLabels: Record<LaneKey, string> = useMemo(
    () => ({
      follow_graph: t("connections.suggestions.laneFromMutuals"),
      likes_based: t("connections.suggestions.laneFromLikes"),
      expand: t("connections.suggestions.laneFromExhibitions"),
    }),
    [t],
  );

  const [lanes, setLanes] = useState<Record<LaneKey, Lane>>(() => ({
    follow_graph: {
      key: "follow_graph",
      label: laneLabels.follow_graph,
      rows: [],
      loading: true,
    },
    likes_based: {
      key: "likes_based",
      label: laneLabels.likes_based,
      rows: [],
      loading: true,
    },
    expand: {
      key: "expand",
      label: laneLabels.expand,
      rows: [],
      loading: true,
    },
  }));
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  useEffect(() => {
    let cancelled = false;
    LANE_ORDER.forEach((k) => {
      void (async () => {
        const res = await getPeopleRecs({ mode: k, limit: 6 });
        if (cancelled) return;
        setLanes((prev) => ({
          ...prev,
          [k]: { ...prev[k], rows: res.data ?? [], loading: false },
        }));
      })();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      writeDismissed(next);
      return next;
    });
  }, []);

  const laneRows = useMemo(
    () =>
      LANE_ORDER.map((k) => ({
        ...lanes[k],
        label: laneLabels[k],
        rows: lanes[k].rows.filter((r) => !dismissed.has(r.id)),
      })),
    [lanes, dismissed, laneLabels],
  );

  const hasAny = laneRows.some((l) => l.rows.length > 0 || l.loading);
  if (!hasAny) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-6 text-sm text-zinc-500">
        {t("connections.suggestions.empty")}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {laneRows.map((lane) => {
        if (!lane.loading && lane.rows.length === 0) return null;
        return (
          <section
            key={lane.key}
            className="rounded-2xl border border-zinc-200 bg-white"
          >
            <header className="border-b border-zinc-100 px-5 py-3">
              <h3 className="text-sm font-semibold text-zinc-900">
                {t("connections.suggestions.title")}{" "}
                <span className="text-zinc-500">— {lane.label}</span>
              </h3>
            </header>
            {lane.loading ? (
              <p className="px-5 py-6 text-sm text-zinc-500">…</p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                {lane.rows.map((row) => (
                  <SuggestionCard
                    key={row.id}
                    row={row}
                    onDismiss={() => handleDismiss(row.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SuggestionCard({
  row,
  onDismiss,
}: {
  row: PeopleRec;
  onDismiss: () => void;
}) {
  const { t } = useT();
  const name = row.display_name ?? row.username ?? "—";
  const src = avatarSrc(row.avatar_url);
  const roleChips = formatRoleChips(
    {
      main_role: row.main_role ?? null,
      roles: (row.roles ?? []) as string[],
    },
    t,
    { max: 1 },
  );
  const roleLabel = roleChips[0]?.label ?? null;
  const mutualCount = row.mutual_follow_sources ?? row.signal_count ?? 0;

  return (
    <li className="relative flex flex-col rounded-xl border border-zinc-200 bg-white p-3">
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("connections.suggestions.dismiss")}
        className="absolute right-2 top-2 rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
      </button>
      <Link
        href={row.username ? `/u/${row.username}` : "#"}
        className="flex items-start gap-3"
      >
        <span className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-zinc-100">
          {src ? (
            <Image
              src={src}
              alt=""
              width={44}
              height={44}
              className="h-full w-full object-cover"
              unoptimized
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-sm font-medium text-zinc-500">
              {name.charAt(0).toUpperCase()}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1 pr-6">
          <p className="truncate text-sm font-medium text-zinc-900">{name}</p>
          {row.username && (
            <p className="truncate text-xs text-zinc-500">@{row.username}</p>
          )}
        </div>
      </Link>
      <div className="mt-2 space-y-0.5 text-xs text-zinc-500">
        {roleLabel && <p className="truncate">{roleLabel}</p>}
        {mutualCount > 0 && (
          <p className="truncate">
            {t("connections.suggestions.mutual").replace(
              "{count}",
              String(mutualCount),
            )}
          </p>
        )}
      </div>
      <div className="mt-3 [&_button]:w-full">
        <FollowButton
          targetProfileId={row.id}
          initialFollowing={false}
          size="sm"
        />
      </div>
    </li>
  );
}
