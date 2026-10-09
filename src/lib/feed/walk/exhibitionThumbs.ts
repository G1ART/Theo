/** Image-only tiles on an exhibition highlight. No title, no artist. */

export const EXHIBITION_THUMB_LIMIT = 6;

const THUMB_KINDS = new Set(["artwork", "print_edition"]);

export type ExhibitionThumbInput = {
  id: string;
  imagePath: string | null;
  visibility?: string | null;
  workKind?: string | null;
};

export type ExhibitionThumb = {
  id: string;
  imagePath: string;
};

/**
 * Keep up to six public artwork or print images.
 * Goods, collected works, private rows, and missing images are skipped
 * and do not leave empty slots.
 */
export function pickExhibitionThumbs(rows: readonly ExhibitionThumbInput[]): ExhibitionThumb[] {
  const out: ExhibitionThumb[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (out.length >= EXHIBITION_THUMB_LIMIT) break;
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    const imagePath = typeof row?.imagePath === "string" ? row.imagePath.trim() : "";
    if (!id || !imagePath || seen.has(id)) continue;
    if (row.visibility != null && row.visibility !== "public") continue;
    if (row.workKind != null && row.workKind !== "" && !THUMB_KINDS.has(row.workKind)) continue;
    seen.add(id);
    out.push({ id, imagePath });
  }
  return out;
}
