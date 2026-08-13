"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import {
  displaySummary,
  getTheoBoardRail,
  type TheoBoardPost,
} from "@/lib/supabase/theoBoard";
import { relativeTime } from "@/lib/time/relative";
import {
  TheoBoardPlaceholderRows,
  TheoBoardTypeChip,
} from "@/components/theo-board/TheoBoardTypeChip";

function PostRow({ post, locale }: { post: TheoBoardPost; locale: "en" | "ko" }) {
  const { t } = useT();
  const time = post.published_at
    ? relativeTime(post.published_at, locale)
    : "";
  const summary = displaySummary(post);
  const inner = (
    <>
      <TheoBoardTypeChip type={post.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm text-zinc-900">{post.title}</p>
          {time && (
            <span className="shrink-0 text-[11px] text-zinc-400">{time}</span>
          )}
        </div>
        {summary && (
          <p className="truncate text-xs text-zinc-500">{summary}</p>
        )}
      </div>
    </>
  );

  const rowCls =
    "flex items-start gap-3 p-3 hover:bg-zinc-50";

  if (post.href) {
    return (
      <a
        href={post.href}
        target="_blank"
        rel="noopener noreferrer"
        className={rowCls}
        title={t("theoBoard.externalLink")}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link href={`/theo-board/${post.id}`} className={rowCls}>
      {inner}
    </Link>
  );
}

export function TheoBoardRail() {
  const { t, locale } = useT();
  const [posts, setPosts] = useState<TheoBoardPost[] | null>(null);

  useEffect(() => {
    let alive = true;
    getTheoBoardRail(6).then(({ data, error }) => {
      if (!alive) return;
      if (error || data.length === 0) {
        setPosts([]);
        return;
      }
      setPosts(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  const showReal = posts !== null && posts.length > 0;

  return (
    <section aria-label={t("rail.theoBoard.title")}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">
          {t("rail.theoBoard.title")}
        </h2>
        <Link
          href="/theo-board"
          className="text-xs text-zinc-400 hover:text-zinc-700"
        >
          {t("rail.theoBoard.more")} ›
        </Link>
      </div>
      {showReal ? (
        <ul className="rounded-lg border border-zinc-200 bg-white">
          {posts.map((post, idx) => (
            <li
              key={post.id}
              className={idx > 0 ? "border-t border-zinc-100" : ""}
            >
              <PostRow post={post} locale={locale} />
            </li>
          ))}
        </ul>
      ) : (
        <TheoBoardPlaceholderRows />
      )}
    </section>
  );
}
