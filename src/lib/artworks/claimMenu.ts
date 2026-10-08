/**
 * Claim menu vs artwork deletion.
 *
 * "owned by me" / curated / exhibited / inventory is a relationship
 * request. It never grants the right to delete the work. Deletion stays
 * with the artist and the uploader (`created_by`), the same people who
 * could delete before any claim existed.
 */

export type ArtworkDeleteSubject = {
  artist_id?: string | null;
  created_by?: string | null;
};

export const REVOCABLE_CLAIM_TYPES = ["OWNS", "INVENTORY", "CURATED", "EXHIBITED"] as const;

export type RevocableClaimType = (typeof REVOCABLE_CLAIM_TYPES)[number];

export type RelationshipClaimRow = {
  id: string;
  claim_type: string;
  subject_profile_id: string;
  status?: string | null;
};

function actorIds(input: string | string[] | null | undefined): string[] {
  if (!input) return [];
  const list = typeof input === "string" ? [input] : input;
  const out: string[] = [];
  for (const id of list) {
    if (typeof id === "string" && id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function isRevocableClaimType(claimType: string | null | undefined): boolean {
  return (REVOCABLE_CLAIM_TYPES as readonly string[]).includes(claimType ?? "");
}

/** Artist or uploader. Claims are ignored on purpose. */
export function canDeleteArtwork(
  artwork: ArtworkDeleteSubject,
  userId: string | string[] | null | undefined,
): boolean {
  const ids = actorIds(userId);
  if (ids.length === 0) return false;
  if (artwork.artist_id && ids.includes(artwork.artist_id)) return true;
  if (artwork.created_by && ids.includes(artwork.created_by)) return true;
  return false;
}

function isLiveRelationshipStatus(status: string | null | undefined): boolean {
  return status == null || status === "pending" || status === "confirmed";
}

/** Relationship claims this viewer filed. Authorship (CREATED) is not one of them. */
export function relationshipClaimsForActor(
  claims: RelationshipClaimRow[],
  userId: string | string[] | null | undefined,
): RelationshipClaimRow[] {
  const ids = actorIds(userId);
  if (ids.length === 0) return [];
  return claims.filter(
    (claim) =>
      ids.includes(claim.subject_profile_id) &&
      isRevocableClaimType(claim.claim_type) &&
      isLiveRelationshipStatus(claim.status),
  );
}

/**
 * Withdraw one relationship claim. The artwork object is returned unchanged.
 */
export function revokeRelationshipClaim<TArtwork extends { id: string }>(input: {
  artwork: TArtwork;
  claims: RelationshipClaimRow[];
  claimId: string;
  actorId: string;
}): { artwork: TArtwork; claims: RelationshipClaimRow[]; artworkDeleted: false } {
  const target = input.claims.find((claim) => claim.id === input.claimId);
  const allowed =
    target != null &&
    target.subject_profile_id === input.actorId &&
    isRevocableClaimType(target.claim_type) &&
    isLiveRelationshipStatus(target.status);
  return {
    artwork: input.artwork,
    claims: allowed ? input.claims.filter((claim) => claim.id !== input.claimId) : input.claims,
    artworkDeleted: false,
  };
}
