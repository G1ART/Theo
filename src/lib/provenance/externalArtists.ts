import { supabase } from "@/lib/supabase/client";

export type MyExternalArtist = {
  id: string;
  display_name: string;
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
    invite_email: string | null;
    has_email: boolean;
    work_count: number | string;
    created_at: string;
  }>;
  return {
    data: rows.map((r) => ({
      id: r.id,
      display_name: r.display_name,
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
