import { supabase } from "@/lib/supabase/client";
import {
  artworkMatchesSearch,
  ilikeAnyClause,
  queryTokenGroups,
  recallTermsForGroup,
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

async function fallbackIds(options: {
  query: string;
  mode: ArtworkSearchMode;
  ownerId: string | null;
  limit: number;
}): Promise<string[]> {
  const groups = queryTokenGroups(options.query);
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
  const groups = queryTokenGroups(queryText);
  if (groups.length === 0) return [];
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 80);
  const ownerId = isUuid(options.ownerId) ? options.ownerId : null;

  const { data, error } = await supabase.rpc("search_artwork_ids", {
    p_groups: groups,
    p_mode: options.mode,
    p_owner: ownerId,
    p_limit: limit,
  });

  if (!error && Array.isArray(data)) {
    const ids = data
      .map((row) => {
        if (typeof row === "string") return row;
        if (row && typeof row === "object" && "id" in row) {
          return String((row as { id: unknown }).id ?? "");
        }
        return "";
      })
      .filter((id) => isUuid(id));
    return ids.slice(0, limit);
  }

  if (error && !missingRpc(error)) {
    console.warn("[search] search_artwork_ids failed, using ilike fallback", error);
  }
  return fallbackIds({ query: queryText, mode: options.mode, ownerId, limit });
}
