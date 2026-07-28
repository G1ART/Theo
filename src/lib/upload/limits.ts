/**
 * Upload limits documented in UI and used for client-side checks before Storage upload.
 *
 * 2026-07-28 auto-compression update
 * -----------------------------------
 * Since new uploads pass through client-side WebP compression (see
 * `src/lib/image/compress.ts`), the effective ceiling for compressible
 * image formats is raised to 200 MB — the compressor guarantees the
 * display file lands at ≤ 50 MiB (Supabase Storage server cap in
 * `supabase/config.toml [storage] file_size_limit`).
 *
 * Non-compressible formats (HEIC, animated GIF, decode failures) still
 * fall under the 50 MB legacy ceiling because they upload untouched.
 * `isCompressibleMime()` (in `compress.ts`) decides which ceiling
 * applies at prefight-check time. The `UPLOAD_MAX_IMAGE_BYTES` constant
 * below stays around for legacy display copy and back-compat.
 */

/** Legacy ceiling — still enforced for uncompressible formats (HEIC, animated GIF). */
export const UPLOAD_MAX_IMAGE_BYTES = 50 * 1024 * 1024;

/** 2026-07-28 — compressible formats can go up to this size on the client;
 *  the compressor downscales/re-encodes to fit under the 50 MiB storage cap. */
export const UPLOAD_MAX_COMPRESSIBLE_BYTES = 200 * 1024 * 1024;

/** Whole MB for user-facing copy (50 MiB ≈ 52.4 MB; we label "50 MB" for simplicity). */
export const UPLOAD_MAX_IMAGE_MB_LABEL = 50;

/** User-facing label for the compressible ceiling. */
export const UPLOAD_MAX_COMPRESSIBLE_MB_LABEL = 200;

/**
 * Pre-flight check helper: given a File, return the applicable byte
 * ceiling. `isCompressibleMime` is duplicated here to avoid pulling the
 * whole compress module into places that only need the ceiling.
 */
export function getUploadCeilingBytes(file: File): number {
  const mime = (file.type || "").toLowerCase();
  const isCompressible =
    mime === "image/jpeg" ||
    mime === "image/pjpeg" ||
    mime === "image/png" ||
    mime === "image/webp";
  return isCompressible
    ? UPLOAD_MAX_COMPRESSIBLE_BYTES
    : UPLOAD_MAX_IMAGE_BYTES;
}

/** `listMyDraftArtworks` fetch limit on bulk upload page — older drafts may not appear until others are published/deleted. */
export const BULK_MY_DRAFTS_QUERY_LIMIT = 100;

/** Max images queued at once on the bulk screen — upload this batch, then add the next. */
export const BULK_MAX_FILES_PER_BATCH = 100;

/** Website-import match: max artwork IDs per `/match` request. */
export const UPLOAD_WEBSITE_MATCH_MAX_ARTWORKS = 80;

/** Bulk page: newest staged artwork ids kept for "match to website" hinting. */
export const BULK_WEBSITE_STAGED_IDS_MAX = 120;
