"use client";

/**
 * Theo Image Enhance (Beta) — local flat-artwork engine.
 *
 * Produces a warped, gently-toned, lightly-sharpened, bezel-padded
 * copy of the user's original file, entirely in-browser. Result is a
 * WebP `Blob` plus a JSON-serializable `FlatRecipe` the caller can
 * persist to `enhancement_meta`.
 *
 * OpenCV.js note
 * --------------
 * The plan file allows a `dynamic import("opencv.js")` for full
 * 4-corner homography. We do NOT ship opencv.js in `package.json` yet
 * (WASM bundle is ~9 MiB and adds significant TTFI risk on mobile).
 * Instead this engine implements a **canvas-only pipeline** that:
 *   - takes the user's rectangular crop selection (or the analyzer's
 *     suggested crop),
 *   - crops on-device,
 *   - applies the ±15%-clamped tone,
 *   - runs a small luminance unsharp-mask,
 *   - pads a white bezel around the result.
 *
 * When opencv.js later becomes available on the client (see TODO
 * below), the perspective-warp branch will be enabled behind the
 * `sourceCorners` param — the recipe schema already carries the four
 * points so an upgrade is drop-in and backwards-compatible.
 *
 * TODO(opencv): once opencv.js is dependency-declared, add a
 * try/catch dynamic import at the top of `runFlatEnhancement` and use
 * `cv.getPerspectiveTransform` + `cv.warpPerspective` when
 * `sourceCorners` describes a non-axis-aligned quadrilateral.
 */

import type { FlatRecipe, NormalizedPoint } from "./types";
import { ENHANCEMENT_TONE_CAP, clampTone, round3 } from "./types";

export type RunFlatInput = {
  file: File;
  /**
   * Optional user-picked four corners in normalized [0,1] space, order
   * TL / TR / BR / BL. When omitted the engine falls back to the
   * axis-aligned rectangle inferred from `crop` (or the full frame).
   */
  sourceCorners?: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] | null;
  /** Axis-aligned crop rectangle to use when `sourceCorners` is
   *  omitted. Normalized to [0,1]. */
  crop?: { x: number; y: number; w: number; h: number } | null;
  /** Optional tone override. Values are re-clamped into ±15% of 1.0. */
  tone?: { b?: number; c?: number; s?: number } | null;
  /** Unsharp mask amount in [0,1]. */
  sharpen?: number;
  /** Bezel width as a fraction of the shorter output edge. Default 0.02. */
  bezel?: number;
  /** Maximum output long edge in px. Defaults to 4096 to align with
   *  the compression pipeline. */
  maxLongEdge?: number;
};

export type RunFlatResult = {
  /** WebP blob suitable for upload as the display copy. */
  blob: Blob;
  /** Fully-normalized recipe to persist. */
  recipe: FlatRecipe;
  /** End-to-end wall-clock latency of this pipeline, in ms. */
  latencyMs: number;
  /**
   * A [0,1] "we think this worked" score. This engine is deterministic
   * once given corners, so we return 1 when a full pipeline ran and a
   * lower value when we had to skip stages. Consumers may still
   * override with their own confidence.
   */
  confidence: number;
};

const DEFAULT_MAX_LONG_EDGE = 4096;
const DEFAULT_BEZEL = 0.02;
const DEFAULT_SHARPEN = 0.35;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function normalizeCropFromCorners(
  corners: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] | null | undefined,
  fallback: { x: number; y: number; w: number; h: number } | null | undefined,
): { x: number; y: number; w: number; h: number } {
  if (corners && corners.length === 4) {
    const xs = corners.map((p) => clamp01(p[0]));
    const ys = corners.map((p) => clamp01(p[1]));
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const w = Math.max(0.05, xMax - xMin);
    const h = Math.max(0.05, yMax - yMin);
    return { x: xMin, y: yMin, w, h };
  }
  if (fallback) {
    return {
      x: clamp01(fallback.x),
      y: clamp01(fallback.y),
      w: Math.max(0.05, clamp01(fallback.w)),
      h: Math.max(0.05, clamp01(fallback.h)),
    };
  }
  return { x: 0, y: 0, w: 1, h: 1 };
}

/** Apply tone shift + optional unsharp mask into a fresh ImageData. */
function applyToneAndSharpen(
  src: ImageData,
  tone: { b: number; c: number; s: number },
  sharpen: number,
): ImageData {
  const w = src.width;
  const h = src.height;
  const out = new ImageData(w, h);
  const bIn = src.data;
  const bOut = out.data;
  const b = clampTone(tone.b);
  const c = clampTone(tone.c);
  const s = clampTone(tone.s);

  // First pass — tone.
  for (let i = 0; i < bIn.length; i += 4) {
    let r = bIn[i];
    let g = bIn[i + 1];
    let bl = bIn[i + 2];
    r = (r - 128) * c + 128 * b;
    g = (g - 128) * c + 128 * b;
    bl = (bl - 128) * c + 128 * b;
    const y = 0.299 * r + 0.587 * g + 0.114 * bl;
    r = y + (r - y) * s;
    g = y + (g - y) * s;
    bl = y + (bl - y) * s;
    bOut[i] = Math.min(255, Math.max(0, r));
    bOut[i + 1] = Math.min(255, Math.max(0, g));
    bOut[i + 2] = Math.min(255, Math.max(0, bl));
    bOut[i + 3] = bIn[i + 3];
  }

  if (sharpen <= 0) return out;

  // Second pass — unsharp mask (small radius, luminance-only). We
  // reuse `bOut` as the source and write back in place.
  const amount = Math.min(1, Math.max(0, sharpen));
  const kernel = [-1, -1, -1, -1, 9, -1, -1, -1, -1];
  const kernelSum = 1;
  const sharpened = new Uint8ClampedArray(bOut.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let r = 0;
      let g = 0;
      let bl = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          const px = Math.min(w - 1, Math.max(0, x + kx));
          const py = Math.min(h - 1, Math.max(0, y + ky));
          const p = (py * w + px) * 4;
          const k = kernel[ki++];
          r += bOut[p] * k;
          g += bOut[p + 1] * k;
          bl += bOut[p + 2] * k;
        }
      }
      const p = (y * w + x) * 4;
      const origR = bOut[p];
      const origG = bOut[p + 1];
      const origB = bOut[p + 2];
      const shR = r / kernelSum;
      const shG = g / kernelSum;
      const shB = bl / kernelSum;
      sharpened[p] = Math.min(255, Math.max(0, origR + (shR - origR) * amount));
      sharpened[p + 1] = Math.min(255, Math.max(0, origG + (shG - origG) * amount));
      sharpened[p + 2] = Math.min(255, Math.max(0, origB + (shB - origB) * amount));
      sharpened[p + 3] = bOut[p + 3];
    }
  }
  for (let i = 0; i < bOut.length; i += 1) bOut[i] = sharpened[i];
  return out;
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type, quality }).catch(() => null);
  }
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}

function makeCanvas(w: number, h: number): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("no_canvas_ctx");
    return { canvas, ctx };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no_canvas_ctx");
  return { canvas, ctx };
}

/**
 * Run the local flat pipeline. Never throws for a decode / encode
 * failure — surfaces a `{ blob: <original>, confidence: 0 }` result
 * instead so the caller can fall back gracefully.
 */
export async function runFlatEnhancement(
  input: RunFlatInput,
): Promise<RunFlatResult> {
  const started = performance.now();

  const bezel =
    typeof input.bezel === "number" && Number.isFinite(input.bezel)
      ? Math.min(0.1, Math.max(0, input.bezel))
      : DEFAULT_BEZEL;
  const sharpen =
    typeof input.sharpen === "number" && Number.isFinite(input.sharpen)
      ? Math.min(1, Math.max(0, input.sharpen))
      : DEFAULT_SHARPEN;
  const tone = {
    b: clampTone(input.tone?.b ?? 1, ENHANCEMENT_TONE_CAP),
    c: clampTone(input.tone?.c ?? 1, ENHANCEMENT_TONE_CAP),
    s: clampTone(input.tone?.s ?? 1, ENHANCEMENT_TONE_CAP),
  };
  const cropNormalized = normalizeCropFromCorners(input.sourceCorners, input.crop);

  const buildRecipe = (): FlatRecipe => ({
    sourceCorners: input.sourceCorners ?? null,
    tone: { b: round3(tone.b), c: round3(tone.c), s: round3(tone.s) },
    sharpen: round3(sharpen),
    bezel: round3(bezel),
  });

  try {
    if (typeof createImageBitmap === "undefined") {
      return {
        blob: input.file,
        recipe: buildRecipe(),
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
        confidence: 0,
      };
    }

    const maxLongEdge = input.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE;
    const probe = await createImageBitmap(input.file);
    const srcW = probe.width;
    const srcH = probe.height;
    try {
      probe.close();
    } catch {}

    const cropPxX = Math.round(cropNormalized.x * srcW);
    const cropPxY = Math.round(cropNormalized.y * srcH);
    const cropPxW = Math.max(1, Math.round(cropNormalized.w * srcW));
    const cropPxH = Math.max(1, Math.round(cropNormalized.h * srcH));

    const longestCropEdge = Math.max(cropPxW, cropPxH);
    const scale = longestCropEdge > maxLongEdge ? maxLongEdge / longestCropEdge : 1;
    const outW = Math.max(1, Math.round(cropPxW * scale));
    const outH = Math.max(1, Math.round(cropPxH * scale));

    const bitmap = await createImageBitmap(input.file, cropPxX, cropPxY, cropPxW, cropPxH, {
      resizeWidth: outW,
      resizeHeight: outH,
      resizeQuality: "high",
    });

    const { canvas, ctx } = makeCanvas(outW, outH);
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, outW, outH);
    try {
      bitmap.close();
    } catch {}

    // Read pixels, apply tone + sharpen, write back.
    const src = ctx.getImageData(0, 0, outW, outH);
    const processed = applyToneAndSharpen(src, tone, sharpen);
    ctx.putImageData(processed, 0, 0);

    // Bezel — draw the processed canvas onto a slightly larger white
    // canvas so the resulting artwork sits on a clean flat mat.
    const bezelPx = Math.round(bezel * Math.min(outW, outH));
    const finalW = outW + bezelPx * 2;
    const finalH = outH + bezelPx * 2;
    const { canvas: matCanvas, ctx: matCtx } = makeCanvas(finalW, finalH);
    matCtx.fillStyle = "#ffffff";
    matCtx.fillRect(0, 0, finalW, finalH);
    matCtx.drawImage(canvas as CanvasImageSource, bezelPx, bezelPx);

    const blob = await canvasToBlob(matCanvas, "image/webp", 0.9);
    const latency = Math.max(0, Math.round(performance.now() - started));
    if (!blob) {
      return {
        blob: input.file,
        recipe: buildRecipe(),
        latencyMs: latency,
        confidence: 0,
      };
    }
    return {
      blob,
      recipe: buildRecipe(),
      latencyMs: latency,
      confidence: 1,
    };
  } catch {
    return {
      blob: input.file,
      recipe: buildRecipe(),
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      confidence: 0,
    };
  }
}

/**
 * Convert a `Blob` produced by `runFlatEnhancement` into a `File` the
 * upload pipeline expects. Preserves the original stem, swaps the
 * extension to `.webp`, marks the mime as `image/webp`.
 */
export function flatBlobToFile(originalName: string, blob: Blob): File {
  const stem = originalName.replace(/\.[^./\\]+$/, "") || "enhanced";
  return new File([blob], `${stem}.enhanced.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
}
