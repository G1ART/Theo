"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { EmptyState, FeedGridSkeleton } from "@/components/ds";
import { keepVisibleModules } from "@/lib/feed/walk/content";
import type { FeedModule, WalkLane, WalkPage } from "@/lib/feed/walk/types";
import { saveFeedSnapshot } from "@/lib/feed/scrollSnapshot";
import {
  canWriteFeedSnapshot,
  feedResetRefetches,
  handleFeedSnapshotClick,
  readFeedSnapshotForMount,
  subscribeFeedReset,
} from "@/lib/feed/scrollRestore";
import { useT } from "@/lib/i18n/useT";
import { supabase } from "@/lib/supabase/client";
import { WalkModuleView } from "./WalkModules";

type Props = {
  userId: string | null;
  lane: WalkLane;
  sort: "latest" | "popular";
};

type WalkSnap = {
  userId: string | null;
  modules: FeedModule[];
  cursor: string | null;
  hasMore: boolean;
};

function snapshotKeyFor(pathname: string, search: string, lane: WalkLane, sort: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return `walk:${pathname || "/feed"}${query ? `?${query}` : ""}:${lane}:${sort}`;
}

function readWalkSnap(key: string, userId: string | null): { modules: FeedModule[]; cursor: string | null; hasMore: boolean; scrollY: number } | null {
  const snap = readFeedSnapshotForMount<WalkSnap>(key);
  const state = snap?.state;
  if (!snap || !state || state.userId !== userId || !Array.isArray(state.modules)) return null;
  const modules = keepVisibleModules(state.modules);
  if (modules.length === 0) return null;
  return {
    modules,
    cursor: typeof state.cursor === "string" ? state.cursor : null,
    hasMore: Boolean(state.hasMore) && typeof state.cursor === "string",
    scrollY: snap.scrollY,
  };
}

export function FeedWalk({ userId, lane, sort }: Props) {
  const { t, locale } = useT();
  const pathname = usePathname() || "/feed";
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const snapshotKey = snapshotKeyFor(pathname, search, lane, sort);
  const bootRef = useRef<ReturnType<typeof readWalkSnap> | null | undefined>(undefined);
  if (bootRef.current === undefined) {
    bootRef.current = readWalkSnap(snapshotKey, userId);
  }
  const boot = bootRef.current;

  const [modules, setModules] = useState<FeedModule[]>(() => boot?.modules ?? []);
  const [loading, setLoading] = useState(() => !boot);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(() => Boolean(boot?.hasMore));
  const fetchSeqRef = useRef(0);
  const cursorRef = useRef<string | null>(boot?.cursor ?? null);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const inflightRef = useRef<{ cursor: string; promise: Promise<WalkPage> } | null>(null);
  const restoreY = useRef<number | null>(boot && boot.scrollY > 0 ? boot.scrollY : null);
  const restoreGen = useRef(0);
  const snapshotKeyRef = useRef(snapshotKey);
  snapshotKeyRef.current = snapshotKey;

  const requestPage = useCallback(
    async (cursor: string | null): Promise<WalkPage> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch("/api/feed/walk", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ cursor, lane, sort, locale }),
      });
      if (!response.ok) throw new Error("walk");
      const json = (await response.json()) as Partial<WalkPage>;
      return {
        scenario: json.scenario ?? null,
        modules: keepVisibleModules(Array.isArray(json.modules) ? json.modules : []),
        nextCursor: typeof json.nextCursor === "string" ? json.nextCursor : null,
      };
    },
    [lane, sort, locale]
  );

  const prefetch = useCallback(
    (cursor: string | null) => {
      if (!cursor) {
        inflightRef.current = null;
        return;
      }
      if (inflightRef.current?.cursor === cursor) return;
      const promise = requestPage(cursor);
      inflightRef.current = { cursor, promise };
      promise.catch(() => {
        if (inflightRef.current?.cursor === cursor) inflightRef.current = null;
      });
    },
    [requestPage]
  );

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    const y = restoreY.current;
    if (y == null || modules.length === 0) return;
    const gen = restoreGen.current;
    let frames = 0;
    let raf = 0;
    const tick = () => {
      if (gen !== restoreGen.current) return;
      window.scrollTo(0, y);
      frames += 1;
      const landed = Math.abs(window.scrollY - y) <= 2;
      if (landed || frames >= 24) {
        restoreY.current = null;
        return;
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [modules]);

  useEffect(() => {
    const seq = ++fetchSeqRef.current;
    const saved = readWalkSnap(snapshotKey, userId);
    if (saved) {
      if (saved.scrollY > 0) restoreY.current = saved.scrollY;
      cursorRef.current = saved.cursor;
      setModules(saved.modules);
      setHasMore(saved.hasMore);
      setLoading(false);
      setError(false);
      prefetch(saved.cursor);
      return;
    }
    restoreY.current = null;
    cursorRef.current = null;
    loadingMoreRef.current = false;
    inflightRef.current = null;
    setModules([]);
    setLoading(true);
    setPaging(false);
    setError(false);
    void requestPage(null)
      .then((page) => {
        if (seq !== fetchSeqRef.current) return;
        setModules(page.modules);
        cursorRef.current = page.nextCursor;
        setHasMore(Boolean(page.nextCursor) && page.modules.length > 0);
        setLoading(false);
        prefetch(page.nextCursor);
      })
      .catch(() => {
        if (seq !== fetchSeqRef.current) return;
        setModules([]);
        setError(true);
        setHasMore(false);
        setLoading(false);
      });
  }, [prefetch, requestPage, snapshotKey, userId]);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (loadingMoreRef.current || !cursor) return;
    loadingMoreRef.current = true;
    const seq = fetchSeqRef.current;
    const pending = inflightRef.current?.cursor === cursor ? inflightRef.current.promise : null;
    if (inflightRef.current?.cursor === cursor) inflightRef.current = null;
    const spinner = window.setTimeout(() => {
      if (seq === fetchSeqRef.current) setPaging(true);
    }, 180);
    try {
      const page = pending ? await pending : await requestPage(cursor);
      if (seq !== fetchSeqRef.current) return;
      setModules((prev) => appendUnique(prev, page.modules));
      cursorRef.current = page.nextCursor;
      setHasMore(Boolean(page.nextCursor) && page.modules.length > 0);
      prefetch(page.nextCursor);
    } catch {
      if (seq === fetchSeqRef.current) setError(true);
    } finally {
      window.clearTimeout(spinner);
      loadingMoreRef.current = false;
      if (seq === fetchSeqRef.current) setPaging(false);
    }
  }, [prefetch, requestPage]);

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMoreRef.current) void loadMore();
      },
      { root: null, rootMargin: "1400px", threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMore, modules.length]);

  const persistStateRef = useRef<WalkSnap>({
    userId,
    modules,
    cursor: cursorRef.current,
    hasMore,
  });
  useEffect(() => {
    persistStateRef.current = {
      userId,
      modules,
      cursor: cursorRef.current,
      hasMore,
    };
  });

  useEffect(() => {
    const persist = () => {
      if (!canWriteFeedSnapshot()) return;
      const state = persistStateRef.current;
      if (state.modules.length === 0) return;
      const y = window.scrollY;
      // A restore mount paints at 0 for a frame. Don't overwrite the
      // detail-return snapshot before scrollTo lands.
      if (y === 0 && restoreY.current != null) return;
      saveFeedSnapshot(snapshotKeyRef.current, state, y);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") persist();
    };
    const onPageHide = () => persist();
    const onClick = (ev: MouseEvent) => {
      handleFeedSnapshotClick(ev, persist);
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

  useEffect(() => {
    return subscribeFeedReset(() => {
      restoreGen.current += 1;
      restoreY.current = null;
      window.scrollTo(0, 0);
      if (!feedResetRefetches()) return;
      cursorRef.current = null;
      loadingMoreRef.current = false;
      inflightRef.current = null;
      const seq = ++fetchSeqRef.current;
      setModules([]);
      setHasMore(false);
      setError(false);
      setLoading(true);
      setPaging(false);
      void requestPage(null)
        .then((page) => {
          if (seq !== fetchSeqRef.current) return;
          setModules(page.modules);
          cursorRef.current = page.nextCursor;
          setHasMore(Boolean(page.nextCursor) && page.modules.length > 0);
          setLoading(false);
          prefetch(page.nextCursor);
        })
        .catch(() => {
          if (seq !== fetchSeqRef.current) return;
          setModules([]);
          setError(true);
          setHasMore(false);
          setLoading(false);
        });
    });
  }, [prefetch, requestPage]);

  if (loading && modules.length === 0) {
    return <FeedGridSkeleton />;
  }

  if (error && modules.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-zinc-700">{t("feed.walk.error")}</p>
        <button
          type="button"
          onClick={() => {
            fetchSeqRef.current += 1;
            inflightRef.current = null;
            setLoading(true);
            setError(false);
            const seq = fetchSeqRef.current;
            void requestPage(null)
              .then((page) => {
                if (seq !== fetchSeqRef.current) return;
                setModules(page.modules);
                cursorRef.current = page.nextCursor;
                setHasMore(Boolean(page.nextCursor) && page.modules.length > 0);
                setLoading(false);
                prefetch(page.nextCursor);
              })
              .catch(() => {
                if (seq !== fetchSeqRef.current) return;
                setError(true);
                setLoading(false);
              });
          }}
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
        >
          {t("feed.errorRetry")}
        </button>
      </div>
    );
  }

  if (modules.length === 0) {
    return (
      <EmptyState
        title={t(lane === "following" ? "feed.followingEmptyTitle" : "feed.walk.empty.title")}
        description={t(lane === "following" ? "feed.walk.followEmpty.body" : "feed.walk.empty.body")}
        action={
          lane === "following"
            ? { label: t("feed.followingEmptyCta"), href: "/people" }
            : { label: t("feed.walk.empty.cta"), href: "/feed?tab=artworks" }
        }
      />
    );
  }

  return (
    <div>
      {modules.map((module) => (
        <WalkModuleView key={module.key} module={module} userId={userId} lane={lane} />
      ))}
      {hasMore && <div ref={sentinelRef} className="h-8" />}
      {paging && <p className="py-4 text-center text-xs text-zinc-400">{t("feed.walk.loading")}</p>}
      {error && modules.length > 0 && (
        <p className="py-4 text-center text-xs text-zinc-500">{t("feed.walk.error")}</p>
      )}
    </div>
  );
}

function appendUnique(prev: FeedModule[], next: FeedModule[]): FeedModule[] {
  const seen = new Set(prev.map((module) => module.key));
  const extra = keepVisibleModules(next).filter((module) => module && !seen.has(module.key));
  return extra.length > 0 ? [...prev, ...extra] : prev;
}
