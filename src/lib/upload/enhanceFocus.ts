/**
 * Which photo the existing 「이 작품 보정」 dialog edits.
 * One slot: the cover stays the cover, and another work is never in the list.
 */

export function correctableArtworkImages<
  T extends {
    storage_path: string;
    sort_order?: number | null;
    view_type?: string | null;
  },
>(images: readonly T[] | null | undefined): T[] {
  return [...(images ?? [])]
    .filter((img) => {
      const view = img.view_type ?? "";
      return view !== "cutout" && view !== "cutout_alpha" && Boolean(img.storage_path);
    })
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/** The dialog saves this photo only. A missing path saves nothing. */
export function imageSlotForEnhance<T extends { storage_path: string }>(
  images: readonly T[],
  storagePath: string | null | undefined,
): T[] {
  const path = storagePath?.trim();
  if (!path) return [];
  const hit = images.find((img) => img.storage_path === path);
  return hit ? [hit] : [];
}
