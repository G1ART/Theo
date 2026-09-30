/**
 * Library membership and page cursor rules shared by the library query
 * and its tests. A work stays in the profile library when that profile
 * is still the artist, or when it holds a confirmed claim on the work
 * after the artist id moved to an onboarded artist.
 */

export type LibraryClaim = {
  subjectProfileId: string | null;
  status: string | null | undefined;
};

export function isConfirmedLibraryClaim(status: string | null | undefined): boolean {
  return status == null || status === "confirmed";
}

export function workBelongsInProfileLibrary(args: {
  profileId: string;
  artistId: string | null;
  claims: LibraryClaim[];
}): boolean {
  if (args.artistId != null && args.artistId === args.profileId) return true;
  return args.claims.some(
    (claim) =>
      claim.subjectProfileId === args.profileId &&
      isConfirmedLibraryClaim(claim.status),
  );
}

export type LibrarySortKey = "created_at" | "likes" | "artist_sort";

export type LibraryOrderedRow = {
  id: string;
  created_at: string | null;
  likes_count?: number | null;
  artist_sort_order?: number | null;
};

function descText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

/** Matches the library query order, including artist_sort nulls last. */
export function compareLibraryRows(
  sort: LibrarySortKey,
  a: LibraryOrderedRow,
  b: LibraryOrderedRow,
): number {
  if (sort === "artist_sort") {
    const aNull = a.artist_sort_order == null;
    const bNull = b.artist_sort_order == null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && !bNull && a.artist_sort_order !== b.artist_sort_order) {
      return (a.artist_sort_order ?? 0) - (b.artist_sort_order ?? 0);
    }
  } else if (sort === "likes") {
    const al = Number(a.likes_count ?? 0);
    const bl = Number(b.likes_count ?? 0);
    if (al !== bl) return bl - al;
  }
  const created = descText(a.created_at ?? "", b.created_at ?? "");
  if (created !== 0) return created;
  return descText(a.id, b.id);
}

export type LibraryPageCursor = {
  created_at: string;
  id: string;
  likes_count?: number;
};

/**
 * `ordered` is already in display order and may include one extra row
 * so we know another page exists. The cursor is the last row we return,
 * not the extra row. The next query starts strictly after that row.
 */
export function libraryPageCursor<T extends LibraryOrderedRow>(
  ordered: readonly T[],
  pageSize: number,
  includeLikes: boolean,
): { page: T[]; nextCursor: LibraryPageCursor | null } {
  const hasMore = ordered.length > pageSize;
  const page = hasMore ? ordered.slice(0, pageSize) : [...ordered];
  const last = page[page.length - 1];
  if (!hasMore || !last?.created_at || !last.id) {
    return { page, nextCursor: null };
  }
  return {
    page,
    nextCursor: {
      created_at: last.created_at,
      id: last.id,
      ...(includeLikes ? { likes_count: Number(last.likes_count ?? 0) } : {}),
    },
  };
}

export function mergeLibraryRows<T extends LibraryOrderedRow>(
  rows: readonly T[],
  sort: LibrarySortKey,
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  unique.sort((a, b) => compareLibraryRows(sort, a, b));
  return unique;
}

export function artworkDuplicateKey(
  title: string | null | undefined,
  year: string | number | null | undefined,
): string {
  return `${(title ?? "").trim().toLowerCase()}|${year ?? ""}`;
}

/** Other profiles' public works are not duplicates of this library. */
export function isDuplicateInProfileLibrary(args: {
  existingArtistId: string | null;
  targetProfileId: string;
  existingTitle: string | null;
  existingYear: string | number | null;
  rowTitle: string;
  rowYear: string;
}): boolean {
  if (!args.existingArtistId || args.existingArtistId !== args.targetProfileId) return false;
  return (
    artworkDuplicateKey(args.existingTitle, args.existingYear) ===
    artworkDuplicateKey(args.rowTitle, args.rowYear)
  );
}
