/**
 * Theo Image Enhance (Beta) — shared upload-preparation contract.
 *
 * The four upload paths (single, bulk, exhibition single, exhibition
 * bulk) all route through this helper so opting into Theo Enhance is a
 * one-line change per surface. The helper NEVER modifies the artist's
 * original file; it just decides which blob should become the
 * `storage_path` display copy and returns a serialized meta envelope
 * for `artwork_images.enhancement_meta` / `exhibition_media.enhancement_meta`.
 *
 * Rules of the contract
 *   1. `originalFile` is always returned untouched.
 *   2. `displayFile` is populated when the local flat pipeline produced
 *      an in-browser blob that the caller should upload as the display.
 *   3. `preparedDisplayPath` is populated when a server pipeline
 *      (Photoroom hybrid) already uploaded the display object under a
 *      user-scoped path — in that case the caller passes the path
 *      through and skips a second display upload.
 *   4. `enhancementMeta` mirrors what the DB should store; `null` when
 *      the user did not opt into enhancement (default path).
 */

import type { EnhancementMeta } from "@/lib/image/enhancement/types";
import { normalizeEnhancementMeta } from "@/lib/image/enhancement/types";

export type PreparedArtworkUpload = {
  originalFile: File;
  displayFile: File | null;
  preparedDisplayPath: string | null;
  enhancementMeta: EnhancementMeta | null;
};

export type PrepareArtworkImageInput = {
  originalFile: File;
  /**
   * Local pipeline result — a Blob-backed File the caller should upload
   * as the display copy. Ignored when `preparedDisplayPath` is set (the
   * server pipeline path).
   */
  adjustedFile?: File | null;
  /**
   * Server pipeline result — the storage path of the already-uploaded
   * enhanced display object. Set by the `objectClient` after a
   * successful Photoroom hybrid run.
   */
  preparedDisplayPath?: string | null;
  /** Enhancement metadata to persist. Undefined / null = user did not
   *  opt in. */
  enhancementMeta?: EnhancementMeta | null;
};

/**
 * Return the canonical upload contract for a single artwork image. The
 * helper is intentionally a thin, testable data transform — heavy
 * lifting lives in `localFlatEngine` and `objectClient`. Callers that
 * skip enhancement can either not call this helper at all or call it
 * with just `{ originalFile }` and receive a pass-through result.
 */
export function prepareArtworkImageForUpload(
  input: PrepareArtworkImageInput,
): PreparedArtworkUpload {
  const meta = normalizeEnhancementMeta(input.enhancementMeta ?? null);
  const hasPreparedPath =
    typeof input.preparedDisplayPath === "string" && input.preparedDisplayPath.length > 0;
  const displayFile =
    !hasPreparedPath && input.adjustedFile instanceof File ? input.adjustedFile : null;
  return {
    originalFile: input.originalFile,
    displayFile,
    preparedDisplayPath: hasPreparedPath ? input.preparedDisplayPath! : null,
    enhancementMeta: meta,
  };
}

/**
 * Compute a stable SHA-256 hex digest of the file bytes. Used to fill
 * `EnhancementMeta.sourceHashSha256` so downstream QA can tell whether
 * the meta describes the currently-stored original.
 *
 * Uses `crypto.subtle` — available in every modern browser + in the
 * Node.js runtime that hosts our API routes. When `crypto.subtle` is
 * missing (extremely old environments) we return a zero-filled hash so
 * the caller never crashes; the normalized meta writer will drop that
 * value at persist time.
 */
export async function computeFileSha256(file: File | Blob): Promise<string> {
  try {
    const subtle =
      typeof crypto !== "undefined" && "subtle" in crypto ? crypto.subtle : null;
    if (!subtle) return "0".repeat(64);
    const buf = await file.arrayBuffer();
    const digest = await subtle.digest("SHA-256", buf);
    const bytes = new Uint8Array(digest);
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) {
      const b = bytes[i].toString(16).padStart(2, "0");
      out += b;
    }
    return out;
  } catch {
    return "0".repeat(64);
  }
}
