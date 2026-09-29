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
