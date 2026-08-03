"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setArtworkBack } from "@/lib/artworkBack";
import { useT } from "@/lib/i18n/useT";
import {
  type ArtworkWithLikes,
  canEditArtwork,
  getStorageUrl,
  getPrimaryClaim,
} from "@/lib/supabase/artworks";
import type { ClaimType } from "@/lib/provenance/types";
import { claimTypeToByPhrase } from "@/lib/provenance/rpc";
import {
  formatDisplayName,
  formatIdentityPair,
  formatRoleChips,
} from "@/lib/identity/format";
import { FollowButton } from "./FollowButton";
import { LikeButton } from "./LikeButton";

export type ArtistThreadArtist = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio?: string | null;
  roles?: string[] | null;
};

type Props = {
  artist: ArtistThreadArtist;
  artworks: ArtworkWithLikes[];
  likedIds: Set<string>;
  initialFollowing?: boolean;
  userId?: string | null;
  onLikeUpdate: (artworkId: string, liked: boolean, count: number) => void;
};

const MAX_WORKS_IN_THREAD = 6;

function getAvatarUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith("http")) return avatarUrl;
  return getStorageUrl(avatarUrl);
}

export function ArtistThreadCard({
  artist,
  artworks,
  likedIds,
  initialFollowing = false,
  userId = null,
  onLikeUpdate,
}: Props) {
  const router = useRouter();
  const { t } = useT();
  const username = artist.username ?? "";
  const { primary: displayName, secondary: handleLabel } =
    formatIdentityPair(artist);
  const roleChips = formatRoleChips(
    { roles: artist.roles ?? [], main_role: null, ...artist },
    t,
    { max: 2 }
  );
  const avatarUrl = getAvatarUrl(artist.avatar_url);
  const worksToShow = artworks.slice(0, MAX_WORKS_IN_THREAD);
  const firstClaim = worksToShow[0]
    ? getPrimaryClaim(worksToShow[0])
    : null;
  const byPhrase = firstClaim
    ? claimTypeToByPhrase(firstClaim.claim_type as ClaimType)
    : null;

  function handleHeaderClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (username) router.push(`/u/${username}`);
  }

  function handleHeaderKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (username) router.push(`/u/${username}`);
    }
  }

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {/* Header row */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleHeaderClick}
        onKeyDown={handleHeaderKeyDown}
        className="flex cursor-pointer items-center gap-3 p-4 hover:bg-zinc-50"
      >
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-zinc-200">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt=""
              width={48}
              height={48}
              className="h-full w-full object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-lg font-medium text-zinc-500">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-zinc-900">{displayName}</p>
          {handleLabel && (
            <p className="text-sm text-zinc-500">{handleLabel}</p>
          )}
          {roleChips.length > 0 && (
            <p className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-zinc-500">
              {roleChips.map((chip) => (
                <span
                  key={chip.key}
                  className={`rounded-full border px-2 py-0.5 ${chip.isPrimary ? "border-zinc-400 bg-zinc-50 text-zinc-700" : "border-zinc-200 text-zinc-500"}`}
                >
                  {chip.label}
                </span>
              ))}
            </p>
          )}
        </div>
        <div
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <FollowButton targetProfileId={artist.id} initialFollowing={initialFollowing} size="sm" />
        </div>
      </div>

      {/* Bio (clamp 2 lines) */}
      {artist.bio && (
        <p className="line-clamp-2 whitespace-pre-line px-4 pb-2 text-sm text-zinc-600">{artist.bio}</p>
      )}

      {/* Mini gallery */}
      <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-6">
        {worksToShow.map((artwork) => {
          const images = artwork.artwork_images ?? [];
          const sorted = [...images].sort(
            (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
          );
          const first = sorted[0];
          const imageUrl = first
            ? getStorageUrl(first.storage_path)
            : null;

          return (
            <div
              key={artwork.id}
              className="group relative aspect-square overflow-hidden rounded-md bg-zinc-100"
            >
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setArtworkBack();
                  router.push(`/artwork/${artwork.id}`);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setArtworkBack();
                    router.push(`/artwork/${artwork.id}`);
                  }
                }}
                className="absolute inset-0 cursor-pointer"
              />
              {imageUrl ? (
                <Image
                  src={imageUrl}
                  alt={artwork.title ?? "Artwork"}
                  width={200}
                  height={200}
                  className="h-full w-full object-contain transition-opacity group-hover:opacity-90"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-zinc-400">
                  No image
                </div>
              )}
              <div
                className="absolute bottom-1 right-1 flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                {userId && canEditArtwork(artwork, userId) && (
                  <Link
                    href={`/artwork/${artwork.id}/edit`}
                    className="rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium text-zinc-700 shadow hover:bg-white hover:text-zinc-900"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t("common.edit")}
                  </Link>
                )}
                <LikeButton
                  artworkId={artwork.id}
                  likesCount={artwork.likes_count ?? 0}
                  isLiked={likedIds.has(artwork.id)}
                  onUpdate={(newLiked, newCount) =>
                    onLikeUpdate(artwork.id, newLiked, newCount)
                  }
                  size="sm"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Attribution + View profile link */}
      <div className="border-t border-zinc-100 px-4 py-2">
        <p className="text-xs text-zinc-500">
          by {formatDisplayName(artist)}
          {byPhrase && <> · {byPhrase} {displayName}</>}
        </p>
        {username && (
          <Link
            href={`/u/${username}`}
            className="mt-1 inline-block text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            {t("profile.viewProfile")} →
          </Link>
        )}
      </div>
    </article>
  );
}
