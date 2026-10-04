import { compareArtworkImageOrder } from "@/lib/artworks/primaryImage";

/** Camera backup lives under an `original` folder. Never package it. */
export function isCameraOriginalPath(path: string): boolean {
  return path.split("/").some((segment) => segment === "original");
}

/**
 * Primary display file for a work. Uses `storage_path` only.
 * `original_storage_path` is ignored even when it is the only backup.
 */
export function pickDisplayStoragePath(
  images:
    | readonly {
        storage_path?: string | null;
        sort_order?: number | null;
        original_storage_path?: string | null;
      }[]
    | null
    | undefined,
): string | null {
  if (!images || images.length === 0) return null;
  const sorted = [...images].sort(compareArtworkImageOrder);
  for (const image of sorted) {
    const path = typeof image.storage_path === "string" ? image.storage_path.trim() : "";
    if (!path || isCameraOriginalPath(path)) continue;
    return path;
  }
  return null;
}
