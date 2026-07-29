/**
 * Exhibition participant hydration + mutation wrappers.
 *
 * Backed by SECURITY DEFINER RPCs added in
 * `supabase/migrations/20260728220001_exhibition_participants_rpcs.sql`:
 *
 *   - `list_exhibition_participants(p_project_id)` — returns the
 *     canonical participant roster (both onboarded profiles and invited
 *     external artists) so the `/add` page can rehydrate on mount
 *     instead of losing state to a fresh remount.
 *   - `remove_exhibition_participant(p_claim_id, p_delete_external)` —
 *     removes a participant. Raises `works_present` when the participant
 *     still has works attached to the exhibition; the UI translates that
 *     to a `removeBlocked` hint.
 *
 * PII: `invite_email` is populated only when the caller is the
 * exhibition curator or host. Delegates receive `null`, matching the
 * privacy posture of other external-artist surfaces.
 */

import { supabase } from "./client";

export type ExhibitionParticipant = {
  kind: "profile" | "external";
  claimId: string;
  profileId: string | null;
  externalArtistId: string | null;
  displayName: string | null;
  displayNameKo: string | null;
  displayNameEn: string | null;
  username: string | null;
  inviteEmail: string | null;
  worksCount: number;
  createdAt: string;
};

type RawParticipantRow = {
  kind: string;
  claim_id: string;
  profile_id: string | null;
  external_artist_id: string | null;
  display_name: string | null;
  display_name_ko: string | null;
  display_name_en: string | null;
  username: string | null;
  invite_email: string | null;
  works_count: number | string;
  created_at: string;
};

export async function listExhibitionParticipants(
  projectId: string
): Promise<{ data: ExhibitionParticipant[]; error: unknown }> {
  if (!projectId) return { data: [], error: null };
  const { data, error } = await supabase.rpc("list_exhibition_participants", {
    p_project_id: projectId,
  });
  if (error) return { data: [], error };
  const rows = (data ?? []) as RawParticipantRow[];
  return {
    data: rows.map((r) => ({
      kind: r.kind === "external" ? "external" : "profile",
      claimId: r.claim_id,
      profileId: r.profile_id ?? null,
      externalArtistId: r.external_artist_id ?? null,
      displayName: r.display_name ?? null,
      displayNameKo: r.display_name_ko ?? null,
      displayNameEn: r.display_name_en ?? null,
      username: r.username ?? null,
      inviteEmail: r.invite_email ?? null,
      worksCount: Number(r.works_count ?? 0),
      createdAt: r.created_at,
    })),
    error: null,
  };
}

export type RemoveParticipantResult = {
  removed: boolean;
  externalArtistDeleted: boolean;
};

export type RemoveParticipantOutcome =
  | { ok: true; data: RemoveParticipantResult }
  | { ok: false; kind: "works_present"; worksCount: number }
  | { ok: false; kind: "error"; error: unknown };

/**
 * Delete a project-scope CURATED participant claim.
 *
 * The RPC raises `works_present: N work(s) still attached...` when the
 * participant has works in the exhibition. We surface that as a
 * structured outcome so the UI can render `exhibition.participants.removeBlocked`
 * without parsing English server error strings.
 */
export async function removeExhibitionParticipant(
  claimId: string,
  options: { deleteExternal?: boolean } = {}
): Promise<RemoveParticipantOutcome> {
  const { data, error } = await supabase.rpc("remove_exhibition_participant", {
    p_claim_id: claimId,
    p_delete_external: options.deleteExternal ?? false,
  });
  if (error) {
    // PostgREST surfaces raise-exception messages on `error.message`.
    // We only need to distinguish the `works_present` sentinel (safe to
    // present) from anything else (bubble up as a generic error).
    const message =
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "";
    const match = message.match(/works_present:\s*(\d+)/);
    if (match) {
      return { ok: false, kind: "works_present", worksCount: Number(match[1]) };
    }
    return { ok: false, kind: "error", error };
  }
  const row = (data ?? {}) as { removed?: boolean; external_artist_deleted?: boolean };
  return {
    ok: true,
    data: {
      removed: !!row.removed,
      externalArtistDeleted: !!row.external_artist_deleted,
    },
  };
}
