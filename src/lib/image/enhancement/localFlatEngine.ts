"use client";

/**
 * Theo Image Enhance (Beta) — local flat-artwork engine.
 *
 * Produces a warped, gently-toned, lightly-sharpened, bezel-padded
 * copy of the user's original file, entirely in-browser. Result is a
 * WebP `Blob` plus a JSON-serializable `FlatRecipe` the caller can
 * persist to `enhancement_meta`.
 *
 * Perspective is solved in this package (`homography.ts`,
 * `rectifyArtwork.ts`). opencv.js is not loaded. Sol still supplies
 * the four corners. This engine does not replace that detector.
 * The rectangle crop is that one homography. A radial coefficient
 * or a per-edge curve is not applied, because it remaps the interior.
 * The rectangle path does not repaint inward by wall color.
 */

import type { AwbRecipe, FlatRecipe, NormalizedPoint, ProLookRecipe } from "./types";
import type { GeometryRecipe } from "./geometryPlan";
import { GEOMETRY_ENGINE_VERSION } from "./geometryPlan";
import {
  galleryMatteMask,
  restoreGalleryMatte,
} from "./borderWall";
import {
  compositeStudioPresentation,
  prepareCutoutForColor,
  STUDIO_BEZEL_FRACTION,
} from "./studioPresentation";
import { ENHANCEMENT_TONE_CAP, clampTone, round3 } from "./types";
import {
  applyAwb,
  computeWallAnchoredGains,
  dampenAwbGain,
  estimateAwb,
  gainsFromWallMedian,
  resolveWallBrightnessTarget,
  type WallAnchoredGains,
  type WallBrightness,
} from "./awb";
import {
  estimateRectifiedAspect,
  homographyForCorners,
  warpPerspectiveNearest,
} from "./homography";
import { planArtworkRectification, type EdgeNudges } from "./rectifyArtwork";
import { renderRectifiedYielding } from "./geometry.worker";
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
  /**
   * Bezel width as a fraction of the shorter output edge. `0` or
   * omitted is a tight crop: the engine still adds the standard
   * studio margin (`STANDARD_STUDIO_BEZEL`) so the staged shadow
   * has wall to fall on. The margin is not taken from the photo.
   */
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
   * Where `targetAspect` came from. Estimated when the engine derives
   * it from the corner lengths.
   */
  aspectSource?: "artwork_dimensions" | "user" | "estimated";
  /**
   * Kept for the existing wizard. `auto`, `off`, and `adjust` all crop
   * with the four-corner homography. A bow coefficient does not move
   * pixels. Omitted means `auto` whenever corners are present.
   * Silhouette callers leave corners null, so this never runs there.
   */
  edgeCurvature?: "auto" | "off" | "adjust";
  /** Accepted from the wizard. Not applied to pixels. */
  edgeCurvatureK1?: number | null;
  /** Accepted from the wizard. Not applied to pixels. */
  edgeNudges?: EdgeNudges | null;
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
    /**
     * 2026-10-02 — partial white-balance strength in [0,1]. The
     * computed per-channel gains are blended toward identity by this
     * factor before they are applied AND persisted (see
     * `dampenAwbGain`). `1` (or omitted) = full strength, byte-identical
     * with every pre-2026-10-02 recipe. The "선명 보정" capture mode
     * passes `0.5` so a warm artwork tone survives while severe casts
     * are still eased; "원본 색감" leaves AWB disabled entirely.
     */
    strength?: number;
  };
  /**
   * F2 (2026-08-10) — matte white target selector. Threads a
   * user-facing chip ("soft" | "normal" | "bright") through to:
   *   - `computeWallAnchoredGains(..., { target })` so the sampled
   *     wall's median lands on the chosen luma (245 / 243 / 252;
   *     see WALL_BRIGHTNESS_TARGETS — `normal` moved back to 243 in
   *     2026-10-01 bulk-claim-5),
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
  /** Geometry actually applied. Absent on the silhouette and legacy paths. */
  geometryStatus?: GeometryRecipe["status"];
  engineVersion?: string;
};

const DEFAULT_MAX_LONG_EDGE = 4096;
/** Even studio margin around the artwork, as a fraction of the short edge.
 *  Keeps the artwork's own aspect — this is padding, not a canvas crop.
 *  A tight crop (bezel 0 / omitted) uses this same margin. */
export const STANDARD_STUDIO_BEZEL = STUDIO_BEZEL_FRACTION;
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
 * 2026-10-01 bulk-claim-4 helper.
 *
 * Sample the median RGB of pixels sitting OUTSIDE the user's four
 * corners (the wall) but inside the working buffer. The rectangle
 * path uses this as the white-balance reference after the wall has
 * been left out of the artwork. It does not repaint those pixels.
 *
 * Uses a deterministic 2000-sample stride walk over the crop pixels so
 * the result is reproducible for a given input (useful for
 * recipe-replay snapshots). Winding-number point-in-polygon test is
 * cheap and robust against the arbitrary CW/CCW ordering of the user's
 * quad.
 */
function sampleWallRefOutsideQuad(
  src: ImageData,
  quad: [[number, number], [number, number], [number, number], [number, number]],
): { r: number; g: number; b: number } | null {
  const total = src.width * src.height;
  if (total < 64) return null;
  const budget = 2000;
  const step = Math.max(1, Math.floor(total / budget));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let p = 0; p < total; p += step) {
    const x = p % src.width;
    const y = (p / src.width) | 0;
    if (pointInQuad(x + 0.5, y + 0.5, quad)) continue;
    const i = p * 4;
    rs.push(src.data[i]);
    gs.push(src.data[i + 1]);
    bs.push(src.data[i + 2]);
  }
  if (rs.length < 64) return null;
  const med = (xs: number[]): number => {
    const sorted = xs.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length & 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return { r: med(rs), g: med(gs), b: med(bs) };
}

function opaqueRatio(data: Uint8ClampedArray): number {
  const pixels = data.length / 4;
  if (pixels <= 0) return 0;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 16) n += 1;
  return n / pixels;
}

function fallbackWarp(
  src: ImageData,
  corners: [[number, number], [number, number], [number, number], [number, number]],
  requestedAspect: number | null,
  longEdge: number,
): ImageData | null {
  const targetAspect = requestedAspect ?? estimateRectifiedAspect(corners);
  let warpOutW: number;
  let warpOutH: number;
  if (targetAspect >= 1) {
    warpOutW = longEdge;
    warpOutH = Math.max(1, Math.round(longEdge / targetAspect));
  } else {
    warpOutH = longEdge;
    warpOutW = Math.max(1, Math.round(longEdge * targetAspect));
  }
  const H = homographyForCorners(corners, warpOutW, warpOutH);
  if (!H) return null;
  return warpPerspectiveNearest(src, H, warpOutW, warpOutH);
}

/** Winding-number point-in-polygon for a 4-vertex quad. */
function pointInQuad(
  x: number,
  y: number,
  quad: [[number, number], [number, number], [number, number], [number, number]],
): boolean {
  let wn = 0;
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % 4];
    if (ay <= y) {
      if (by > y) {
        const cross = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
        if (cross > 0) wn += 1;
      }
    } else if (by <= y) {
      const cross = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
      if (cross < 0) wn -= 1;
    }
  }
  return wn !== 0;
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

  // A tight sol crop passes 0. That is not "no wall" — stage the
  // same margin the install image uses, and persist it so later
  // brightness does not repaint the shadow.
  const bezel =
    typeof input.bezel === "number" && Number.isFinite(input.bezel) && input.bezel > 0
      ? Math.min(0.1, input.bezel)
      : STANDARD_STUDIO_BEZEL;
  const sharpen =
    typeof input.sharpen === "number" && Number.isFinite(input.sharpen)
      ? Math.min(1, Math.max(0, input.sharpen))
      : DEFAULT_SHARPEN;
  const tone = {
    b: clampTone(input.tone?.b ?? 1, ENHANCEMENT_TONE_CAP),
    c: clampTone(input.tone?.c ?? 1, ENHANCEMENT_TONE_CAP),
    s: clampTone(input.tone?.s ?? 1, ENHANCEMENT_TONE_CAP),
  };
  // Corners stay where sol or the artist put them. The crop is the
  // homography of those four points. The rectangle path does not walk
  // inward recoloring wall-like pixels.
  const warpCorners = input.sourceCorners ?? null;
  const cropNormalized = normalizeCropFromCorners(warpCorners, input.crop);

  const proLookEnabled = input.proLook?.enabled === true;
  // F2 (2026-08-10) — user-supplied wall brightness target. When
  // omitted we stay on the historical `MATTE_WHITE_POINT` (243) so
  // bulk / legacy callers keep replaying identically. The wizard
  // supplies `normal` (243 as of 2026-10-01 bulk-claim-5) by default.
  const wallBrightnessTarget = resolveWallBrightnessTarget(input.wallBrightness);
  const wallBrightnessSupplied = typeof input.wallBrightness === "string";
  const proLookRecipeIn: (ProLookRecipe & { enabled?: boolean }) | undefined =
    wallBrightnessSupplied
      ? {
          ...(input.proLook ?? {}),
          // Cap = target + 5, clamped 0..255. When the user chose
          // "bright" (252) we allow the top end to reach 255; "normal"
          // (243) yields 248; "soft" (245) yields 250 (same as
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
  let geometryRecipe: GeometryRecipe | undefined;
  let geometryExcludedWall = false;
  let pinnedWall: { r: number; g: number; b: number } | null = null;

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
    ...(geometryRecipe ? { geometry: geometryRecipe } : {}),
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
    ...(geometryRecipe
      ? { geometryStatus: geometryRecipe.status, engineVersion: GEOMETRY_ENGINE_VERSION }
      : {}),
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
  // Keep a band around the corner box so an outward bow is still in
  // the buffer. The output long edge stays the corner box, not the band.
  const searchMargin = warpCorners
    ? Math.max(12, Math.round(Math.min(cropPxW, cropPxH) * 0.08))
    : 0;
  const readX = Math.max(0, cropPxX - searchMargin);
  const readY = Math.max(0, cropPxY - searchMargin);
  const readR = Math.min(srcW, cropPxX + cropPxW + searchMargin);
  const readB = Math.min(srcH, cropPxY + cropPxH + searchMargin);
  const readW = Math.max(1, readR - readX);
  const readH = Math.max(1, readB - readY);
  const longestCropEdge = Math.max(cropPxW, cropPxH);
  const scale = longestCropEdge > maxLongEdge ? maxLongEdge / longestCropEdge : 1;
  const outW = Math.max(1, Math.round(readW * scale));
  const outH = Math.max(1, Math.round(readH * scale));

  if (isAborted()) return bail("aborted");

  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  try {
    const bitmap = await decodeOrientedRegion(
      input.file,
      readX,
      readY,
      readW,
      readH,
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

  const requestedAspect =
    typeof input.targetAspect === "number" &&
    Number.isFinite(input.targetAspect) &&
    input.targetAspect > 0
      ? input.targetAspect
      : null;
  let workW = outW;
  let workH = outH;
  if (warpCorners) {
    try {
      const twarp = performance.now();
      const srcData = ctx.getImageData(0, 0, outW, outH);
      const scaleX = outW / readW;
      const scaleY = outH / readH;
      const pxCorners: [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ] = [
        [(warpCorners[0][0] * srcW - readX) * scaleX, (warpCorners[0][1] * srcH - readY) * scaleY],
        [(warpCorners[1][0] * srcW - readX) * scaleX, (warpCorners[1][1] * srcH - readY) * scaleY],
        [(warpCorners[2][0] * srcW - readX) * scaleX, (warpCorners[2][1] * srcH - readY) * scaleY],
        [(warpCorners[3][0] * srcW - readX) * scaleX, (warpCorners[3][1] * srcH - readY) * scaleY],
      ];
      pinnedWall = sampleWallRefOutsideQuad(srcData, pxCorners);
      const longEdge = Math.max(1, Math.round(longestCropEdge * scale));
      const plan = planArtworkRectification({
        raster: { data: srcData.data, width: outW, height: outH },
        corners: pxCorners,
        frame: {
          width: srcW,
          height: srcH,
          originX: readX,
          originY: readY,
          scaleX,
          scaleY,
        },
        mode: input.edgeCurvature ?? "auto",
        manualK1: input.edgeCurvature === "adjust" ? input.edgeCurvatureK1 ?? null : null,
        nudges: input.edgeCurvature === "adjust" ? input.edgeNudges ?? null : null,
        targetAspect: requestedAspect,
        aspectSource: input.aspectSource ?? (requestedAspect ? "user" : "estimated"),
        longEdge,
      });
      const rendered = await renderRectifiedYielding({
        raster: { data: srcData.data, width: outW, height: outH },
        plan,
        frame: {
          width: srcW,
          height: srcH,
          originX: readX,
          originY: readY,
          scaleX,
          scaleY,
        },
        signal,
      });
      if (rendered === "aborted") return bail("aborted");
      const covered = opaqueRatio(rendered.data);
      if (covered >= 0.9) {
        geometryRecipe = plan.recipe;
        geometryExcludedWall =
          plan.recipe.status === "applied" &&
          (plan.recipe.method === "radial" ||
            plan.recipe.method === "boundary_traced" ||
            plan.recipe.method === "boundary_manual");
        const rectifiedSurface = makeCanvas(rendered.width, rendered.height);
        canvas = rectifiedSurface.canvas;
        ctx = rectifiedSurface.ctx;
        const image = new ImageData(rendered.width, rendered.height);
        image.data.set(rendered.data);
        ctx.putImageData(image, 0, 0);
        workW = rendered.width;
        workH = rendered.height;
      } else {
        geometryRecipe = {
          ...plan.recipe,
          status: "needs_review",
          diagnostics: { ...plan.recipe.diagnostics, reason: "uncovered" },
        };
        const fallback = fallbackWarp(srcData, pxCorners, requestedAspect, longEdge);
        if (fallback) {
          const rectifiedSurface = makeCanvas(fallback.width, fallback.height);
          canvas = rectifiedSurface.canvas;
          ctx = rectifiedSurface.ctx;
          ctx.putImageData(fallback, 0, 0);
          workW = fallback.width;
          workH = fallback.height;
        }
      }
      stageTimings.warpMs = Math.max(0, Math.round(performance.now() - twarp));
    } catch {
      // Singular geometry falls back to the decoded crop. No inward
      // wall repaint on that path either.
    }
  }

  if (isAborted()) return bail("aborted");

  let processed: ImageData;
  // A Photoroom cutout still has alpha. Clear pixels are not black
  // while tone runs, or the edge picks up a dark halo. The studio
  // wall is painted after color from that alpha. Locking the matte
  // here would flatten the silhouette.
  const preColor = ctx.getImageData(0, 0, workW, workH);
  const cutoutSubject = prepareCutoutForColor(preColor.data);
  if (cutoutSubject) ctx.putImageData(preColor, 0, 0);
  // Captured before tone / Pro Look. Those passes shift the matte
  // off #f3f3f3, so the mask cannot be rebuilt afterwards.
  const lockedMatte =
    !cutoutSubject && bezel === 0
      ? galleryMatteMask(ctx.getImageData(0, 0, workW, workH).data, workW, workH)
      : null;
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
    if (awbEnabled && geometryExcludedWall) {
      const tawb = performance.now();
      if (pinnedWall) {
        const sample = ctx.getImageData(0, 0, workW, workH);
        const awbStrength = input.awb?.strength ?? 1;
        const anchored = gainsFromWallMedian(
          pinnedWall,
          wallBrightnessSupplied ? wallBrightnessTarget : undefined,
        );
        awbRecipe = {
          rMul: dampenAwbGain(anchored.r, awbStrength),
          gMul: dampenAwbGain(anchored.g, awbStrength),
          bMul: dampenAwbGain(anchored.b, awbStrength),
          source: "wall-biased",
        };
        applyAwb(sample.data, awbRecipe);
        ctx.putImageData(sample, 0, 0);
      }
      stageTimings.awbMs = Math.max(0, Math.round(performance.now() - tawb));
    } else if (awbEnabled) {
      const tawb = performance.now();
      const sample = ctx.getImageData(0, 0, workW, workH);
      // 2026-10-02 — partial white-balance strength. Omitted / 1 keeps
      // the historical full-strength gains (byte-identical replay); the
      // "선명 보정" mode passes 0.5 so the correction eases casts without
      // neutralizing the artist's intended warm tone. Applied to both
      // the anchored and gray-world paths, and to the PERSISTED gains so
      // recipe replay matches what the viewer saw.
      const awbStrength = input.awb?.strength ?? 1;
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
            // lifts the whole wall by ~9 luma vs "normal" (243).
            // When the caller didn't supply `wallBrightness` this
            // stays at 243 (MATTE_WHITE_POINT).
            ...(wallBrightnessSupplied ? { target: wallBrightnessTarget } : {}),
          },
        );
      }
      if (anchored) {
        awbRecipe = {
          rMul: dampenAwbGain(anchored.r, awbStrength),
          gMul: dampenAwbGain(anchored.g, awbStrength),
          bMul: dampenAwbGain(anchored.b, awbStrength),
          // AwbRecipe.source is a compact enum shared with the DB
          // schema; the new anchored variants still fit under
          // "wall-biased" (the wall is the reference in both paths).
          // The tighter provenance (auto vs pick, area fraction) lives
          // in metering, not the persisted recipe.
          source: "wall-biased",
        };
        applyAwb(sample.data, awbRecipe);
      } else {
        const estimated = estimateAwb({
          data: sample.data,
          width: workW,
          height: workH,
          rectangle: input.awb?.rectangle ?? null,
          rectangleConfidence: input.awb?.rectangleConfidence,
        });
        awbRecipe = {
          ...estimated,
          rMul: dampenAwbGain(estimated.rMul, awbStrength),
          gMul: dampenAwbGain(estimated.gMul, awbStrength),
          bMul: dampenAwbGain(estimated.bMul, awbStrength),
        };
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
    if (lockedMatte) restoreGalleryMatte(processed.data, lockedMatte);
    ctx.putImageData(processed, 0, 0);
  } catch {
    return bail("decode_failed");
  }

  if (isAborted()) return bail("aborted");

  // After color: place the tight crop on #f3f3f3 and stage one studio
  // shadow from its alpha. Not sampled from the photograph. Rectangle
  // and Photoroom share this pass, so brightness, contrast, and
  // saturation do not move the wall or the shadow. The rectangle path
  // does not paint #f3f3f3 inward, so a thread fringe is not sliced
  // into a hard cut. A zero bezel was already raised to the standard
  // margin above.
  const bezelPx = Math.round(bezel * Math.min(workW, workH));
  let blob: Blob | null;
  try {
    const t0 = performance.now();
    const subject = ctx.getImageData(0, 0, workW, workH);
    const presented = compositeStudioPresentation(subject.data, workW, workH, bezelPx);
    const { canvas: matCanvas, ctx: matCtx } = makeCanvas(presented.width, presented.height);
    const presentedImage = new ImageData(presented.width, presented.height);
    presentedImage.data.set(presented.data);
    matCtx.putImageData(presentedImage, 0, 0);
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
      ...(geometryRecipe
        ? { geometryStatus: geometryRecipe.status, engineVersion: GEOMETRY_ENGINE_VERSION }
        : {}),
    };
  }
  return {
    blob,
    recipe: buildRecipe(),
    latencyMs: latency,
    confidence: 1,
    stageTimings,
    ...(awbRecipe ? { awb: awbRecipe } : {}),
    ...(geometryRecipe
      ? { geometryStatus: geometryRecipe.status, engineVersion: GEOMETRY_ENGINE_VERSION }
      : {}),
  };
}

/**
 * Convert a `Blob` produced by `runFlatEnhancement` into a `File` the
 * upload pipeline expects. Preserves the original stem, swaps the
 * extension to `.webp`, marks the mime as `image/webp`.
 */
/**
 * Preview of a Photoroom alpha cutout on the same studio wall the
 * rectangle uses. Color is applied later, in `runFlatEnhancement`,
 * which paints this wall again after tone.
 */
export async function presentCutoutOnStudioWall(file: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap === "undefined") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;
    const { ctx } = makeCanvas(w, h);
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
    try {
      bitmap.close();
    } catch {
      /* older browsers */
    }
    const image = ctx.getImageData(0, 0, w, h);
    const presented = compositeStudioPresentation(
      image.data,
      w,
      h,
      Math.round(STANDARD_STUDIO_BEZEL * Math.min(w, h)),
    );
    const out = makeCanvas(presented.width, presented.height);
    const presentedImage = new ImageData(presented.width, presented.height);
    presentedImage.data.set(presented.data);
    out.ctx.putImageData(presentedImage, 0, 0);
    return canvasToBlob(out.canvas, "image/webp", 0.9);
  } catch {
    return null;
  }
}

export function flatBlobToFile(originalName: string, blob: Blob): File {
  const stem = originalName.replace(/\.[^./\\]+$/, "") || "enhanced";
  return new File([blob], `${stem}.enhanced.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
}
