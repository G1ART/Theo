/**
 * Storage objects that belong to one artwork image row.
 * Detail shots and cutouts are rows on the same artwork, so callers
 * pass every row. `original_storage_path` is the untouched backup under
 * `{userId}/original/…`.
 */
export type ArtworkStorageRow = {
  storage_path?: string | null;
  original_storage_path?: string | null;
};

export type CascadeStoragePaths = {
  displayPaths: string[];
  originalPaths: string[];
};

function pushUnique(target: string[], seen: Set<string>, value: string | null | undefined) {
  const path = value?.trim() ?? "";
  if (!path || seen.has(path)) return;
  seen.add(path);
  target.push(path);
}

/** Display files and original backups for a cascade delete, including every child image row. */
export function cascadeDeleteStoragePaths(images: ArtworkStorageRow[]): CascadeStoragePaths {
  const displayPaths: string[] = [];
  const originalPaths: string[] = [];
  const seenDisplay = new Set<string>();
  const seenOriginal = new Set<string>();
  for (const image of images) {
    pushUnique(displayPaths, seenDisplay, image.storage_path);
    pushUnique(originalPaths, seenOriginal, image.original_storage_path);
  }
  return { displayPaths, originalPaths };
}

/**
 * Remove display files, then original backups.
 * A failure on the first remove does not skip the originals.
 */
export async function removeCascadeStorage(
  images: ArtworkStorageRow[],
  remove: (paths: string[]) => Promise<{ error: unknown }>,
): Promise<{ error: unknown; displayPaths: string[]; originalPaths: string[] }> {
  const { displayPaths, originalPaths } = cascadeDeleteStoragePaths(images);
  let displayError: unknown = null;
  if (displayPaths.length > 0) {
    try {
      const result = await remove(displayPaths);
      displayError = result?.error ?? null;
    } catch (err) {
      displayError = err;
    }
  }
  const removedDisplay = displayError == null ? new Set(displayPaths) : new Set<string>();
  const originalsToRemove = originalPaths.filter((path) => !removedDisplay.has(path));
  let originalError: unknown = null;
  if (originalsToRemove.length > 0) {
    try {
      const result = await remove(originalsToRemove);
      originalError = result?.error ?? null;
    } catch (err) {
      originalError = err;
    }
  }
  return {
    error: displayError ?? originalError,
    displayPaths,
    originalPaths,
  };
}

/**
 * A failed upload already put bytes in the bucket and may have created
 * an empty draft. Drop the display file and the original backup, then
 * the empty draft when this attempt created it and no image was attached.
 * One remove failing does not skip the other path or the draft row.
 */
export async function cleanupFailedAttach(input: {
  displayPath?: string | null;
  originalPath?: string | null;
  draftId?: string | null;
  deleteEmptyDraft: boolean;
  removeFile: (path: string) => Promise<void>;
  deleteDraft?: (id: string) => Promise<unknown>;
}): Promise<{ storageError: unknown }> {
  let storageError: unknown = null;
  const display = input.displayPath?.trim() ?? "";
  const original = input.originalPath?.trim() ?? "";
  if (display) {
    try {
      await input.removeFile(display);
    } catch (err) {
      storageError = err;
    }
  }
  if (original && (original !== display || storageError)) {
    try {
      await input.removeFile(original);
    } catch (err) {
      if (!storageError) storageError = err;
    }
  }
  if (input.deleteEmptyDraft && input.draftId && input.deleteDraft) {
    try {
      await input.deleteDraft(input.draftId);
    } catch {
      /* The row cleanup is best-effort. Storage was already attempted. */
    }
  }
  return { storageError };
}

/** Bulk 전체 삭제 / 선택 삭제는 초안만 지운다. 게시된 작품은 이 경로로 지우지 않는다. */
export function isBulkDraftDeleteTarget(visibility: string | null | undefined): boolean {
  return visibility === "draft";
}
