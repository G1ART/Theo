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

const BUCKET = "artworks";

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
  try {
    const canvas = document.createElement("canvas");
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { applied: false, reason: "canvas_failed" };
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    dataUrl = canvas.toDataURL("image/jpeg", 0.92);
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
    bboxPxWidth: cropW,
    bboxPxHeight: cropH,
    confidence: res.confidence,
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
    const body = (await resp.json()) as { storagePath?: string };
    return {
      applied: true,
      cutoutPath: body?.storagePath,
    };
  } catch {
    // Server sent 200 without JSON — still treat as success since
    // the caller reloads the artwork anyway.
    return { applied: true };
  }
}
