"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getExternalArtistClaim,
  type ArtworkWithLikes,
} from "@/lib/supabase/artworks";
import { hasPublicLinkableUsername } from "@/lib/identity/format";
import { getSession } from "@/lib/supabase/auth";
import { UnonboardedBadge } from "@/components/artists/UnonboardedBadge";
import { UnonboardedArtistInterestPopover } from "@/components/artists/UnonboardedArtistInterestPopover";

/**
 * QA 2026-07-29 (PART B.2) — per-artist section header on the exhibition
 * detail page. Shown once per artist group when an exhibition has more
 * than one credited artist (single-artist shows suppress this — the
 * credit line already says who made the work).
 *
 * - Onboarded artist → clickable name, routes to `/u/{username}`.
 * - Unonboarded (external) artist → name is a button that opens the
 *   interest popover, plus a small "not yet on Theo" badge. Also fires a
 *   *passive* interest signal once per session per artist on mount (a
 *   viewer scrolling to this artist's section is itself a soft interest
 *   signal — separate from the explicit "let them know" click inside the
 *   popover).
 */
export function ExhibitionArtistSectionHeader({
  artistName,
  firstArtwork,
  exhibitionId,
}: {
  artistName: string;
  firstArtwork: ArtworkWithLikes;
  exhibitionId: string;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  const externalClaim = getExternalArtistClaim(firstArtwork);
  const externalArtistId = externalClaim?.external_artist_id ?? null;
  const isUnonboarded = !!externalArtistId;

  const artistProfile = (
    firstArtwork as unknown as {
      profiles?: { username?: string | null } | null;
    }
  ).profiles;
  const username =
    !isUnonboarded && hasPublicLinkableUsername(artistProfile)
      ? artistProfile?.username ?? null
      : null;

  useEffect(() => {
    if (!isUnonboarded || !externalArtistId) return;
    const key = `interest-recorded:${externalArtistId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // sessionStorage unavailable (privacy mode etc.) — skip dedupe guard,
      // still fire once for this mount only.
    }
    void (async () => {
      try {
        const {
          data: { session },
        } = await getSession();
        const token = session?.access_token;
        if (!token) return; // anon viewers don't carry passive-interest signal
        await fetch("/api/artist-profile-interest-email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            externalArtistId,
            triggerKind: "passive",
            context: { exhibitionId, artworkId: null },
          }),
        });
      } catch (err) {
        console.warn("[ExhibitionArtistSectionHeader] passive interest failed", err);
      }
    })();
    // Only re-run if the artist identity actually changes (grid re-renders
    // shouldn't retrigger this).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalArtistId, isUnonboarded]);

  return (
    <div className="border-b border-zinc-100 pb-2">
      {isUnonboarded ? (
        <button
          type="button"
          onClick={() => setPopoverOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-900 hover:text-zinc-600"
        >
          <span>{artistName}</span>
          <UnonboardedBadge />
        </button>
      ) : username ? (
        <Link
          href={`/u/${username}`}
          className="text-sm font-medium text-zinc-900 hover:underline"
        >
          {artistName}
        </Link>
      ) : (
        <span className="text-sm font-medium text-zinc-900">{artistName}</span>
      )}

      {isUnonboarded && externalArtistId && (
        <UnonboardedArtistInterestPopover
          open={popoverOpen}
          onClose={() => setPopoverOpen(false)}
          externalArtistId={externalArtistId}
          displayName={artistName}
          contextExhibitionId={exhibitionId}
          contextArtworkId={null}
        />
      )}
    </div>
  );
}
