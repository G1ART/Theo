import { buildIlikeClauses, recordMatchesQuery } from "@/lib/search/matchText";
import { looseInitialQuery } from "@/lib/search/romanize";
import { supabase } from "@/lib/supabase/client";

const NAME_COLUMNS = ["username", "display_name", "display_name_ko", "display_name_en"] as const;

export type RecalledProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  display_name_ko?: string | null;
  display_name_en?: string | null;
  avatar_url: string | null;
  bio?: string | null;
  main_role: string | null;
  roles: string[] | null;
  is_public?: boolean;
};

function roleMatches(row: RecalledProfile, roles: string[]): boolean {
  if (roles.length === 0) return true;
  if (row.main_role && roles.includes(row.main_role)) return true;
  return (row.roles ?? []).some((role) => roles.includes(role));
}

/**
 * Profiles whose stored Hangul or Latin name matches the query.
 * Runs before trigram SQL, so a Korean-only name is found by
 * "Hyunmin Kim" or "h kim" even if that migration is not applied.
 */
export async function recallProfilesForQuery(options: {
  q: string;
  limit: number;
  roles?: string[];
}): Promise<RecalledProfile[]> {
  const q = options.q.trim().replace(/^@+/, "");
  if (!q) return [];
  const clauses = buildIlikeClauses(q, NAME_COLUMNS);
  if (!clauses) return [];
  const fetchLimit = looseInitialQuery(q)
    ? Math.max(options.limit, 40)
    : Math.max(options.limit, 20);
  let query = supabase
    .from("profiles")
    .select(
      "id, username, display_name, display_name_ko, display_name_en, avatar_url, bio, main_role, roles, is_public",
    );
  for (const clause of clauses) query = query.or(clause);
  const { data, error } = await query.limit(Math.min(fetchLimit, 80));
  if (error || !data) return [];
  const roles = options.roles ?? [];
  return (data as RecalledProfile[])
    .filter((row) => roleMatches(row, roles))
    .filter((row) =>
      recordMatchesQuery(q, [
        row.username,
        row.display_name,
        row.display_name_ko,
        row.display_name_en,
      ]),
    )
    .slice(0, options.limit);
}
