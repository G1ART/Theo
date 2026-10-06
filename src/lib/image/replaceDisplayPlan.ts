/**
 * What to write when a draft's display image is replaced by a correction.
 * The first correction keeps the current file as the original backup.
 * A later correction retires only the previous display file.
 */
export type DisplayImageSlot = {
  storage_path: string;
  original_storage_path?: string | null;
};

export function planDisplayReplacement(
  current: DisplayImageSlot,
  nextPath: string,
): { original_storage_path: string; retire_storage_path: string | null } {
  const original =
    current.original_storage_path?.trim() || current.storage_path;
  const retire =
    current.storage_path &&
    current.storage_path !== original &&
    current.storage_path !== nextPath
      ? current.storage_path
      : null;
  return { original_storage_path: original, retire_storage_path: retire };
}

/**
 * Swapping the cover file rewrites one artwork_images row.
 * The artworks row stays — this is not delete-and-reupload.
 */
export function planCoverFileSwap(input: {
  artworkId: string;
  current: DisplayImageSlot;
  nextStoragePath: string;
}): {
  artworkId: string;
  deleteArtwork: false;
  nextStoragePath: string;
  original_storage_path: string;
  retire_storage_path: string | null;
} {
  const image = planDisplayReplacement(input.current, input.nextStoragePath);
  return {
    artworkId: input.artworkId,
    deleteArtwork: false,
    nextStoragePath: input.nextStoragePath,
    original_storage_path: image.original_storage_path,
    retire_storage_path: image.retire_storage_path,
  };
}
