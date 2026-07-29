/**
 * Provenance v1 types.
 * Work = artworks; Claims = relationship declarations.
 */

export const CLAIM_TYPES = [
  "CREATED",
  "OWNS",
  "INVENTORY",
  "EXHIBITED",
  "CURATED",
  "INCLUDES_WORK",
  "HOSTS_PROJECT",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const VISIBILITY_OPTIONS = ["public", "connections", "private"] as const;
export type Visibility = (typeof VISIBILITY_OPTIONS)[number];

export const PROJECT_TYPES = ["exhibition"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_STATUS = ["planned", "live", "ended"] as const;
export type ProjectStatus = (typeof PROJECT_STATUS)[number];

export const EXTERNAL_ARTIST_STATUS = ["invited", "claimed", "merged"] as const;
export type ExternalArtistStatus = (typeof EXTERNAL_ARTIST_STATUS)[number];

export type ExternalArtist = {
  id: string;
  display_name: string;
  website: string | null;
  instagram: string | null;
  invite_email: string | null;
  invited_by: string;
  created_at: string;
  status: ExternalArtistStatus;
  claimed_profile_id: string | null;
};

export type Project = {
  id: string;
  project_type: ProjectType;
  title: string;
  start_date: string | null;
  end_date: string | null;
  status: ProjectStatus;
  curator_id: string;
  host_name: string | null;
  host_profile_id: string | null;
  created_at: string;
};

export type Claim = {
  id: string;
  subject_profile_id: string;
  claim_type: ClaimType;
  work_id: string | null;
  project_id: string | null;
  artist_profile_id: string | null;
  external_artist_id: string | null;
  visibility: Visibility;
  note: string | null;
  created_at: string;
};

export type CreateExternalArtistAndClaimArgs = {
  displayName: string;
  /**
   * QA 2026-07-28 (bilingual, 240005 SECTION 2/3) — optional KO/EN slots for
   * external_artists. When provided, the row is persisted with the bilingual
   * pair and (once the invited artist signs up) the 240005 SECTION 5 trigger
   * inherits them into `profiles.display_name_ko / _en`.
   */
  displayNameKo?: string | null;
  displayNameEn?: string | null;
  website?: string | null;
  instagram?: string | null;
  inviteEmail?: string | null;
  claimType: ClaimType;
  workId?: string | null;
  projectId?: string | null;
  visibility?: Visibility;
  /** For INVENTORY/CURATED/EXHIBITED: past/current/future */
  period_status?: "past" | "current" | "future" | null;
  /**
   * Acting-as override. When set, the claim's `subject_profile_id` is the
   * given profile (instead of `auth.uid()`). The RPC verifies the caller
   * holds an active account-scope delegation with mutate rights for that
   * profile; otherwise the call is rejected. Leave undefined for normal
   * (self) writes.
   */
  subjectProfileId?: string | null;
  /**
   * Phase 3-4 (QA 2026-07): explicit external_artist_id when the operator
   * re-selected an already-invited external artist from search results
   * (`search_people_with_external`). When set, the RPC skips the
   * name/email dedupe lookup and uses this id directly — eliminating race
   * conditions from tiny name/whitespace differences that could otherwise
   * mint a fresh external_artists row. The server verifies the id
   * belongs to an unclaimed row invited by the operator (or by the
   * acting-as principal); invalid ids fall back to the standard dedupe.
   */
  externalArtistId?: string | null;
};

export type CreateClaimForExistingArtistArgs = {
  artistProfileId: string;
  claimType: ClaimType;
  workId?: string | null;
  projectId?: string | null;
  visibility?: Visibility;
  /** For INVENTORY/CURATED/EXHIBITED: past/current/future */
  period_status?: "past" | "current" | "future" | null;
  /**
   * Acting-as override. See `CreateExternalArtistAndClaimArgs.subjectProfileId`.
   */
  subjectProfileId?: string | null;
};

export type SearchWorksForDedupArgs = {
  artistProfileId?: string | null;
  externalArtistId?: string | null;
  q?: string | null;
  limit?: number;
};
