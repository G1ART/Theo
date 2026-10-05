/**
 * Public profile artwork window.
 *
 * A numeric cap of 50 hid newer works once older exhibition pieces filled
 * the first page. The profile reads every public work by this artist.
 * Callers that want a short preview pass an explicit limit.
 */

export const PUBLIC_PROFILE_ARTWORK_LIMIT: number | null = null;

export function resolvePublicProfileLimit(limit: number | null | undefined): number | null {
  if (limit === undefined) return PUBLIC_PROFILE_ARTWORK_LIMIT;
  return limit;
}

/** Rows already ordered the way the profile query orders them. */
export function publicProfileSlice<T>(rows: readonly T[], limit: number | null): T[] {
  if (limit == null) return [...rows];
  if (limit <= 0) return [];
  return rows.slice(0, limit);
}
