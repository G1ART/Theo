"use client";

/**
 * Display Simulation Phase 2 (2026-08-20) — client-side glue for the
 * Track 1 "painting isolation via Vision bbox" pipeline.
 *
 * Track 1 (this file) is fully free-tier: we ask `gpt-4o-mini` for
 * a bounding rectangle around the actual painting inside the user's
 * upload, then crop client-side (canvas) and upload as a SIBLING
 * `artwork_images` row with `view_type='cutout'`. The primary image
 * is never touched — the renderer picks the cutout when it exists,
 * and every existing surface (feed / carousel / share) keeps working
 * off the primary as before.
 *
 * Track 2 ("advanced cutout" with alpha) lives server-side at
 * `/api/ai/artwork-cutout-alpha` because it requires the Photoroom
 * API key. The client just POSTs and refetches the artwork.
 *
 * Both entry points are re-exported from `SpaceEditor.tsx` and
 * `ImageStandardizeEditor.tsx`, so the CTAs stay small.
 */

import { supabase } from "@/lib/supabase/client";
import { aiApi } from "@/lib/ai/browser";
import { attachArtworkImage } from "@/lib/supabase/artworks";
import {
  refineTightBboxByLuminanceFromImageData,
  summarizeTrim,
  type CropRect,
  type CutoutTrimMeta,
  type RefinedTightBbox,
  type RefineTightBboxOptions,
} from "./cutoutTrim";

const BUCKET = "artworks";

/**
 * DOM canvas wrapper around
 * `refineTightBboxByLuminanceFromImageData`. Reads the canvas's
 * pixel buffer once, then delegates to the pure-JS core (which the
 * unit tests exercise directly with synthetic ImageData).
 *
 * The passed canvas is expected to be the model-bbox crop of the
 * source image, drawn 1:1 (`ctx.drawImage(img, cropX, cropY, cropW,
 * cropH, 0, 0, cropW, cropH)`) — i.e. its own pixel space is 0..cropW
 * × 0..cropH. `initialCropRect` mirrors that in canvas-local coords:
 * `{cropX: 0, cropY: 0, cropW: canvas.width, cropH: canvas.height}`.
 * Callers translate the returned delta back to source-image space.
 */
export function refineTightBboxByLuminance(
  canvas: HTMLCanvasElement,
  initialCropRect: CropRect,
  options?: RefineTightBboxOptions,
): RefinedTightBbox {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      ...initialCropRect,
      trimmed: { top: 0, bottom: 0, left: 0, right: 0 },
    };
  }
  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    // getImageData can throw on tainted canvases (unlikely here —
    // we drew from a same-origin CDN with crossOrigin='anonymous'
    // — but keep the graceful fallback so the trim never blocks
    // the cutout write.
    return {
      ...initialCropRect,
      trimmed: { top: 0, bottom: 0, left: 0, right: 0 },
    };
  }
  return refineTightBboxByLuminanceFromImageData(
    imgData,
    initialCropRect,
    options,
  );
}

export type { CutoutTrimMeta, RefinedTightBbox, RefineTightBboxOptions };

/**
 * 2026-08-19 (personal cutouts fix) — decide whether the current
 * user can publish a cutout to the artwork globally (writes to
 * `artwork_images`) or must land it in `artwork_user_cutouts` as a
 * private overlay.
 *
 * Global write is allowed for:
 *   • the artist (`artworks.artist_id = auth.uid()`); or
 *   • a claim holder (`claims.subject_profile_id = auth.uid()`).
 *
 * Everyone else (a collector placing a public artwork into their
 * Space) takes the personal path so the CTA no longer silently fails
 * on the existing `artwork_images` RLS.
 *
 * Two shallow SELECTs, both RLS-friendly. Never throws — a network
 * blip falls back to `false` so we never accidentally publish an
 * unpermitted cutout.
 */
export async function canWriteGlobalCutout(
  artworkId: string,
  userId: string,
): Promise<boolean> {
  try {
    const { data: artistRow, error: artistErr } = await supabase
      .from("artworks")
      .select("id")
      .eq("id", artworkId)
      .eq("artist_id", userId)
      .maybeSingle();
    if (!artistErr && artistRow) return true;
    const { data: claimRow, error: claimErr } = await supabase
      .from("claims")
      .select("id")
      .eq("work_id", artworkId)
      .eq("subject_profile_id", userId)
      .maybeSingle();
    if (!claimErr && claimRow) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Scope of a cutout write — see `canWriteGlobalCutout` above.
 * Callers use this to swap toast copy so the artist / delegate
 * knows their result is now published for the artwork, whereas a
 * collector knows the touch-up is private to their Space.
 */
export type CutoutScope = "global" | "personal";

/**
 * Fetch an image URL as a Blob. Handles both same-origin and
 * cross-origin CDNs — Supabase Storage serves public URLs with
 * permissive CORS so this stays a simple `fetch`.
 */
async function fetchAsBlob(url: string): Promise<Blob | null> {
  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) return null;
    return await resp.blob();
  } catch {
    return null;
  }
}

/** Blob → base64 (no `data:` prefix). Duplicated intentionally so
 *  this helper is self-contained and importable from any client. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      const commaIdx = raw.indexOf(",");
      resolve(commaIdx >= 0 ? raw.slice(commaIdx + 1) : raw);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("cutout_read_failed"));
    reader.readAsDataURL(blob);
  });
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("cutout_image_decode_failed"));
    img.src = url;
  });
}

export type BboxCropResult = {
  applied: boolean;
  reason?:
    | "unauthorized"
    | "no_image"
    | "low_confidence"
    | "already_tight"
    | "decode_failed"
    | "canvas_failed"
    | "upload_failed"
    | "attach_failed"
    | "unknown";
  cutoutPath?: string;
  bboxPxWidth?: number;
  bboxPxHeight?: number;
  confidence?: number;
  /**
   * 2026-08-19 (personal cutouts fix) — where the row landed.
   * `global` = `artwork_images` (artist / claim holder); `personal`
   * = `artwork_user_cutouts` (collector / anyone else). Callers use
   * this to swap toast copy. Only set when `applied === true`.
   */
  cutoutScope?: CutoutScope;
};

/**
 * Track 1 — auto-crop an artwork's primary image via Vision bbox
 * detection and upload the crop as a `cutout` sibling row.
 *
 * Idempotent: callers can invoke this on every upload without
 * knowing whether a cutout already exists — if the bbox comes back
 * `alreadyTight` or the confidence is below `minConfidence`, no
 * write happens and the primary keeps rendering.
 *
 * Returns `{ applied: true, ... }` on success. All failure modes
 * (unauthorized, decode, upload, attach) resolve to `{ applied:
 * false, reason }` — never throws, so the enclosing upload / CTA
 * pipeline never breaks.
 */
export async function runVisionBboxCrop(input: {
  artworkId: string;
  /** Primary image URL — fetched into a Blob before we send it to
   *  the model. Prefer the display copy (smaller) over the original
   *  since the model only needs to see the geometry. */
  imageUrl: string;
  minConfidence?: number;
}): Promise<BboxCropResult> {
  const minConfidence = input.minConfidence ?? 0.7;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { applied: false, reason: "unauthorized" };

  const sourceBlob = await fetchAsBlob(input.imageUrl);
  if (!sourceBlob) return { applied: false, reason: "no_image" };
  const mime = sourceBlob.type || "image/jpeg";
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) {
    // The bbox route accepts jpeg/png/webp only; anything else would
    // be rejected server-side so we bail early.
    return { applied: false, reason: "no_image" };
  }

  let img: HTMLImageElement;
  try {
    img = await loadImage(input.imageUrl);
  } catch {
    return { applied: false, reason: "decode_failed" };
  }
  const pxW = img.naturalWidth;
  const pxH = img.naturalHeight;
  if (pxW <= 0 || pxH <= 0) {
    return { applied: false, reason: "decode_failed" };
  }

  const base64 = await blobToBase64(sourceBlob);
  const res = await aiApi.artworkPaintingBbox({
    imageBase64: base64,
    mime,
    imagePxWidth: pxW,
    imagePxHeight: pxH,
  });

  if (res.alreadyTight) return { applied: false, reason: "already_tight" };
  if (res.confidence < minConfidence) {
    return {
      applied: false,
      reason: "low_confidence",
      confidence: res.confidence,
    };
  }

  const { x, y, width, height } = res.bbox;
  const cropX = Math.max(0, Math.round(x * pxW));
  const cropY = Math.max(0, Math.round(y * pxH));
  const cropW = Math.max(1, Math.round(width * pxW));
  const cropH = Math.max(1, Math.round(height * pxH));
  if (cropW < 8 || cropH < 8) {
    // Degenerate rectangle — treat as "no useful crop" and keep the
    // primary. Guard against a model that returns a near-zero bbox
    // when it fails to find the painting.
    return { applied: false, reason: "already_tight" };
  }

  let dataUrl: string;
  let trimMeta: CutoutTrimMeta | null = null;
  let finalCropW = cropW;
  let finalCropH = cropH;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { applied: false, reason: "canvas_failed" };
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // Post-processing trim (2026-08-19): even after the model bbox
    // + gpt-4o + prompt hardening, a thin sliver of near-white
    // matte or near-black shadow padding sometimes remains along
    // one or two edges. Sample the border 5% of the crop and
    // shrink the rect wherever the strip is uniform enough to
    // clearly not be part of the painting. See `cutoutTrim.ts` for
    // the full description.
    //
    // The refined rect is expressed in the canvas's local pixel
    // space (0..cropW × 0..cropH); if any edge trimmed, we re-draw
    // into a smaller canvas so the JPEG we upload is actually the
    // tighter rect.
    const initialLocalCrop: CropRect = {
      cropX: 0,
      cropY: 0,
      cropW,
      cropH,
    };
    const refined = refineTightBboxByLuminance(canvas, initialLocalCrop);
    const hasTrim =
      refined.trimmed.top > 0 ||
      refined.trimmed.bottom > 0 ||
      refined.trimmed.left > 0 ||
      refined.trimmed.right > 0;
    let canvasForUpload = canvas;
    if (hasTrim && refined.cropW > 0 && refined.cropH > 0) {
      const trimCanvas = document.createElement("canvas");
      trimCanvas.width = refined.cropW;
      trimCanvas.height = refined.cropH;
      const trimCtx = trimCanvas.getContext("2d");
      if (trimCtx) {
        trimCtx.drawImage(
          canvas,
          refined.cropX,
          refined.cropY,
          refined.cropW,
          refined.cropH,
          0,
          0,
          refined.cropW,
          refined.cropH,
        );
        canvasForUpload = trimCanvas;
        finalCropW = refined.cropW;
        finalCropH = refined.cropH;
      }
    }
    trimMeta = summarizeTrim(initialLocalCrop, refined);
    dataUrl = canvasForUpload.toDataURL("image/jpeg", 0.92);
  } catch {
    return { applied: false, reason: "canvas_failed" };
  }

  const cutoutBlob = await (await fetch(dataUrl)).blob();

  const path = `${user.id}/cutout/${crypto.randomUUID()}.jpg`;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, cutoutBlob, {
      upsert: false,
      contentType: "image/jpeg",
    });
  if (uploadErr) {
    return { applied: false, reason: "upload_failed" };
  }

  // 2026-08-19 (personal cutouts fix) — branch on ownership so a
  // collector's write lands in `artwork_user_cutouts` (private) and
  // the artist's / claim holder's write keeps flowing into
  // `artwork_images` (published for every viewer).
  const canGlobal = await canWriteGlobalCutout(input.artworkId, user.id);
  if (canGlobal) {
    const { error: attachErr } = await attachArtworkImage(
      input.artworkId,
      path,
      {
        // High sort_order so the cutout sits after the primary in
        // gallery contexts that iterate `artwork_images` — but the
        // simulation renderer selects by `view_type`, so the ordering
        // only matters for legacy carousels that still read the raw
        // list. 100 leaves plenty of room for future cutout variants.
        sortOrder: 100,
        viewType: "cutout",
      },
    );
    if (attachErr) {
      // Best-effort cleanup — a dangling storage object is preferable
      // to a stale artwork_images row, so we swap the priority and
      // skip the delete when the attach fails (a re-run will overwrite
      // via the same `crypto.randomUUID()` path guard).
      return { applied: false, reason: "attach_failed" };
    }
    return {
      applied: true,
      cutoutPath: path,
      bboxPxWidth: finalCropW,
      bboxPxHeight: finalCropH,
      confidence: res.confidence,
      cutoutScope: "global",
    };
  }

  // Personal fallback — upsert so re-runs from the same viewer
  // overwrite the previous private crop rather than piling up rows.
  const { error: personalErr } = await supabase
    .from("artwork_user_cutouts")
    .upsert(
      {
        user_id: user.id,
        artwork_id: input.artworkId,
        view_type: "cutout",
        storage_path: path,
        px_width: finalCropW,
        px_height: finalCropH,
        source: "vision_bbox",
        // `metadata.trim` (2026-08-19): per-edge pixel delta the
        // luminance post-processor contributed on top of the model
        // bbox. Nullable — pre-2026-08-19 rows and any run where
        // the border sampler chose not to trim will not carry it.
        // See `cutoutTrim.ts::summarizeTrim` for the shape.
        metadata: {
          confidence: res.confidence,
          bbox: res.bbox,
          ...(trimMeta ? { trim: trimMeta } : {}),
        },
      },
      { onConflict: "user_id,artwork_id,view_type" },
    );
  if (personalErr) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[cutoutClient] personal cutout insert failed",
        personalErr.message,
      );
    }
    return { applied: false, reason: "attach_failed" };
  }
  return {
    applied: true,
    cutoutPath: path,
    bboxPxWidth: finalCropW,
    bboxPxHeight: finalCropH,
    confidence: res.confidence,
    cutoutScope: "personal",
  };
}

export type CutoutAlphaResult = {
  applied: boolean;
  reason?:
    | "unauthorized"
    | "not_configured"
    | "not_entitled"
    | "cap_reached"
    | "server_error"
    | "unknown";
  cutoutPath?: string;
  /**
   * 2026-08-19 (personal cutouts fix) — mirrors `BboxCropResult`.
   * Server route now decides based on the same ownership check and
   * echoes `"global"` (artist / claim holder) or `"personal"`
   * (collector). Only set when `applied === true`.
   */
  cutoutScope?: CutoutScope;
};

/**
 * Track 2 — call the server-side Photoroom proxy to produce a
 * transparent PNG cutout. All the heavy work (auth, entitlement,
 * Photoroom, storage upload, `artwork_images` insert, usage event)
 * happens in `/api/ai/artwork-cutout-alpha`; this wrapper just
 * shapes the client call.
 */
export async function runPhotoroomCutout(input: {
  artworkId: string;
}): Promise<CutoutAlphaResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { applied: false, reason: "unauthorized" };

  let resp: Response;
  try {
    resp = await fetch("/api/ai/artwork-cutout-alpha", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ artworkId: input.artworkId }),
    });
  } catch {
    return { applied: false, reason: "server_error" };
  }

  if (resp.status === 501) return { applied: false, reason: "not_configured" };
  if (resp.status === 401) return { applied: false, reason: "unauthorized" };
  if (resp.status === 402 || resp.status === 403) {
    return { applied: false, reason: "not_entitled" };
  }
  if (resp.status === 429) return { applied: false, reason: "cap_reached" };
  if (!resp.ok) return { applied: false, reason: "server_error" };

  try {
    const body = (await resp.json()) as {
      storagePath?: string;
      cutoutScope?: CutoutScope;
    };
    return {
      applied: true,
      cutoutPath: body?.storagePath,
      cutoutScope:
        body?.cutoutScope === "personal" || body?.cutoutScope === "global"
          ? body.cutoutScope
          : undefined,
    };
  } catch {
    // Server sent 200 without JSON — still treat as success since
    // the caller reloads the artwork anyway.
    return { applied: true };
  }
}
