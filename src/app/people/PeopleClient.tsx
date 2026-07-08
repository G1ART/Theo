"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n/useT";
import { getSession } from "@/lib/supabase/auth";
import { getFollowingIds } from "@/lib/supabase/artists";
import {
  getPeopleRecommendations,
  ROLE_OPTIONS,
  type PeopleLane,
  type PeopleRec,
} from "@/lib/supabase/recommendations";
import {
  dismissPerson,
  undismissPerson,
  getTrendingPeople,
} from "@/lib/supabase/peopleRecs";
import { AuthGate } from "@/components/AuthGate";
import { hasPublicLinkableUsername } from "@/lib/identity/format";
import { reasonTagToI18n } from "@/lib/people/reason";
import { SectionFrame } from "@/components/ds/SectionFrame";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { SectionLabel } from "@/components/ds/SectionLabel";
import { FloorPanel } from "@/components/ds/FloorPanel";
import { LaneChips } from "@/components/ds/LaneChips";
import { FilterChip } from "@/components/ds/FilterChip";
import { ListCardSkeleton } from "@/components/ds/PageShellSkeleton";
import { getMyProfile } from "@/lib/supabase/me";
import { getProfileSurface } from "@/lib/profile/surface";
import { TourTrigger, TourHelpButton } from "@/components/tour";
import { TOUR_IDS } from "@/lib/tours/tourRegistry";
import { PeopleResultCard } from "./PeopleResultCard";
import { PersonaCountPanel } from "./PersonaCountPanel";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";

const DEBOUNCE_MS = 250;
const INITIAL_LIMIT = 15;
const LOAD_MORE_LIMIT = 10;
// Background-refresh TTL (C6). When the user returns to the tab via
// focus / visibility-change and the data is older than this threshold,
// silently re-fetch. 90s mirrors the feed's refresh policy.
const PEOPLE_REFRESH_TTL_MS = 90_000;

type LaneKey = "follow" | "likes" | "expand";
const LANE_TO_CONTRACT: Record<LaneKey, PeopleLane> = {
  follow: "follow_graph",
  likes: "likes_based",
  expand: "expand",
};

const LANE_SUBTITLE_KEY: Record<LaneKey, string> = {
  follow: "people.lanes.followGraphSubtitle",
  likes: "people.lanes.likesBasedSubtitle",
  expand: "people.lanes.expandSubtitle",
};

function formatReasonLine(profile: PeopleRec, t: (key: string) => string): string {
  const detail = profile.reason_detail ?? {};
  return reasonTagToI18n(profile.reason_tags ?? [], t, {
    medium: typeof detail.medium === "string" ? detail.medium : null,
    city: typeof detail.city === "string" ? detail.city : null,
  });
}

/**
 * Render the headline numerical badge for a recommendation card.
 *
 * Reads the lane-uniform score envelope (G2): every RPC row carries
 * `signal_count` + `top_signal`, so the client doesn't have to know
 * the lane to pick the badge. We still gate at >= 2 so the badge
 * only appears when the signal is genuinely meaningful.
 */
function getScoreBadge(profile: PeopleRec, t: (key: string) => string): string | null {
  const count = profile.signal_count ?? 0;
  const top = profile.top_signal ?? "";
  if (count < 2) return null;
  if (top === "follow_graph") {
    return t("people.signal.followNetwork").replace("{count}", String(count));
  }
  if (top === "likes_based") {
    return t("people.signal.likesMatched").replace("{count}", String(count));
  }
  if (top === "trending") {
    return t("people.signal.trending").replace("{count}", String(count));
  }
  return null;
}

// Page-local toast — small, slides in from the bottom-right. Auto
// dismisses after `durationMs`. Optional Undo button that calls
// the toast's `onUndo` and immediately closes the toast.
type ToastSpec = {
  id: number;
  message: string;
  undoLabel?: string;
  onUndo?: () => void;
  durationMs?: number;
};

export function PeopleClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useT();

  const qFromUrl = searchParams.get("q") ?? "";
  const laneFromUrl = (searchParams.get("lane") as LaneKey) ?? "follow";
  const validLane = ["follow", "likes", "expand"].includes(laneFromUrl)
    ? laneFromUrl
    : "follow";
  const rolesFromUrl = searchParams.get("roles") ?? "";
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState(qFromUrl);
  const [debouncedSearch, setDebouncedSearch] = useState(qFromUrl);
  const [lane, setLane] = useState<LaneKey>(validLane);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(() => {
    if (!rolesFromUrl) return new Set();
    return new Set(
      rolesFromUrl
        .split(",")
        .filter((x) => ROLE_OPTIONS.includes(x as (typeof ROLE_OPTIONS)[number]))
    );
  });
  const isSearchMode = !!debouncedSearch.trim();

  const [profiles, setProfiles] = useState<PeopleRec[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchSuggestion, setSearchSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // C5 — surfaced load-more error state, kept separate from initial-fetch
  // error so the existing list stays visible while we offer a retry.
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [introOpenSignal, setIntroOpenSignal] = useState<Record<string, number>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [myProfile, setMyProfile] = useState<{
    display_name: string | null;
    main_role: string | null;
    themes: string[];
    mediums: string[];
    city: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastSpec[]>([]);
  const lastFetchAtRef = useRef<number>(0);
  const cardsContainerRef = useRef<HTMLDivElement>(null);
  const toastIdRef = useRef(0);

  // S4 — trending row state. The `searchFocused` flag toggles when the
  // user enters/leaves the search field; while focused with an empty
  // query we replace the lane area with a trending strip so the
  // empty-state has something concrete to act on. We delay the
  // blur-driven hide by a tick so a tap on a trending card isn't
  // cancelled before the click handler runs.
  const [searchFocused, setSearchFocused] = useState(false);
  const [trendingProfiles, setTrendingProfiles] = useState<PeopleRec[]>([]);
  const trendingLoadedRef = useRef(false);
  const blurTimerRef = useRef<number | null>(null);

  const updateUrl = useCallback(
    (opts: { q?: string; roles?: Set<string>; lane?: LaneKey }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (opts.q !== undefined) {
        const v = opts.q.trim();
        if (v) params.set("q", v);
        else params.delete("q");
      }
      if (opts.roles !== undefined) {
        if (opts.roles.size > 0)
          params.set("roles", Array.from(opts.roles).sort().join(","));
        else params.delete("roles");
      }
      if (opts.lane !== undefined) {
        if (opts.lane !== "follow") params.set("lane", opts.lane);
        else params.delete("lane");
      }
      const s = params.toString();
      router.replace(s ? `/people?${s}` : "/people", { scroll: false });
    },
    [router, searchParams]
  );

  useEffect(() => {
    getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
    getMyProfile().then(({ data }) => {
      if (!data) return;
      const surface = getProfileSurface(data);
      if (!surface) return;
      setMyProfile({
        display_name: surface.displayName,
        main_role: surface.mainRole,
        themes: [...surface.details.themes],
        mediums: [...surface.details.mediums],
        city: surface.details.city,
      });
    });
  }, []);

  useEffect(() => {
    const tid = setTimeout(() => setDebouncedSearch(search), DEBOUNCE_MS);
    return () => clearTimeout(tid);
  }, [search]);

  useEffect(() => {
    if (debouncedSearch.trim()) {
      updateUrl({ q: debouncedSearch });
    } else {
      updateUrl({ q: "", lane });
    }
  }, [debouncedSearch]);

  const rolesArr = useMemo(
    () => (selectedRoles.size > 0 ? Array.from(selectedRoles) : []),
    [selectedRoles]
  );
  const rolesKey = rolesArr.join(",");

  const fetchInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadMoreError(false);
    setProfiles([]);
    setNextCursor(null);

    try {
      const [followingRes] = await Promise.all([getFollowingIds()]);
      setFollowingIds(followingRes.data);

      const contractLane: PeopleLane = isSearchMode
        ? "search"
        : LANE_TO_CONTRACT[lane];
      const res = await getPeopleRecommendations({
        lane: contractLane,
        q: isSearchMode ? debouncedSearch.trim() : undefined,
        roles: rolesArr,
        limit: INITIAL_LIMIT,
        cursor: null,
        searchVariant: isSearchMode ? "merged" : undefined,
      });
      if (res.error) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[People] getPeopleRecommendations error:", res.error);
        }
        setError(t("people.loadFailed"));
        return;
      }
      setProfiles(res.data);
      setNextCursor(res.nextCursor);
      setSearchSuggestion(isSearchMode ? res.suggestion : null);
      lastFetchAtRef.current = Date.now();
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[People] fetch error:", err);
      }
      setError(t("people.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [isSearchMode, lane, debouncedSearch, rolesKey, t]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  // C6 — refresh on visibility / focus when stale.
  useEffect(() => {
    function maybeRefresh() {
      if (loading) return;
      if (Date.now() - lastFetchAtRef.current < PEOPLE_REFRESH_TTL_MS) return;
      fetchInitial();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") maybeRefresh();
    }
    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchInitial, loading]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const contractLane: PeopleLane = isSearchMode
        ? "search"
        : LANE_TO_CONTRACT[lane];
      const res = await getPeopleRecommendations({
        lane: contractLane,
        q: isSearchMode ? debouncedSearch.trim() : undefined,
        roles: rolesArr,
        limit: LOAD_MORE_LIMIT,
        cursor: nextCursor,
        searchVariant: isSearchMode ? "merged" : undefined,
      });
      if (res.error) {
        setLoadMoreError(true);
        return;
      }
      setProfiles((prev) => [...prev, ...res.data]);
      setNextCursor(res.nextCursor);
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [isSearchMode, lane, debouncedSearch, rolesKey, nextCursor, loadingMore]);

  function setLaneAndUpdate(l: LaneKey) {
    setLane(l);
    updateUrl({ lane: l });
  }

  function toggleRole(role: string) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      updateUrl({ roles: next });
      return next;
    });
  }

  function clearRoles() {
    setSelectedRoles(new Set());
    updateUrl({ roles: new Set() });
  }

  // ── Toast helpers ─────────────────────────────────────────────────────
  const pushToast = useCallback((spec: Omit<ToastSpec, "id">) => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    const dur = spec.durationMs ?? 5000;
    setToasts((prev) => [...prev, { ...spec, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((tt) => tt.id !== id));
    }, dur);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((tt) => tt.id !== id));
  }, []);

  // ── Dismiss flow (S3) ────────────────────────────────────────────────
  const handleDismiss = useCallback(
    async (target: PeopleRec, mode: "snooze" | "block") => {
      // Optimistic remove; fire the RPC; on failure restore + toast
      // the error. On success show a confirmation toast with Undo.
      const prevList = profiles;
      setProfiles((prev) => prev.filter((p) => p.id !== target.id));
      const res = await dismissPerson(target.id, mode);
      if (!res.ok) {
        setProfiles(prevList);
        pushToast({ message: t("people.loadFailed") });
        return;
      }
      pushToast({
        message: t("people.dismiss.confirmed"),
        undoLabel: t("people.dismiss.undo"),
        onUndo: async () => {
          await undismissPerson(target.id);
          setProfiles((prev) => {
            // Restore at original position when possible.
            const idx = prevList.findIndex((p) => p.id === target.id);
            if (idx === -1) return [target, ...prev];
            const next = prev.slice();
            next.splice(idx, 0, target);
            return next;
          });
        },
      });
    },
    [profiles, pushToast, t]
  );

  // ── Follow undo (S5) ─────────────────────────────────────────────────
  // The actual follow write is committed by FollowButton (or
  // IntroMessageAssist's handleFollowOnly / handleSend). Here we
  // surface the resulting status and offer a one-tap undo via
  // `cancel_follow_request` (works for both pending and accepted —
  // it functions as an unfollow when the row is accepted).
  const handleFollowed = useCallback(
    async (target: PeopleRec, status: "accepted" | "pending") => {
      // Update local follow tracking.
      setFollowingIds((prev) => {
        if (prev.has(target.id)) return prev;
        const next = new Set(prev);
        next.add(target.id);
        return next;
      });
      const message =
        status === "pending"
          ? t("people.follow.requested")
          : t("people.follow.added");
      pushToast({
        message,
        undoLabel: t("people.follow.undo"),
        onUndo: async () => {
          // Best-effort unfollow / cancel. We don't surface a
          // failure toast — undo is opportunistic.
          try {
            const { supabase } = await import("@/lib/supabase/client");
            await supabase.rpc("cancel_follow_request", { p_target: target.id });
          } catch {
            // swallow — undo is best-effort
          }
          setFollowingIds((prev) => {
            if (!prev.has(target.id)) return prev;
            const next = new Set(prev);
            next.delete(target.id);
            return next;
          });
        },
      });
    },
    [pushToast, t]
  );

  // ── Trending fetch (S4) ──────────────────────────────────────────────
  const ensureTrendingLoaded = useCallback(async () => {
    if (trendingLoadedRef.current) return;
    trendingLoadedRef.current = true;
    const res = await getTrendingPeople(8);
    if (!res.error) setTrendingProfiles(res.data);
  }, []);

  function handleSearchFocus() {
    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setSearchFocused(true);
    void ensureTrendingLoaded();
  }
  function handleSearchBlur() {
    // Delay so a click on a trending card lands before the row is unmounted.
    if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current);
    blurTimerRef.current = window.setTimeout(() => {
      setSearchFocused(false);
      blurTimerRef.current = null;
    }, 180);
  }

  const showTrending = searchFocused && !isSearchMode && trendingProfiles.length > 0;

  // ── Keyboard navigation (S8) ─────────────────────────────────────────
  // j / k step focus through cards; the inner Link handles Enter →
  // navigate. Skip when the user is typing in the search field or in
  // any other input/textarea.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "j" && e.key !== "k") return;
      const container = cardsContainerRef.current;
      if (!container) return;
      const cards = Array.from(
        container.querySelectorAll<HTMLAnchorElement>(
          "[data-people-card] > a"
        )
      );
      if (cards.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? cards.indexOf(active as HTMLAnchorElement) : -1;
      const nextIdx =
        e.key === "j"
          ? Math.min(cards.length - 1, idx + 1)
          : Math.max(0, idx === -1 ? 0 : idx - 1);
      e.preventDefault();
      cards[nextIdx]?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const emptyRecommendations =
    !loading && !isSearchMode && profiles.length === 0;
  const emptySearch = !loading && isSearchMode && profiles.length === 0;

  const laneOptions: ReadonlyArray<{ id: LaneKey; label: string }> = [
    { id: "follow", label: t("people.lanes.followGraphTitle") },
    { id: "likes", label: t("people.lanes.likesBasedTitle") },
    { id: "expand", label: t("people.lanes.expandTitle") },
  ];

  return (
    <AuthGate>
      <TourTrigger tourId={TOUR_IDS.people} />
      <PageShell variant="default">
        <PageHeader
          variant="plain"
          title={t("people.title")}
          lead={t("people.lead")}
          actions={<TourHelpButton tourId={TOUR_IDS.people} />}
        />

        <PersonaCountPanel />

        <div className="mb-8">
          <input
            ref={searchInputRef}
            data-tour="people-search"
            type="search"
            placeholder={t("people.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-200"
          />
        </div>

        {showTrending && (
          <FloorPanel padding="sm" className="mb-6">
            <SectionLabel className="mb-4">
              {t("people.trendingHeader")}
            </SectionLabel>
            <div className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 lg:-mx-6 lg:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {trendingProfiles.map((profile) => (
                <TrendingChip key={profile.id} profile={profile} />
              ))}
            </div>
          </FloorPanel>
        )}

        {!isSearchMode && !showTrending && (
          <FloorPanel padding="sm" className="mb-6">
            <LaneChips
              variant="lane"
              options={laneOptions}
              active={lane}
              onChange={(id) => setLaneAndUpdate(id)}
              ariaLabel={t("people.title")}
              data-tour="people-lane-tabs"
            />
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              {t(LANE_SUBTITLE_KEY[lane])}
            </p>
          </FloorPanel>
        )}

        <div data-tour="people-role-filters" className="mb-8 flex flex-wrap items-center gap-2">
          <SectionLabel as="span">{t("people.filtersLabel")}</SectionLabel>
          {ROLE_OPTIONS.map((role) => (
            <FilterChip
              key={role}
              active={selectedRoles.has(role)}
              onClick={() => toggleRole(role)}
            >
              {t(`people.role.${role}`)}
            </FilterChip>
          ))}
          {selectedRoles.size > 0 && (
            <button
              type="button"
              onClick={clearRoles}
              className="rounded-full px-3 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
            >
              {t("people.filterAll")}
            </button>
          )}
        </div>

        {loading ? (
          <ListCardSkeleton rows={4} />
        ) : error ? (
          <div className="rounded-2xl border border-red-100 bg-red-50/50 px-5 py-6">
            <p className="text-sm text-red-700">{error}</p>
            <button
              type="button"
              onClick={fetchInitial}
              className="mt-3 inline-flex rounded-full border border-red-200 bg-white px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              {t("common.retry")}
            </button>
          </div>
        ) : emptyRecommendations ? (
          <FloorPanel padding="lg" className="text-center">
            <p className="mb-4 text-zinc-600">{t("people.noRecommendations")}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => searchInputRef.current?.focus()}
                className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {t("people.trySearch")}
              </button>
              <a
                href="/onboarding"
                className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {t("people.completeProfile")}
              </a>
            </div>
          </FloorPanel>
        ) : emptySearch ? (
          <FloorPanel padding="lg" className="text-center">
            <p className="mb-4 text-zinc-600">{t("people.noSearchResults")}</p>
            {searchSuggestion && (
              <p className="mb-3 text-zinc-700">
                {t("people.didYouMean").replace("{suggestion}", searchSuggestion)}
              </p>
            )}
            <div className="mb-6 flex flex-wrap justify-center gap-2">
              {searchSuggestion && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch(searchSuggestion);
                    setDebouncedSearch(searchSuggestion);
                    updateUrl({ q: searchSuggestion });
                    setSearchSuggestion(null);
                  }}
                  className="rounded-full border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  {t("people.searchSuggestion").replace("{suggestion}", searchSuggestion)}
                </button>
              )}
              <button
                type="button"
                onClick={clearRoles}
                className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {t("people.filterAll")}
              </button>
            </div>
            <SectionFrame tone="muted" padding="md" noMargin className="text-left">
              <p className="mb-2 text-sm font-medium text-zinc-700">{t("people.inviteCta")}</p>
              <Link
                href={`/people/invite?name=${encodeURIComponent(debouncedSearch.trim())}`}
                className="inline-block rounded-full border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                {t("people.inviteCtaButton")}
              </Link>
            </SectionFrame>
          </FloorPanel>
        ) : (
          <>
            <div ref={cardsContainerRef} className="space-y-3">
              {profiles.map((profile, profileIdx) => {
                const username = profile.username ?? "";
                if (!username) return null;
                // Defence in depth — RPC also gates this in P0.
                if (!hasPublicLinkableUsername(profile)) return null;
                const isFirstVisibleCard = profileIdx === 0;
                const isSelf = userId === profile.id;
                const initialFollowing = followingIds.has(profile.id);
                const reasonLine =
                  !isSearchMode && (profile.reason_tags?.length ?? 0) > 0
                    ? formatReasonLine(profile, t)
                    : null;
                const badge = !isSearchMode ? getScoreBadge(profile, t) : null;
                return (
                  <PeopleResultCard
                    key={profile.id}
                    profile={profile}
                    initialFollowing={initialFollowing}
                    isSelf={isSelf}
                    isFirstVisibleCard={isFirstVisibleCard}
                    reasonLine={reasonLine}
                    badge={badge}
                    onDismiss={
                      !isSelf && !isSearchMode
                        ? (mode) => handleDismiss(profile, mode)
                        : undefined
                    }
                    onFollowed={
                      !isSelf
                        ? (status) => handleFollowed(profile, status)
                        : undefined
                    }
                    me={myProfile}
                    userId={userId}
                    introOpenSignal={introOpenSignal[profile.id]}
                    setIntroOpenSignal={() => {
                      setIntroOpenSignal((prev) => ({
                        ...prev,
                        [profile.id]: (prev[profile.id] ?? 0) + 1,
                      }));
                    }}
                  />
                );
              })}
            </div>
            {nextCursor && (
              <div className="mt-8 flex justify-center">
                {loadMoreError ? (
                  <button
                    type="button"
                    onClick={loadMore}
                    className="rounded-full border border-red-200 bg-white px-6 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    {t("people.loadMoreFailed")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="rounded-full border border-zinc-300 bg-white px-6 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {loadingMore ? t("common.loading") : t("people.loadMore")}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </PageShell>
    </AuthGate>
  );
}

// ─── Toast UI ──────────────────────────────────────────────────────────
// Tiny page-local stack — fixed bottom-center on mobile, bottom-right on
// larger screens. We deliberately avoid pulling in a global toast
// system because People is the only surface using these affordances
// today; the contract is intentionally local.
function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastSpec[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      role="region"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex flex-col items-center gap-2 px-4 sm:bottom-8 sm:right-8 sm:left-auto sm:items-end"
    >
      {toasts.map((tt) => (
        <div
          key={tt.id}
          className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-full border border-zinc-200 bg-white px-4 py-2.5 shadow-lg"
        >
          <span className="text-sm text-zinc-800">{tt.message}</span>
          {tt.undoLabel && tt.onUndo && (
            <button
              type="button"
              onClick={() => {
                tt.onUndo?.();
                onDismiss(tt.id);
              }}
              className="text-sm font-medium text-zinc-900 underline-offset-2 hover:underline"
            >
              {tt.undoLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// Trending chip — small profile pill for the search-focus empty
// state. Clicking navigates to the profile; the list itself is
// horizontally scrollable on mobile.
function TrendingChip({ profile }: { profile: PeopleRec }) {
  const username = profile.username ?? "";
  if (!username) return null;
  if (!hasPublicLinkableUsername(profile)) return null;
  const display =
    (profile.display_name ?? "").trim() ||
    (username.startsWith("@") ? username : `@${username}`);
  // We use a plain anchor so the click happens before the input's
  // onBlur callback can hide the trending row (we already gate that
  // with a short timeout, but anchor-based navigation is more robust).
  return (
    <Link
      href={`/u/${username}`}
      className="flex shrink-0 snap-start items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300"
    >
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-[10px] font-medium text-zinc-500">
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={
              profile.avatar_url.startsWith("http")
                ? profile.avatar_url
                : getArtworkImageUrl(profile.avatar_url, "avatar")
            }
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span>{display.charAt(0).toUpperCase()}</span>
        )}
      </span>
      <span className="max-w-[12rem] truncate">{display}</span>
    </Link>
  );
}

