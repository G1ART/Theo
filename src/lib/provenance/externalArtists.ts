import { supabase } from "@/lib/supabase/client";

export type MyExternalArtist = {
  id: string;
  display_name: string;
  /** QA 2026-08-17 bilingual — populated when the RPC surfaces the
   *  KO/EN slots. Consumers should route through
   *  `pickLocalizedDisplayName(row, locale)`. */
  display_name_ko?: string | null;
  display_name_en?: string | null;
  invite_email: string | null;
  has_email: boolean;
  work_count: number;
  created_at: string;
};

/**
 * Invited (not-yet-onboarded) external artists owned by the current user (or a
 * principal they hold an account-writer delegation for). Backed by the
 * `list_my_external_artists` SECURITY DEFINER RPC.
 */
export async function listMyExternalArtists(
  actingSubjectProfileId?: string | null
): Promise<{ data: MyExternalArtist[]; error: unknown }> {
  const { data, error } = await supabase.rpc("list_my_external_artists", {
    p_inviter: actingSubjectProfileId ?? null,
  });
  if (error) return { data: [], error };
  const rows = (data ?? []) as Array<{
    id: string;
    display_name: string;
    display_name_ko?: string | null;
    display_name_en?: string | null;
    invite_email: string | null;
    has_email: boolean;
    work_count: number | string;
    created_at: string;
  }>;
  return {
    data: rows.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      display_name_ko: r.display_name_ko ?? null,
      display_name_en: r.display_name_en ?? null,
      invite_email: r.invite_email,
      has_email: !!r.has_email,
      work_count: Number(r.work_count ?? 0),
      created_at: r.created_at,
    })),
    error: null,
  };
}

export type LinkExternalArtistResult = {
  external_artist_id: string;
  target_profile_id: string;
  claims_migrated: number;
  works_moved: number;
};

/**
 * Link an invited external artist row to a real (onboarded) profile. Mirrors the
 * signup auto-link: repoints claims and flips artworks.artist_id so the works
 * surface under the artist's own persona. Owner / account-delegate only.
 */
/**
 * PII-safe probe: "does an unclaimed external_artists row exist globally
 * for this email?" Returns boolean only — no name, no inviter, no counts.
 * Used by the attribution flow (QA 2026-07-28 Phase B) to surface a chip
 * telling the operator that their upload will be attached to an EXISTING
 * external artist account (rather than spawning a new invite).
 */
export async function externalArtistEmailExists(
  email: string
): Promise<{ data: boolean; error: unknown }> {
  const trimmed = email.trim();
  if (!trimmed) return { data: false, error: null };
  const { data, error } = await supabase.rpc("external_artist_email_exists", {
    p_email: trimmed,
  });
  if (error) return { data: false, error };
  return { data: !!data, error: null };
}

export async function linkExternalArtistToProfile(
  externalArtistId: string,
  targetProfileId: string
): Promise<{ data: LinkExternalArtistResult | null; error: unknown }> {
  const { data, error } = await supabase.rpc("link_external_artist_to_profile", {
    p_external_artist_id: externalArtistId,
    p_target_profile_id: targetProfileId,
  });
  if (error) return { data: null, error };
  return { data: (data as LinkExternalArtistResult) ?? null, error: null };
}

// ─────────────────────────────────────────────────────────────────────────
// QA 2026-07-28 Phase D — orphan external artist claim (post-onboarding)
// ─────────────────────────────────────────────────────────────────────────

export type OrphanExternalArtistCandidate = {
  id: string;
  display_name: string | null;
  display_name_ko: string | null;
  display_name_en: string | null;
  invited_by: string | null;
  inviter_display_name: string | null;
  inviter_username: string | null;
  invited_at: string;
  works_count: number;
  latest_cover_paths: string[];
  /**
   * QA 2026-07-29 (Part B) — server-computed match confidence: "exact"
   * when the candidate's display_name (any language slot) matches the
   * caller's profile display_name exactly (case/whitespace-insensitive),
   * "fuzzy" for a partial ILIKE match. The dashboard autoscan banner uses
   * this to decide whether a 1-click "this is mine" action is safe to
   * offer directly, vs. routing to the full review list.
   */
  match_confidence: "exact" | "fuzzy";
};

/**
 * Find unclaimed external_artists rows whose display_name matches the
 * caller's profile (or an explicit search term). Only surfaces rows with
 * NO invite_email — email-based invitations are already reconciled by
 * the auth signup trigger. See migration
 * `20260728000002_orphan_external_artist_claim.sql`.
 */
export async function searchOrphanExternalArtistsForMe(
  query?: string | null
): Promise<{ data: OrphanExternalArtistCandidate[]; error: unknown }> {
  const { data, error } = await supabase.rpc(
    "search_orphan_external_artists_for_me",
    { p_q: query?.trim() || null }
  );
  if (error) return { data: [], error };
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return {
    data: rows.map((r) => ({
      id: String(r.id ?? ""),
      display_name: (r.display_name as string | null) ?? null,
      display_name_ko: (r.display_name_ko as string | null) ?? null,
      display_name_en: (r.display_name_en as string | null) ?? null,
      invited_by: (r.invited_by as string | null) ?? null,
      inviter_display_name:
        (r.inviter_display_name as string | null) ?? null,
      inviter_username: (r.inviter_username as string | null) ?? null,
      invited_at: String(r.invited_at ?? ""),
      works_count: Number(r.works_count ?? 0),
      latest_cover_paths: Array.isArray(r.latest_cover_paths)
        ? (r.latest_cover_paths as string[])
        : [],
      match_confidence: r.match_confidence === "exact" ? "exact" : "fuzzy",
    })),
    error: null,
  };
}

export type ClaimOrphanExternalArtistResult = {
  external_artist_id: string;
  target_profile_id: string;
  claims_migrated: number;
  works_moved: number;
};

/**
 * Caller claims an orphan (no-email) external_artist row as themselves.
 * The RPC enforces a case-insensitive name match against the caller's
 * profile display_name (across legacy/KO/EN fields). See migration
 * `20260728000002_orphan_external_artist_claim.sql` for the guards.
 */
export async function claimOrphanExternalArtistAsSelf(
  externalArtistId: string
): Promise<{ data: ClaimOrphanExternalArtistResult | null; error: unknown }> {
  const { data, error } = await supabase.rpc(
    "claim_orphan_external_artist_as_self",
    { p_external_artist_id: externalArtistId }
  );
  if (error) return { data: null, error };
  return {
    data: (data as ClaimOrphanExternalArtistResult) ?? null,
    error: null,
  };
}
