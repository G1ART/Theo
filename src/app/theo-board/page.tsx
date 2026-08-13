"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { FilterChip } from "@/components/ds/FilterChip";
import { EmptyState } from "@/components/ds/EmptyState";
import { useT } from "@/lib/i18n/useT";
import { relativeTime } from "@/lib/time/relative";
import {
  THEO_BOARD_TYPES,
  displaySummary,
  getTheoBoardPage,
  type TheoBoardPost,
  type TheoBoardType,
  theoBoardTypeLabelKey,
} from "@/lib/supabase/theoBoard";
import {
  TheoBoardPlaceholderRows,
  TheoBoardTypeChip,
} from "@/components/theo-board/TheoBoardTypeChip";

const PAGE_LIMIT = 20;

function PostLink({
  post,
  locale,
  t,
}: {
  post: TheoBoardPost;
  locale: "en" | "ko";
  t: (key: string) => string;
}) {
  const time = post.published_at
    ? relativeTime(post.published_at, locale)
    : "";
  const summary = displaySummary(post);
  const inner = (
    <div className="flex items-start gap-3 px-4 py-4 hover:bg-zinc-50">
      <TheoBoardTypeChip type={post.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-zinc-900">
            {post.title}
          </p>
          {time && (
            <span className="shrink-0 text-[11px] text-zinc-400">{time}</span>
          )}
        </div>
        {summary && (
          <p className="mt-0.5 truncate text-xs text-zinc-500">{summary}</p>
        )}
      </div>
    </div>
  );

  if (post.href) {
    return (
      <a
        href={post.href}
        target="_blank"
        rel="noopener noreferrer"
        title={t("theoBoard.externalLink")}
      >
        {inner}
      </a>
    );
  }

  return <Link href={`/theo-board/${post.id}`}>{inner}</Link>;
}

export default function TheoBoardPage() {
  const { t, locale } = useT();
  const [type, setType] = useState<TheoBoardType | null>(null);
  const [posts, setPosts] = useState<TheoBoardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(
    async (offset: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      const { data, error } = await getTheoBoardPage({
        offset,
        limit: PAGE_LIMIT,
        type,
      });
      if (error) {
        if (!append) {
          setFailed(true);
          setPosts([]);
        }
        setHasMore(false);
        setLoading(false);
        setLoadingMore(false);
        return;
      }
      setFailed(false);
      setPosts((prev) => (append ? [...prev, ...data] : data));
      setHasMore(data.length === PAGE_LIMIT);
      setLoading(false);
      setLoadingMore(false);
    },
    [type],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getTheoBoardPage({ offset: 0, limit: PAGE_LIMIT, type }).then(
      ({ data, error }) => {
        if (!alive) return;
        if (error) {
          setFailed(true);
          setPosts([]);
          setHasMore(false);
        } else {
          setFailed(false);
          setPosts(data);
          setHasMore(data.length === PAGE_LIMIT);
        }
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [type]);

  return (
    <PageShell>
      <PageHeader
        variant="plain"
        title={t("theoBoard.title")}
        lead={t("theoBoard.lead")}
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <FilterChip active={type === null} onClick={() => setType(null)}>
          {t("theoBoard.filterAll")}
        </FilterChip>
        {THEO_BOARD_TYPES.map((ty) => (
          <FilterChip
            key={ty}
            active={type === ty}
            onClick={() => setType(ty)}
          >
            {t(theoBoardTypeLabelKey(ty))}
          </FilterChip>
        ))}
      </div>

      {loading ? (
        <TheoBoardPlaceholderRows />
      ) : failed ? (
        <div>
          <p className="mb-3 text-sm text-zinc-500">
            {t("rail.theoBoard.placeholder")}
          </p>
          <TheoBoardPlaceholderRows />
        </div>
      ) : posts.length === 0 ? (
        <EmptyState title={t("theoBoard.empty")} size="sm" />
      ) : (
        <>
          <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white">
            {posts.map((post) => (
              <li key={post.id}>
                <PostLink post={post} locale={locale} t={t} />
              </li>
            ))}
          </ul>
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => load(posts.length, true)}
                className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                {t("theoBoard.loadMore")}
              </button>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
