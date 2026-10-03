"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, FeedGridSkeleton } from "@/components/ds";
import type { FeedModule, WalkLane, WalkPage } from "@/lib/feed/walk/types";
import { useT } from "@/lib/i18n/useT";
import { supabase } from "@/lib/supabase/client";
import { WalkModuleView } from "./WalkModules";

type Props = {
  userId: string | null;
  lane: WalkLane;
  sort: "latest" | "popular";
};

export function FeedWalk({ userId, lane, sort }: Props) {
  const { t, locale } = useT();
  const [modules, setModules] = useState<FeedModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const fetchSeqRef = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const inflightRef = useRef<{ cursor: string; promise: Promise<WalkPage> } | null>(null);

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
        modules: Array.isArray(json.modules) ? json.modules : [],
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
    const seq = ++fetchSeqRef.current;
    cursorRef.current = null;
    loadingMoreRef.current = false;
    inflightRef.current = null;
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
  }, [prefetch, requestPage, userId]);

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
  const extra = next.filter((module) => module && !seen.has(module.key));
  return extra.length > 0 ? [...prev, ...extra] : prev;
}
