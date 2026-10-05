/**
 * The owner of a work is the artist. A gallery or curator who uploads
 * it is the uploader (`created_by`) and, when they say so, the claim
 * subject — never the person under the title.
 */

export type UploadArtistResolution = {
  /** Stored on `artworks.artist_id`. */
  artistId: string;
  /** Stored on `artworks.created_by`. The session that performed the upload. */
  createdBy: string;
};

export function resolveUploadedArtworkArtist(input: {
  sessionUserId: string;
  /** Account-delegate principal. Used only when no other artist was chosen. */
  actingAsProfileId?: string | null;
  /** Onboarded artist picked with "upload as another artist's work". */
  selectedArtistId?: string | null;
}): UploadArtistResolution {
  const createdBy = input.sessionUserId;
  const selected = input.selectedArtistId?.trim() || "";
  if (selected) return { artistId: selected, createdBy };
  const acting = input.actingAsProfileId?.trim() || "";
  return { artistId: acting || createdBy, createdBy };
}

export type ListerClaimType = "OWNS" | "INVENTORY" | "CURATED";

/**
 * Rows written when a gallery publishes an onboarded artist's work.
 *
 * `artist_id` is the artist. That is what 내 작품 reads. `created_by` stays
 * the uploading session. The lister claim (curator / gallery / owns) is the
 * uploader's relationship, not a CREATED claim that means "I clicked upload".
 * Returns null when the chosen person is the account the upload is for.
 */
export type OnboardedArtistPublishPlan = {
  artistId: string;
  createdBy: string;
  listerClaim: {
    claimType: ListerClaimType;
    subjectProfileId: string;
    artistProfileId: string;
  };
};

export function planOnboardedArtistPublish(input: {
  sessionUserId: string;
  actingAsProfileId?: string | null;
  selectedArtistId: string;
  intent: "CREATED" | ListerClaimType | null;
}): OnboardedArtistPublishPlan | null {
  const selected = input.selectedArtistId.trim();
  const createdBy = input.sessionUserId.trim();
  if (!selected || !createdBy) return null;
  const subject = input.actingAsProfileId?.trim() || createdBy;
  if (selected === subject) return null;
  const claimType: ListerClaimType =
    input.intent === "OWNS" || input.intent === "INVENTORY" || input.intent === "CURATED"
      ? input.intent
      : "CURATED";
  return {
    artistId: selected,
    createdBy,
    listerClaim: {
      claimType,
      subjectProfileId: subject,
      artistProfileId: selected,
    },
  };
}

type HeaderPerson = { id?: string | null };

/**
 * Person rendered on the line under the title.
 *
 * Prefer the stored artist whenever they are not the uploading account.
 * If the row still points `artist_id` at the uploader but a claim names
 * a different onboarded artist, show that artist. Own-work uploads, where
 * the uploader is the artist, keep the stored profile.
 */
export function personUnderArtworkTitle<T extends HeaderPerson>(input: {
  storedArtist: T | null;
  uploaderId?: string | null;
  claimedArtist?: T | null;
}): T | null {
  const uploaderId = input.uploaderId ?? null;
  const storedId = input.storedArtist?.id ?? null;
  if (storedId && uploaderId && storedId !== uploaderId) return input.storedArtist;
  const claimedId = input.claimedArtist?.id ?? null;
  if (claimedId && claimedId !== uploaderId) return input.claimedArtist ?? null;
  return input.storedArtist;
}

export function claimedOnboardedArtist<T extends HeaderPerson>(
  claims:
    | Array<{
        artist_profile_id?: string | null;
        artist_profile?: T | null;
        status?: string | null;
      }>
    | null
    | undefined,
  uploaderId?: string | null,
): T | null {
  if (!claims) return null;
  for (const claim of claims) {
    if (claim.status && claim.status !== "confirmed") continue;
    const profile = claim.artist_profile ?? null;
    const id = profile?.id ?? claim.artist_profile_id ?? null;
    if (!profile || !id) continue;
    if (uploaderId && id === uploaderId) continue;
    return profile;
  }
  return null;
}

/**
 * Artist already written onto draft claims. Used when the upload screen
 * is reopened and the in-memory "other artist" choice is gone.
 * Returns an id only when every attributed draft names the same artist.
 */
export function rememberedArtistId(
  drafts: Array<{
    claims?: Array<{
      artist_profile_id?: string | null;
      status?: string | null;
    }> | null;
  }>,
  uploaderIds: string[],
): string | null {
  const found = new Set<string>();
  const skip = new Set(uploaderIds.filter(Boolean));
  for (const draft of drafts) {
    for (const claim of draft.claims ?? []) {
      if (claim.status && claim.status !== "confirmed") continue;
      const id = claim.artist_profile_id;
      if (!id || skip.has(id)) continue;
      found.add(id);
    }
  }
  if (found.size !== 1) return null;
  return [...found][0];
}
