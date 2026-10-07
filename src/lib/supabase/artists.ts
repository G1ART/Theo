import { recordMatchesQuery } from "@/lib/search/matchText";
import { looseInitialQuery } from "@/lib/search/romanize";
import { recallProfilesForQuery } from "@/lib/search/recallPeople";
import { supabase } from "./client";

export type PublicProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  /** QA 2026-08-17 bilingual — populated whenever the RPC surfaces the
   *  KO/EN slots. Consumers should route the name through
   *  `formatDisplayName(row, t, locale)` for locale-first display. */
  display_name_ko?: string | null;
  display_name_en?: string | null;
  main_role: string | null;
  roles: string[] | null;
  avatar_url: string | null;
  bio?: string | null;
  bio_ko?: string | null;
  bio_en?: string | null;
  reason?: string;
  reason_tags?: string[];
  reason_detail?: {
    sharedThemesTop?: string[];
    sharedSchool?: string;
  };
};

export const ROLE_OPTIONS = ["artist", "curator", "gallerist", "collector"] as const;

/** Encode UUID as cursor for next page */
export function encodePeopleCursor(id: string): string {
  if (typeof btoa !== "undefined") {
    return btoa(id);
  }
  return Buffer.from(id, "utf8").toString("base64");
}

// `getRecommendedPeople` was removed in P3 (sample-tab-quality): the
// `get_recommended_people` RPC was superseded by `get_people_recs`
// (lanes RPC) and no client called it. Drop in
// `20260601300000_people_recs_quality_p3.sql`.

export type SearchPeopleOptions = {
  q: string;
  roles?: string[];
  limit: number;
  cursor?: string | null;
};

export async function searchPeople(
  options: SearchPeopleOptions
): Promise<{ data: PublicProfile[]; nextCursor: string | null; error: unknown }> {
  const { q, roles = [], limit = 15, cursor = null } = options;
  const normalized = q.trim();
  if (!normalized) return { data: [], nextCursor: null, error: null };

  const rolesArr = Array.isArray(roles) ? roles : [];
  const cleanRoles = rolesArr.filter((r) => ROLE_OPTIONS.includes(r as (typeof ROLE_OPTIONS)[number]));

  const recalledPromise = cursor
    ? Promise.resolve([])
    : recallProfilesForQuery({ q: normalized, limit, roles: cleanRoles });
  const [{ data, error }, recalled] = await Promise.all([
    supabase.rpc("search_people", {
      p_q: normalized,
      p_roles: cleanRoles,
      p_limit: limit,
      p_cursor: cursor || null,
    }),
    recalledPromise,
  ]);

  const nameFields = (row: {
    username?: string | null;
    display_name?: string | null;
    display_name_ko?: string | null;
    display_name_en?: string | null;
  }) => [row.username, row.display_name, row.display_name_ko, row.display_name_en];
  const loose = looseInitialQuery(normalized);
  const rpcRows = ((error ? [] : data ?? []) as PublicProfile[]).filter((row) =>
    loose ? recordMatchesQuery(normalized, nameFields(row)) : true,
  );
  const merged: PublicProfile[] = [];
  const seen = new Set<string>();
  for (const row of [...recalled, ...rpcRows]) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
    if (merged.length >= limit) break;
  }
  if (error && merged.length === 0) return { data: [], nextCursor: null, error };
  const nextCursor = rpcRows.length >= limit && rpcRows[rpcRows.length - 1]?.id
    ? encodePeopleCursor(rpcRows[rpcRows.length - 1].id)
    : null;
  return { data: merged, nextCursor, error: null };
}

/**
 * Combined-kind result from `search_people_with_external` RPC.
 *
 * `profile` rows correspond to onboarded users (mirror of `PublicProfile`
 * with a `kind` tag). `external` rows correspond to invited-but-not-yet-
 * onboarded artists that the caller invited themselves — surfaced so the
 * operator can re-select an existing invite instead of re-typing name +
 * email (which historically minted a fresh external_artists row per
 * upload; QA 2026-07 root fix).
 *
 * External rows carry `works_count` (distinct works already attributed
 * via claims) and `latest_cover_paths` (up to 3 storage paths for a
 * hover mini-strip). No PII (invite email) is included.
 */
export type SearchPeopleWithExternalResult = {
  kind: "profile" | "external";
  id: string;
  display_name: string | null;
  /** QA 2026-08-17 bilingual — populated when the search RPC surfaces
   *  the KO/EN slots. Consumers should route through
   *  `formatDisplayName(row, t, locale)`. */
  display_name_ko?: string | null;
  display_name_en?: string | null;
  username: string | null;
  avatar_url: string | null;
  main_role: string | null;
  roles: string[] | null;
  works_count: number;
  latest_cover_paths: string[];
  invited_at: string | null;
};

/**
 * Unified search across onboarded profiles + the caller's own invited
 * external artists. Only surfaces external results when both
 * `includeExternal=true` AND the caller is authenticated (server enforces
 * `invited_by = auth.uid()` or an active-writer principal — see the
 * `search_people_with_external` RPC migration for the privacy boundary).
 *
 * Backwards-compat: this is a NEW function; the existing `searchPeople`
 * (profiles only) still services delegation wizard, host search, etc.
 * where surfacing external artists would be inappropriate.
 */
export async function searchPeopleWithExternal(options: {
  q: string;
  roles?: string[];
  limit?: number;
  includeExternal?: boolean;
  /** Acting-as principal id when the caller is a delegate; server verifies. */
  inviterId?: string | null;
}): Promise<{ data: SearchPeopleWithExternalResult[]; error: unknown }> {
  const {
    q,
    roles = [],
    limit = 15,
    includeExternal = false,
    inviterId = null,
  } = options;
  const normalized = q.trim();
  if (!normalized) return { data: [], error: null };

  const rolesArr = Array.isArray(roles) ? roles : [];
  const cleanRoles = rolesArr.filter((r) =>
    ROLE_OPTIONS.includes(r as (typeof ROLE_OPTIONS)[number])
  );

  const [rpc, recalled] = await Promise.all([
    supabase.rpc("search_people_with_external", {
      p_q: normalized,
      p_roles: cleanRoles,
      p_include_external: includeExternal,
      p_inviter_id: inviterId,
      p_limit: limit,
    }),
    recallProfilesForQuery({ q: normalized, limit, roles: cleanRoles }),
  ]);

  if (rpc.error && recalled.length === 0) return { data: [], error: rpc.error };
  const loose = looseInitialQuery(normalized);
  const rpcRows = ((rpc.error ? [] : rpc.data ?? []) as SearchPeopleWithExternalResult[]).filter(
    (row) =>
      loose
        ? recordMatchesQuery(normalized, [
            row.username,
            row.display_name,
            row.display_name_ko,
            row.display_name_en,
          ])
        : true,
  );
  const seen = new Set(rpcRows.map((row) => row.id));
  const recalledRows: SearchPeopleWithExternalResult[] = recalled
    .filter((row) => row.id && !seen.has(row.id))
    .map((row) => ({
      kind: "profile" as const,
      id: row.id,
      display_name: row.display_name,
      display_name_ko: row.display_name_ko ?? null,
      display_name_en: row.display_name_en ?? null,
      username: row.username,
      avatar_url: row.avatar_url,
      main_role: row.main_role,
      roles: row.roles,
      works_count: 0,
      latest_cover_paths: [],
      invited_at: null,
    }));
  return { data: [...recalledRows, ...rpcRows].slice(0, limit), error: null };
}

export async function getFollowingIds(): Promise<{
  data: Set<string>;
  error: unknown;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id)
    return { data: new Set(), error: new Error("Not authenticated") };

  const { data, error } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", session.user.id)
    .eq("status", "accepted");

  if (error) return { data: new Set(), error };
  const ids = new Set((data ?? []).map((r) => r.following_id));
  return { data: ids, error: null };
}
