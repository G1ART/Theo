"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setArtworkBack } from "@/lib/artworkBack";
import {
  type Artwork,
  getArtworkImageUrl,
  getPrimaryClaim,
  getArtworkArtistLabel,
  getArtworkPriceDisplay,
} from "@/lib/supabase/artworks";
import { CroppedArtworkImage } from "@/components/artwork/CroppedArtworkImage";
import { readDisplayAdjust } from "@/lib/image/displayAdjust";
import type { ClaimType } from "@/lib/provenance/types";
import { claimTypeToLabel, claimTypeToByPhrase } from "@/lib/provenance/rpc";
import { useT } from "@/lib/i18n/useT";
import {
  formatUsername,
  hasPublicLinkableUsername,
} from "@/lib/identity/format";
import { ownershipStatusLabel } from "@/lib/artworks/labels";
import { LikeButton } from "./LikeButton";
import { ArtworkProvenanceBlock } from "./ArtworkProvenanceBlock";

type Props = {
  artwork: Artwork;
  likesCount?: number;
  isLiked?: boolean;
  onLikeUpdate?: (artworkId: string, liked: boolean, count: number) => void;
  showDelete?: boolean;
  onDelete?: (artworkId: string) => void;
  showEdit?: boolean;
  disableNavigation?: boolean;
  dragHandle?: React.ReactNode;
  /** When set, show full provenance (curator, collector) if visible to viewer */
  viewerId?: string | null;
};


export function ArtworkCard({ artwork, likesCount = 0, isLiked = false, onLikeUpdate, showDelete = false, onDelete, showEdit = false, disableNavigation = false, dragHandle, viewerId = null }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useT();
  const images = artwork.artwork_images ?? [];
  const sortedImages = [...images].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  const firstImage = sortedImages[0];
  const imageUrl = firstImage ? getArtworkImageUrl(firstImage.storage_path, "thumb") : null;
  const { label: artistLabel, profileUsername } = getArtworkArtistLabel(artwork);
  const usernameHandle = formatUsername({ username: profileUsername });
  const usernameLinkable = hasPublicLinkableUsername({ username: profileUsername });
  const username = usernameLinkable ? (profileUsername ?? "") : "";
  const primaryClaim = getPrimaryClaim(artwork);
  const listerProf = primaryClaim?.profiles;
  const listerHandle = listerProf ? formatUsername(listerProf) : "";
  const listerLinkable = listerProf ? hasPublicLinkableUsername(listerProf) : false;
  const listerLabel = listerProf
    ? (listerProf.display_name?.trim() || (listerHandle ? listerHandle : null))
    : null;
  const claimLabel = primaryClaim
    ? claimTypeToLabel(primaryClaim.claim_type as ClaimType)
    : "Work";
  const byPhrase = primaryClaim
    ? claimTypeToByPhrase(primaryClaim.claim_type as ClaimType)
    : null;

  function handleArticleClick() {
    if (disableNavigation) return;
    setArtworkBack(pathname ?? "/feed");
    router.push(`/artwork/${artwork.id}`);
  }

  function handleArticleKeyDown(e: React.KeyboardEvent) {
    if (disableNavigation) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleArticleClick();
    }
  }

  return (
    <article
      role={disableNavigation ? undefined : "link"}
      tabIndex={disableNavigation ? undefined : 0}
      onClick={handleArticleClick}
      onKeyDown={handleArticleKeyDown}
      className={`overflow-hidden rounded-lg border border-zinc-200 bg-white transition-shadow focus:outline-none focus:ring-2 focus:ring-zinc-400 ${disableNavigation ? "" : "cursor-pointer hover:shadow-md"}`}
    >
      {dragHandle && (
        <div className="flex items-center justify-end border-b border-zinc-100 bg-zinc-50 px-2 py-1" onClick={(e) => e.stopPropagation()}>
          {dragHandle}
        </div>
      )}
      <div className="relative aspect-square w-full overflow-hidden bg-zinc-100">
          {imageUrl ? (
            <CroppedArtworkImage
              src={imageUrl}
              alt={artwork.title ?? "Artwork"}
              sizes="(max-width: 768px) 100vw, 400px"
              loading="lazy"
              adjust={readDisplayAdjust(firstImage?.display_adjust)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-zinc-400">
              No image
            </div>
          )}
      </div>
      <div className="p-4">
          <h3 className="font-semibold text-zinc-900">
            {artwork.title ?? "Untitled"}
          </h3>
          <p className="text-sm text-zinc-600">
            {[artwork.year, artwork.medium].filter(Boolean).join(" · ")}
          </p>
          {(() => {
            const label = ownershipStatusLabel(artwork.ownership_status, t);
            return label ? (
              <p className="mt-1 text-sm font-medium text-zinc-700">{label}</p>
            ) : null;
          })()}
          <p className="mt-1 text-sm text-zinc-600">
            {getArtworkPriceDisplay(artwork, t)}
          </p>
          {(artistLabel || (listerLabel && byPhrase)) && (
            <p className="mt-1 text-sm text-zinc-500">
              {artistLabel && <span>by {artistLabel}</span>}
              {artistLabel && listerLabel && byPhrase && " · "}
              {listerLabel && byPhrase && (
                <span>
                  {byPhrase}{" "}
                  {listerLinkable && listerProf?.username ? (
                    <Link
                      href={`/u/${listerProf.username}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-zinc-900"
                    >
                      {listerLabel}
                    </Link>
                  ) : (
                    listerLabel
                  )}
                </span>
              )}
            </p>
          )}
          {viewerId != null && (
            <ArtworkProvenanceBlock
              artwork={artwork}
              viewerId={viewerId}
              variant="compact"
              stopPropagation
              excludeClaimId={primaryClaim?.id ?? null}
            />
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {username && usernameHandle ? (
                <Link
                  href={`/u/${username}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm text-zinc-500 hover:text-zinc-900"
                >
                  {usernameHandle}
                </Link>
              ) : (
                <span />
              )}
              {showEdit && (
                <Link
                  href={`/artwork/${artwork.id}/edit`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm text-zinc-600 hover:text-zinc-900"
                >
                  {t("common.edit")}
                </Link>
              )}
              {showDelete && onDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeof window !== "undefined" && window.confirm(t("common.confirmDeleteShort"))) {
                      onDelete(artwork.id);
                    }
                  }}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  {t("common.delete")}
                </button>
              )}
            </div>
            <LikeButton
              artworkId={artwork.id}
              likesCount={likesCount}
              isLiked={isLiked}
              onUpdate={(newLiked, newCount) =>
                onLikeUpdate?.(artwork.id, newLiked, newCount)
              }
              size="sm"
            />
          </div>
      </div>
    </article>
  );
}
