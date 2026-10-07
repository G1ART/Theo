import { supabase } from "@/lib/supabase/client";
import {
  artworkMatchesSearch,
  buildIlikeClauses,
  ilikeAnyClause,
  isCrossScriptQuery,
  looseInitialQuery,
  recallTermsForGroup,
  rpcSearchGroups,
  searchTokenGroups,
  type ArtworkSearchSource,
} from "@/lib/search/matchText";

export type ArtworkSearchMode = "public" | "attachable" | "library";

const PROFILE_COLUMNS = [
  "username",
  "display_name",
  "display_name_ko",
  "display_name_en",
] as const;

const TEXT_COLUMNS = [
  "title",
  "title_ko",
  "title_en",
  "medium",
  "medium_ko",
  "medium_en",
  "story",
  "story_ko",
  "story_en",
] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function missingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = `${error.code ?? ""} ${error.message ?? ""}`;
  return /PGRST202|schema cache|could not find the function|42883/i.test(message);
}

async function profileIdsForTerms(terms: readonly string[]): Promise<string[]> {
  const clause = ilikeAnyClause(terms, PROFILE_COLUMNS);
  if (!clause) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .or(clause)
    .limit(20);
  if (error || !data) return [];
  return (data as Array<{ id?: string }>)
    .map((row) => row.id)
    .filter((id): id is string => isUuid(id));
}

type SearchRow = ArtworkSearchSource & {
  id: string;
  visibility: string | null;
  artist_id: string | null;
  created_by: string | null;
  profiles?: ArtworkSearchSource["profiles"];
  uploader?: ArtworkSearchSource["uploader"];
};

function scopeOr(mode: ArtworkSearchMode, ownerId: string | null): string | null {
  if (mode === "public" || !isUuid(ownerId)) return null;
  if (mode === "attachable") {
    return `visibility.eq.public,artist_id.eq.${ownerId},created_by.eq.${ownerId}`;
  }
  return `artist_id.eq.${ownerId},created_by.eq.${ownerId}`;
}

async function looseFallbackIds(options: {
  query: string;
  mode: ArtworkSearchMode;
  ownerId: string | null;
  limit: number;
}): Promise<string[]> {
  const profileClause = buildIlikeClauses(options.query, PROFILE_COLUMNS);
  const textClause = buildIlikeClauses(options.query, TEXT_COLUMNS);
  let profileIds: string[] = [];
  if (profileClause?.[0]) {
    const { data } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS.join(", ") + ", id")
      .or(profileClause[0])
      .limit(40);
    profileIds = ((data ?? []) as unknown as Array<Record<string, string | null>>)
      .filter((row) =>
        artworkMatchesSearch(options.query, {
          profiles: {
            username: row.username,
            display_name: row.display_name,
            display_name_ko: row.display_name_ko,
            display_name_en: row.display_name_en,
          },
        }),
      )
      .map((row) => row.id)
      .filter((id): id is string => isUuid(id));
  }

  let query = supabase.from("artworks").select(
    `id, title, title_ko, title_en, medium, medium_ko, medium_en, story, story_ko, story_en, visibility, artist_id, created_by,
     profiles!artist_id(${PROFILE_COLUMNS.join(", ")}),
     uploader:profiles!created_by(${PROFILE_COLUMNS.join(", ")})`,
  );
  const scope = scopeOr(options.mode, options.ownerId);
  if (scope) query = query.or(scope);
  else query = query.eq("visibility", "public");

  const parts: string[] = [];
  if (textClause?.[0]) parts.push(textClause[0]);
  if (profileIds.length > 0) {
    const list = profileIds.join(",");
    parts.push(`artist_id.in.(${list})`, `created_by.in.(${list})`);
  }
  if (parts.length === 0) return [];
  query = query.or(parts.join(","));
  const { data, error } = await query.limit(Math.min(options.limit * 2, 80));
  if (error || !data) return [];
  return (data as unknown as SearchRow[])
    .filter((row) =>
      artworkMatchesSearch(options.query, {
        ...row,
        profiles: row.profiles,
        uploader: row.uploader,
      }),
    )
    .map((row) => row.id)
    .filter((id) => isUuid(id))
    .slice(0, options.limit);
}

async function fallbackIds(options: {
  query: string;
  mode: ArtworkSearchMode;
  ownerId: string | null;
  limit: number;
}): Promise<string[]> {
  if (looseInitialQuery(options.query)) return looseFallbackIds(options);
  const groups = searchTokenGroups(options.query);
  if (groups.length === 0) return [];

  let query = supabase.from("artworks").select(
    `id, title, title_ko, title_en, medium, medium_ko, medium_en, story, story_ko, story_en, visibility, artist_id, created_by,
     profiles!artist_id(${PROFILE_COLUMNS.join(", ")}),
     uploader:profiles!created_by(${PROFILE_COLUMNS.join(", ")})`,
  );

  const scope = scopeOr(options.mode, options.ownerId);
  if (scope) query = query.or(scope);
  else query = query.eq("visibility", "public");

  for (const group of groups) {
    const terms = recallTermsForGroup(group);
    const ids = await profileIdsForTerms(terms);
    const parts: string[] = [];
    const textClause = ilikeAnyClause(terms, TEXT_COLUMNS);
    if (textClause) parts.push(textClause);
    if (ids.length > 0) {
      const list = ids.join(",");
      parts.push(`artist_id.in.(${list})`, `created_by.in.(${list})`);
    }
    if (parts.length === 0) return [];
    query = query.or(parts.join(","));
  }

  const { data, error } = await query.limit(Math.min(options.limit * 2, 80));
  if (error || !data) return [];
  return (data as unknown as SearchRow[])
    .filter((row) =>
      artworkMatchesSearch(options.query, {
        ...row,
        profiles: row.profiles,
        uploader: row.uploader,
      }),
    )
    .map((row) => row.id)
    .filter((id) => isUuid(id))
    .slice(0, options.limit);
}

/**
 * Artwork ids the caller may already read that match the query.
 * Tries `search_artwork_ids` (trigram). If that function is not applied
 * yet, falls back to ilike on titles plus artist and uploader names.
 */
export async function findArtworkIdsForQuery(options: {
  query: string;
  mode: ArtworkSearchMode;
  ownerId?: string | null;
  limit?: number;
}): Promise<string[]> {
  const queryText = options.query.trim();
  if (!queryText) return [];
  const groups = rpcSearchGroups(queryText);
  if (groups.length === 0) return [];
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 80);
  const ownerId = isUuid(options.ownerId) ? options.ownerId : null;
  const cross = isCrossScriptQuery(queryText);

  const { data, error } = await supabase.rpc("search_artwork_ids", {
    p_groups: groups,
    p_mode: options.mode,
    p_owner: ownerId,
    p_limit: limit,
  });

  const rpcIds =
    !error && Array.isArray(data)
      ? data
          .map((row) => {
            if (typeof row === "string") return row;
            if (row && typeof row === "object" && "id" in row) {
              return String((row as { id: unknown }).id ?? "");
            }
            return "";
          })
          .filter((id) => isUuid(id))
      : [];

  if (error && !missingRpc(error)) {
    console.warn("[search] search_artwork_ids failed, using ilike fallback", error);
  }

  if (!error && !cross) return rpcIds.slice(0, limit);

  const extra = await fallbackIds({ query: queryText, mode: options.mode, ownerId, limit });
  const merged: string[] = [];
  for (const id of [...rpcIds, ...extra]) {
    if (!merged.includes(id)) merged.push(id);
  }
  if (!looseInitialQuery(queryText)) return merged.slice(0, limit);

  if (merged.length === 0) return [];
  let check = supabase
    .from("artworks")
    .select(
      `id, title, title_ko, title_en, medium, medium_ko, medium_en, story, story_ko, story_en, visibility, artist_id, created_by,
       profiles!artist_id(${PROFILE_COLUMNS.join(", ")}),
       uploader:profiles!created_by(${PROFILE_COLUMNS.join(", ")})`,
    )
    .in("id", merged.slice(0, 80));
  const scope = scopeOr(options.mode, ownerId);
  if (scope) check = check.or(scope);
  else check = check.eq("visibility", "public");
  const { data: rows } = await check;
  if (!rows) return extra.slice(0, limit);
  const allowed = new Set(
    (rows as unknown as SearchRow[])
      .filter((row) =>
        artworkMatchesSearch(queryText, {
          ...row,
          profiles: row.profiles,
          uploader: row.uploader,
        }),
      )
      .map((row) => row.id),
  );
  return merged.filter((id) => allowed.has(id)).slice(0, limit);
}
