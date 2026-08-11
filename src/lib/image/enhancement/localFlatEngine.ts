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

import type { AwbRecipe, FlatRecipe, NormalizedPoint, ProLookRecipe } from "./types";
import { ENHANCEMENT_TONE_CAP, clampTone, round3 } from "./types";
import {
  applyAwb,
  computeWallAnchoredGains,
  estimateAwb,
  resolveWallBrightnessTarget,
  type WallAnchoredGains,
  type WallBrightness,
} from "./awb";
import {
  estimateRectifiedAspect,
  homographyForCorners,
  warpPerspectiveNearest,
} from "./homography";
import {
  resolveProLookConfig,
  runProLook,
  type ProLookTimings,
} from "./proLook";

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
  /**
   * G2 (2026-08-10) — optional override for the post-warp rectified
   * aspect ratio (width / height). Normally the engine derives this
   * from the source corners via `estimateRectifiedAspect`. Setting a
   * value here bypasses the heuristic — useful for the ellipse-to-
   * circle restoration flow where the caller wants a 1:1 target.
   */
  targetAspect?: number;
  /**
   * Pro-look pipeline flags (2026-08-06). When present, the engine
   * runs the AWB + adaptive-exposure + saturation + micro-unsharp +
   * warm-bias stages after the classic tone step. Optional CLAHE is
   * skipped on high-contrast sources. Set `{ enabled: false }` (or
   * omit) to preserve v1 behavior.
   */
  proLook?: ProLookRecipe & { enabled?: boolean };
  /**
   * Enable wall-aware AWB. When the analyzer supplied a rectangle
   * with high confidence, callers pass that rect + its confidence
   * so we can sample only the wall region. Setting `enabled: false`
   * or omitting the field entirely skips AWB (v1 behavior).
   */
  awb?: {
    enabled: boolean;
    rectangle?: { x: number; y: number; w: number; h: number } | null;
    rectangleConfidence?: number;
    /**
     * G1 (2026-08-10) — Wall-anchored white balance sample.
     *
     *  - `wallSample: { x, y }` (normalized [0,1] on the OUTPUT canvas)
     *    — user clicked the wall; sample a 32×32 patch centered there.
     *  - `wallSample: "auto"` (default when this field is absent /
     *    undefined) — the engine calls `computeWallAnchoredGains` in
     *    auto-detect mode: largest bright + near-neutral connected
     *    region touching an image edge. Falls back to gray-world when
     *    no wall is found.
     *  - `wallSample: "off"` — skip wall-anchored path entirely; use
     *    gray-world only (kept for callers that opt out for backup
     *    reasons, e.g. tests).
     */
    wallSample?: { x: number; y: number } | "auto" | "off";
  };
  /**
   * F2 (2026-08-10) — matte white target selector. Threads a
   * user-facing chip ("soft" | "normal" | "bright") through to:
   *   - `computeWallAnchoredGains(..., { target })` so the sampled
   *     wall's median lands on the chosen luma (245 / 248 / 252),
   *   - the pro-look adaptive-exposure cap (`target + 5`, clamped
   *     to 255) so bright chips unlock a higher highlight ceiling
   *     and soft chips keep the historical roll-off.
   * When omitted the engine falls back to the legacy
   * `MATTE_WHITE_POINT` (243) so pre-F2 recipes replay byte-identically.
   */
  wallBrightness?: WallBrightness;
  /**
   * Cancel the pipeline at the next stage boundary. When aborted, the
   * result carries `stageError: "aborted"` and `blob: null`. The
   * caller MUST treat this as "no output produced" — never wrap the
   * original bytes in the WebP wrapper.
   */
  signal?: AbortSignal;
};

export type RunFlatResult = {
  /**
   * WebP blob suitable for upload as the display copy. `null` when the
   * pipeline had to bail out (unsupported source, decode failed, encode
   * failed). Callers MUST check for null before wrapping the result in
   * a `File` — the original bytes are never returned mislabeled as
   * WebP, which would corrupt storage for HEIC / animated GIF inputs.
   */
  blob: Blob | null;
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
  /**
   * When the pipeline bailed out, which stage failed. Useful for both
   * metering (`.failed` reason) and to explain the fallback to the
   * user. Absent on the happy path.
   */
  stageError?: "no_canvas_api" | "decode_failed" | "encode_failed" | "aborted";
  /**
   * Per-stage wall-clock timings (ms). Fields land in the metering
   * `.completed` metadata so we can watch mobile-Safari regressions
   * without extra RUM plumbing. All numbers are >= 0 and rounded.
   *
   * 2026-08-06 additions: `warpMs`, `awbMs`, and `proLook*` when the
   * matching stage ran. `proLook*` fields are `null` when disabled.
   */
  stageTimings: {
    decodeMs: number;
    toneMs: number;
    sharpenMs: number;
    encodeMs: number;
    warpMs?: number;
    awbMs?: number;
    proLookExposureMs?: number;
    proLookClaheMs?: number;
    proLookSatMs?: number;
    proLookSharpenMs?: number;
    proLookWarmthMs?: number;
  };
  /**
   * When the AWB stage ran, the computed multipliers. Persisted into
   * `FlatRecipe.awb` so the recipe can be replayed byte-identically.
   */
  awb?: AwbRecipe;
};

const DEFAULT_MAX_LONG_EDGE = 4096;
const DEFAULT_BEZEL = 0.02;
const DEFAULT_SHARPEN = 0.35;

/**
 * Map corners from full-image normalized space into the crop's local
 * normalized space (0..1 relative to the crop rect). Returns null when
 * any corner falls outside the crop rect.
 */
function mapCornersIntoCrop(
  corners: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint],
  crop: { x: number; y: number; w: number; h: number },
): [[number, number], [number, number], [number, number], [number, number]] | null {
  const out: [number, number][] = [];
  for (const [x, y] of corners) {
    const lx = (x - crop.x) / crop.w;
    const ly = (y - crop.y) / crop.h;
    out.push([Math.min(1, Math.max(0, lx)), Math.min(1, Math.max(0, ly))]);
  }
  return out as [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
}

/**
 * Heuristic: does this quadrilateral warrant an actual perspective
 * warp? Skip when the corners are close to the axis-aligned rectangle
 * — the compressor's implicit letterbox already handles that case, and
 * running a full warp on a straight rect is wasteful.
 *
 * §Fix B (2026-08-10): the previous 2 px tolerance was too tight —
 * a near-axis-aligned edge-detector seed would slip past and rotate
 * the whole image on straight-on captures. Widened to 0.5 % of the
 * smaller output edge (~5 px on a 1024-wide preview, ~13 px at 2560),
 * matching the `AXIS_ALIGNED_TOLERANCE` used by the auto-seed gate.
 */
function cornersLookQuadrilateral(
  corners: [[number, number], [number, number], [number, number], [number, number]],
  outW: number,
  outH: number,
): boolean {
  // Compute the smallest enclosing axis-aligned rectangle in local
  // [0,1] space and compare corner-by-corner. Using the bounding box
  // (rather than [(0,0),(1,0),…]) means a quad occupying only part
  // of the crop still gets a fair "is it rotated?" check.
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const targets: [[number, number], [number, number], [number, number], [number, number]] = [
    [xMin, yMin],
    [xMax, yMin],
    [xMax, yMax],
    [xMin, yMax],
  ];
  const tol = Math.max(0.005, 5 / Math.min(outW, outH));
  for (let i = 0; i < 4; i += 1) {
    if (
      Math.abs(corners[i][0] - targets[i][0]) > tol ||
      Math.abs(corners[i][1] - targets[i][1]) > tol
    ) {
      return true;
    }
  }
  return false;
}

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

/** Apply tone shift into a fresh ImageData. */
function applyTone(
  src: ImageData,
  tone: { b: number; c: number; s: number },
): ImageData {
  const w = src.width;
  const h = src.height;
  const out = new ImageData(w, h);
  const bIn = src.data;
  const bOut = out.data;
  const b = clampTone(tone.b);
  const c = clampTone(tone.c);
  const s = clampTone(tone.s);

  // 2026-08-09 correctness fix: brightness (b) was previously applied
  // as `... + 128 * b`, which quietly re-added a fixed grey pedestal
  // regardless of the input. Standard form is `((x - 128) * c + 128) * b`
  // — contrast pivots around mid-grey, then brightness multiplies the
  // whole result. This matters only for the Pro Look OFF path (pro-look
  // now skips this stage entirely per the linear-light rewrite).
  for (let i = 0; i < bIn.length; i += 4) {
    let r = bIn[i];
    let g = bIn[i + 1];
    let bl = bIn[i + 2];
    r = ((r - 128) * c + 128) * b;
    g = ((g - 128) * c + 128) * b;
    bl = ((bl - 128) * c + 128) * b;
    const y = 0.299 * r + 0.587 * g + 0.114 * bl;
    r = y + (r - y) * s;
    g = y + (g - y) * s;
    bl = y + (bl - y) * s;
    bOut[i] = Math.min(255, Math.max(0, r));
    bOut[i + 1] = Math.min(255, Math.max(0, g));
    bOut[i + 2] = Math.min(255, Math.max(0, bl));
    bOut[i + 3] = bIn[i + 3];
  }
  return out;
}

/** Apply an unsharp mask (small radius, luminance-only) in-place. */
function applyUnsharp(image: ImageData, sharpen: number): void {
  if (sharpen <= 0) return;
  const w = image.width;
  const h = image.height;
  const bOut = image.data;
  const amount = Math.min(1, Math.max(0, sharpen));
  const kernel = [-1, -1, -1, -1, 9, -1, -1, -1, -1];
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
      sharpened[p] = Math.min(255, Math.max(0, origR + (r - origR) * amount));
      sharpened[p + 1] = Math.min(255, Math.max(0, origG + (g - origG) * amount));
      sharpened[p + 2] = Math.min(255, Math.max(0, origB + (bl - origB) * amount));
      sharpened[p + 3] = bOut[p + 3];
    }
  }
  for (let i = 0; i < bOut.length; i += 1) bOut[i] = sharpened[i];
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
 * Try to decode `file` with EXIF orientation applied. Falls back
 * gracefully when the browser (older Safari) doesn't support the
 * `imageOrientation` option — in that case we still decode, orientation
 * will just remain the encoded EXIF orientation. Callers who care about
 * orientation for a JPEG use the analyze pipeline's rotation math.
 *
 * The two-pass `createImageBitmap` here is intentional: some Chromium
 * builds throw on an unknown option, so we probe with an options object,
 * and on catch fall back to plain decode.
 */
async function decodeOriented(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);
  } catch {
    return await createImageBitmap(file);
  }
}

async function decodeOrientedRegion(
  file: File,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  outW: number,
  outH: number,
): Promise<ImageBitmap> {
  const opts: ImageBitmapOptions = {
    resizeWidth: outW,
    resizeHeight: outH,
    resizeQuality: "high",
    imageOrientation: "from-image",
  };
  try {
    return await createImageBitmap(file, sx, sy, sw, sh, opts);
  } catch {
    // Older Safari can reject the option — retry without orientation.
    return await createImageBitmap(file, sx, sy, sw, sh, {
      resizeWidth: outW,
      resizeHeight: outH,
      resizeQuality: "high",
    });
  }
}

/**
 * Run the local flat pipeline. Non-throwing: decode / encode failures
 * are returned as `{ blob: null, stageError }` so the caller can log
 * the failure and fall back to the original file WITHOUT mislabeling
 * arbitrary bytes as `image/webp`.
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

  const proLookEnabled = input.proLook?.enabled === true;
  // F2 (2026-08-10) — user-supplied wall brightness target. When
  // omitted we stay on the historical `MATTE_WHITE_POINT` (243) so
  // bulk / legacy callers keep replaying identically. The wizard
  // supplies `normal` (248) by default.
  const wallBrightnessTarget = resolveWallBrightnessTarget(input.wallBrightness);
  const wallBrightnessSupplied = typeof input.wallBrightness === "string";
  const proLookRecipeIn: (ProLookRecipe & { enabled?: boolean }) | undefined =
    wallBrightnessSupplied
      ? {
          ...(input.proLook ?? {}),
          // Cap = target + 5, clamped 0..255. When the user chose
          // "bright" (252) we allow the top end to reach 255; "normal"
          // (248) yields 253; "soft" (245) yields 250 (same as
          // legacy). See proLook.adaptiveExposure for how this is
          // consumed.
          whiteCapLuma:
            input.proLook?.whiteCapLuma ??
            Math.min(255, wallBrightnessTarget + 5),
        }
      : input.proLook;
  const proLookConfig = resolveProLookConfig(proLookRecipeIn);
  const awbEnabled = input.awb?.enabled === true;
  let awbRecipe: AwbRecipe | undefined;

  const buildRecipe = (): FlatRecipe => ({
    sourceCorners: input.sourceCorners ?? null,
    tone: { b: round3(tone.b), c: round3(tone.c), s: round3(tone.s) },
    sharpen: round3(sharpen),
    bezel: round3(bezel),
    ...(awbRecipe ? { awb: awbRecipe } : {}),
    ...(proLookEnabled
      ? {
          proLook: {
            exposureLumaTarget: proLookConfig.exposureLumaTarget,
            claheEnabled: proLookConfig.claheEnabled,
            claheClipLimit: proLookConfig.claheClipLimit,
            claheTiles: proLookConfig.claheTiles,
            satBoost: proLookConfig.satBoost,
            warmthBias: proLookConfig.warmthBias,
            // G3 (2026-08-10) — persist adaptive tunables when the
            // engine ran with non-default values so a recipe replay
            // reproduces the same pixels.
            ...(proLookConfig.unsharpAmount !== undefined
              ? { unsharpAmount: proLookConfig.unsharpAmount }
              : {}),
            ...(proLookConfig.highlightCompress
              ? { highlightCompress: proLookConfig.highlightCompress }
              : {}),
            ...(typeof proLookConfig.whiteCapLuma === "number"
              ? { whiteCapLuma: proLookConfig.whiteCapLuma }
              : {}),
          },
        }
      : {}),
  });

  const stageTimings: RunFlatResult["stageTimings"] = {
    decodeMs: 0,
    toneMs: 0,
    sharpenMs: 0,
    encodeMs: 0,
  };

  const bail = (
    stageError: NonNullable<RunFlatResult["stageError"]>,
  ): RunFlatResult => ({
    blob: null,
    recipe: buildRecipe(),
    latencyMs: Math.max(0, Math.round(performance.now() - started)),
    confidence: 0,
    stageError,
    stageTimings,
    ...(awbRecipe ? { awb: awbRecipe } : {}),
  });

  const signal = input.signal;
  const isAborted = () => signal?.aborted === true;

  if (isAborted()) return bail("aborted");

  if (typeof createImageBitmap === "undefined") {
    return bail("no_canvas_api");
  }

  const maxLongEdge = input.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE;

  let srcW: number;
  let srcH: number;
  try {
    // Probe with orientation so `srcW/srcH` reflect the *visual* frame
    // after EXIF rotation — otherwise a portrait phone shot would be
    // cropped against its landscape sensor dimensions and the preview
    // would come out sideways. See:
    // https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmapOptions
    const t0 = performance.now();
    const probe = await decodeOriented(input.file);
    srcW = probe.width;
    srcH = probe.height;
    try {
      probe.close();
    } catch {}
    stageTimings.decodeMs = Math.max(0, Math.round(performance.now() - t0));
  } catch {
    return bail("decode_failed");
  }

  const cropPxX = Math.round(cropNormalized.x * srcW);
  const cropPxY = Math.round(cropNormalized.y * srcH);
  const cropPxW = Math.max(1, Math.round(cropNormalized.w * srcW));
  const cropPxH = Math.max(1, Math.round(cropNormalized.h * srcH));
  const longestCropEdge = Math.max(cropPxW, cropPxH);
  const scale = longestCropEdge > maxLongEdge ? maxLongEdge / longestCropEdge : 1;
  const outW = Math.max(1, Math.round(cropPxW * scale));
  const outH = Math.max(1, Math.round(cropPxH * scale));

  if (isAborted()) return bail("aborted");

  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  try {
    const bitmap = await decodeOrientedRegion(
      input.file,
      cropPxX,
      cropPxY,
      cropPxW,
      cropPxH,
      outW,
      outH,
    );
    const surface = makeCanvas(outW, outH);
    canvas = surface.canvas;
    ctx = surface.ctx;
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, outW, outH);
    try {
      bitmap.close();
    } catch {}
  } catch {
    return bail("decode_failed");
  }

  // Homography warp — only when the caller supplied 4 corners that
  // describe a non-axis-aligned quadrilateral inside the crop rect.
  // The crop above already trimmed the frame; corners are re-mapped
  // into the crop's local pixel space so warping stays lossless.
  // 2026-08-09: rectified target aspect is derived from the corner
  // edge lengths (Zhang/Cao heuristic) rather than the crop bounding
  // box, so keystoned photographs land at the artwork's true aspect
  // instead of the framing rectangle's aspect.
  const cornersInCrop: [[number, number], [number, number], [number, number], [number, number]] | null =
    input.sourceCorners
      ? mapCornersIntoCrop(input.sourceCorners, cropNormalized)
      : null;
  const needsWarp = cornersInCrop
    ? cornersLookQuadrilateral(cornersInCrop, outW, outH)
    : false;
  // Track the *post-warp* dimensions so downstream stages (tone,
  // proLook, bezel, encode) all agree on the current canvas geometry.
  let workW = outW;
  let workH = outH;
  if (needsWarp && cornersInCrop) {
    try {
      const twarp = performance.now();
      const srcData = ctx.getImageData(0, 0, outW, outH);
      const pxCorners: [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ] = [
        [cornersInCrop[0][0] * outW, cornersInCrop[0][1] * outH],
        [cornersInCrop[1][0] * outW, cornersInCrop[1][1] * outH],
        [cornersInCrop[2][0] * outW, cornersInCrop[2][1] * outH],
        [cornersInCrop[3][0] * outW, cornersInCrop[3][1] * outH],
      ];
      const targetAspect =
        typeof input.targetAspect === "number" &&
        Number.isFinite(input.targetAspect) &&
        input.targetAspect > 0
          ? input.targetAspect
          : estimateRectifiedAspect(pxCorners);
      const longEdge = Math.max(outW, outH);
      let warpOutW: number;
      let warpOutH: number;
      if (targetAspect >= 1) {
        warpOutW = longEdge;
        warpOutH = Math.max(1, Math.round(longEdge / targetAspect));
      } else {
        warpOutH = longEdge;
        warpOutW = Math.max(1, Math.round(longEdge * targetAspect));
      }
      const H = homographyForCorners(pxCorners, warpOutW, warpOutH);
      if (H) {
        const warped = warpPerspectiveNearest(srcData, H, warpOutW, warpOutH);
        if (warped) {
          // Replace the source canvas with a fresh surface sized to
          // the rectified aspect so subsequent stages (tone, proLook,
          // bezel, encode) don't have to know a warp happened.
          const rectifiedSurface = makeCanvas(warpOutW, warpOutH);
          canvas = rectifiedSurface.canvas;
          ctx = rectifiedSurface.ctx;
          ctx.putImageData(warped, 0, 0);
          workW = warpOutW;
          workH = warpOutH;
        }
      }
      stageTimings.warpMs = Math.max(0, Math.round(performance.now() - twarp));
    } catch {
      // Warp is best-effort — if the solve is singular fall back to
      // the crop-only pipeline. Never fail the whole enhancement.
    }
  }

  if (isAborted()) return bail("aborted");

  let processed: ImageData;
  try {
    // AWB. Runs before tone so tone/sat operate on a neutral base.
    // Uses the current canvas ImageData directly — no downsample —
    // because the wall region needs pixel-accurate edge-touching
    // detection, and the ImageData here is already capped at the
    // engine's `maxLongEdge` (default 2560 as of 2026-08-10 / G5).
    //
    // G1 (2026-08-10): try wall-anchored gains first (targets
    // MATTE_WHITE_POINT = #f3f3f3 = 243), fall back to the classic
    // gray-world / wall-biased estimator when no wall region is
    // detected. See awb.ts for the anchoring rationale.
    if (awbEnabled) {
      const tawb = performance.now();
      const sample = ctx.getImageData(0, 0, workW, workH);
      const wallSample = input.awb?.wallSample ?? "auto";
      let anchored: WallAnchoredGains | null = null;
      if (wallSample !== "off") {
        const sampleRegion =
          typeof wallSample === "object" && wallSample
            ? (() => {
                const patch = 32;
                const cx = Math.round(wallSample.x * workW);
                const cy = Math.round(wallSample.y * workH);
                return {
                  x: Math.max(0, cx - patch / 2),
                  y: Math.max(0, cy - patch / 2),
                  w: patch,
                  h: patch,
                };
              })()
            : undefined;
        anchored = computeWallAnchoredGains(
          { data: sample.data, width: workW, height: workH },
          {
            ...(sampleRegion ? { sampleRegion } : {}),
            // F2 (2026-08-10) — thread the user's wall-brightness
            // chip into the AWB target so a "bright" (252) chip
            // lifts the whole wall by ~4 luma vs "normal" (248).
            // When the caller didn't supply `wallBrightness` this
            // stays at 243 (MATTE_WHITE_POINT).
            ...(wallBrightnessSupplied ? { target: wallBrightnessTarget } : {}),
          },
        );
      }
      if (anchored) {
        awbRecipe = {
          rMul: anchored.r,
          gMul: anchored.g,
          bMul: anchored.b,
          // AwbRecipe.source is a compact enum shared with the DB
          // schema; the new anchored variants still fit under
          // "wall-biased" (the wall is the reference in both paths).
          // The tighter provenance (auto vs pick, area fraction) lives
          // in metering, not the persisted recipe.
          source: "wall-biased",
        };
        applyAwb(sample.data, awbRecipe);
      } else {
        awbRecipe = estimateAwb({
          data: sample.data,
          width: workW,
          height: workH,
          rectangle: input.awb?.rectangle ?? null,
          rectangleConfidence: input.awb?.rectangleConfidence,
        });
        applyAwb(sample.data, awbRecipe);
      }
      ctx.putImageData(sample, 0, 0);
      stageTimings.awbMs = Math.max(0, Math.round(performance.now() - tawb));
    }

    const t0 = performance.now();
    const src = ctx.getImageData(0, 0, workW, workH);
    // 2026-08-09 color-linear: skip classic multiplicative tone when
    // Pro Look is enabled — its adaptive exposure + tone curve already
    // targets the same midtone, and doing both stacks the effect and
    // produces the muddy result reported in QA. Preserve classic tone
    // for the Pro Look OFF path so recipe replay stays byte-identical.
    processed = proLookEnabled ? src : applyTone(src, tone);
    stageTimings.toneMs = Math.max(0, Math.round(performance.now() - t0));

    // Pro-look pipeline (2026-08-06). Runs after classic tone so the
    // recipe's b/c/s intent is preserved; proLook then does the
    // "make it feel professional" nudges (adaptive exposure, CLAHE,
    // perceptual sat, halo-safe sharpen, warm bias).
    if (proLookEnabled) {
      const proTimings: ProLookTimings = runProLook(processed, proLookConfig);
      stageTimings.proLookExposureMs = proTimings.exposureMs;
      stageTimings.proLookClaheMs = proTimings.claheMs;
      stageTimings.proLookSatMs = proTimings.satMs;
      stageTimings.proLookSharpenMs = proTimings.sharpenMs;
      stageTimings.proLookWarmthMs = proTimings.warmthMs;
      // proLook.microUnsharp already applied its own halo-safe unsharp.
      // Skip the aggressive kernel below to avoid double-processing.
    } else {
      const t1 = performance.now();
      applyUnsharp(processed, sharpen);
      stageTimings.sharpenMs = Math.max(0, Math.round(performance.now() - t1));
    }
    ctx.putImageData(processed, 0, 0);
  } catch {
    return bail("decode_failed");
  }

  if (isAborted()) return bail("aborted");

  // Bezel — draw the processed canvas onto a slightly larger white
  // canvas so the resulting artwork sits on a clean flat mat.
  const bezelPx = Math.round(bezel * Math.min(workW, workH));
  const finalW = workW + bezelPx * 2;
  const finalH = workH + bezelPx * 2;
  let blob: Blob | null;
  try {
    const t0 = performance.now();
    const { canvas: matCanvas, ctx: matCtx } = makeCanvas(finalW, finalH);
    matCtx.fillStyle = "#ffffff";
    matCtx.fillRect(0, 0, finalW, finalH);
    matCtx.drawImage(canvas as CanvasImageSource, bezelPx, bezelPx);
    blob = await canvasToBlob(matCanvas, "image/webp", 0.9);
    stageTimings.encodeMs = Math.max(0, Math.round(performance.now() - t0));
  } catch {
    return bail("encode_failed");
  }

  const latency = Math.max(0, Math.round(performance.now() - started));
  if (!blob) {
    return {
      blob: null,
      recipe: buildRecipe(),
      latencyMs: latency,
      confidence: 0,
      stageError: "encode_failed",
      stageTimings,
      ...(awbRecipe ? { awb: awbRecipe } : {}),
    };
  }
  return {
    blob,
    recipe: buildRecipe(),
    latencyMs: latency,
    confidence: 1,
    stageTimings,
    ...(awbRecipe ? { awb: awbRecipe } : {}),
  };
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
