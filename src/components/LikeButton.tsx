"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import { logFeedEvent, type FeedSort, type FeedTab } from "@/lib/feed/telemetry";
import { like, unlike } from "@/lib/supabase/likes";

/**
 * Surface attribution for telemetry. When set to `feed`, a successful like
 * additionally emits `feed_item_like_or_save` with the active tab/sort/
 * position so dashboards can split feed-driven likes from profile-page
 * likes without changing the existing `artwork_liked` event.
 */
export type LikeSurface = "feed" | "artwork_detail" | "profile" | "other";

type Props = {
  artworkId: string;
  likesCount: number;
  isLiked: boolean;
  onUpdate?: (newLiked: boolean, newCount: number) => void;
  /** When true, show "Login to like" instead of like button */
  showLoginCta?: boolean;
  size?: "sm" | "md";
  /** Optional surface tag for telemetry attribution. */
  surface?: LikeSurface;
  /** Required when surface === "feed" so we can log feed-side context. */
  feedContext?: {
    tab: FeedTab;
    sort?: FeedSort;
    position: number;
  };
};

export function LikeButton({
  artworkId,
  likesCount: initialCount,
  isLiked: initialLiked,
  onUpdate,
  showLoginCta = false,
  size = "md",
  surface,
  feedContext,
}: Props) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (showLoginCta || loading) return;
      const nextLiked = !liked;
      const nextCount = count + (nextLiked ? 1 : -1);
      setLiked(nextLiked);
      setCount(nextCount);
      setLoading(true);
      const { error } = nextLiked
        ? await like(artworkId)
        : await unlike(artworkId);
      setLoading(false);
      if (error) {
        setLiked(liked);
        setCount(count);
        return;
      }
      if (nextLiked) {
        logBetaEventSync("artwork_liked", {
          artwork_id: artworkId,
          surface: surface ?? "other",
        });
        if (surface === "feed" && feedContext) {
          logFeedEvent("feed_item_like_or_save", {
            tab: feedContext.tab,
            sort: feedContext.sort,
            item_kind: "artwork",
            item_id: artworkId,
            position: feedContext.position,
            action: "like",
          });
        }
      }
      onUpdate?.(nextLiked, nextCount);
    },
    [artworkId, liked, count, loading, showLoginCta, onUpdate, surface, feedContext]
  );

  if (showLoginCta) {
    return (
      <Link
        href="/onboarding"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1.5 text-zinc-500 hover:text-zinc-800 ${
          size === "sm" ? "text-sm" : "text-base"
        }`}
      >
        <span aria-hidden>♡</span>
        <span>{count > 0 ? count : ""}</span>
        <span>Sign up to like</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 disabled:opacity-70 ${
        size === "sm" ? "text-sm" : "text-base"
      }`}
    >
      <span aria-hidden>{liked ? "❤️" : "♡"}</span>
      <span>{count > 0 ? count : ""}</span>
    </button>
  );
}
