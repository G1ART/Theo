import { buildIlikeClauses } from "@/lib/search/matchText";

const SEARCH_COLUMNS = [
  "username",
  "display_name",
  "display_name_ko",
  "display_name_en",
  "bio",
  "bio_ko",
  "bio_en",
] as const;

/**
 * PostgREST `or` filters against the embedded profiles row.
 * One string per query token (callers AND them). Related forms of a
 * token are OR'd inside that string. Empty input means "no search".
 */
export function followProfileSearchClauses(
  raw: string | null | undefined,
): string[] | null {
  return buildIlikeClauses(raw ?? "", SEARCH_COLUMNS);
}

/** Single-token helper. Multi-token search should use the clause list. */
export function followProfileSearchOr(raw: string | null | undefined): string | null {
  const clauses = followProfileSearchClauses(raw);
  return clauses?.[0] ?? null;
}
