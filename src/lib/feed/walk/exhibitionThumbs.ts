/** Image-only tiles on an exhibition highlight. No title, no artist. */

export const EXHIBITION_THUMB_LIMIT = 6;

const THUMB_KINDS = new Set(["artwork", "print_edition"]);

export type ExhibitionThumbInput = {
  id: string;
  imagePath: string | null;
  visibility?: string | null;
  workKind?: string | null;
  /** Participating artist. Missing on every row means one solo set, in order. */
  artistId?: string | null;
};

export type ExhibitionThumb = {
  id: string;
  imagePath: string;
};

export type ExhibitionThumbPick = {
  /**
   * Gallery-chosen work ids, in display order.
   * Used only when more than six artists have a showable work.
   * A saved list is shown as-is, even when it is shorter than six.
   */
  feedThumbWorkIds?: readonly string[] | null;
};

type CleanThumb = {
  id: string;
  imagePath: string;
  artistId: string;
};

export function isFeedThumbArtwork(input: {
  visibility?: string | null;
  workKind?: string | null;
}): boolean {
  if (input.visibility != null && input.visibility !== "public") return false;
  if (input.workKind != null && input.workKind !== "" && !THUMB_KINDS.has(input.workKind)) return false;
  return true;
}

/** Up to six ids, de-duplicated, in the order they were saved. */
export function normalizeFeedThumbIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= EXHIBITION_THUMB_LIMIT) break;
  }
  return out;
}

function cleanThumbs(rows: readonly ExhibitionThumbInput[]): { items: CleanThumb[]; taggedArtists: boolean } {
  const items: CleanThumb[] = [];
  const seen = new Set<string>();
  let taggedArtists = false;
  for (const row of rows) {
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    const imagePath = typeof row?.imagePath === "string" ? row.imagePath.trim() : "";
    if (!id || !imagePath || seen.has(id)) continue;
    if (!isFeedThumbArtwork(row)) continue;
    const artistId = typeof row.artistId === "string" ? row.artistId.trim() : "";
    if (artistId) taggedArtists = true;
    seen.add(id);
    items.push({ id, imagePath, artistId });
  }
  return { items, taggedArtists };
}

/**
 * How many works each artist gets, in stable artist order.
 * One artist keeps six. Two get three each. Three get two each.
 * Four and five keep everyone, and the spare slots go to the earliest artists.
 * Six or more: one work from each of the first six artists.
 */
function thumbQuotas(artistCount: number): number[] {
  if (artistCount <= 1) return [EXHIBITION_THUMB_LIMIT];
  if (artistCount === 2) return [3, 3];
  if (artistCount === 3) return [2, 2, 2];
  if (artistCount === 4) return [2, 2, 1, 1];
  if (artistCount === 5) return [2, 1, 1, 1, 1];
  return [1, 1, 1, 1, 1, 1];
}

/**
 * Up to six public artwork or print images.
 * Goods, collected works, private rows, and missing images are skipped
 * and do not leave empty slots.
 * Group shows split the slots across artists. A solo set stays in order.
 */
export function pickExhibitionThumbs(
  rows: readonly ExhibitionThumbInput[],
  options?: ExhibitionThumbPick
): ExhibitionThumb[] {
  const { items, taggedArtists } = cleanThumbs(rows);
  if (!taggedArtists) {
    return items.slice(0, EXHIBITION_THUMB_LIMIT).map(({ id, imagePath }) => ({ id, imagePath }));
  }

  const groups = new Map<string, CleanThumb[]>();
  const artistOrder: string[] = [];
  for (const item of items) {
    const key = item.artistId || `work:${item.id}`;
    const list = groups.get(key);
    if (list) {
      list.push(item);
      continue;
    }
    groups.set(key, [item]);
    artistOrder.push(key);
  }

  const saved = normalizeFeedThumbIds(options?.feedThumbWorkIds);
  if (artistOrder.length > EXHIBITION_THUMB_LIMIT && saved.length > 0) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const picked: ExhibitionThumb[] = [];
    const seen = new Set<string>();
    for (const id of saved) {
      if (picked.length >= EXHIBITION_THUMB_LIMIT) break;
      if (seen.has(id)) continue;
      const item = byId.get(id);
      if (!item) continue;
      seen.add(id);
      picked.push({ id: item.id, imagePath: item.imagePath });
    }
    if (picked.length > 0) return picked;
  }

  const chosen = artistOrder.slice(0, EXHIBITION_THUMB_LIMIT);
  const share = thumbQuotas(chosen.length);
  const out: ExhibitionThumb[] = [];
  chosen.forEach((key, index) => {
    const want = share[index] ?? 1;
    const works = groups.get(key) ?? [];
    for (let i = 0; i < want && i < works.length; i += 1) {
      const work = works[i]!;
      out.push({ id: work.id, imagePath: work.imagePath });
    }
  });
  return out;
}
