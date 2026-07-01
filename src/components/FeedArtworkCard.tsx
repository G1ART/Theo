"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setArtworkBack } from "@/lib/artworkBack";
import {
  type ArtworkWithLikes,
  getArtworkImageUrl,
  getPrimaryClaim,
  canEditArtwork,
} from "@/lib/supabase/artworks";
import { useT } from "@/lib/i18n/useT";
import {
  logFeedEvent,
  setFeedSource,
  type FeedSort,
  type FeedTab,
} from "@/lib/feed/telemetry";
import {
  formatDisplayName,
  formatIdentityPair,
  formatRoleChips,
  hasPublicLinkableUsername,
} from "@/lib/identity/format";
import {
  formatSizeForLocale,
  parseSizeWithUnit,
  type SizeUnitPref,
} from "@/lib/size/format";
import { useSizeUnitPref } from "@/lib/size/preference";
import { LikeButton } from "./LikeButton";
import { ArtworkArtistName } from "@/components/artwork/ArtworkArtistName";
import { Chip } from "@/components/ds";

/**
 * `formatSizeForLocale` may prefix the dimensions with a Hosu marker
 * (`30F · `, `약 30F · `, `~30F · `). The salon size pill is meant to
 * read at a glance, so we drop any leading Hosu marker and keep only the
 * dimension base (e.g. `90.9 × 72.7 cm`).
 *
 * Final defence: if the base does *not* end with a `cm` / `in` unit
 * marker, return null so the pill never renders without a unit. cm and
 * inch differ by ~2.5x — a unit-less number on a thumbnail can mislead
 * viewers far worse than silently hiding the pill until the data is
 * patched. This catches legacy / stale-build paths in which an upstream
 * formatter accidentally emits a unit-less string (e.g. raw fall-through
 * in `formatSizeForLocale` when `parseSize` doesn't match a known
 * pattern, or older builds where the gate didn't yet exist).
 */
function extractSizeBase(formatted: string | null): string | null {
  if (!formatted) return null;
  const stripped = formatted
    .replace(/^(?:약\s+|~)?\d+\s*[FPMSfpms]\s*·\s*/, "")
    .trim();
  if (!stripped) return null;
  if (!/\b(?:cm|in)\b/i.test(stripped)) return null;
  return stripped;
}

/**
 * Build the size pill string for the salon grid. Returns null when:
 * - the `size` field is missing / empty, or
 * - the value doesn't parse at all, or
 * - the unit can't be confidently determined: no suffix on the input
 *   (`120 × 80`), no Hosu marker (`30F`), and no `artwork.size_unit`
 *   column. cm and inch differ by ~2.5x, so guessing a unit on a bare
 *   number can mislead viewers far worse than quietly hiding the pill
 *   until the data is patched (Artsy / Artnet / 1stDibs follow the
 *   same policy).
 *
 * Hosu inputs always evaluate as `unit: "cm"` in `parseSizeWithUnit`
 * (Hosu is a cm-based standard) and therefore pass the gate. The only
 * silently-hidden case is a bare unit-less number with no `size_unit`.
 */
function buildSizePill(
  size: string | null | undefined,
  sizeUnit: "cm" | "in" | null | undefined,
  locale: string,
  prefUnit: SizeUnitPref
): string | null {
  if (!size || !size.trim()) return null;
  const parsed = parseSizeWithUnit(size);
  const inputHasUnit = parsed?.unit != null;
  if (!inputHasUnit && (sizeUnit == null || sizeUnit === undefined)) {
    return null;
  }
  return extractSizeBase(formatSizeForLocale(size, locale, sizeUnit ?? null, prefUnit));
}

type ArtistProfileLite = {
  id?: string;
  username?: string | null;
  display_name?: string | null;
  main_role?: string | null;
  roles?: string[] | null;
};

/**
 * Card variants used inside the Living Salon grid.
 * - `feedTile`: standard tile in the salon grid. Borderless, magazine-style:
 *   image on top, three-line meta block below (artist / title / year·medium).
 * - `feedAnchor`: spotlight tile on `lg+`. Same meta vocabulary as the tile;
 *   visual weight comes from a wider column span (col-span-2 row-span-2) and
 *   a higher-resolution image, not a louder frame.
 * - `discoveryMini`: compact thumb used inside artist-world strips. Title is
 *   shown but everything else is hidden so the strip stays quiet.
 */
export type FeedArtworkCardVariant = "feedTile" | "feedAnchor" | "discoveryMini";

/**
 * Lightweight surface context that lets the card emit feed-attributed
 * telemetry. Optional — when absent the card stays a generic artwork card
 * for non-feed surfaces (e.g. profile grids).
 */
export type FeedArtworkCardFeedContext = {
  tab: FeedTab;
  sort?: FeedSort;
  /** 1-based index of the card in the rendered presentation list. */
  position: number;
};

type Props = {
  artwork: ArtworkWithLikes;
  likedIds: Set<string>;
  userId?: string | null;
  onLikeUpdate?: (artworkId: string, liked: boolean, count: number) => void;
  priority?: boolean;
  variant?: FeedArtworkCardVariant;
  /** When true, render the artist's primary role chip on desktop. */
  showRoleChip?: boolean;
  /** When true, render the small claim/multi-claim summary line. */
  showClaimLine?: boolean;
  /**
   * When provided, click activations log a `feed_item_click` event and
   * stash a feed-source breadcrumb in sessionStorage so downstream
   * surfaces (e.g. artwork detail → inquiry) can attribute back to feed.
   */
  feedContext?: FeedArtworkCardFeedContext;
};

export function FeedArtworkCard({
  artwork,
  likedIds,
  userId = null,
  onLikeUpdate,
  priority = false,
  variant = "feedTile",
  showRoleChip = false,
  showClaimLine = false,
  feedContext,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, locale } = useT();
  const sizePref = useSizeUnitPref();
  const images = artwork.artwork_images ?? [];
  const sorted = [...images].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  const first = sorted[0];
  // Anchor/spotlight tiles are visibly larger (~600px wide on lg); thumb
  // (400px) blurs noticeably there, so anchors load `medium` (1200px) while
  // standard tiles (~290px col-1/4) and mini stay on thumb to keep the
  // first-screen network footprint small.
  const imageVariant: "thumb" | "medium" =
    variant === "feedAnchor" ? "medium" : "thumb";
  const imageUrl = first
    ? getArtworkImageUrl(first.storage_path, imageVariant)
    : null;

  const artistProfile = (artwork as { profiles?: ArtistProfileLite | null }).profiles ?? null;
  const primaryClaim = getPrimaryClaim(artwork);
  const externalName = primaryClaim
    ? ((artwork.claims ?? []).find(
        (c) =>
          (c as { external_artists?: { display_name?: string | null } }).external_artists
            ?.display_name
      ) as { external_artists?: { display_name?: string | null } } | undefined)
        ?.external_artists?.display_name ?? null
    : null;

  const artistIdentityInput = externalName
    ? { display_name: externalName, username: null }
    : artistProfile;
  const { primary: artistName } = formatIdentityPair(artistIdentityInput, t);
  const artistRoleChips = formatRoleChips(artistIdentityInput, t, { max: 1 });
  const artistUsername = hasPublicLinkableUsername(artistProfile)
    ? artistProfile?.username ?? ""
    : "";
  const claimCount = artwork.claims?.length ?? 0;

  const isAnchor = variant === "feedAnchor";
  const isMini = variant === "discoveryMini";
  const sizeOverlay = isMini
    ? null
    : buildSizePill(artwork.size, artwork.size_unit ?? null, locale, sizePref);
  // Standard tiles use a 4:5 portrait aspect for a magazine rhythm. Anchor /
  // spotlight stays square because its wider column span already gives it
  // visual weight; a taller anchor would push the row height up. Mini stays
  // square as a quiet strip thumb.
  const aspectClass = isAnchor || isMini ? "aspect-square" : "aspect-[4/5]";
  // No matte fill behind the artwork — letterbox bands distract from the
  // image. The page background (white) shows through any aspect mismatch,
  // which reads as the artwork floating on paper rather than sitting in a
  // grey frame. Mini still gets a quiet frame inside the strip.
  const imageWrapClass = isMini ? "overflow-hidden" : "";

  function handleClick() {
    setArtworkBack(pathname ?? "/feed");
    if (feedContext) {
      logFeedEvent("feed_item_click", {
        tab: feedContext.tab,
        sort: feedContext.sort,
        item_kind: "artwork",
        item_id: artwork.id,
        position: feedContext.position,
        artwork_variant: variant,
      });
      setFeedSource({
        tab: feedContext.tab,
        sort: feedContext.sort,
        item_kind: "artwork",
        item_id: artwork.id,
        position: feedContext.position,
      });
    }
    router.push(`/artwork/${artwork.id}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={artwork.title ?? undefined}
      className="group flex h-full cursor-pointer flex-col focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
    >
      <div className={`relative w-full ${aspectClass} ${imageWrapClass}`}>
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={artwork.title ?? ""}
            fill
            sizes={
              isAnchor
                ? "(max-width: 1024px) 50vw, 600px"
                : isMini
                  ? "(max-width: 768px) 33vw, 200px"
                  : "(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            }
            loading={priority ? "eager" : "lazy"}
            priority={priority}
            className="object-contain transition-transform duration-300 ease-out group-hover:scale-[1.01]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
            {/* Intentionally muted: image-less tiles should disappear quietly, not shout "no image". */}
          </div>
        )}
        {sizeOverlay && (
          <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium tracking-tight text-zinc-700 shadow-sm backdrop-blur-sm">
            {sizeOverlay}
          </div>
        )}
        {!isMini && userId && (
          <div
            className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <LikeButton
              artworkId={artwork.id}
              likesCount={artwork.likes_count ?? 0}
              isLiked={likedIds.has(artwork.id)}
              onUpdate={(newLiked, newCount) =>
                onLikeUpdate?.(artwork.id, newLiked, newCount)
              }
              size="sm"
              surface={feedContext ? "feed" : undefined}
              feedContext={feedContext}
            />
          </div>
        )}
      </div>

      {isMini ? (
        <div className="flex flex-1 flex-col gap-0.5 px-0.5 pt-2">
          <h3 className="truncate text-xs font-medium text-zinc-900">
            {artwork.title ?? ""}
          </h3>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-0.5 pt-3">
          {/* Artist identity — single line, never wraps. The name is ALWAYS the
              artist's (external invited artist name or onboarded artist). For
              external artists the link routes to the uploading account only
              after an explicit confirm (handled by ArtworkArtistName). */}
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium tracking-tight text-zinc-900">
              <ArtworkArtistName
                name={externalName ? artistName : (artistName || formatDisplayName(artistIdentityInput, t))}
                isExternal={!!externalName}
                artistUsername={externalName ? null : artistUsername}
                uploader={artistProfile}
                stopPropagation
                className="hover:underline"
              />
            </span>
            {showRoleChip && artistRoleChips[0] && (
              <Chip
                tone="muted"
                size="xs"
                className="hidden shrink-0 lg:inline-flex"
              >
                {artistRoleChips[0].label}
              </Chip>
            )}
          </div>

          <h3 className="truncate text-sm font-normal tracking-tight text-zinc-700">
            {artwork.title ?? ""}
          </h3>

          {(artwork.year || artwork.medium) && (
            // Two-column mobile tiles must read as restrained thumbnails — the
            // Sprint 1 work order calls for "minimal metadata only" there. We
            // hide year·medium below `md:` so a phone shows artist + title and
            // nothing else; tablet+ regains the full caption.
            <p className="hidden truncate text-xs tracking-tight text-zinc-500 md:block">
              {[artwork.year, artwork.medium].filter(Boolean).join(" · ")}
            </p>
          )}

          {showClaimLine && claimCount > 1 ? (
            <p className="text-[11px] tracking-tight text-zinc-500">
              <span title={t("artwork.viewHistory")}>
                +{claimCount - 1} {t("artwork.moreInHistory")}
              </span>
            </p>
          ) : null}

          {userId && canEditArtwork(artwork, userId) && (
            <Link
              href={`/artwork/${artwork.id}/edit`}
              onClick={(e) => e.stopPropagation()}
              // Edit affordance hidden by default; reveals on hover/focus on
              // lg+ where there's clean room. Keeps the salon spread quiet.
              className="mt-1 hidden self-start text-[11px] text-zinc-500 opacity-0 transition-opacity hover:text-zinc-800 group-hover:opacity-100 group-focus-within:opacity-100 lg:inline-block"
            >
              {t("common.edit")}
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
