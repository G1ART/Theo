/**
 * Who may receive a packaged download (PNG, JPEG, ZIP, caption PDF).
 *
 * Public feed images stay public. This gate is only for the package.
 * The API route loads the facts and calls these functions; hiding a
 * button is not the check.
 */

export type DownloadActor = {
  userId: string;
  /** Principal the operator claims to be acting as. Ignored unless
   *  `accountWriterFor` contains that id (active account-scope writer). */
  actingAsProfileId: string | null;
  accountWriterFor: ReadonlySet<string>;
};

export type ArtworkDownloadFacts = {
  artistId: string | null;
  /** Fully published. Drafts never download. */
  published: boolean;
  /** Gallery host and curator ids of exhibitions that include this work. */
  exhibitionPosterIds: readonly string[];
};

export type ExhibitionPackFacts = {
  hostProfileId: string | null;
  curatorId: string | null;
  participatingArtistIds: readonly string[];
  /** Approved access_grants row for this exhibition pack. */
  hasPackGrant: boolean;
};

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a === b;
}

/** Acting-as counts only for the principal, and only with an account writer grant. */
function actingAsWriter(actor: DownloadActor, principalId: string | null): boolean {
  if (!principalId) return false;
  if (!same(actor.actingAsProfileId, principalId)) return false;
  if (actor.actingAsProfileId === actor.userId) return false;
  return actor.accountWriterFor.has(principalId);
}

export function canDownloadArtwork(
  actor: DownloadActor,
  facts: ArtworkDownloadFacts,
): boolean {
  if (!actor.userId || !facts.published) return false;
  if (same(actor.userId, facts.artistId)) return true;
  if (facts.exhibitionPosterIds.some((id) => id === actor.userId)) return true;
  if (actingAsWriter(actor, facts.artistId)) return true;
  return false;
}

export function canDownloadExhibitionPack(
  actor: DownloadActor,
  facts: ExhibitionPackFacts,
): boolean {
  if (!actor.userId) return false;
  if (facts.hasPackGrant) return true;
  const principals = [
    facts.hostProfileId,
    facts.curatorId,
    ...facts.participatingArtistIds,
  ];
  if (principals.some((id) => same(actor.userId, id))) return true;
  if (principals.some((id) => actingAsWriter(actor, id))) return true;
  return false;
}

/** Stored on access_requests.field_key. subject_id stays null because
 *  exhibition subjects with an id fail the existing belongs-to-owner check. */
export const EXHIBITION_PACK_FIELD_PREFIX = "download_pack:";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function exhibitionPackFieldKey(exhibitionId: string): string {
  return `${EXHIBITION_PACK_FIELD_PREFIX}${exhibitionId}`;
}

export function exhibitionIdFromPackField(fieldKey: string): string | null {
  if (!fieldKey.startsWith(EXHIBITION_PACK_FIELD_PREFIX)) return null;
  const id = fieldKey.slice(EXHIBITION_PACK_FIELD_PREFIX.length);
  return UUID_RE.test(id) ? id : null;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
