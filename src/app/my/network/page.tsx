"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";
import { formatDisplayName } from "@/lib/identity/format";
import { pickLocalizedBio, pickLocalizedDisplayName } from "@/lib/i18n/pickLocalized";
import { FollowButton } from "@/components/FollowButton";
import {
  getMyFollowers,
  getMyFollowing,
  isFollowing,
  type FollowProfileRow,
} from "@/lib/supabase/follows";
import { getMyStats, type MyStats } from "@/lib/supabase/me";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { TourTrigger, TourHelpButton } from "@/components/tour";
import { TOUR_IDS } from "@/lib/tours/tourRegistry";
import { getSession } from "@/lib/supabase/auth";
import { RelationshipDeskPanel } from "@/components/network/RelationshipDeskPanel";
import { AccessRequestsPanel } from "@/components/network/AccessRequestsPanel";
import { InvitationsPanel } from "@/components/network/InvitationsPanel";
import { SuggestionsGroupedPanel } from "@/components/network/SuggestionsGroupedPanel";
import { RoleDiscoveryPanel } from "@/components/network/RoleDiscoveryPanel";
import { DiscoverByRolePanel } from "@/components/network/DiscoverByRolePanel";
import { NetworkPeopleSearch } from "@/components/network/NetworkPeopleSearch";
import { isRoleDiscoveryKey } from "@/lib/supabase/peopleByRole";

// Sprint 6.2 — Network Hub upgrade.
//
// `/my/network` is now the single home for every people-graph surface:
// followers, following, the Relationship Desk, and the Access Requests
// inbox. Two side-effects of this:
//   1. /my/relationships and /my/access-requests are now thin redirect
//      pages that send the user here with the right tab pre-selected.
//   2. The Studio Hero exposes a single "네트워크" pill (with a tiny
//      activity dot when there are pending requests / open inquiries)
//      instead of the prior two text links scattered across /my and
//      /my/shortlists/*.
// Sprint C.M / 2026-08-03 — Connections redesign.
//
// The 2026-08-03 wireframe re-frames `/my/network` as a two-layer page:
//   • Default (no `?tab=` param) → Overview: Invitations (union of
//     follow requests + access requests) + grouped People suggestions.
//   • Detail (any `?tab=` value) → the pre-existing followers /
//     following / requests / relationships tab strip stays available
//     via URL query so bookmarks and side-nav shortcuts keep working.
//
// Rationale: the wireframe hides the 4-tab strip below the fold, but
// pre-existing Studio surfaces still deep-link into individual tabs
// (e.g. Studio Hero's "관계" pill). Keeping the tab strip URL-
// addressable means those callers don't break during the redesign.
type TabKey =
  | "overview"
  | "followers"
  | "following"
  | "requests"
  | "relationships"
  | "discover";
type SortKey = "recent" | "alpha";

function parseTab(raw: string | null): TabKey {
  switch (raw) {
    case "followers":
      return "followers";
    case "following":
      return "following";
    case "relationships":
      return "relationships";
    case "requests":
      return "requests";
    case "discover":
      // URL-only surface (entered via "전체 보기 →" from RoleDiscoveryPanel).
      // Intentionally NOT a button in the 5-tab strip below.
      return "discover";
    default:
      return "overview";
  }
}

function avatarUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.startsWith("http")) return v;
  return getArtworkImageUrl(v, "avatar");
}

export default function MyNetworkPage() {
  const { t, locale } = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = parseTab(searchParams.get("tab"));

  const [stats, setStats] = useState<MyStats | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [followers, setFollowers] = useState<FollowProfileRow[]>([]);
  const [followersCursor, setFollowersCursor] = useState<string | null>(null);
  const [followersLoaded, setFollowersLoaded] = useState(false);
  const [followersLoading, setFollowersLoading] = useState(false);

  const [following, setFollowing] = useState<FollowProfileRow[]>([]);
  const [followingCursor, setFollowingCursor] = useState<string | null>(null);
  const [followingLoaded, setFollowingLoaded] = useState(false);
  const [followingLoading, setFollowingLoading] = useState(false);

  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  // Overview 탭 상단 전역 인물 검색이 활성 상태인지. 활성 시 그래프-신호
  // sections (`SuggestionsGroupedPanel` / `RoleDiscoveryPanel`) 를 숨겨
  // 검색 결과에 집중할 수 있게 한다. `InvitationsPanel` 은 관계 관리 액션
  // 이라 검색 중에도 계속 노출.
  const [searchActive, setSearchActive] = useState(false);

  const setTab = useCallback(
    (next: TabKey) => {
      if (next === activeTab) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === "overview") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `/my/network?${qs}` : "/my/network", {
        scroll: false,
      });
    },
    [activeTab, router, searchParams]
  );

  const hydrateFollowingMap = useCallback(async (rows: FollowProfileRow[]) => {
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.id);
    const results = await Promise.all(ids.map((id) => isFollowing(id)));
    setFollowingMap((prev) => {
      const next = { ...prev };
      results.forEach((r, i) => {
        next[ids[i]] = r.data ?? false;
      });
      return next;
    });
  }, []);

  const loadFollowers = useCallback(
    async (cursor?: string) => {
      setFollowersLoading(true);
      const res = await getMyFollowers({ limit: 24, cursor });
      if (!res.error) {
        setFollowers((prev) => (cursor ? [...prev, ...res.data] : res.data));
        setFollowersCursor(res.nextCursor);
        await hydrateFollowingMap(res.data);
      }
      setFollowersLoaded(true);
      setFollowersLoading(false);
    },
    [hydrateFollowingMap]
  );

  const loadFollowing = useCallback(async (cursor?: string) => {
    setFollowingLoading(true);
    const res = await getMyFollowing({ limit: 24, cursor });
    if (!res.error) {
      setFollowing((prev) => (cursor ? [...prev, ...res.data] : res.data));
      setFollowingCursor(res.nextCursor);
      setFollowingMap((prev) => {
        const next = { ...prev };
        for (const row of res.data) next[row.id] = true;
        return next;
      });
    }
    setFollowingLoaded(true);
    setFollowingLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await getMyStats();
      if (!cancelled) setStats(r.data ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await getSession();
      if (cancelled) return;
      setUserId(data.session?.user?.id ?? null);
      setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (activeTab === "followers" && !followersLoaded && !followersLoading) {
        void loadFollowers();
      }
      if (activeTab === "following" && !followingLoaded && !followingLoading) {
        void loadFollowing();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [
    activeTab,
    followersLoaded,
    followersLoading,
    followingLoaded,
    followingLoading,
    loadFollowers,
    loadFollowing,
  ]);

  const isFollowTab = activeTab === "followers" || activeTab === "following";
  const rawRows = activeTab === "followers" ? followers : following;
  const cursor = activeTab === "followers" ? followersCursor : followingCursor;
  const loadingMore =
    activeTab === "followers"
      ? followersLoading && followers.length > 0
      : followingLoading && following.length > 0;
  const initialLoading =
    activeTab === "followers" ? !followersLoaded : !followingLoaded;

  const filtered = useMemo(() => {
    if (!isFollowTab) return [];
    const q = query.trim().toLowerCase();
    const base = q
      ? rawRows.filter((row) => {
          const legacyName = (row.display_name ?? "").toLowerCase();
          const nameKo = (row.display_name_ko ?? "").toLowerCase();
          const nameEn = (row.display_name_en ?? "").toLowerCase();
          const handle = (row.username ?? "").toLowerCase();
          const bio = (row.bio ?? "").toLowerCase();
          const bioKo = (row.bio_ko ?? "").toLowerCase();
          const bioEn = (row.bio_en ?? "").toLowerCase();
          return (
            legacyName.includes(q) ||
            nameKo.includes(q) ||
            nameEn.includes(q) ||
            handle.includes(q) ||
            (bio ? bio.includes(q) : false) ||
            (bioKo ? bioKo.includes(q) : false) ||
            (bioEn ? bioEn.includes(q) : false)
          );
        })
      : rawRows;
    const nameKey = (row: (typeof rawRows)[number]): string =>
      (pickLocalizedDisplayName(row, locale) || row.username || "").toLowerCase();
    if (sort === "alpha") {
      return [...base].sort((a, b) => nameKey(a).localeCompare(nameKey(b)));
    }
    return [...base].sort((a, b) => {
      const at = a.followed_at ? new Date(a.followed_at).getTime() : 0;
      const bt = b.followed_at ? new Date(b.followed_at).getTime() : 0;
      if (bt !== at) return bt - at;
      return nameKey(a).localeCompare(nameKey(b));
    });
  }, [rawRows, query, sort, isFollowTab, locale]);

  const followersCount = stats?.followersCount ?? 0;
  const followingCount = stats?.followingCount ?? 0;
  const visibleCount = rawRows.length;

  const hasQuery = query.trim().length > 0;
  const emptyCopy = hasQuery
    ? t("network.empty.search")
    : activeTab === "followers"
      ? t("network.empty.followers")
      : t("network.empty.following");

  return (
    <AuthGate>
      <TourTrigger tourId={TOUR_IDS.network} />
      {/* Sprint 6.2 polish — page container widened from max-w-3xl to
          max-w-4xl. Now that the hub holds four lanes (followers,
          following, access requests, relationships) and Relationship
          Desk rows can carry several activity chips per person, the
          extra horizontal room keeps long lines (private-note chip +
          activity counts) from wrapping prematurely as activity grows.
          The studio /my page stays at its own width — this widening
          is scoped to /my/network where density is highest. */}
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link
            href="/my"
            className="min-w-0 flex-1 truncate text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← {t("network.backToStudio")}
          </Link>
          <TourHelpButton tourId={TOUR_IDS.network} />
        </div>

        <header className="mb-5">
          <h1 className="text-xl font-semibold text-zinc-900">
            {t("network.title")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            <button
              type="button"
              onClick={() => setTab("followers")}
              className={`tabular-nums transition-colors ${activeTab === "followers" ? "text-zinc-900" : "hover:text-zinc-900"}`}
            >
              <span className="font-semibold">{followersCount}</span>{" "}
              {t("network.summary.followers")}
            </button>
            <span aria-hidden className="mx-2 text-zinc-300">
              ·
            </span>
            <button
              type="button"
              onClick={() => setTab("following")}
              className={`tabular-nums transition-colors ${activeTab === "following" ? "text-zinc-900" : "hover:text-zinc-900"}`}
            >
              <span className="font-semibold">{followingCount}</span>{" "}
              {t("network.summary.following")}
            </button>
          </p>
        </header>

        <div
          role="tablist"
          aria-label={t("network.title")}
          data-tour="network-tabs"
          className="mb-4 flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1"
        >
          {/* Sprint C.M — Overview lands first (wireframe default). The
              legacy 4-tab strip (followers → following → requests →
              relationships) remains reachable via URL so deep links
              from Studio surfaces keep working. */}
          <NetworkTabButton
            label={t("connections.tabs.default")}
            active={activeTab === "overview"}
            onClick={() => setTab("overview")}
          />
          <NetworkTabButton
            label={t("network.tabs.followers")}
            count={followersCount}
            active={activeTab === "followers"}
            onClick={() => setTab("followers")}
          />
          <NetworkTabButton
            label={t("network.tabs.following")}
            count={followingCount}
            active={activeTab === "following"}
            onClick={() => setTab("following")}
          />
          <NetworkTabButton
            label={t("network.tabs.requests")}
            active={activeTab === "requests"}
            onClick={() => setTab("requests")}
          />
          <NetworkTabButton
            label={t("network.tabs.relationships")}
            active={activeTab === "relationships"}
            onClick={() => setTab("relationships")}
          />
        </div>

        {/* Per-tab guidance — kindly explains what the active tab does
            so newcomers (and returning users post-Sprint 6.2) understand
            why two former pages now live as tabs in here.
            `break-keep` = `word-break: keep-all` keeps Korean copy
            from snapping mid-어절. We intentionally do NOT add
            `text-pretty` here — Chrome's `text-wrap: pretty` balances
            line lengths to avoid widows, but the side effect on this
            short paragraph was an early first-line break with a wide
            empty gutter on the right (the eyesore that triggered this
            polish). Without `text-pretty` the paragraph fills the
            page container `max-w-4xl` end-to-end and only wraps when
            it actually has to — at a natural 어절 boundary thanks to
            `break-keep`. */}
        <p className="mb-4 break-keep text-xs text-zinc-500">
          {activeTab === "followers" && t("network.guide.followers")}
          {activeTab === "following" && t("network.guide.following")}
          {activeTab === "relationships" && t("network.guide.relationships")}
          {activeTab === "requests" && t("network.guide.requests")}
        </p>

        {activeTab === "overview" && (
          <div className="mb-6 space-y-4">
            <NetworkPeopleSearch onQueryChange={setSearchActive} />
            <InvitationsPanel ownerProfileId={userId} />
            {!searchActive && (
              <>
                <SuggestionsGroupedPanel />
                <RoleDiscoveryPanel />
              </>
            )}
          </div>
        )}

        {activeTab === "discover" && (() => {
          const raw = searchParams.get("role");
          if (!isRoleDiscoveryKey(raw)) {
            // Unknown / missing role — fall back to the role catalog.
            return (
              <div className="mb-6 space-y-4">
                <RoleDiscoveryPanel />
              </div>
            );
          }
          return (
            <div className="mb-6 space-y-4">
              <DiscoverByRolePanel key={raw} role={raw} />
            </div>
          );
        })()}

        {isFollowTab && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label
              className="relative flex-1 min-w-[180px]"
              data-tour="network-search"
            >
              <span className="sr-only">{t("network.search.placeholder")}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("network.search.placeholder")}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={t("network.search.clear")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                >
                  ✕
                </button>
              )}
            </label>
            <div
              data-tour="network-sort"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5"
            >
              <span className="text-xs text-zinc-500">
                {t("network.sort.label")}
              </span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="bg-transparent text-sm text-zinc-800 focus:outline-none"
              >
                <option value="recent">{t("network.sort.recent")}</option>
                <option value="alpha">{t("network.sort.alpha")}</option>
              </select>
            </div>
          </div>
        )}

        {activeTab !== "overview" && activeTab !== "discover" && (
        <div data-tour="network-list">
          {isFollowTab ? (
            initialLoading ? (
              <p className="py-8 text-center text-sm text-zinc-500">…</p>
            ) : visibleCount === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 p-8 text-center text-sm text-zinc-500">
                {emptyCopy}
              </p>
            ) : filtered.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 p-8 text-center text-sm text-zinc-500">
                {emptyCopy}
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                {filtered.map((row) => {
                  const src = avatarUrl(row.avatar_url);
                  const name =
                    formatDisplayName(row, t, locale) || row.username || "—";
                  const handle = row.username ? `@${row.username}` : null;
                  const rowBio = pickLocalizedBio(row, locale) || row.bio;
                  return (
                    <li
                      key={row.id}
                      className="flex items-center gap-3 px-4 py-3 sm:gap-4"
                    >
                      <Link
                        href={row.username ? `/u/${row.username}` : "#"}
                        className="flex min-w-0 flex-1 items-center gap-3"
                        aria-label={t("network.openProfile")}
                      >
                        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-zinc-200">
                          {src ? (
                            <Image
                              src={src}
                              alt=""
                              width={40}
                              height={40}
                              className="h-full w-full object-cover"
                              unoptimized
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-sm font-medium text-zinc-600">
                              {name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-zinc-900">
                            {name}
                          </span>
                          {(handle || rowBio) && (
                            <span className="mt-0.5 block truncate text-xs text-zinc-500">
                              {handle}
                              {handle && rowBio && (
                                <span
                                  aria-hidden
                                  className="mx-1 text-zinc-300"
                                >
                                  ·
                                </span>
                              )}
                              {rowBio && (
                                <span className="text-zinc-500">{rowBio}</span>
                              )}
                            </span>
                          )}
                        </span>
                      </Link>
                      <FollowButton
                        targetProfileId={row.id}
                        initialFollowing={
                          followingMap[row.id] ?? activeTab === "following"
                        }
                        size="sm"
                      />
                    </li>
                  );
                })}
              </ul>
            )
          ) : activeTab === "relationships" ? (
            <RelationshipDeskPanel userId={userId} authReady={authReady} />
          ) : (
            <AccessRequestsPanel />
          )}
        </div>
        )}

        {isFollowTab && cursor && (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() =>
                activeTab === "followers"
                  ? loadFollowers(cursor)
                  : loadFollowing(cursor)
              }
              disabled={loadingMore}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-50"
            >
              {loadingMore ? "…" : t("network.loadMore")}
            </button>
          </div>
        )}
      </main>
    </AuthGate>
  );
}

function NetworkTabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-white text-zinc-900 shadow-sm"
          : "text-zinc-600 hover:text-zinc-900"
      }`}
    >
      {label}
      {typeof count === "number" && (
        <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-600">
          {count}
        </span>
      )}
    </button>
  );
}
