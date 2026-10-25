/**
 * Destination shared by the desktop right-rail search and the mobile
 * header magnifier. A query opens the existing `/search` results.
 * An empty submit opens `/people`, same as the rail. Not a second search.
 */
export function shellSearchHref(raw: string): string {
  const query = raw.trim();
  return query ? `/search?q=${encodeURIComponent(query)}` : "/people";
}
