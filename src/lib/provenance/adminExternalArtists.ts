import { supabase } from "@/lib/supabase/client";

/**
 * QA 2026-07-28 Phase E — ops-only wrappers for legacy external_artist
 * consolidation. These are only useful if the caller is in the
 * `public.platform_admins` allowlist; otherwise the RPCs raise
 * `forbidden`.
 */

export async function isOpsUser(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_ops_user");
  if (error) return false;
  return !!data;
}

export type ExternalArtistDuplicateGroup = {
  bucket: "noemail-name" | "mixed-email-noemail" | string;
  key: string;
  ids: string[];
  n: number;
};

export async function adminSearchExternalArtistDuplicates(): Promise<{
  data: ExternalArtistDuplicateGroup[];
  error: unknown;
}> {
  const { data, error } = await supabase.rpc(
    "admin_search_external_artist_duplicates"
  );
  if (error) return { data: [], error };
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return {
    data: rows.map((r) => ({
      bucket: String(r.bucket ?? ""),
      key: String(r.key ?? ""),
      ids: Array.isArray(r.ids) ? (r.ids as string[]) : [],
      n: Number(r.n ?? 0),
    })),
    error: null,
  };
}

export type AdminMergeExternalArtistsResult = {
  target_id: string;
  source_count: number;
  claims_moved: number;
  claims_dropped?: number;
};

/**
 * Map leftover unique-constraint failures (pre-migration RPC, or a
 * collision we do not yet absorb) to a sentence the English ops page
 * can show. Other errors pass through as their PostgREST message.
 */
export function formatAdminMergeExternalArtistsError(error: unknown): string {
  const o = (error ?? {}) as {
    message?: unknown;
    details?: unknown;
    code?: unknown;
  };
  const message = typeof o.message === "string" ? o.message : "";
  const details = typeof o.details === "string" ? o.details : "";
  const code = typeof o.code === "string" ? o.code : "";
  const blob = `${code} ${message} ${details}`.toLowerCase();
  const isUnique =
    code === "23505" ||
    blob.includes("duplicate key") ||
    blob.includes("unique constraint") ||
    blob.includes("uq_claims_project_curated_ext") ||
    blob.includes("uq_claims_one_created_per_work");
  if (isUnique) {
    return "These artists already have overlapping exhibition or creator claims. The merge now drops the source claim and keeps the target’s — if you still see this, apply the latest merge SQL in the Dashboard, then retry.";
  }
  if (message) return message;
  return String(error ?? "Merge failed.");
}

export async function adminMergeExternalArtists(
  targetId: string,
  sourceIds: string[]
): Promise<{
  data: AdminMergeExternalArtistsResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("admin_merge_external_artists", {
    p_source_ids: sourceIds,
    p_target_id: targetId,
  });
  if (error) return { data: null, error };
  return {
    data: (data as AdminMergeExternalArtistsResult) ?? null,
    error: null,
  };
}

export type AdminExternalArtistDetail = {
  id: string;
  display_name: string | null;
  display_name_ko: string | null;
  display_name_en: string | null;
  invite_email: string | null;
  invited_by: string | null;
  website: string | null;
  instagram: string | null;
  claimed_profile_id: string | null;
  status: string | null;
  created_at: string | null;
};

/**
 * Direct table read (RLS restricted to invited_by = auth.uid()). Ops can
 * still read via SECURITY DEFINER helpers — this direct call is only used
 * when the caller is the inviter for the specific row. For ops UI we
 * expose a dedicated SECURITY DEFINER shortcut below.
 */
export async function adminFetchExternalArtistBatch(
  ids: string[]
): Promise<{
  data: AdminExternalArtistDetail[];
  error: unknown;
}> {
  if (ids.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.rpc(
    "admin_fetch_external_artist_batch",
    { p_ids: ids }
  );
  if (error) return { data: [], error };
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return {
    data: rows.map((r) => ({
      id: String(r.id ?? ""),
      display_name: (r.display_name as string | null) ?? null,
      display_name_ko: (r.display_name_ko as string | null) ?? null,
      display_name_en: (r.display_name_en as string | null) ?? null,
      invite_email: (r.invite_email as string | null) ?? null,
      invited_by: (r.invited_by as string | null) ?? null,
      website: (r.website as string | null) ?? null,
      instagram: (r.instagram as string | null) ?? null,
      claimed_profile_id: (r.claimed_profile_id as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      created_at: (r.created_at as string | null) ?? null,
    })),
    error: null,
  };
}
