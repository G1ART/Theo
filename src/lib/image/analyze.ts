/**
 * Client-side image analysis for the "Theo standard" auto tone and
 * auto-crop suggestions (feed image standardization, 2026-07-20).
 *
 * Runs entirely in the browser via a downscaled offscreen canvas.
 * No server work. No pixel writes to the original file.
 *
 * The output is a `DisplayAdjust` payload the uploader can preview,
 * tweak, or reset. Because grid surfaces apply this via CSS filter +
 * transform, "wrong" values are trivially reversible — we err toward
 * gentle nudges (clamped ±15%) rather than aggressive rewrites.
 */

import type {
  DisplayAdjust,
  DisplayCrop,
} from "@/lib/image/displayAdjust";
import { normalizeDisplayAdjust } from "@/lib/image/displayAdjust";

/** Downscaled sample size (px on the longest side). 256 is more than
 *  enough for stable histogram/edge estimation and keeps analysis under
 *  ~10ms even on mid-range mobile. */
const SAMPLE_LONG_EDGE = 256;

/**
 * "Theo standard" tone targets. These are the mid-grey targets we
 * gently steer every image toward, chosen so a mixed grid of works
 * (dark charcoal drawings, bright watercolors, muted photographs)
 * reads with consistent visual weight without ever dominating a
 * neighbour or fading away.
 *
 * Values sit in linear 0–255 luminance space:
 *  - `mean` ≈ 132 (roughly middle grey, slight bias toward light so
 *    white canvases don't feel washed against the page).
 *  - `stdev` ≈ 58 (moderate dynamic range — enough to hold detail in
 *    both shadows and highlights).
 */
const TONE_TARGET = {
  meanLuma: 132,
  stdevLuma: 58,
} as const;

/** ±15% cap keeps the auto-tone gentle. If the source is way off from
 *  the target, we cap the correction and leave the rest to human eye
 *  review. This is the reason artist trust survives the pipeline —
 *  Theo never quietly makes a red painting orange. */
const AUTO_CAP = 0.15;

/** Auto-crop only triggers when at least this fraction of a border is
 *  detected as uniform "background". Below this we leave the crop as
 *  full-frame so the auto-suggest is quiet by default. */
const AUTO_CROP_MIN_BAND = 0.03;

/** And we never crop more than this many pixels of border away
 *  (as a fraction of image dimension) on any single side. Any larger
 *  and the user must confirm manually — the algorithm cannot tell a
 *  large background from an artwork with intentionally soft margins. */
const AUTO_CROP_MAX_BAND = 0.2;

/** Uniform-background threshold (per-channel stdev in a border strip).
 *  Painterly gradients, watermarks, or textured papers exceed this and
 *  are correctly left alone. */
const BAND_UNIFORM_STDEV = 12;

export type ImageAnalysis = {
  /** Original pixel width. */
  width: number;
  /** Original pixel height. */
  height: number;
  /** Mean luminance across the downscaled sample (0–255). */
  meanLuma: number;
  /** Std dev of luminance (0–255). */
  stdevLuma: number;
  /** Suggested display adjustments (already clamped & normalized). May
   *  be `null` when the image is already close to standard AND has no
   *  usable background to crop — in which case rendering the original
   *  is correct. */
  suggested: DisplayAdjust | null;
  /** Separate crop suggestion so the editor can show a "auto-crop"
   *  chip independent of the tone controls. */
  suggestedCrop: DisplayCrop | null;
};

/** Load a `File` into an `HTMLImageElement` via object URL. */
function loadFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(img);
      // Revoke on next tick so the caller has a chance to draw first.
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }, 0);
    };
    img.onerror = (err) => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
      reject(err);
    };
    img.src = url;
  });
}

/** Draw an `HTMLImageElement` into a downscaled canvas for analysis. */
function toSampleCanvas(img: HTMLImageElement): {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
} {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const longEdge = Math.max(w0, h0);
  const scale = longEdge > SAMPLE_LONG_EDGE ? SAMPLE_LONG_EDGE / longEdge : 1;
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas_2d_unavailable");
  ctx.drawImage(img, 0, 0, w, h);
  return { ctx, canvas, w, h };
}

/**
 * Luminance stats (Rec.601 weights) over an ImageData buffer.
 * Returns mean and std dev in 0–255.
 */
function lumaStats(data: Uint8ClampedArray): {
  mean: number;
  stdev: number;
} {
  let sum = 0;
  let sumSq = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += y;
    sumSq += y * y;
  }
  const mean = sum / n;
  const varv = Math.max(0, sumSq / n - mean * mean);
  return { mean, stdev: Math.sqrt(varv) };
}

/**
 * Per-channel stdev across a rectangular strip of the sample canvas.
 * Used to detect "uniform background" borders (walls, matte paper,
 * scan margins) for the auto-crop suggestion.
 */
function stripUniformStdev(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): number {
  if (w <= 0 || h <= 0) return Number.POSITIVE_INFINITY;
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  r /= n;
  g /= n;
  b /= n;
  let sqr = 0;
  let sqg = 0;
  let sqb = 0;
  for (let i = 0; i < d.length; i += 4) {
    sqr += (d[i] - r) ** 2;
    sqg += (d[i + 1] - g) ** 2;
    sqb += (d[i + 2] - b) ** 2;
  }
  // Average per-channel stdev — using the max would over-trigger on
  // pure-red frames; average is robust across typical scans.
  return (Math.sqrt(sqr / n) + Math.sqrt(sqg / n) + Math.sqrt(sqb / n)) / 3;
}

/**
 * Walk inward from each edge to find the widest uniform-background
 * band. Returns fractional distances in [0, AUTO_CROP_MAX_BAND].
 */
function detectBackgroundBands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): { top: number; bottom: number; left: number; right: number } {
  const stepY = Math.max(1, Math.floor(h * 0.02));
  const stepX = Math.max(1, Math.floor(w * 0.02));
  const maxTop = Math.floor(h * AUTO_CROP_MAX_BAND);
  const maxBottom = Math.floor(h * AUTO_CROP_MAX_BAND);
  const maxLeft = Math.floor(w * AUTO_CROP_MAX_BAND);
  const maxRight = Math.floor(w * AUTO_CROP_MAX_BAND);

  let top = 0;
  for (let y = 0; y < maxTop; y += stepY) {
    if (stripUniformStdev(ctx, 0, y, w, stepY) < BAND_UNIFORM_STDEV) {
      top = y + stepY;
    } else break;
  }
  let bottom = 0;
  for (let y = 0; y < maxBottom; y += stepY) {
    const yy = h - stepY - y;
    if (yy < 0) break;
    if (stripUniformStdev(ctx, 0, yy, w, stepY) < BAND_UNIFORM_STDEV) {
      bottom = y + stepY;
    } else break;
  }
  let left = 0;
  for (let x = 0; x < maxLeft; x += stepX) {
    if (stripUniformStdev(ctx, x, 0, stepX, h) < BAND_UNIFORM_STDEV) {
      left = x + stepX;
    } else break;
  }
  let right = 0;
  for (let x = 0; x < maxRight; x += stepX) {
    const xx = w - stepX - x;
    if (xx < 0) break;
    if (stripUniformStdev(ctx, xx, 0, stepX, h) < BAND_UNIFORM_STDEV) {
      right = x + stepX;
    } else break;
  }

  return {
    top: top / h,
    bottom: bottom / h,
    left: left / w,
    right: right / w,
  };
}

/**
 * Compute the "Theo standard" tone correction (b/c) toward the target
 * mean/stdev, clamped to a gentle range.
 *
 * We don't touch saturation automatically — colour interpretation is
 * artist territory. The manual slider is still exposed for photographs
 * with washed-out scans, but auto stays at 1.0.
 */
function suggestTone(
  meanLuma: number,
  stdevLuma: number,
): { b: number; c: number; s: number } {
  const bRaw =
    meanLuma > 0.1 ? TONE_TARGET.meanLuma / Math.max(30, meanLuma) : 1;
  const cRaw =
    stdevLuma > 0.1 ? TONE_TARGET.stdevLuma / Math.max(20, stdevLuma) : 1;
  const b = Math.min(1 + AUTO_CAP, Math.max(1 - AUTO_CAP, bRaw));
  const c = Math.min(1 + AUTO_CAP, Math.max(1 - AUTO_CAP, cRaw));
  return { b, c, s: 1.0 };
}

/**
 * Suggest a crop rectangle (normalized [0,1]) that trims uniform
 * background bands. Returns `null` when the auto-detector isn't
 * confident enough to suggest anything.
 */
function suggestCrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): DisplayCrop | null {
  const bands = detectBackgroundBands(ctx, w, h);
  const trimEnabled =
    bands.top >= AUTO_CROP_MIN_BAND ||
    bands.bottom >= AUTO_CROP_MIN_BAND ||
    bands.left >= AUTO_CROP_MIN_BAND ||
    bands.right >= AUTO_CROP_MIN_BAND;
  if (!trimEnabled) return null;

  const x = bands.left;
  const y = bands.top;
  const cw = 1 - bands.left - bands.right;
  const ch = 1 - bands.top - bands.bottom;
  // A crop below 60% of the frame is suspicious — the algorithm has
  // likely misread a low-contrast painting as background. Leave it be.
  if (cw < 0.6 || ch < 0.6) return null;
  return { x, y, w: cw, h: ch };
}

/**
 * Full analysis pipeline. Given a browser `File`, return luminance
 * stats + a suggested `DisplayAdjust`.
 */
export async function analyzeImageFile(file: File): Promise<ImageAnalysis> {
  const img = await loadFile(file);
  return analyzeImageElement(img);
}

/** Same as `analyzeImageFile` but takes an already-loaded element. */
export function analyzeImageElement(
  img: HTMLImageElement,
): ImageAnalysis {
  const { ctx, w, h } = toSampleCanvas(img);
  const imageData = ctx.getImageData(0, 0, w, h);
  const { mean, stdev } = lumaStats(imageData.data);
  const tone = suggestTone(mean, stdev);
  const crop = suggestCrop(ctx, w, h);
  const suggested = normalizeDisplayAdjust({
    v: 1,
    b: tone.b,
    c: tone.c,
    s: tone.s,
    crop: crop ?? undefined,
  });
  return {
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    meanLuma: mean,
    stdevLuma: stdev,
    suggested,
    suggestedCrop: crop,
  };
}
