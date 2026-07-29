/**
 * Provenance v1 RPCs.
 */

import { supabase } from "@/lib/supabase/client";
import type {
  ClaimType,
  Visibility,
  CreateExternalArtistAndClaimArgs,
  CreateClaimForExistingArtistArgs,
  SearchWorksForDedupArgs,
} from "./types";

export type CreateExternalArtistAndClaimResult = {
  external_artist: { id: string; display_name: string; [key: string]: unknown };
  claim: { id: string; [key: string]: unknown };
};

export async function createExternalArtistAndClaim(
  args: CreateExternalArtistAndClaimArgs
): Promise<{ data: CreateExternalArtistAndClaimResult | null; error: unknown }> {
  const payload: Record<string, unknown> = {
    p_display_name: args.displayName,
    p_website: args.website ?? null,
    p_instagram: args.instagram ?? null,
    p_invite_email: args.inviteEmail ?? null,
    p_claim_type: args.claimType,
    p_work_id: args.workId ?? null,
    p_project_id: args.projectId ?? null,
    p_visibility: (args.visibility ?? "public") as Visibility,
  };
  if (args.period_status != null) payload.p_period_status = args.period_status;
  if (args.subjectProfileId) payload.p_subject_profile_id = args.subjectProfileId;
  // Phase 3-4 (QA 2026-07): pass explicit external_artist_id when the UI
  // has re-selected an already-invited artist. Server-side migration
  // 20260727000000 accepts and validates this id, skipping dedupe.
  if (args.externalArtistId) payload.p_external_artist_id = args.externalArtistId;
  // QA 2026-07-28 (bilingual, 240005) — forward KO/EN slots. RPC accepts
  // nullable params; existing callers unaffected.
  if (args.displayNameKo != null) payload.p_display_name_ko = args.displayNameKo;
  if (args.displayNameEn != null) payload.p_display_name_en = args.displayNameEn;
  // QA 2026-07-29 (Part A) — forward explicit consent only when the
  // caller passed it. The RPC default is false and only ever flips
  // false→true (never reverts a prior true), so omitting this key when
  // the caller has no opinion is safe.
  if (args.notifyOnInquiryViaEmail != null) {
    payload.p_notify_on_inquiry_via_email = args.notifyOnInquiryViaEmail;
  }
  // QA 2026-07-29 (PART D) — sibling opt-in, forwarded the same way.
  if (args.notifyOnProfileInterestViaEmail != null) {
    payload.p_notify_on_profile_interest_via_email = args.notifyOnProfileInterestViaEmail;
  }
  const { data, error } = await supabase.rpc("create_external_artist_and_claim", payload);
  if (error) return { data: null, error };
  return { data: data as CreateExternalArtistAndClaimResult, error: null };
}

export type CreateClaimForExistingArtistResult = {
  claim: { id: string; [key: string]: unknown };
};

export async function createClaimForExistingArtist(
  args: CreateClaimForExistingArtistArgs
): Promise<{ data: CreateClaimForExistingArtistResult | null; error: unknown }> {
  const payload: Record<string, unknown> = {
    p_artist_profile_id: args.artistProfileId,
    p_claim_type: args.claimType,
    p_work_id: args.workId ?? null,
    p_project_id: args.projectId ?? null,
    p_visibility: (args.visibility ?? "public") as Visibility,
  };
  if (args.period_status != null) payload.p_period_status = args.period_status;
  if (args.subjectProfileId) payload.p_subject_profile_id = args.subjectProfileId;
  const { data, error } = await supabase.rpc("create_claim_for_existing_artist", payload);
  if (error) return { data: null, error };
  return { data: data as CreateClaimForExistingArtistResult, error: null };
}

export async function createExternalArtist(
  args: {
    displayName: string;
    inviteEmail?: string | null;
    /** QA 2026-07-28 bilingual — KO/EN slots (240005 SECTION 2). */
    displayNameKo?: string | null;
    displayNameEn?: string | null;
  }
): Promise<{ data: string | null; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: null, error: new Error("Not authenticated") };
  // Route through the SECURITY DEFINER dedupe RPC so the edit screen reuses an
  // existing external_artists row for the same (inviter, email|name) instead of
  // minting a fresh random-id row per edit (QA 2026-07-01). The partial unique
  // indexes make this race-safe; the RPC swallows unique_violation and re-reads.
  const rpcPayload: Record<string, unknown> = {
    p_display_name: args.displayName.trim(),
    p_invite_email: args.inviteEmail?.trim() || null,
  };
  if (args.displayNameKo != null) rpcPayload.p_display_name_ko = args.displayNameKo;
  if (args.displayNameEn != null) rpcPayload.p_display_name_en = args.displayNameEn;
  const { data, error } = await supabase.rpc(
    "get_or_create_external_artist",
    rpcPayload,
  );
  if (error) return { data: null, error };
  return { data: (data as string | null) ?? null, error: null };
}

/**
 * Owner-only fetch of an invited external artist's invite_email.
 *
 * QA 2026-06-27: `external_artists.invite_email` (PII) is no longer
 * selectable via PostgREST by anon/authenticated — the public feed /
 * detail / exhibition embeds dropped it so a third-party viewer can't
 * harvest invite emails of publicly-credited external artists. The
 * edit screen still needs it to prefill the invite field, so it now
 * goes through the SECURITY DEFINER `get_external_artist_invite_email`
 * RPC, which returns the email only to the inviter (invited_by =
 * auth.uid()). Non-inviters (incl. delegates, who never had row
 * access to begin with) get null.
 */
export async function getExternalArtistInviteEmail(
  externalArtistId: string
): Promise<{ data: string | null; error: unknown }> {
  if (!externalArtistId) return { data: null, error: null };
  const { data, error } = await supabase.rpc("get_external_artist_invite_email", {
    p_external_artist_id: externalArtistId,
  });
  if (error) return { data: null, error };
  return { data: (data as string | null) ?? null, error: null };
}

export async function updateClaim(
  claimId: string,
  payload: {
    claim_type?: string;
    artist_profile_id?: string | null;
    external_artist_id?: string | null;
    visibility?: string;
    status?: string;
  }
): Promise<{ error: unknown }> {
  const { error } = await supabase.from("claims").update(payload).eq("id", claimId);
  return { error };
}

/**
 * Request to confirm a relationship (e.g. "I own this" / "I curated this").
 * Creates a pending claim that the artist must confirm.
 *
 * When `subjectProfileId` is supplied AND different from the caller, the
 * server-side RPC verifies the caller is an active account-scope delegate
 * writer for that subject, then files the request on behalf of that
 * principal — preventing the historical regression where a delegate's
 * "claim" attached to the operator's own profile.
 */
export async function createClaimRequest(args: {
  workId: string;
  claimType: ClaimType;
  artistProfileId: string;
  /** Requester can suggest period (artist may change on confirm). For INVENTORY/CURATED/EXHIBITED. */
  period_status?: "past" | "current" | "future" | null;
  /** When acting-as a principal: the principal's profile id. */
  subjectProfileId?: string | null;
}): Promise<{ data: { id: string } | null; error: unknown }> {
  const payload: Record<string, unknown> = {
    p_work_id: args.workId,
    p_claim_type: args.claimType,
    p_artist_profile_id: args.artistProfileId,
  };
  if (args.period_status != null) payload.p_period_status = args.period_status;
  if (args.subjectProfileId) payload.p_subject_profile_id = args.subjectProfileId;
  const { data, error } = await supabase.rpc("create_claim_request", payload);
  if (error) return { data: null, error };
  const row = (data as { claim?: { id: string } } | null)?.claim ?? null;
  return { data: row, error: null };
}

/** Artist confirms a pending claim on their work. Can set or correct period_status and optional dates. */
export async function confirmClaim(
  claimId: string,
  payload?: { period_status?: "past" | "current" | "future" | null; start_date?: string | null; end_date?: string | null }
): Promise<{ error: unknown }> {
  const update: Record<string, unknown> = { status: "confirmed" };
  if (payload?.period_status != null) update.period_status = payload.period_status;
  if (payload?.start_date !== undefined) update.start_date = payload.start_date || null;
  if (payload?.end_date !== undefined) update.end_date = payload.end_date || null;
  const { error } = await supabase.from("claims").update(update).eq("id", claimId);
  return { error };
}

/** Artist rejects (deletes) a pending claim on their work. */
export async function rejectClaim(claimId: string): Promise<{ error: unknown }> {
  const { error } = await supabase.from("claims").delete().eq("id", claimId);
  return { error };
}

export type PendingClaimRow = {
  id: string;
  claim_type: string;
  subject_profile_id: string;
  work_id: string | null;
  created_at: string | null;
  period_status: "past" | "current" | "future" | null;
  start_date: string | null;
  end_date: string | null;
  profiles: { username: string | null; display_name: string | null } | null;
};

/** List all pending claims on my works (for /my/claims). Optional profileId for acting-as account delegate. */
export async function listMyPendingClaims(profileId?: string): Promise<{ data: PendingClaimRow[]; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], error: null };
  const artistId = profileId ?? session.user.id;
  const { data: workRows } = await supabase
    .from("artworks")
    .select("id")
    .eq("artist_id", artistId);
  const workIds = (workRows ?? []).map((r: { id: string }) => r.id);
  if (workIds.length === 0) return { data: [], error: null };
  const { data, error } = await supabase
    .from("claims")
    .select(
      "id, claim_type, subject_profile_id, work_id, created_at, period_status, start_date, end_date, profiles!subject_profile_id(username, display_name)"
    )
    .in("work_id", workIds)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) return { data: [], error };
  const rows: PendingClaimRow[] = (data ?? []).map((row: unknown) => {
    const r = row as Record<string, unknown>;
    const profiles = r.profiles;
    const profileObj =
      Array.isArray(profiles) && profiles.length > 0
        ? (profiles[0] as { username: string | null; display_name: string | null })
        : profiles && typeof profiles === "object" && !Array.isArray(profiles)
          ? (profiles as { username: string | null; display_name: string | null })
          : null;
    return {
      id: r.id,
      claim_type: r.claim_type,
      subject_profile_id: r.subject_profile_id,
      work_id: r.work_id ?? null,
      created_at: r.created_at ?? null,
      period_status: (r.period_status as "past" | "current" | "future") ?? null,
      start_date: (r.start_date as string) ?? null,
      end_date: (r.end_date as string) ?? null,
      profiles: profileObj,
    } as PendingClaimRow;
  });
  return { data: rows, error: null };
}

/** List pending claims for a work (artist only sees these). */
export async function listPendingClaimsForWork(
  workId: string
): Promise<{ data: PendingClaimRow[]; error: unknown }> {
  const { data, error } = await supabase
    .from("claims")
    .select(
      "id, claim_type, subject_profile_id, work_id, created_at, period_status, start_date, end_date, profiles!subject_profile_id(username, display_name)"
    )
    .eq("work_id", workId)
    .eq("status", "pending");
  if (error) return { data: [], error };
  const rows: PendingClaimRow[] = (data ?? []).map((row: unknown) => {
    const r = row as Record<string, unknown>;
    const profiles = r.profiles;
    const profileObj =
      Array.isArray(profiles) && profiles.length > 0
        ? (profiles[0] as { username: string | null; display_name: string | null })
        : profiles && typeof profiles === "object" && !Array.isArray(profiles)
          ? (profiles as { username: string | null; display_name: string | null })
          : null;
    return {
      id: r.id,
      claim_type: r.claim_type,
      subject_profile_id: r.subject_profile_id,
      work_id: r.work_id ?? null,
      created_at: r.created_at ?? null,
      period_status: (r.period_status as "past" | "current" | "future") ?? null,
      start_date: (r.start_date as string) ?? null,
      end_date: (r.end_date as string) ?? null,
      profiles: profileObj,
    } as PendingClaimRow;
  });
  return { data: rows, error: null };
}

export async function searchWorksForDedup(
  args: SearchWorksForDedupArgs
): Promise<{ data: { id: string; title: string | null; [key: string]: unknown }[]; error: unknown }> {
  const { data, error } = await supabase.rpc("search_works_for_dedup", {
    p_artist_profile_id: args.artistProfileId ?? null,
    p_external_artist_id: args.externalArtistId ?? null,
    p_q: args.q ?? null,
    p_limit: args.limit ?? 20,
  });
  if (error) return { data: [], error };
  return { data: (data ?? []) as { id: string; title: string | null; [key: string]: unknown }[], error: null };
}

export function claimTypeToLabel(claimType: ClaimType, projectTitle?: string | null): string {
  switch (claimType) {
    case "CREATED":
      return "Work";
    case "OWNS":
      return "Collected";
    case "INVENTORY":
      return "Inventory";
    case "EXHIBITED":
      return "Exhibited";
    case "CURATED":
      return projectTitle ? `Curated in ${projectTitle}` : "Curated";
    case "INCLUDES_WORK":
      return projectTitle ? `In ${projectTitle}` : "Included";
    case "HOSTS_PROJECT":
      return "Hosts";
    default:
      return "Work";
  }
}

/** "X by {user}" phrase for display (curated by, collected by, secured by, etc.) */
export function claimTypeToByPhrase(claimType: ClaimType): string | null {
  switch (claimType) {
    case "CREATED":
      return null; // artist is shown as "by {artist}" separately
    case "OWNS":
      return "collected by";
    case "INVENTORY":
      return "secured by";
    case "EXHIBITED":
      return "exhibited by";
    case "CURATED":
      return "curated by";
    case "INCLUDES_WORK":
      return "included by";
    case "HOSTS_PROJECT":
      return "hosted by";
    default:
      return null;
  }
}
