"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import {
  formatIdentityPair,
  formatRoleChips,
} from "@/lib/identity/format";
import { reasonTagToI18n } from "@/lib/people/reason";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import type { LivingSalonPersona } from "@/lib/feed/livingSalon";
import {
  logFeedEvent,
  setFeedSource,
  type FeedSort,
  type FeedTab,
} from "@/lib/feed/telemetry";
import type { PeopleRec } from "@/lib/supabase/peopleRecs";
import { FollowButton } from "@/components/FollowButton";

type FeedContext = {
  tab: FeedTab;
  sort?: FeedSort;
  position: number;
};

type Props = {
  persona: LivingSalonPersona;
  profiles: PeopleRec[];
  followingIds: Set<string>;
  userId: string | null;
  /** When provided, person interactions log feed-attributed telemetry. */
  feedContext?: FeedContext;
};

const PERSONA_HEADER_KEY: Record<LivingSalonPersona, string> = {
  artist: "feed.artistClusterHeader",
  curator: "feed.curatorClusterHeader",
  gallerist: "feed.galleristClusterHeader",
  collector: "feed.collectorClusterHeader",
};

function getAvatarUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith("http")) return avatarUrl;
  return getArtworkImageUrl(avatarUrl, "avatar");
}

/**
 * Living Salon "people carousel" strip — same persona, horizontal
 * scroll-snap row. The card vocabulary stays close to the LinkedIn
 * "Jobs / People you may know" pattern but the row direction is now
 * horizontal so a single thin pool doesn't read as a near-empty grid.
 *
 * - Mobile: native horizontal swipe with `scroll-snap-x`.
 * - Desktop (lg+): same scroll, plus left/right arrow buttons that page
 *   the row by ~one card width. Buttons hide gracefully at the
 *   start/end of the scroll range.
 *
 * The builder guarantees the persona is always the same inside one row
 * and emits at least `PEOPLE_CLUSTER_MIN` (= 2) profiles, so a row will
 * never feel "lonely". Profiles whose `main_role` doesn't fit the four
 * canonical personas never reach this component.
 */
export function PeopleCarouselStrip({
  persona,
  profiles,
  followingIds,
  userId,
  feedContext,
}: Props) {
  const { t } = useT();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    const handler = () => updateArrows();
    el.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("resize", handler);
    return () => {
      el.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    };
  }, [updateArrows, profiles.length]);

  function scrollByPage(dir: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    const delta = el.clientWidth * 0.85 * dir;
    el.scrollBy({ left: delta, behavior: "smooth" });
  }

  return (
    // Floor tint + rounded container: artworks render directly on the
    // page (white), so a soft zinc-50 panel here lets the eye snap to
    // "this is a different unit" without shouting. Paired with the
    // 2px-wide accent before the header so the section reads as an
    // editorial paragraph break, not just a quiet hairline divider.
    <section className="my-2 rounded-2xl bg-zinc-50/70 px-6 py-9 lg:px-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-700">
          <span aria-hidden className="h-3 w-[2px] bg-zinc-900" />
          {t(PERSONA_HEADER_KEY[persona])}
        </p>
        <div className="hidden items-center gap-2 lg:flex">
          <ArrowButton
            direction="left"
            disabled={!canScrollLeft}
            onClick={() => scrollByPage(-1)}
            label={t("feed.carouselPrev")}
          />
          <ArrowButton
            direction="right"
            disabled={!canScrollRight}
            onClick={() => scrollByPage(1)}
            label={t("feed.carouselNext")}
          />
        </div>
      </div>
      <div
        ref={scrollerRef}
        className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-6 pb-1 lg:-mx-8 lg:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {profiles.map((profile, idx) => (
          <div
            key={profile.id}
            className="w-[260px] shrink-0 snap-start sm:w-[280px]"
          >
            <PersonCard
              profile={profile}
              initialFollowing={followingIds.has(profile.id)}
              userId={userId}
              persona={persona}
              feedContext={feedContext}
              cardIndex={idx}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function ArrowButton({
  direction,
  disabled,
  onClick,
  label,
}: {
  direction: "left" | "right";
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-30"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden
      >
        {direction === "left" ? (
          <polyline points="15 18 9 12 15 6" />
        ) : (
          <polyline points="9 18 15 12 9 6" />
        )}
      </svg>
    </button>
  );
}

function PersonCard({
  profile,
  initialFollowing,
  userId,
  persona,
  feedContext,
  cardIndex,
}: {
  profile: PeopleRec;
  initialFollowing: boolean;
  userId: string | null;
  persona: LivingSalonPersona;
  feedContext?: FeedContext;
  cardIndex: number;
}) {
  const { t, locale } = useT();
  const username = profile.username ?? "";
  const { primary: displayName, secondary: handleLabel } =
    formatIdentityPair(profile, t, locale);
  const avatarUrl = getAvatarUrl(profile.avatar_url);
  const roleChips = formatRoleChips(profile, t, { max: 1 });
  const reasonLine = reasonTagToI18n(profile.reason_tags ?? [], t);
  const isOwnCard = userId !== null && userId === profile.id;

  function handleCardClick() {
    if (!feedContext || !username) return;
    logFeedEvent("feed_item_click", {
      tab: feedContext.tab,
      sort: feedContext.sort,
      item_kind: "people",
      item_id: profile.id,
      position: feedContext.position,
      persona,
      card_index: cardIndex,
    });
    logFeedEvent("profile_view_from_feed", {
      tab: feedContext.tab,
      sort: feedContext.sort,
      item_kind: "people",
      item_id: profile.id,
      position: feedContext.position,
      persona,
    });
    setFeedSource({
      tab: feedContext.tab,
      sort: feedContext.sort,
      item_kind: "people",
      item_id: profile.id,
      position: feedContext.position,
    });
  }

  return (
    <article className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-5 transition-colors hover:bg-zinc-50/40">
      <Link
        href={username ? `/u/${username}` : "#"}
        onClick={handleCardClick}
        className="flex min-w-0 items-start gap-3 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-zinc-100">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt=""
              width={48}
              height={48}
              sizes="48px"
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-medium text-zinc-500">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-zinc-900">
            {displayName}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
            {handleLabel && <span className="truncate">{handleLabel}</span>}
            {roleChips[0] && (
              <span className="rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500">
                {roleChips[0].label}
              </span>
            )}
          </div>
        </div>
      </Link>

      {reasonLine && (
        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-zinc-500">
          {reasonLine}
        </p>
      )}

      {!isOwnCard && (
        <div className="mt-auto pt-4" onClick={(e) => e.stopPropagation()}>
          <FollowButton
            targetProfileId={profile.id}
            initialFollowing={initialFollowing}
            isPrivateTarget={profile.is_public === false}
            size="sm"
            surface={feedContext ? "feed" : undefined}
            feedContext={feedContext}
          />
        </div>
      )}
    </article>
  );
}
