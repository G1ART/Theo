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
 * PostgREST `or` filter against the embedded profiles row.
 * Strips characters that would break the filter syntax.
 * Empty input means "no search" (caller lists the page unfiltered).
 */
export function followProfileSearchOr(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "")
    .trim()
    .replace(/[%_\\,()"*]/g, "")
    .replace(/\s+/g, " ");
  if (!cleaned) return null;
  const pattern = `"%${cleaned}%"`;
  return SEARCH_COLUMNS.map((column) => `${column}.ilike.${pattern}`).join(",");
}
