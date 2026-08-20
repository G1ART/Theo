"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import {
  listPublicArtworks,
  type ArtworkCursor,
  type ArtworkWithLikes,
} from "@/lib/supabase/artworks";
import {
  listPublicExhibitionsForFeed,
  type ExhibitionCursor,
  type ExhibitionWithCredits,
} from "@/lib/supabase/exhibitions";
import {
  listPublicProfiles,
  type ProfileListCursor,
  type ProfileListItem,
} from "@/lib/supabase/profiles";
import {
  readFeedSnapshot,
  saveFeedSnapshot,
  type FeedSnapshot,
} from "@/lib/feed/scrollSnapshot";
import { ExploreArtworkCard } from "./explore/ExploreArtworkCard";
import { ExploreArtistCard } from "./explore/ExploreArtistCard";
import { ExploreExhibitionCard } from "./explore/ExploreExhibitionCard";
import { EmptyState, FeedGridSkeleton } from "@/components/ds";

type Tab = "artworks" | "artists" | "exhibitions" | "all";
type Sort = "latest" | "popular";

type Props = {
  tab: Tab;
  sort: Sort;
  userId: string | null;
  onSortChange: (sort: Sort) => void;
};

const PAGE_SIZE = 24;

/**
 * Shape of the sessionStorage snapshot for this component. The
 * union-of-list-slots is deliberate — a given tab only touches a
 * subset, and we snapshot everything so a re-tab (e.g. artworks →
 * back) still hydrates cleanly even when the outer tab prop changes.
 */
type ExploreSnapshot = {
  artworks: ArtworkWithLikes[];
  artworksCursor: ArtworkCursor | null;
  exhibitions: ExhibitionWithCredits[];
  exhibitionsCursor: ExhibitionCursor | null;
  artists: ProfileListItem[];
  artistsCursor: ProfileListCursor | null;
};

function exploreSnapshotKey(tab: Tab, sort: Sort): string {
  return `explore:${tab}:${sort}`;
}

/**
 * Type-filtered Explore body used for the wireframe taxonomy tabs
 * (Artworks / Artists / Exhibitions / All). This is intentionally simpler
 * than the personalized `FeedContent` — no Living Salon composition, no
 * follow-based freezing — because these lanes exist so a first-time /
 * anonymous visitor can browse a single kind of thing without the
 * personalization layer getting in the way.
 *
 * `locked` (based on `userId`) blurs the identity slice on each card and
 * routes clicks to `/onboarding?next=<detail>` (signup-first), matching the
 * product decision to make the feed public but send a cold visitor straight
 * to signup the moment they tap a detail.
 */
export function ExploreTaxonomyContent({ tab, sort, userId }: Props) {
  const { t } = useT();
  const locked = !userId;

  const snapshotKey = exploreSnapshotKey(tab, sort);

  // Read the snapshot once during first render so state slots + scroll
  // can be seeded synchronously. See `FeedContent` for the extended
  // rationale — this is the taxonomy-side sibling of the same fix.
  const initialSnapshotRef = useRef<FeedSnapshot<ExploreSnapshot> | null | undefined>(
    undefined
  );
  if (initialSnapshotRef.current === undefined) {
    initialSnapshotRef.current = readFeedSnapshot<ExploreSnapshot>(snapshotKey);
  }
  const hydrated = initialSnapshotRef.current !== null;
  const initialState = initialSnapshotRef.current?.state;

  const [artworks, setArtworks] = useState<ArtworkWithLikes[]>(
    () => initialState?.artworks ?? []
  );
  const [artworksCursor, setArtworksCursor] = useState<ArtworkCursor | null>(
    () => initialState?.artworksCursor ?? null
  );
  const [exhibitions, setExhibitions] = useState<ExhibitionWithCredits[]>(
    () => initialState?.exhibitions ?? []
  );
  const [exhibitionsCursor, setExhibitionsCursor] = useState<ExhibitionCursor | null>(
    () => initialState?.exhibitionsCursor ?? null
  );
  const [artists, setArtists] = useState<ProfileListItem[]>(
    () => initialState?.artists ?? []
  );
  const [artistsCursor, setArtistsCursor] = useState<ProfileListCursor | null>(
    () => initialState?.artistsCursor ?? null
  );
  const [loading, setLoading] = useState(!hydrated);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Set to true when hydration filled state — the initial-fetch effect
  // consumes and clears the flag so subsequent tab/sort changes still
  // refetch normally.
  const skipInitialFetchRef = useRef(hydrated);

  const needsArtworks = tab === "artworks" || tab === "all";
  const needsExhibitions = tab === "exhibitions" || tab === "all";
  const needsArtists = tab === "artists";

  const fetchInitial = useCallback(async () => {
    setLoading(true);
    const jobs: Promise<unknown>[] = [];
    if (needsArtworks) {
      jobs.push(
        listPublicArtworks({ limit: PAGE_SIZE, sort }).then((res) => {
          setArtworks(res.data ?? []);
          setArtworksCursor(res.nextCursor ?? null);
        })
      );
    } else {
      setArtworks([]);
      setArtworksCursor(null);
    }
    if (needsExhibitions) {
      jobs.push(
        listPublicExhibitionsForFeed(PAGE_SIZE / 2).then((res) => {
          setExhibitions(res.data ?? []);
          setExhibitionsCursor(res.nextCursor ?? null);
        })
      );
    } else {
      setExhibitions([]);
      setExhibitionsCursor(null);
    }
    if (needsArtists) {
      jobs.push(
        listPublicProfiles({ role: "artist", limit: PAGE_SIZE }).then((res) => {
          setArtists(res.data ?? []);
          setArtistsCursor(res.nextCursor ?? null);
        })
      );
    } else {
      setArtists([]);
      setArtistsCursor(null);
    }
    await Promise.all(jobs);
    setLoading(false);
  }, [needsArtworks, needsExhibitions, needsArtists, sort]);

  useEffect(() => {
    if (skipInitialFetchRef.current) {
      // Snapshot hydration already primed the state slots; consume
      // the flag so future tab/sort changes still refetch fresh.
      skipInitialFetchRef.current = false;
      return;
    }
    void fetchInitial();
  }, [fetchInitial]);

  // Blocks paint until we've moved the viewport to the pre-navigation
  // scroll offset — prevents a paint-then-jump flicker on back-nav.
  useLayoutEffect(() => {
    const snap = initialSnapshotRef.current;
    if (!snap) return;
    window.scrollTo(0, snap.scrollY);
    const raf = window.requestAnimationFrame(() => {
      window.scrollTo(0, snap.scrollY);
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, []);

  // Latest-values ref for the snapshot listeners below. Kept out of
  // the listener effect's dep list so we don't re-add DOM listeners
  // every render.
  const persistStateRef = useRef<ExploreSnapshot>({
    artworks: [],
    artworksCursor: null,
    exhibitions: [],
    exhibitionsCursor: null,
    artists: [],
    artistsCursor: null,
  });
  useEffect(() => {
    persistStateRef.current = {
      artworks,
      artworksCursor,
      exhibitions,
      exhibitionsCursor,
      artists,
      artistsCursor,
    };
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const persist = () => {
      const state = persistStateRef.current;
      // Snapshot only after the first fetch has landed for the current
      // tab. Prevents overwriting a valid restore payload with an
      // empty one before content mounts.
      const hasArtworks = state.artworks.length > 0;
      const hasExhibitions = state.exhibitions.length > 0;
      const hasArtists = state.artists.length > 0;
      if (!hasArtworks && !hasExhibitions && !hasArtists) return;
      saveFeedSnapshot(snapshotKey, state, window.scrollY);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") persist();
    };
    const onPageHide = () => persist();
    const onClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (
        href.startsWith("/artwork/") ||
        href.startsWith("/exhibition/") ||
        href.startsWith("/artist/") ||
        href.startsWith("/@") ||
        href.startsWith("/u/") ||
        href.startsWith("/e/")
      ) {
        persist();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("click", onClick, true);
      persist();
    };
  }, [snapshotKey]);

  const hasMore =
    (needsArtworks && artworksCursor != null) ||
    (needsExhibitions && exhibitionsCursor != null) ||
    (needsArtists && artistsCursor != null);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const jobs: Promise<unknown>[] = [];
      if (needsArtworks && artworksCursor) {
        jobs.push(
          listPublicArtworks({ limit: PAGE_SIZE, sort, cursor: artworksCursor }).then((res) => {
            setArtworks((prev) => [...prev, ...(res.data ?? [])]);
            setArtworksCursor(res.nextCursor ?? null);
          })
        );
      }
      if (needsExhibitions && exhibitionsCursor) {
        jobs.push(
          listPublicExhibitionsForFeed(PAGE_SIZE / 2, exhibitionsCursor).then((res) => {
            setExhibitions((prev) => [...prev, ...(res.data ?? [])]);
            setExhibitionsCursor(res.nextCursor ?? null);
          })
        );
      }
      if (needsArtists && artistsCursor) {
        jobs.push(
          listPublicProfiles({ role: "artist", limit: PAGE_SIZE, cursor: artistsCursor }).then(
            (res) => {
              setArtists((prev) => [...prev, ...(res.data ?? [])]);
              setArtistsCursor(res.nextCursor ?? null);
            }
          )
        );
      }
      await Promise.all(jobs);
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [
    hasMore,
    needsArtworks,
    needsExhibitions,
    needsArtists,
    artworksCursor,
    exhibitionsCursor,
    artistsCursor,
    sort,
  ]);

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingRef.current) void loadMore();
      },
      { rootMargin: "800px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMore]);

  const isEmpty = useMemo(() => {
    if (tab === "artists") return artists.length === 0;
    if (tab === "exhibitions") return exhibitions.length === 0;
    if (tab === "artworks") return artworks.length === 0;
    return artworks.length === 0 && exhibitions.length === 0;
  }, [tab, artworks.length, exhibitions.length, artists.length]);

  if (loading) return <FeedGridSkeleton />;

  if (isEmpty) {
    const title =
      tab === "artists"
        ? t("feed.artistsEmpty")
        : tab === "exhibitions"
          ? t("feed.exhibitionsEmpty")
          : t("feed.noArtworks");
    return <EmptyState title={title} size="sm" />;
  }

  return (
    <div>
      {locked && (
        <p className="mb-6 text-xs text-zinc-500">{t("feed.anonHint")}</p>
      )}

      {tab === "artists" ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2">
          {artists.map((p) => (
            <ExploreArtistCard key={p.id} profile={p} locked={locked} />
          ))}
        </div>
      ) : tab === "exhibitions" ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2">
          {exhibitions.map((e) => (
            <ExploreExhibitionCard key={e.id} exhibition={e} locked={locked} />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2">
            {artworks.map((a) => (
              <ExploreArtworkCard key={a.id} artwork={a} locked={locked} />
            ))}
            {tab === "all" &&
              exhibitions.map((e) => (
                <ExploreExhibitionCard key={`e-${e.id}`} exhibition={e} locked={locked} />
              ))}
          </div>
        </>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="flex min-h-[80px] items-center justify-center py-6">
          {loadingMore && (
            <span className="text-xs text-zinc-500">{t("feed.loading")}</span>
          )}
        </div>
      )}
    </div>
  );
}
