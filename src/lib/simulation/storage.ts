/**
 * P1 Display / Hang Simulation — room photo upload.
 *
 * Uploads a user-supplied room photo into the existing `artworks`
 * storage bucket under `{userId}/spaces/{spaceId}/photo.webp` (working
 * copy) and `{userId}/spaces/{spaceId}/photo_original.<ext>` (untouched
 * original for re-derivation). The existing storage RLS
 * (`can_manage_artworks_storage_path`) is scoped on the first path
 * segment being `auth.uid()`, so this reuses the same policy that
 * covers `{userId}/profile/{kind}/...` — no new bucket or migration.
 *
 * Compression reuses `src/lib/image/compress.ts` (the same helper the
 * artwork / exhibition upload paths call). Two derivatives are stored:
 *
 *   • **Working copy** — WebP encoded (project convention across all
 *     `artworks`-bucket display files; `.jpg` naming from the brief
 *     is a deviation noted in HANDOFF, kept as WebP for parity), max
 *     2048 px longest edge, initial quality 0.85.
 *   • **Original** — the untouched file as uploaded. Kept so future
 *     re-derivations (different display size, higher-fidelity walker,
 *     etc.) don't require the user to re-upload.
 *
 * On success the caller-supplied `spaceId` row is patched with
 * `photo_storage_path`, `photo_original_storage_path`,
 * `photo_width_px`, `photo_height_px` so the 2D renderer can project
 * `cm → px` immediately without another round-trip.
 */

import { supabase as defaultClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compressArtworkImage } from "@/lib/image/compress";
import { updateSpace } from "@/lib/supabase/spaces";

/** The bucket every artworks / profile / exhibition asset already lives in. */
const BUCKET = "artworks";

/** Long-edge cap for the display copy — per the P1 brief. */
const SPACE_DISPLAY_LONG_EDGE = 2048;

/** Initial WebP quality; the compressor iterates down if the file is too big. */
const SPACE_DISPLAY_QUALITY = 0.85;

export class SpacePhotoValidationError extends Error {
  readonly code: "user" | "mime" | "size";
  readonly limitBytes?: number;
  constructor(code: "user" | "mime" | "size", message: string, limitBytes?: number) {
    super(message);
    this.name = "SpacePhotoValidationError";
    this.code = code;
    this.limitBytes = limitBytes;
  }
}

export type UploadSpacePhotoResult = {
  storagePath: string;
  originalStoragePath: string | null;
  widthPx: number;
  heightPx: number;
};

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  // HEIC is tolerated on input but the compress helper will `skipped`
  // decode-failed and we fall back to storing the original as-is. Callers
  // (Chunk C) should convert HEIC upstream if they want a WebP display copy.
  "image/heic",
  "image/heif",
]);

/**
 * Best-effort dimension probe used only when the compressor skipped
 * (HEIC, animated GIF, decode-fail) so the caller-supplied `spaces`
 * row still gets `photo_width_px` / `photo_height_px` populated.
 * Returns `null` when we can't decode (SSR, ancient browsers) so the
 * caller can fall back gracefully.
 */
async function probeImageDimensions(
  file: File,
): Promise<{ w: number; h: number } | null> {
  if (typeof createImageBitmap === "undefined") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { w: bitmap.width, h: bitmap.height };
    try {
      bitmap.close();
    } catch {
      /* older browsers */
    }
    return size;
  } catch {
    return null;
  }
}

function sanitizeExt(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 8) || "bin";
}

/**
 * Upload a room photo for a space. See file-level JSDoc.
 *
 * Requires an authenticated caller (RLS on the underlying storage +
 * `spaces` row cross-check). Throws `SpacePhotoValidationError` on
 * mime/size problems and the raw Supabase error on storage failure.
 */
export async function uploadSpacePhoto(
  spaceId: string,
  file: File,
  options: { client?: SupabaseClient } = {},
): Promise<UploadSpacePhotoResult> {
  const client = options.client ?? defaultClient;
  if (!spaceId) {
    throw new SpacePhotoValidationError("user", "spaceId is required");
  }
  if (!IMAGE_MIMES.has(file.type)) {
    throw new SpacePhotoValidationError(
      "mime",
      `Unsupported image type (${file.type || "unknown"}). Use JPEG, PNG, WebP, or HEIC.`,
    );
  }

  const {
    data: { session },
  } = await client.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new SpacePhotoValidationError("user", "Not authenticated");

  const compressed = await compressArtworkImage(file, {
    maxLongEdge: SPACE_DISPLAY_LONG_EDGE,
    initialQuality: SPACE_DISPLAY_QUALITY,
  });

  const basePath = `${userId}/spaces/${spaceId}`;
  const originalExt = sanitizeExt(file.name || `${file.type.split("/")[1] ?? "bin"}`);

  let displayStoragePath: string;
  let originalStoragePath: string | null = null;
  let widthPx: number;
  let heightPx: number;

  if (!compressed.skipped) {
    displayStoragePath = `${basePath}/photo.webp`;
    const { error: displayErr } = await client.storage
      .from(BUCKET)
      .upload(displayStoragePath, compressed.displayFile, {
        upsert: true,
        contentType: "image/webp",
        cacheControl: "3600",
      });
    if (displayErr) throw displayErr;
    widthPx = compressed.meta.outWidth;
    heightPx = compressed.meta.outHeight;

    // Best-effort original backup. Failing here doesn't invalidate the
    // display copy — the caller still gets a usable simulation photo.
    const origPath = `${basePath}/photo_original.${originalExt}`;
    const { error: origErr } = await client.storage
      .from(BUCKET)
      .upload(origPath, file, {
        upsert: true,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      });
    if (!origErr) {
      originalStoragePath = origPath;
    } else if (process.env.NODE_ENV !== "production") {
      console.warn("[simulation/storage] original backup failed", origErr);
    }
  } else {
    // Compression skipped (HEIC / animated / decode-fail). Store the
    // original as both the display and the backup so the caller still
    // sees a photo. Dimensions are best-effort — HEIC won't decode in
    // Chromium without extra plumbing, so we may fall back to 0.
    displayStoragePath = `${basePath}/photo.${originalExt}`;
    const { error: displayErr } = await client.storage
      .from(BUCKET)
      .upload(displayStoragePath, file, {
        upsert: true,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      });
    if (displayErr) throw displayErr;
    originalStoragePath = displayStoragePath;
    const probed = await probeImageDimensions(file);
    widthPx = probed?.w ?? 0;
    heightPx = probed?.h ?? 0;
  }

  // Persist the paths + dimensions on the space row so the renderer
  // can project cm→px without another round trip. RLS enforces that
  // the caller owns the space.
  const { error: updateErr } = await updateSpace(
    spaceId,
    {
      photoStoragePath: displayStoragePath,
      photoOriginalStoragePath: originalStoragePath,
      photoWidthPx: widthPx || null,
      photoHeightPx: heightPx || null,
    },
    { client },
  );
  if (updateErr) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[simulation/storage] spaces row patch after upload failed",
        updateErr,
      );
    }
  }

  return {
    storagePath: displayStoragePath,
    originalStoragePath,
    widthPx,
    heightPx,
  };
}
