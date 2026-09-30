/** Same order as the public artwork page: lowest sort_order is the primary image. */

export function compareArtworkImageOrder(
  a: { sort_order?: number | null },
  b: { sort_order?: number | null },
): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

export function primaryArtworkImage<T extends { sort_order?: number | null }>(
  images: readonly T[] | null | undefined,
): T | null {
  if (!images || images.length === 0) return null;
  return [...images].sort(compareArtworkImageOrder)[0] ?? null;
}
