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

export type RegistrationIntent = "CREATED" | ListerClaimType | null;

/**
 * Who a first save should credit.
 *
 * The single-work form defaults to CREATED ("I made this") until the
 * operator opens attribution. A chosen artist — on this form, from the
 * exhibition link, or remembered from the upload workspace — still wins.
 * The uploader stays `created_by`. Own-work uploads stay CREATED.
 */
export function resolveRegistrationArtist(input: {
  sessionUserId: string;
  actingAsProfileId?: string | null;
  intent: RegistrationIntent;
  selectedArtistId?: string | null;
  sessionArtistId?: string | null;
  useExternalArtist?: boolean;
}): {
  onboardedArtistId: string | null;
  claimIntent: "CREATED" | ListerClaimType;
} {
  const subject = (input.actingAsProfileId?.trim() || input.sessionUserId).trim();
  const lister =
    input.intent === "OWNS" || input.intent === "INVENTORY" || input.intent === "CURATED"
      ? input.intent
      : null;
  if (input.useExternalArtist && lister) {
    return { onboardedArtistId: null, claimIntent: lister };
  }
  const picked = input.selectedArtistId?.trim() || input.sessionArtistId?.trim() || "";
  if (picked && picked !== subject) {
    return { onboardedArtistId: picked, claimIntent: lister ?? "CURATED" };
  }
  return { onboardedArtistId: null, claimIntent: lister ?? "CREATED" };
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

/**
 * Artist id written on the artwork row.
 * A chosen artist wins over the uploading account and over whoever
 * the operator is acting as. Own-work uploads keep the acting principal,
 * or the session user when nobody else was chosen.
 */
export function draftArtistIdForInsert(input: {
  sessionUserId: string;
  /** Account-delegate principal. Used only when no other artist was chosen. */
  forProfileId?: string | null;
  /** Onboarded artist for this card. */
  artistProfileId?: string | null;
}): string {
  const explicit = input.artistProfileId?.trim() || "";
  if (explicit) return explicit;
  const acting = input.forProfileId?.trim() || "";
  return acting || input.sessionUserId;
}

/**
 * Id of the person who should be credited as the artist.
 * Prefer `artist_id` when it is already someone other than the uploader.
 * Otherwise use a confirmed claim that names an onboarded artist.
 */
export function creditedArtistId(input: {
  artistId?: string | null;
  uploaderId?: string | null;
  claims?: Array<{
    artist_profile_id?: string | null;
    status?: string | null;
  }> | null;
}): string | null {
  const stored = input.artistId?.trim() || "";
  const uploader = input.uploaderId?.trim() || "";
  if (stored && (!uploader || stored !== uploader)) return stored;
  for (const claim of input.claims ?? []) {
    if (claim.status && claim.status !== "confirmed") continue;
    const id = claim.artist_profile_id?.trim() || "";
    if (!id || (uploader && id === uploader)) continue;
    return id;
  }
  return stored || null;
}
