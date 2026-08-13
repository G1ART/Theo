/**
 * People recommendations: get_people_recs RPC (3 lanes) + search_people.
 */

import { supabase } from "./client";
import { ROLE_OPTIONS, encodePeopleCursor } from "./artists";
import { getSearchQueryVariants } from "@/lib/search/queryVariants";

export { ROLE_OPTIONS };

export type PeopleRecMode = "follow_graph" | "likes_based" | "expand";

/**
 * Mutual-source profile shipped with `follow_graph` recommendations.
 * Up to 3 of the actual middle-graph people who follow the candidate,
 * for the LinkedIn / Twitter style "X, Y +N follow this person" stack.
 */
export type PeopleRecMutualAvatar = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export type PeopleRec = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio?: string | null;
  main_role: string | null;
  roles: string[] | null;
  is_public?: boolean;
  reason_tags?: string[];
  reason_detail?: Record<string, unknown>;
  mutual_follow_sources?: number;
  liked_artists_count?: number;
  /** 0 = exact name, 1 = fuzzy name, 2 = artwork/theme match; lower is better. */
  match_rank?: number;
  /** Tiered search rank from `search_people` — 0 = exact, 4 = fuzzy. */
  match_tier?: number;
  /** Similarity score from `search_people` (pg_trgm), 0..1. */
  match_similarity?: number;
  // ── Score envelope (G2) ────────────────────────────────────────────────
  /** Lane-uniform headline number (mutual sources / liked count / shared count). */
  signal_count?: number;
  /** Lane-uniform top signal token (`follow_graph`, `likes_based`, `shared_themes`, …). */
  top_signal?: string;
  // ── Mutual avatar stack (G3) ───────────────────────────────────────────
  mutual_avatars?: PeopleRecMutualAvatar[];
  // ── Activity dot (S2) ─────────────────────────────────────────────────
  /** True when the candidate has been active within the last 14 days. */
  is_recently_active?: boolean;
};

export type GetPeopleRecsOptions = {
  mode: PeopleRecMode;
  roles?: string[] | null;
  limit?: number;
  cursor?: string | null;
};

export async function getPeopleRecs(
  options: GetPeopleRecsOptions
): Promise<{ data: PeopleRec[]; nextCursor: string | null; error: unknown }> {
  const { mode, roles, limit = 15, cursor = null } = options;
  const rolesArr = Array.isArray(roles) ? roles : [];
  const cleanRoles = rolesArr.filter((r) =>
    ROLE_OPTIONS.includes(r as (typeof ROLE_OPTIONS)[number])
  );

  const { data, error } = await supabase.rpc("get_people_recs", {
    p_mode: mode,
    p_roles: cleanRoles.length > 0 ? cleanRoles : [],
    p_limit: Math.min(Math.max(limit ?? 15, 1), 50),
    p_cursor: cursor ?? null,
  });

  if (error) return { data: [], nextCursor: null, error };
  const rows = (data ?? []) as PeopleRec[];
  const nextCursor =
    rows.length >= (limit ?? 15) && rows[rows.length - 1]?.id
      ? encodePeopleCursor(rows[rows.length - 1].id)
      : null;
  return { data: rows, nextCursor, error: null };
}

export type SearchPeopleOptions = {
  q: string;
  roles?: string[] | null;
  limit?: number;
  cursor?: string | null;
};

export async function searchPeople(
  options: SearchPeopleOptions
): Promise<{ data: PeopleRec[]; nextCursor: string | null; error: unknown }> {
  const { q, roles, limit = 15, cursor = null } = options;
  const normalized = q.trim();
  if (!normalized) return { data: [], nextCursor: null, error: null };

  const rolesArr = Array.isArray(roles) ? roles : [];
  const cleanRoles = rolesArr.filter((r) =>
    ROLE_OPTIONS.includes(r as (typeof ROLE_OPTIONS)[number])
  );

  const { data, error } = await supabase.rpc("search_people", {
    p_q: normalized,
    p_roles: cleanRoles.length > 0 ? cleanRoles : [],
    p_limit: limit ?? 15,
    p_cursor: cursor ?? null,
  });

  if (error) return { data: [], nextCursor: null, error };
  const rows = (data ?? []) as PeopleRec[];
  const nextCursor =
    rows.length >= (limit ?? 15) && rows[rows.length - 1]?.id
      ? encodePeopleCursor(rows[rows.length - 1].id)
      : null;
  return { data: rows, nextCursor, error: null };
}

/** Search artists by artwork title/medium/story (theme). Same profile shape as search_people. */
export async function searchArtistsByArtwork(
  options: { q: string; roles?: string[] | null; limit?: number }
): Promise<{ data: PeopleRec[]; error: unknown }> {
  const { q, roles, limit = 20 } = options;
  const normalized = q.trim();
  if (!normalized) return { data: [], error: null };

  const rolesArr = Array.isArray(roles) ? roles : [];
  const cleanRoles = rolesArr.filter((r) =>
    ROLE_OPTIONS.includes(r as (typeof ROLE_OPTIONS)[number])
  );

  const { data, error } = await supabase.rpc("search_artists_by_artwork", {
    p_q: normalized,
    p_roles: cleanRoles.length > 0 ? cleanRoles : [],
    p_limit: Math.min(Math.max(limit ?? 20, 1), 50),
  });

  if (error) return { data: [], error };
  return { data: (data ?? []) as PeopleRec[], error: null };
}

/** Get "Did you mean?" suggestion when search has no or few results. */
export async function getSearchSuggestion(
  q: string
): Promise<{ suggestion: string | null; error: unknown }> {
  const normalized = q.trim();
  if (!normalized) return { suggestion: null, error: null };
  const { data, error } = await supabase.rpc("get_search_suggestion", {
    p_q: normalized,
  });
  if (error) return { suggestion: null, error };
  const suggestion = (data as { suggestion?: string | null } | null)?.suggestion ?? null;
  return { suggestion: suggestion && String(suggestion).trim() ? String(suggestion).trim() : null, error: null };
}

/** People search: name + artwork/theme, cross-language variants, ranked, optional "Did you mean?".
 *
 * Pagination contract (B3):
 *   - First page (`cursor === null`): we run *all* query variants in
 *     parallel — name search across each variant + artwork match across
 *     each variant — and merge by `match_rank`. The returned
 *     `nextCursor` is the primary-variant name search's cursor (i.e.
 *     the unmodified `q`). This is enough for "load more": once the
 *     user is past the first page the artwork-matched and language-
 *     variant rows are already shown, and additional pages should
 *     simply continue the primary fuzzy result list.
 *   - Subsequent pages (`cursor !== null`): we run a single primary
 *     fuzzy `searchPeople` call and pass the cursor through. No
 *     artwork-side fanout (it would re-fetch already-shown rows).
 */
export async function searchPeopleWithArtwork(
  options: SearchPeopleOptions
): Promise<{
  data: PeopleRec[];
  nextCursor: string | null;
  suggestion: string | null;
  error: unknown;
}> {
  const { q, roles, limit = 30, cursor = null } = options;
  const normalized = q.trim();
  if (!normalized) return { data: [], nextCursor: null, suggestion: null, error: null };

  // Subsequent-page path: cursor is set → page through the primary
  // fuzzy variant only. The first page already exposed every variant
  // and every artwork-derived row.
  if (cursor) {
    const res = await searchPeople({ q: normalized, roles, limit, cursor });
    return {
      data: res.data,
      nextCursor: res.nextCursor,
      suggestion: null,
      error: res.error,
    };
  }

  const variants = getSearchQueryVariants(normalized);
  const namePromises = variants.map((v) =>
    // The primary variant (the user's literal input) is the one whose
    // cursor we'll surface for "load more". Run it with the requested
    // limit so its cursor logic stays consistent. Other variants stay
    // bounded to ~40 to keep merging cheap.
    searchPeople({
      q: v,
      roles,
      limit: v === normalized ? limit : 40,
      cursor: null,
    })
  );
  const artworkPromises = variants.map((v) => searchArtistsByArtwork({ q: v, roles, limit: 20 }));

  // Multi-token artwork fanout (first-page only). Field-split data
  // (`medium = "자개, 옻칠"`, `title = "달항아리 III"`) makes phrase
  // ILIKE / whole-string trigram similarity underfire on 2-token compound
  // Korean queries like "자개 달항아리". Instead, run one artwork RPC per
  // token and intersect the resulting profile-ID sets: an artist appears
  // if every token hits *some* row of theirs. Capped at 4 tokens to bound
  // fanout width.
  const rawTokens = normalized.split(/\s+/).filter((t) => t.length >= 2);
  const fanoutTokens = rawTokens.slice(0, 4);
  const runFanout = fanoutTokens.length >= 2;
  const tokenPromises = runFanout
    ? fanoutTokens.map((t) => searchArtistsByArtwork({ q: t, roles, limit: 40 }))
    : [];

  const [nameResults, artworkResults, tokenResults] = await Promise.all([
    Promise.all(namePromises),
    Promise.all(artworkPromises),
    Promise.all(tokenPromises),
  ]);

  const firstError = nameResults.find((r) => r.error)?.error ?? artworkResults.find((r) => r.error)?.error;
  if (firstError) return { data: [], nextCursor: null, suggestion: null, error: firstError };

  const byId = new Map<string, PeopleRec>();
  for (const res of nameResults) {
    for (const p of res.data ?? []) {
      const rank = (p as PeopleRec).match_rank ?? 0;
      if (!byId.has(p.id) || (byId.get(p.id)!.match_rank ?? 99) > rank) byId.set(p.id, p);
    }
  }
  for (const res of artworkResults) {
    for (const p of res.data ?? []) {
      const rank = (p as PeopleRec).match_rank ?? 2;
      if (!byId.has(p.id) || (byId.get(p.id)!.match_rank ?? 99) > rank) byId.set(p.id, p);
    }
  }

  if (runFanout) {
    const tokenErr = tokenResults.find((r) => r.error)?.error;
    if (tokenErr) {
      // Fail-soft: any single flaky per-token call → drop intersection
      // entirely, keep the name + full-query artwork results intact.
      console.warn("[searchPeopleWithArtwork] per-token fanout dropped due to error:", tokenErr);
    } else {
      // Build one id→row map per token, then intersect. The row from the
      // FIRST per-token result set is the canonical PeopleRec; we only
      // override match_rank to 2 (artwork tier).
      const rowMaps = tokenResults.map((r) => {
        const m = new Map<string, PeopleRec>();
        for (const p of r.data ?? []) if (!m.has(p.id)) m.set(p.id, p);
        return m;
      });
      const [firstMap, ...restMaps] = rowMaps;
      if (firstMap) {
        for (const [id, row] of firstMap) {
          let inAll = true;
          for (const otherMap of restMaps) {
            if (!otherMap.has(id)) {
              inAll = false;
              break;
            }
          }
          if (!inAll) continue;
          const intersected: PeopleRec = { ...row, match_rank: 2 };
          const rank = 2;
          if (!byId.has(id) || (byId.get(id)!.match_rank ?? 99) > rank) {
            byId.set(id, intersected);
          }
        }
      }
    }
  }
  const merged = Array.from(byId.values())
    .sort((a, b) => {
      const ra = a.match_rank ?? 99;
      const rb = b.match_rank ?? 99;
      if (ra !== rb) return ra - rb;
      // Within the same match_rank, prefer richer search-tier signal
      // (tier 0 exact name → tier 4 fuzzy). Falls back to similarity.
      const ta = a.match_tier ?? 99;
      const tb = b.match_tier ?? 99;
      if (ta !== tb) return ta - tb;
      const sa = a.match_similarity ?? 0;
      const sb = b.match_similarity ?? 0;
      return sb - sa;
    })
    .slice(0, limit);

  let suggestion: string | null = null;
  if (merged.length === 0) {
    const sugRes = await getSearchSuggestion(normalized);
    suggestion = sugRes.suggestion;
  }

  // Primary-variant name results: their cursor is the one we expose so
  // the caller can keep paginating *after* the first merged page.
  const primaryNameRes = nameResults[
    Math.max(0, variants.indexOf(normalized))
  ];
  const nextCursor = primaryNameRes?.nextCursor ?? null;

  return { data: merged, nextCursor, suggestion, error: null };
}

// ── Trending (S4) ──────────────────────────────────────────────────────
// Surfaces accounts that gained the most accepted-follows in the last
// 7 days. Used by the People tab when the search field is focused but
// empty so the empty state has something to interact with instead of
// a blank canvas.
export async function getTrendingPeople(
  limit: number = 8
): Promise<{ data: PeopleRec[]; error: unknown }> {
  const { data, error } = await supabase.rpc("get_trending_people", {
    p_limit: Math.min(Math.max(limit, 1), 24),
  });
  if (error) return { data: [], error };
  return { data: (data ?? []) as PeopleRec[], error: null };
}

// ── People dismissal (S3) ─────────────────────────────────────────────
// Wraps `people_dismiss` / `people_undismiss` SECURITY DEFINER RPCs.
// `mode = 'snooze'` hides the target for 30 days; `'block'` hides
// permanently. The RPC is idempotent — repeated calls just refresh
// the timestamp / mode.

export type PeopleDismissMode = "snooze" | "block";

export async function dismissPerson(
  targetId: string,
  mode: PeopleDismissMode = "snooze"
): Promise<{ ok: boolean; error: unknown }> {
  if (!targetId) return { ok: false, error: new Error("missing target") };
  const { error } = await supabase.rpc("people_dismiss", {
    p_target: targetId,
    p_mode: mode,
  });
  return { ok: !error, error: error ?? null };
}

export async function undismissPerson(
  targetId: string
): Promise<{ ok: boolean; error: unknown }> {
  if (!targetId) return { ok: false, error: new Error("missing target") };
  const { error } = await supabase.rpc("people_undismiss", {
    p_target: targetId,
  });
  return { ok: !error, error: error ?? null };
}
