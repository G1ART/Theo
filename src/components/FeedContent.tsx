"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { markFeedPerf, readFeedPerf } from "@/lib/feed/feedPerf";
import {
  buildLivingSalonItems,
  summarizeFirstView,
  summarizeLivingSalonMix,
} from "@/lib/feed/livingSalon";
import { personalizeFeedEntries } from "@/lib/feed/personalizedSalon";
import { readSeenItemKeys, type ViewerSignals } from "@/lib/feed/feedSignals";
import { getViewerRoleCached } from "@/lib/feed/viewerRole";
import { FEED_LAYOUT_VERSION, logFeedEvent } from "@/lib/feed/telemetry";
import type { DiscoveryDatum, FeedEntry } from "@/lib/feed/types";
import {
  type ArtworkWithLikes,
  type ArtworkCursor,
  listFollowingArtworks,
  listPublicArtworks,
} from "@/lib/supabase/artworks";
import { getFollowingIds } from "@/lib/supabase/artists";
import {
  listExhibitionsForFollowingFeed,
  listPublicExhibitionsForFeed,
  type ExhibitionWithCredits,
  type ExhibitionCursor,
} from "@/lib/supabase/exhibitions";
import { getLikedArtworkIds } from "@/lib/supabase/likes";
import {
  getPeopleRecommendations,
  type PeopleRec,
} from "@/lib/supabase/recommendations";
import { FeedHeader } from "./feed/FeedHeader";
import { LivingSalonGrid } from "./feed/LivingSalonGrid";
import { FeedGridSkeleton } from "@/components/ds";

const REC_CACHE_TTL_MS = 3 * 60 * 1000;
const FEED_BG_REFRESH_TTL_MS = 90_000;
const STRONG_SCORE_THRESHOLD = 2;
/**
 * Hard cap on discovery profiles flowing into the salon. The horizontal
 * carousel can comfortably show many cards, and we still need enough
 * non-artist profiles per persona to clear the `PEOPLE_CLUSTER_MIN` gate
 * (= 2). 24 keeps fetch cost reasonable while letting curator /
 * gallerist / collector buckets all fill above the gate.
 */
const DISCOVERY_BLOCKS_MAX = 24;
/**
 * Page size for the artwork feed and its `loadMore`.
 *
 * 24 = 4 cols x ~6 rows of the salon grid — enough for the first paint
 * to feel dense (anchor + 5 standard tiles + a couple of context
 * modules above the fold) without paying the full TTFB cost of a 60-row
 * fetch up-front. The cursor-leak fix (`listPublicArtworks` raw vs
 * visible split, v1.6) lets pagination kick in reliably even at this
 * smaller page size, so subsequent rows arrive as the user scrolls.
 */
const FEED_PAGE_SIZE = 24;

/**
 * Dedupe by id while *preserving* the order in which entries arrived. The
 * RPC layer (`listPublicArtworks`) already orders rows by the active sort
 * — `latest` → created_at desc, `popular` → likes_count desc → created_at
 * desc. If we re-sort here by created_at we silently destroy the popular
 * ordering and the two sort modes look identical on screen. The Living
 * Salon builder only relies on per-type relative order (artworks vs
 * exhibitions are collected separately), so preserving the concat order
 * is enough.
 */
function dedupePreservingOrder(entries: FeedEntry[]): FeedEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const id = e.type === "artwork" ? `a:${e.artwork.id}` : `e:${e.exhibition.id}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

type Props = {
  tab: "all" | "following";
  sort?: "latest" | "popular";
  userId: string | null;
  onTabChange: (tab: "all" | "following") => void;
  onSortChange: (sort: "latest" | "popular") => void;
};

export function FeedContent({
  tab,
  sort = "latest",
  userId,
  onTabChange,
  onSortChange,
}: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useT();
  // Diagnostics panel — enabled by `?debug=feed` URL query OR by setting
  // `localStorage.debug_feed = "1"` in the browser console. Off by
  // default in production. Helps trace silent infinite-scroll halts
  // (cursor=null vs viewport never reaches the sentinel).
  const [debugMode, setDebugMode] = useState(false);
  const [loadMoreCalls, setLoadMoreCalls] = useState(0);
  const [lastLoadMoreFetched, setLastLoadMoreFetched] = useState<{
    artworks: number;
    exhibitions: number;
  } | null>(null);
  const [feedEntries, setFeedEntries] = useState<FeedEntry[]>([]);
  const [discoveryData, setDiscoveryData] = useState<DiscoveryDatum[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [followingProfileIds, setFollowingProfileIds] = useState<string[]>([]);
  const recCacheRef = useRef<{
    profiles: PeopleRec[];
    fetchedAt: number;
  } | null>(null);
  const [artworksNextCursor, setArtworksNextCursor] = useState<ArtworkCursor | null>(null);
  const [exhibitionsNextCursor, setExhibitionsNextCursor] = useState<ExhibitionCursor | null>(null);
  const [followingArtCursor, setFollowingArtCursor] = useState<ArtworkCursor | null>(null);
  const [followingExhCursor, setFollowingExhCursor] = useState<ExhibitionCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const lastFullFetchRef = useRef(0);
  const dataLoadStartedRef = useRef(0);

  useEffect(() => {
    const fromQuery = searchParams?.get("debug") === "feed";
    const fromStorage =
      typeof window !== "undefined" &&
      window.localStorage.getItem("debug_feed") === "1";
    setDebugMode(Boolean(fromQuery || fromStorage));
  }, [searchParams]);

  const fetchRecProfiles = useCallback(async (): Promise<PeopleRec[]> => {
    const now = Date.now();
    if (
      recCacheRef.current &&
      now - recCacheRef.current.fetchedAt < REC_CACHE_TTL_MS
    ) {
      return recCacheRef.current.profiles;
    }
    if (!userId) return [];
    const [likesRes, followRes, expandRes] = await Promise.all([
      getPeopleRecommendations({ lane: "likes_based", limit: 30 }),
      getPeopleRecommendations({ lane: "follow_graph", limit: 30 }),
      getPeopleRecommendations({ lane: "expand", limit: 30 }),
    ]);
    const seen = new Set<string>();
    const strong: PeopleRec[] = [];
    const weak: PeopleRec[] = [];
    const classify = (p: PeopleRec) => {
      if (seen.has(p.id) || p.id === userId) return;
      seen.add(p.id);
      const mut = p.mutual_follow_sources ?? 0;
      const liked = p.liked_artists_count ?? 0;
      const tags = p.reason_tags ?? [];
      const isStrong =
        (tags.includes("follow_graph") && mut >= STRONG_SCORE_THRESHOLD) ||
        (tags.includes("likes_based") && liked >= STRONG_SCORE_THRESHOLD);
      if (isStrong) {
        strong.push(p);
      } else {
        weak.push(p);
      }
    };
    (likesRes.data ?? []).forEach(classify);
    (followRes.data ?? []).forEach(classify);
    (expandRes.data ?? []).forEach(classify);
    // Strong candidates lead, weak candidates fill the carousel so a
    // young platform with few mutuals still surfaces enough people per
    // persona to clear `PEOPLE_CLUSTER_MIN` (= 2). Order is stable.
    const profiles = [...strong, ...weak];
    recCacheRef.current = { profiles, fetchedAt: now };
    return profiles;
  }, [userId]);

  const fetchArtworks = useCallback(
    async (opts?: { force?: boolean; source?: string }) => {
      const force = opts?.force === true;
      const source = opts?.source ?? (force ? "manual" : "ttl");
      if (userId == null && tab === "following") {
        setLoading(false);
        setFeedEntries([]);
        setDiscoveryData([]);
        return;
      }

      if (!force) {
        const now = Date.now();
        const age = now - lastFullFetchRef.current;
        if (age < FEED_BG_REFRESH_TTL_MS && lastFullFetchRef.current > 0) {
          if (process.env.NODE_ENV === "development") {
            console.debug(`[Feed] TTL skip (${source}): ${Math.round(age / 1000)}s < ${FEED_BG_REFRESH_TTL_MS / 1000}s`);
          }
          return;
        }
      }
      if (process.env.NODE_ENV === "development") {
        console.debug(`[Feed] fetch (${source}), force=${force}`);
      }
      lastFullFetchRef.current = Date.now();
      dataLoadStartedRef.current = performance.now();
      markFeedPerf("feed_fetch_started");

      setLoading(true);
      setError(null);
      setArtworksNextCursor(null);
      setExhibitionsNextCursor(null);
      setFollowingArtCursor(null);
      setFollowingExhCursor(null);

      if (tab === "following") {
        const followingRes = await getFollowingIds();
        const followingSet = followingRes.data ?? new Set<string>();
        const ids = Array.from(followingSet);
        setFollowingIds(followingSet);
        setFollowingProfileIds(ids);

        const [artworksRes, exhibitionsRes] = await Promise.all([
          listFollowingArtworks({ limit: FEED_PAGE_SIZE, mergeOwnClaimedWorks: true, followingIds: ids }),
          ids.length > 0
            ? listExhibitionsForFollowingFeed(ids, { limit: 12 })
            : Promise.resolve({
                data: [] as ExhibitionWithCredits[],
                nextCursor: null as ExhibitionCursor | null,
                error: null,
              }),
        ]);

        const list = artworksRes.data ?? [];
        if (artworksRes.error) {
          setError(t("feed.errorTitle"));
          setLoading(false);
          return;
        }
        setFollowingArtCursor(artworksRes.nextCursor ?? null);
        setFollowingExhCursor(exhibitionsRes.nextCursor ?? null);

        const exhibitions = exhibitionsRes.data ?? [];
        // No re-sort: the RPC already orders by the active sort. The
        // Living Salon builder collects artworks and exhibitions
        // separately, so per-type order from the RPC is what reaches
        // the screen.
        const entries: FeedEntry[] = [
          ...list.map((a) => ({ type: "artwork" as const, created_at: a.created_at ?? null, artwork: a })),
          ...exhibitions.map((e) => ({ type: "exhibition" as const, created_at: e.created_at ?? null, exhibition: e })),
        ];
        setFeedEntries(entries);
        const allIds = list.map((a) => a.id);
        const liked = await getLikedArtworkIds(allIds);
        setLikedIds(liked);

        if (process.env.NODE_ENV === "development") {
          console.debug("[Feed] initial fetch (following):", {
            artworks_in: list.length,
            exhibitions_in: exhibitions.length,
            next_art_cursor: artworksRes.nextCursor != null,
            next_exh_cursor: exhibitionsRes.nextCursor != null,
            page_size: FEED_PAGE_SIZE,
          });
        }

        const elapsed = Math.round(performance.now() - dataLoadStartedRef.current);
        logFeedEvent("feed_loaded", {
          tab,
          sort,
          duration_ms: elapsed,
          source,
          item_count: entries.length,
        });
        markFeedPerf("feed_data_loaded_ms", String(elapsed));

        const recProfiles = await fetchRecProfiles();
        // v1.5: every persona renders as a horizontal carousel card with
        // no inline artwork thumbs, so we skip the per-profile artwork
        // fetch entirely. Builder gates the row on `PEOPLE_CLUSTER_MIN`
        // (= 2 profiles) per persona.
        const discoveryWithoutArtworks: DiscoveryDatum[] = recProfiles
          .slice(0, DISCOVERY_BLOCKS_MAX)
          .map((p) => ({ profile: p, artworks: [] }));
        setDiscoveryData(discoveryWithoutArtworks);
        setLoading(false);
        return;
      }

      const [artworksRes, followingRes, exhibitionsRes] = await Promise.all([
        listPublicArtworks({ limit: FEED_PAGE_SIZE, sort }),
        getFollowingIds(),
        listPublicExhibitionsForFeed(20),
      ]);
      const followingSet = followingRes.data ?? new Set<string>();
      setFollowingIds(followingSet);

      const list = artworksRes.data ?? [];
      const err = artworksRes.error;
      if (err) {
        setError(t("feed.errorTitle"));
        setLoading(false);
        return;
      }

      setArtworksNextCursor(artworksRes.nextCursor ?? null);
      setExhibitionsNextCursor(exhibitionsRes.nextCursor ?? null);

      const exhibitions = exhibitionsRes.data ?? [];
      // Same as above — preserve RPC sort. With `popular`, this keeps
      // likes_count desc visible; with `latest`, RPC already gives
      // created_at desc.
      const entries: FeedEntry[] = [
        ...list.map((a) => ({ type: "artwork" as const, created_at: a.created_at ?? null, artwork: a })),
        ...exhibitions.map((e) => ({ type: "exhibition" as const, created_at: e.created_at ?? null, exhibition: e })),
      ];
      setFeedEntries(entries);

      const allIds = list.map((a) => a.id);
      const liked = await getLikedArtworkIds(allIds);
      setLikedIds(liked);

      if (process.env.NODE_ENV === "development") {
        console.debug("[Feed] initial fetch (all):", {
          artworks_in: list.length,
          exhibitions_in: exhibitions.length,
          next_art_cursor: artworksRes.nextCursor != null,
          next_exh_cursor: exhibitionsRes.nextCursor != null,
          page_size: FEED_PAGE_SIZE,
        });
      }

      const elapsed = Math.round(performance.now() - dataLoadStartedRef.current);
      logFeedEvent("feed_loaded", {
        tab,
        sort,
        duration_ms: elapsed,
        source,
        item_count: entries.length,
      });
      markFeedPerf("feed_data_loaded_ms", String(elapsed));

      const recProfiles = await fetchRecProfiles();
      const discoveryWithoutArtworks: DiscoveryDatum[] = recProfiles
        .slice(0, DISCOVERY_BLOCKS_MAX)
        .map((p) => ({ profile: p, artworks: [] }));
      setDiscoveryData(discoveryWithoutArtworks);
      setLoading(false);
    },
    [tab, sort, userId, fetchRecProfiles, t]
  );

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;

    if (tab === "following") {
      const artCur = followingArtCursor;
      const exhCur = followingExhCursor;
      const ids = followingProfileIds;
      if (!artCur && !exhCur) return;
      if (exhCur && ids.length === 0) return;

      loadingMoreRef.current = true;
      setLoadingMore(true);
      const t0 = performance.now();
      try {
        const [artworksRes, exhibitionsRes] = await Promise.all([
          artCur
            ? listFollowingArtworks({
                limit: FEED_PAGE_SIZE,
                cursor: artCur,
                mergeOwnClaimedWorks: false,
              })
            : Promise.resolve({
                data: [] as ArtworkWithLikes[],
                nextCursor: null as ArtworkCursor | null,
                error: null,
              }),
          exhCur && ids.length > 0
            ? listExhibitionsForFollowingFeed(ids, { limit: 12, cursor: exhCur })
            : Promise.resolve({
                data: [] as ExhibitionWithCredits[],
                nextCursor: null as ExhibitionCursor | null,
                error: null,
              }),
        ]);

        setFollowingArtCursor(artworksRes.nextCursor ?? null);
        setFollowingExhCursor(exhibitionsRes.nextCursor ?? null);

        const newArtworks = artworksRes.data ?? [];
        const newExhibitions = exhibitionsRes.data ?? [];
        if (newArtworks.length > 0) {
          const newIds = newArtworks.map((a) => a.id);
          const liked = await getLikedArtworkIds(newIds);
          setLikedIds((prev) => {
            const next = new Set(prev);
            liked.forEach((id) => next.add(id));
            return next;
          });
        }

        const newEntries: FeedEntry[] = [
          ...newArtworks.map((a) => ({ type: "artwork" as const, created_at: a.created_at ?? null, artwork: a })),
          ...newExhibitions.map((e) => ({
            type: "exhibition" as const,
            created_at: e.created_at ?? null,
            exhibition: e,
          })),
        ];
        if (newEntries.length > 0) {
          setFeedEntries((prev) => dedupePreservingOrder([...prev, ...newEntries]));
        }
        const ms = Math.round(performance.now() - t0);
        logFeedEvent("feed_load_more", {
          tab,
          sort,
          duration_ms: ms,
          item_count: newEntries.length,
          source: "load_more",
        });
        setLoadMoreCalls((c) => c + 1);
        setLastLoadMoreFetched({
          artworks: newArtworks.length,
          exhibitions: newExhibitions.length,
        });
        if (process.env.NODE_ENV === "development") {
          console.debug("[Feed] loadMore (following):", {
            artworks_in: newArtworks.length,
            exhibitions_in: newExhibitions.length,
            next_art_cursor: artworksRes.nextCursor != null,
            next_exh_cursor: exhibitionsRes.nextCursor != null,
          });
        }
      } finally {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
      return;
    }

    const hasMore = artworksNextCursor || exhibitionsNextCursor;
    if (!hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const t0 = performance.now();
    try {
      const [artworksRes, exhibitionsRes] = await Promise.all([
        artworksNextCursor
          ? listPublicArtworks({ limit: FEED_PAGE_SIZE, sort, cursor: artworksNextCursor })
          : Promise.resolve({ data: [] as ArtworkWithLikes[], nextCursor: null as ArtworkCursor | null, error: null }),
        exhibitionsNextCursor
          ? listPublicExhibitionsForFeed(20, exhibitionsNextCursor)
          : Promise.resolve({
              data: [] as ExhibitionWithCredits[],
              nextCursor: null as ExhibitionCursor | null,
              error: null,
            }),
      ]);
      setArtworksNextCursor(artworksRes.nextCursor ?? null);
      setExhibitionsNextCursor(exhibitionsRes.nextCursor ?? null);

      const newArtworks = artworksRes.data ?? [];
      const newExhibitions = exhibitionsRes.data ?? [];
      if (newArtworks.length > 0) {
        const newIds = newArtworks.map((a) => a.id);
        const liked = await getLikedArtworkIds(newIds);
        setLikedIds((prev) => {
          const next = new Set(prev);
          liked.forEach((id) => next.add(id));
          return next;
        });
      }

      const newEntries: FeedEntry[] = [
        ...newArtworks.map((a) => ({ type: "artwork" as const, created_at: a.created_at ?? null, artwork: a })),
        ...newExhibitions.map((e) => ({ type: "exhibition" as const, created_at: e.created_at ?? null, exhibition: e })),
      ];
      if (newEntries.length > 0) {
        setFeedEntries((prev) => dedupePreservingOrder([...prev, ...newEntries]));
      }
      const ms = Math.round(performance.now() - t0);
      logFeedEvent("feed_load_more", {
        tab,
        sort,
        duration_ms: ms,
        item_count: newEntries.length,
        source: "load_more",
      });
      setLoadMoreCalls((c) => c + 1);
      setLastLoadMoreFetched({
        artworks: newArtworks.length,
        exhibitions: newExhibitions.length,
      });
      if (process.env.NODE_ENV === "development") {
        console.debug("[Feed] loadMore (all):", {
          artworks_in: newArtworks.length,
          exhibitions_in: newExhibitions.length,
          next_art_cursor: artworksRes.nextCursor != null,
          next_exh_cursor: exhibitionsRes.nextCursor != null,
        });
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [
    tab,
    sort,
    followingArtCursor,
    followingExhCursor,
    followingProfileIds,
    artworksNextCursor,
    exhibitionsNextCursor,
  ]);

  const hasMoreFollowing = tab === "following" && (followingArtCursor != null || followingExhCursor != null);
  const hasMoreAll = tab === "all" && (artworksNextCursor != null || exhibitionsNextCursor != null);
  const hasMore = hasMoreFollowing || hasMoreAll;

  useEffect(() => {
    if (!hasMore) return;

    const el = loadMoreSentinelRef.current;
    let obs: IntersectionObserver | null = null;

    if (el) {
      obs = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && !loadingMoreRef.current) void loadMore();
        },
        { root: null, rootMargin: "800px", threshold: 0 }
      );
      obs.observe(el);
    }

    return () => {
      obs?.disconnect();
    };
  }, [hasMore, loadMore]);

  useEffect(() => {
    void fetchArtworks({ force: true, source: "initial" });
  }, [tab, sort, userId, fetchArtworks]);

  useEffect(() => {
    if (!pathname?.startsWith("/feed")) return;
    void fetchArtworks({ source: "pathname" });
  }, [pathname, fetchArtworks]);

  useEffect(() => {
    function onFocus() {
      void fetchArtworks({ source: "focus" });
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") void fetchArtworks({ source: "visibility" });
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchArtworks]);

  const handleLikeUpdate = useCallback(
    (artworkId: string, liked: boolean, count: number) => {
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (liked) next.add(artworkId);
        else next.delete(artworkId);
        return next;
      });
      setFeedEntries((prev) =>
        prev.map((e) =>
          e.type === "artwork" && e.artwork.id === artworkId
            ? { ...e, artwork: { ...e.artwork, likes_count: count } }
            : e
        )
      );
      setDiscoveryData((prev) =>
        prev.map((d) => ({
          ...d,
          artworks: d.artworks.map((a) =>
            a.id === artworkId ? { ...a, likes_count: count } : a
          ),
        }))
      );
    },
    []
  );

  const handleManualRefresh = useCallback(() => {
    void fetchArtworks({ force: true, source: "manual" });
  }, [fetchArtworks]);

  // Viewer's main_role for the personalization layer. Lives in its own
  // state so the mixer can degrade to "role unknown" while the fetch is
  // in flight — the role boost is small (≤ 25% of one position step), so
  // first paint never visibly changes when the role lands.
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getViewerRoleCached(userId).then((role) => {
      if (!cancelled) setViewerRole(role);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Sprint 3 §2.1 hardening — already-painted tiles must never visibly
  // jump on a load-more append. We freeze the head at every successful
  // paint and only re-rank the tail. The ref is updated inside an effect
  // *after* paint (see useEffect below) so the freeze always reflects
  // what the user actually saw.
  //
  // Reset to 0 whenever a control changes meaning entirely: tab toggle,
  // sort change, or force refresh (= dataLoadStartedRef nonce). Without
  // these resets the user would be locked into the first-paint head when
  // they're trying to ask for something different.
  const personalizedHeadLenRef = useRef(0);
  useEffect(() => {
    // Tab/sort changed → freeze must reset; the next personalize pass
    // sees an empty head and can re-rank the entire window from scratch.
    personalizedHeadLenRef.current = 0;
  }, [tab, sort]);

  // Re-read seen item keys whenever the feed list changes, so load-more
  // arrivals can be down-weighted if the viewer already impressed them
  // earlier this session. The read is a tiny sessionStorage parse — far
  // cheaper than a Supabase round-trip — and is intentionally re-run
  // inside the same useMemo as personalization so the mixer's input set
  // stays consistent.
  const livingSalonItems = useMemo(() => {
    const seenItemKeys = readSeenItemKeys();
    const viewer: ViewerSignals = {
      userId,
      tab,
      sort,
      followingIds,
      likedArtworkIds: likedIds,
      viewerRole,
      seenItemKeys,
    };
    const personalized = personalizeFeedEntries(feedEntries, viewer, {
      frozenHeadCount: personalizedHeadLenRef.current,
    });
    return buildLivingSalonItems({
      entries: personalized.entries,
      discoveryData,
    });
    // `likedIds` and `followingIds` change identity on every Set mutation
    // we do (we always create a new Set in setState), so referential
    // equality is sufficient as a dep.
  }, [
    feedEntries,
    discoveryData,
    userId,
    tab,
    sort,
    followingIds,
    likedIds,
    viewerRole,
  ]);

  // Update freeze AFTER paint completes, so the next personalize pass
  // (caused by a load-more append, viewer-signal change, etc.) treats
  // every tile that was just shown as immutable. This effect runs once
  // per `feedEntries` length change → cheap and predictable.
  useEffect(() => {
    if (loading) return;
    if (feedEntries.length > personalizedHeadLenRef.current) {
      personalizedHeadLenRef.current = feedEntries.length;
    }
  }, [loading, feedEntries.length]);

  useEffect(() => {
    if (loading) return;
    const firstPaint = readFeedPerf("feed_first_paint");
    if (firstPaint == null) {
      markFeedPerf("feed_first_paint");
      const mix = summarizeLivingSalonMix(livingSalonItems);
      const firstView = summarizeFirstView(livingSalonItems);
      logFeedEvent("feed_first_paint", {
        tab,
        sort,
        data_ms: readFeedPerf("feed_data_loaded_ms"),
        item_count: feedEntries.length,
        source: "initial",
        item_mix: {
          artworks: mix.artworks,
          exhibitions: mix.exhibitions,
          people_clusters: mix.people_clusters,
        },
        first_view_estimate: firstView,
        // Whether the personalization layer had a viewer to differentiate
        // on. Lets dashboards split feed_first_paint by personalized vs
        // anonymous without needing user_id reverse-lookup.
        personalization: {
          enabled: userId != null,
          has_role: viewerRole != null,
          following_count: followingIds.size,
          liked_count: likedIds.size,
        },
      });
    }
  }, [
    loading,
    tab,
    sort,
    feedEntries.length,
    livingSalonItems,
    userId,
    viewerRole,
    followingIds,
    likedIds,
  ]);

  const isEmpty = feedEntries.length === 0 && discoveryData.length === 0;
  const isFollowingEmpty = tab === "following" && isEmpty;

  return (
    <div>
      <FeedHeader
        tab={tab}
        sort={sort}
        isLoading={loading}
        onTabChange={onTabChange}
        onSortChange={onSortChange}
        onRefresh={handleManualRefresh}
      />

      {loading ? (
        <FeedGridSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <p className="text-sm text-zinc-700">{error}</p>
          <button
            type="button"
            onClick={handleManualRefresh}
            className="rounded-full border border-zinc-300 px-4 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            {t("feed.errorRetry")}
          </button>
        </div>
      ) : isFollowingEmpty ? (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <p className="text-sm text-zinc-600">{t("feed.followingEmptyTitle")}</p>
          <Link
            href="/people"
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            {t("feed.followingEmptyCta")}
          </Link>
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <p className="text-sm text-zinc-600">{t("feed.noArtworks")}</p>
          {tab === "all" && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/upload"
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                {t("feed.emptyAllCtaUpload")}
              </Link>
              <Link
                href="/people"
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {t("feed.emptyAllCtaPeople")}
              </Link>
            </div>
          )}
        </div>
      ) : (
        <LivingSalonGrid
          items={livingSalonItems}
          likedIds={likedIds}
          followingIds={followingIds}
          userId={userId}
          onLikeUpdate={handleLikeUpdate}
          tab={tab}
          sort={sort}
        />
      )}

      {hasMore ? (
        <div
          ref={loadMoreSentinelRef}
          className="flex min-h-[80px] items-center justify-center py-6"
          aria-hidden
        >
          {loadingMore && (
            <span className="text-xs text-zinc-500">{t("feed.loading")}</span>
          )}
        </div>
      ) : feedEntries.length > 0 ? (
        <p className="py-10 text-center text-xs text-zinc-400">
          {t("feed.caughtUp")}
        </p>
      ) : null}

      {debugMode && (
        <FeedDebugPanel
          tab={tab}
          sort={sort}
          feedEntriesCount={feedEntries.length}
          livingSalonCount={livingSalonItems.length}
          discoveryCount={discoveryData.length}
          artworksNextCursor={artworksNextCursor}
          exhibitionsNextCursor={exhibitionsNextCursor}
          followingArtCursor={followingArtCursor}
          followingExhCursor={followingExhCursor}
          hasMore={hasMore}
          loadingMore={loadingMore}
          loadMoreCalls={loadMoreCalls}
          lastLoadMoreFetched={lastLoadMoreFetched}
          discoveryData={discoveryData}
        />
      )}
    </div>
  );
}

function FeedDebugPanel({
  tab,
  sort,
  feedEntriesCount,
  livingSalonCount,
  discoveryCount,
  artworksNextCursor,
  exhibitionsNextCursor,
  followingArtCursor,
  followingExhCursor,
  hasMore,
  loadingMore,
  loadMoreCalls,
  lastLoadMoreFetched,
  discoveryData,
}: {
  tab: "all" | "following";
  sort: "latest" | "popular";
  feedEntriesCount: number;
  livingSalonCount: number;
  discoveryCount: number;
  artworksNextCursor: ArtworkCursor | null;
  exhibitionsNextCursor: ExhibitionCursor | null;
  followingArtCursor: ArtworkCursor | null;
  followingExhCursor: ExhibitionCursor | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreCalls: number;
  lastLoadMoreFetched: { artworks: number; exhibitions: number } | null;
  discoveryData: DiscoveryDatum[];
}) {
  const personaCounts = discoveryData.reduce(
    (acc: Record<string, number>, d) => {
      const role = d.profile.main_role ?? "unknown";
      acc[role] = (acc[role] ?? 0) + 1;
      return acc;
    },
    {}
  );
  const cursorLabel = (cur: unknown) =>
    cur == null ? "null" : "present";
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-[280px] rounded-md border border-zinc-300 bg-white/95 p-3 text-[11px] leading-relaxed text-zinc-700 shadow-lg backdrop-blur">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Feed debug
      </div>
      <div>tab: {tab} · sort: {sort}</div>
      <div>
        feedEntries: <b>{feedEntriesCount}</b> · salonItems:{" "}
        <b>{livingSalonCount}</b>
      </div>
      <div>
        discovery: <b>{discoveryCount}</b> ({Object.entries(personaCounts)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ") || "—"})
      </div>
      <div className="mt-1 border-t border-zinc-200 pt-1">
        <div>
          art cursor:{" "}
          <b>
            {tab === "all"
              ? cursorLabel(artworksNextCursor)
              : cursorLabel(followingArtCursor)}
          </b>
        </div>
        <div>
          exh cursor:{" "}
          <b>
            {tab === "all"
              ? cursorLabel(exhibitionsNextCursor)
              : cursorLabel(followingExhCursor)}
          </b>
        </div>
        <div>
          hasMore: <b>{hasMore ? "yes" : "no"}</b> · loading:{" "}
          <b>{loadingMore ? "yes" : "no"}</b>
        </div>
      </div>
      <div className="mt-1 border-t border-zinc-200 pt-1">
        <div>
          loadMore calls: <b>{loadMoreCalls}</b>
        </div>
        <div>
          last fetch: <b>{lastLoadMoreFetched
            ? `${lastLoadMoreFetched.artworks}art / ${lastLoadMoreFetched.exhibitions}exh`
            : "—"}</b>
        </div>
      </div>
    </div>
  );
}

