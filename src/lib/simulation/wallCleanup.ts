"use client";

/**
 * P1 (2026-08-19) — Automatic wall-region cleanup pipeline (client-side).
 *
 * The vision route (`/api/ai/space-wall-detect`) returns a normalized
 * wall polygon + dominant paint color. This module turns those into a
 * feathered mask and flattens low-frequency luminance artefacts inside
 * the wall only. The rest of the scene (furniture, floor, windows,
 * framed art already on the wall) is left pixel-identical.
 *
 * Design contract
 * ---------------
 *   • Pure function + tiny helpers. No React. Testable in isolation.
 *   • Uses OffscreenCanvas where available (Chrome, mobile Safari 16.4+,
 *     Firefox 105+) and HTMLCanvasElement fallback everywhere else.
 *   • Rejects gracefully when the polygon is too small (<5%) or
 *     absurdly large (>95%) — those signal detection failure and we
 *     return the original blob unchanged rather than distorting the
 *     photo. Same "fail open" rule the vision route uses.
 *   • Preserves high-frequency wall texture: the flatten operates on a
 *     luminance ratio (`k = target / low_freq_local`) rather than
 *     replacing pixels wholesale, so brush marks, paint texture, and
 *     framed-art shadows on the wall survive the pass.
 *
 * Algorithm
 * ---------
 *   1. Decode `originalBlob` at native resolution.
 *   2. Build feathered polygon mask on canvas B (Gaussian blur radius
 *      = 2% of min(w, h) — enough to hide small polygon inaccuracies
 *      at wall/occluder boundaries without visible seams).
 *   3. Downsample canvas A → 1/8 res → Gaussian blur → upsample to
 *      full res on canvas C. This is the "low-frequency luminance map"
 *      that captures shadow / sunlight gradients across the wall.
 *      Blur radius at full-res is 10% of min(w, h). Doing the blur on
 *      the downsampled image and then upsampling is ~64× cheaper than
 *      blurring at full res and produces visually identical output.
 *   4. For each masked pixel: derive `k = clamp(luma_target /
 *      luma_local, 0.7, 1.5)` and multiply the pixel by `k`. Clamp
 *      bounds prevent blowing out highlights or crushing shadows.
 *   5. Optional chroma pull (~20%) toward `wallMedianRgb`, gated on
 *      wall saturation < 0.15 so accent-color walls keep their tone.
 *   6. Blend at 75% strength weighted by the feathered mask alpha:
 *      `final = original * (1 − 0.75*m) + corrected * (0.75*m)`.
 *      Outside the mask (m = 0) the original is pixel-identical.
 *   7. Encode → JPEG q=0.9 at the same dimensions as the input.
 *
 * The chosen constants (blur radii, clamp bounds, blend weights) are
 * conservative on purpose — a subtle cleanup that always looks like
 * "the same photo, just tidier" beats an aggressive one that fights
 * with any occluders the polygon may have missed.
 */

/** Mask feather radius as a fraction of min(imageWidth, imageHeight). */
const FEATHER_FRAC = 0.02;
/** Low-frequency luminance blur radius at full res, as a fraction of min(w, h). */
const LOWFREQ_BLUR_FRAC = 0.1;
/** Downsample factor for the low-frequency map — 1/8 native resolution. */
const LOWFREQ_DOWNSCALE = 8;
/**
 * Correction ratio clamp — prevents blowing out or crushing pixels.
 *
 * 2026-08-19 loosening (P1 hot-fix): the initial `[0.7, 1.5]` window
 * couldn't visibly attenuate direct-sunlight patches (typical luma
 * ratio 3-5×); a K_MIN of 0.7 only dimmed a hot pixel by 30 % — the
 * sunlit rectangle stayed obvious in the "after" photo. Widening to
 * `[0.5, 1.8]` roughly doubles the correction headroom in both
 * directions while still preventing full pixel wipe-out (which
 * would look like painted-over patches).
 */
const K_MIN = 0.5;
const K_MAX = 1.8;
/**
 * Blend weight applied inside the mask (attenuated further by feather).
 *
 * Raised from 0.75 → 0.85 alongside the K widening — the mask alpha
 * still tapers to 0 at the polygon boundary via the feathered
 * gaussian, so this doesn't create seams; it just pushes the
 * fully-inside pixels closer to the flattened target.
 */
const BLEND_STRENGTH = 0.85;
/** Chroma pull weight toward `wallMedianRgb` when applied. */
const CHROMA_STRENGTH = 0.2;
/** Chroma pull skipped when wall saturation exceeds this threshold. */
const CHROMA_SAT_SKIP = 0.15;
/** Skip cleanup when the polygon covers less than this fraction of the image. */
const MIN_MASK_COVERAGE = 0.05;
/** Skip cleanup when the polygon covers more than this fraction of the image. */
const MAX_MASK_COVERAGE = 0.95;
/** Encoded output quality — matches the display copy quality budget. */
const OUTPUT_JPEG_QUALITY = 0.9;

export type WallCleanupInput = {
  originalBlob: Blob;
  /** Normalized 0-1 polygon vertices in clockwise order. Must have >= 3. */
  wallPolygon: Array<[number, number]>;
  /** Dominant paint color, 0-255 per channel. */
  wallMedianRgb: [number, number, number];
  imageWidth: number;
  imageHeight: number;
};

export type WallCleanupOutput = {
  /** JPEG q=0.9 blob at the SAME dimensions as the input. */
  cleanedBlob: Blob;
  /** Fraction of the image classified as wall (polygon area, 0..1). */
  maskCoverage: number;
  /**
   * `true` when cleanup ran end-to-end; `false` when we bailed early
   * (bad polygon, coverage guard, decode / encode failure). Callers use
   * this to skip the storage-swap step when cleanup was a no-op —
   * uploading a copy of the original as `_cleaned.jpg` wastes storage
   * for no benefit.
   */
  applied: boolean;
};

/**
 * Clean up the wall region in `originalBlob` using the model-supplied
 * polygon + median RGB. Returns the original blob unchanged when the
 * detection is unusable (see coverage guards) so the upload pipeline
 * can always chain `replace → load → detect scale` without a special
 * "did cleanup fire?" branch.
 */
export async function cleanupWallRegion(
  input: WallCleanupInput,
): Promise<WallCleanupOutput> {
  const { originalBlob, wallPolygon, wallMedianRgb, imageWidth, imageHeight } =
    input;

  if (
    wallPolygon.length < 3 ||
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return { cleanedBlob: originalBlob, maskCoverage: 0, applied: false };
  }

  // Polygon area in normalized units (Shoelace, absolute value). The
  // mask itself is feathered so coverage is only a rough estimate, but
  // it's good enough for the "too small / too large" guardrails.
  const coverage = polygonAreaNormalized(wallPolygon);
  if (coverage < MIN_MASK_COVERAGE || coverage > MAX_MASK_COVERAGE) {
    return { cleanedBlob: originalBlob, maskCoverage: coverage, applied: false };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(originalBlob);
  } catch {
    return { cleanedBlob: originalBlob, maskCoverage: coverage, applied: false };
  }
  const w = bitmap.width;
  const h = bitmap.height;
  if (w <= 0 || h <= 0) {
    try {
      bitmap.close?.();
    } catch {
      /* ignore */
    }
    return { cleanedBlob: originalBlob, maskCoverage: coverage, applied: false };
  }

  const minDim = Math.min(w, h);
  const featherPx = Math.max(2, Math.round(minDim * FEATHER_FRAC));
  const blurPxFull = Math.max(4, Math.round(minDim * LOWFREQ_BLUR_FRAC));

  // ── Canvas A: full-resolution copy of the original ────────────
  const a = createRenderTarget(w, h);
  a.ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
  try {
    bitmap.close?.();
  } catch {
    /* ignore */
  }
  bitmap = null;

  // ── Mask canvas: feathered polygon (single-channel via R only) ─
  //
  // The polygon is filled white on a black background, then the whole
  // canvas is re-drawn through a blur filter to produce a feathered
  // alpha mask. We could apply the blur directly with `ctx.filter =
  // "blur(...)" ` before `fill()`, but drawing the polygon FIRST and
  // then re-drawing THROUGH the blur is more predictable across
  // browsers (Safari has been inconsistent about filter application
  // ordering on `fill()` in some releases).
  const rawMask = createRenderTarget(w, h);
  rawMask.ctx.fillStyle = "#000000";
  rawMask.ctx.fillRect(0, 0, w, h);
  rawMask.ctx.fillStyle = "#ffffff";
  rawMask.ctx.beginPath();
  rawMask.ctx.moveTo(wallPolygon[0][0] * w, wallPolygon[0][1] * h);
  for (let i = 1; i < wallPolygon.length; i += 1) {
    rawMask.ctx.lineTo(wallPolygon[i][0] * w, wallPolygon[i][1] * h);
  }
  rawMask.ctx.closePath();
  rawMask.ctx.fill();

  const mask = createRenderTarget(w, h);
  // Cast — the union type across OffscreenCanvasRenderingContext2D and
  // CanvasRenderingContext2D exposes `filter` on both, but TS narrows
  // it away for the union. Assignment is safe on every target.
  (mask.ctx as CanvasRenderingContext2D).filter = `blur(${featherPx}px)`;
  mask.ctx.drawImage(rawMask.canvas as CanvasImageSource, 0, 0);
  (mask.ctx as CanvasRenderingContext2D).filter = "none";

  // ── Low-frequency luminance map ────────────────────────────────
  //
  // Downsample canvasA to 1/8 res, blur on that small canvas (~64x
  // cheaper than blurring at full res), then upsample back to full
  // resolution. The `blurPxLow = blurPxFull / LOWFREQ_DOWNSCALE`
  // scaling keeps the visible blur radius identical to a native
  // full-res blur.
  const lowW = Math.max(1, Math.round(w / LOWFREQ_DOWNSCALE));
  const lowH = Math.max(1, Math.round(h / LOWFREQ_DOWNSCALE));
  const blurPxLow = Math.max(1, Math.round(blurPxFull / LOWFREQ_DOWNSCALE));

  const lowDown = createRenderTarget(lowW, lowH);
  lowDown.ctx.imageSmoothingEnabled = true;
  (lowDown.ctx as CanvasRenderingContext2D).imageSmoothingQuality = "high";
  lowDown.ctx.drawImage(a.canvas as CanvasImageSource, 0, 0, lowW, lowH);

  const lowBlur = createRenderTarget(lowW, lowH);
  (lowBlur.ctx as CanvasRenderingContext2D).filter = `blur(${blurPxLow}px)`;
  lowBlur.ctx.drawImage(lowDown.canvas as CanvasImageSource, 0, 0);
  (lowBlur.ctx as CanvasRenderingContext2D).filter = "none";

  const c = createRenderTarget(w, h);
  c.ctx.imageSmoothingEnabled = true;
  (c.ctx as CanvasRenderingContext2D).imageSmoothingQuality = "high";
  c.ctx.drawImage(lowBlur.canvas as CanvasImageSource, 0, 0, w, h);

  // ── Per-pixel flatten ──────────────────────────────────────────
  let imgData: ImageData;
  let lowData: ImageData;
  let maskData: ImageData;
  try {
    imgData = a.ctx.getImageData(0, 0, w, h);
    lowData = c.ctx.getImageData(0, 0, w, h);
    maskData = mask.ctx.getImageData(0, 0, w, h);
  } catch {
    // Some browsers throw on getImageData when the canvas is "tainted"
    // by a cross-origin source. That can't happen here (we own the
    // blob), but be defensive anyway.
    return { cleanedBlob: originalBlob, maskCoverage: coverage, applied: false };
  }

  const [tr, tg, tb] = wallMedianRgb;
  const targetLuma = 0.299 * tr + 0.587 * tg + 0.114 * tb;

  const maxCh = Math.max(tr, tg, tb);
  const minCh = Math.min(tr, tg, tb);
  const saturation = maxCh > 0 ? (maxCh - minCh) / maxCh : 0;
  const applyChroma = saturation < CHROMA_SAT_SKIP;

  const px = imgData.data;
  const low = lowData.data;
  const mk = maskData.data;
  const len = px.length;

  for (let i = 0; i < len; i += 4) {
    const m = mk[i] / 255;
    if (m <= 0.001) continue;
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const lr = low[i];
    const lg = low[i + 1];
    const lb = low[i + 2];
    const lumaLocal = 0.299 * lr + 0.587 * lg + 0.114 * lb;
    if (lumaLocal < 1) continue;
    let k = targetLuma / lumaLocal;
    if (k < K_MIN) k = K_MIN;
    else if (k > K_MAX) k = K_MAX;
    let rc = r * k;
    let gc = g * k;
    let bc = b * k;
    if (applyChroma) {
      const chromaAlpha = CHROMA_STRENGTH * m;
      rc = rc * (1 - chromaAlpha) + tr * chromaAlpha;
      gc = gc * (1 - chromaAlpha) + tg * chromaAlpha;
      bc = bc * (1 - chromaAlpha) + tb * chromaAlpha;
    }
    const blend = BLEND_STRENGTH * m;
    const inv = 1 - blend;
    const nr = r * inv + rc * blend;
    const ng = g * inv + gc * blend;
    const nb = b * inv + bc * blend;
    px[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
    px[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
    px[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
  }

  a.ctx.putImageData(imgData, 0, 0);

  const cleanedBlob = await canvasToBlob(
    a.canvas,
    a.kind,
    "image/jpeg",
    OUTPUT_JPEG_QUALITY,
  );
  if (!cleanedBlob) {
    return { cleanedBlob: originalBlob, maskCoverage: coverage, applied: false };
  }
  return { cleanedBlob, maskCoverage: coverage, applied: true };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Absolute polygon area via the Shoelace formula on normalized (0..1)
 * coordinates. Robust to vertex order (clockwise or counter-clockwise).
 */
export function polygonAreaNormalized(
  points: ReadonlyArray<readonly [number, number]>,
): number {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) * 0.5;
}

type RenderTargetKind = "offscreen" | "canvas";

type RenderTarget = {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  kind: RenderTargetKind;
};

function createRenderTarget(w: number, h: number): RenderTarget {
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const off = new OffscreenCanvas(w, h);
      const ctx = off.getContext("2d");
      if (ctx) return { canvas: off, ctx, kind: "offscreen" };
    } catch {
      /* fall through */
    }
  }
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("canvas_2d_unavailable");
  return { canvas: el, ctx, kind: "canvas" };
}

async function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  kind: RenderTargetKind,
  mime: string,
  quality: number,
): Promise<Blob | null> {
  if (kind === "offscreen") {
    try {
      const blob = await (canvas as OffscreenCanvas).convertToBlob({
        type: mime,
        quality,
      });
      return blob ?? null;
    } catch {
      return null;
    }
  }
  return new Promise<Blob | null>((resolve) => {
    try {
      (canvas as HTMLCanvasElement).toBlob(
        (blob) => resolve(blob),
        mime,
        quality,
      );
    } catch {
      resolve(null);
    }
  });
}
