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
 *
 * 2026-08-12 — Overview polish:
 *   • Lane headers are now short, opinionated phrases ("친구의 친구",
 *     "취향이 통해요", "전시에서 마주쳐요") instead of the redundant
 *     "알 수도 있는 사람 — X 기반" compound. The parent phrase moved
 *     to a single group heading above the three lanes.
 *   • Each card renders a "왜 추천하는지" one-liner just below the
 *     role chip, priority-ranked from the strongest available signal.
 *   • Each lane exposes a "더 보기" pager that fetches +12 rows on
 *     each click (6 → 18 → 30, capped at 60).
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
import { formatDisplayName, formatRoleChips } from "@/lib/identity/format";

type LaneKey = PeopleRecMode;

type Lane = {
  key: LaneKey;
  label: string;
  rows: PeopleRec[];
  loading: boolean;
  limit: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreClicked: boolean;
};

const LANE_ORDER: LaneKey[] = ["follow_graph", "likes_based", "expand"];
const LANE_INITIAL_LIMIT = 6;
const LANE_LIMIT_STEP = 12;
const LANE_LIMIT_CAP = 60;

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

function makeInitialLane(key: LaneKey, label: string): Lane {
  return {
    key,
    label,
    rows: [],
    loading: true,
    limit: LANE_INITIAL_LIMIT,
    hasMore: false,
    loadingMore: false,
    loadMoreClicked: false,
  };
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
    follow_graph: makeInitialLane("follow_graph", laneLabels.follow_graph),
    likes_based: makeInitialLane("likes_based", laneLabels.likes_based),
    expand: makeInitialLane("expand", laneLabels.expand),
  }));
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  useEffect(() => {
    let cancelled = false;
    LANE_ORDER.forEach((k) => {
      void (async () => {
        const res = await getPeopleRecs({ mode: k, limit: LANE_INITIAL_LIMIT });
        if (cancelled) return;
        setLanes((prev) => ({
          ...prev,
          [k]: {
            ...prev[k],
            rows: res.data ?? [],
            loading: false,
            hasMore: (res.data?.length ?? 0) >= LANE_INITIAL_LIMIT,
          },
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

  const handleLoadMore = useCallback((k: LaneKey) => {
    setLanes((prev) => {
      const lane = prev[k];
      if (lane.loadingMore || !lane.hasMore) return prev;
      return {
        ...prev,
        [k]: { ...lane, loadingMore: true, loadMoreClicked: true },
      };
    });
    void (async () => {
      // Compute next limit off the latest snapshot so parallel clicks
      // don't race past the cap.
      let nextLimit = LANE_INITIAL_LIMIT;
      setLanes((prev) => {
        nextLimit = Math.min(prev[k].limit + LANE_LIMIT_STEP, LANE_LIMIT_CAP);
        return prev;
      });
      const res = await getPeopleRecs({ mode: k, limit: nextLimit });
      setLanes((prev) => ({
        ...prev,
        [k]: {
          ...prev[k],
          rows: res.data ?? prev[k].rows,
          limit: nextLimit,
          hasMore:
            (res.data?.length ?? 0) >= nextLimit && nextLimit < LANE_LIMIT_CAP,
          loadingMore: false,
        },
      }));
    })();
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
      <h2 className="px-1 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        {t("connections.suggestions.groupHeading")}
      </h2>
      {laneRows.map((lane) => {
        if (!lane.loading && lane.rows.length === 0) return null;
        return (
          <section
            key={lane.key}
            className="rounded-2xl border border-zinc-200 bg-zinc-50/40"
          >
            <header className="flex items-baseline justify-between gap-3 border-b border-zinc-100 px-5 py-3">
              <h3 className="text-sm font-semibold text-zinc-900">
                {lane.label}
              </h3>
              {!lane.loading && lane.rows.length > 0 && (
                <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                  {t("connections.suggestions.countBadge").replace(
                    "{count}",
                    String(lane.rows.length),
                  )}
                </span>
              )}
            </header>
            {lane.loading ? (
              <p className="px-5 py-6 text-sm text-zinc-500">…</p>
            ) : (
              <>
                <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {lane.rows.map((row) => (
                    <SuggestionCard
                      key={row.id}
                      row={row}
                      lane={lane.key}
                      onDismiss={() => handleDismiss(row.id)}
                    />
                  ))}
                </ul>
                {lane.hasMore ? (
                  <div className="border-t border-zinc-100 px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleLoadMore(lane.key)}
                      disabled={lane.loadingMore}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-50"
                    >
                      {lane.loadingMore
                        ? "…"
                        : t("connections.suggestions.loadMore")}
                    </button>
                  </div>
                ) : lane.loadMoreClicked ? (
                  <div className="border-t border-zinc-100 px-4 py-3 text-center text-xs text-zinc-500">
                    {t("connections.suggestions.exhausted")}
                  </div>
                ) : null}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function SuggestionCard({
  row,
  lane,
  onDismiss,
}: {
  row: PeopleRec;
  lane: LaneKey | "role";
  onDismiss?: () => void;
}) {
  const { t, locale } = useT();
  const name =
    formatDisplayName(row, t, locale) || row.username || "—";
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
  const mutualCount = row.mutual_follow_sources ?? 0;
  const signalCount = row.signal_count ?? 0;
  const reasonLine = pickReasonLine(t, lane, {
    mutualCount,
    signalCount,
  });

  return (
    <li className="relative flex flex-col rounded-xl border border-zinc-200 bg-white p-3">
      {onDismiss && (
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
      )}
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
        {reasonLine && <p className="truncate">{reasonLine}</p>}
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

/**
 * Compact variant for the "역할별 찾기" horizontal carousel — LinkedIn
 * "Companies to follow" style. Vertical center layout, no dismiss (browse
 * surface). Width 176px; height driven by content but constrained by
 * `min-h-[220px]` so the row stays visually aligned even when usernames
 * wrap under the truncate.
 */
export function SuggestionCardCompact({
  row,
  lane,
}: {
  row: PeopleRec;
  lane: LaneKey | "role";
}) {
  const { t, locale } = useT();
  void lane;
  const name =
    formatDisplayName(row, t, locale) || row.username || "—";
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

  return (
    <li className="flex min-h-[220px] w-[176px] shrink-0 snap-start flex-col rounded-xl border border-zinc-200 bg-white p-3">
      <Link
        href={row.username ? `/u/${row.username}` : "#"}
        className="flex flex-1 flex-col items-center text-center"
      >
        <span className="mt-1 h-16 w-16 shrink-0 overflow-hidden rounded-full bg-zinc-100">
          {src ? (
            <Image
              src={src}
              alt=""
              width={64}
              height={64}
              className="h-full w-full object-cover"
              unoptimized
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-lg font-medium text-zinc-500">
              {name.charAt(0).toUpperCase()}
            </span>
          )}
        </span>
        <div className="mt-2 w-full min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">{name}</p>
          {row.username && (
            <p className="truncate text-xs text-zinc-500">@{row.username}</p>
          )}
        </div>
        {roleLabel && (
          <p className="mt-2 truncate text-xs text-zinc-500">{roleLabel}</p>
        )}
      </Link>
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

function pickReasonLine(
  t: (key: string) => string,
  lane: LaneKey | "role",
  ctx: { mutualCount: number; signalCount: number },
): string | null {
  if (ctx.mutualCount > 0) {
    return t("connections.suggestions.reason.mutual").replace(
      "{count}",
      String(ctx.mutualCount),
    );
  }
  if (lane === "likes_based" && ctx.signalCount > 0) {
    return t("connections.suggestions.reason.sharedTaste");
  }
  if (lane === "expand") {
    return t("connections.suggestions.reason.sameExhibitionCircle");
  }
  if (lane === "follow_graph") {
    return t("connections.suggestions.reason.closeInGraph");
  }
  return null;
}
