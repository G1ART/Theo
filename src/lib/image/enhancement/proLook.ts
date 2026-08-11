/**
 * Theo Image Enhance (Beta) — "Pro on white wall" pipeline (2026-08-06).
 *
 * Order of operations (documented at the top so anyone editing this
 * file understands the rationale):
 *
 *   1. adaptiveExposure   — anchor midtones around a target luma
 *      (default 118). Compute from histogram P5..P95 range so bright
 *      works don't clip and dark works don't crush.
 *      2026-08-09: exposure gain applied in LINEAR light (sRGB EOTF
 *      decode → gain → encode) plus a compact filmic soft shoulder
 *      so highlights roll off instead of clipping. Preserves the
 *      black point (0 stays 0) to keep dark works from muddy grey.
 *   2. wallAwareAwb       — supplied by `awb.ts`; called by the engine
 *      before this stage runs, but the recipe result is stored here
 *      for provenance. NO-OP inside `runProLook` — the engine has
 *      already applied it.
 *   3. localContrastClahe — 8×8 tile grid CLAHE approximation with
 *      clip limit 1.2 (down from 2.0 pre-2026-08-09 to avoid the
 *      "over-crunched" look reported by QA). Skipped on already-high-
 *      contrast sources (P95-P5 > 200) to avoid double-processing.
 *   4. perceptualSat      — luminance-weighted saturation boost in
 *      LINEAR light so shadows/highlights don't neonize. Capped at
 *      +9 %.
 *   5. microUnsharp       — 3×3 unsharp (halo-safe). Default amount
 *      dropped from 0.4 → 0.2 (2026-08-09) so line-art doesn't ring.
 *   6. neutralWarmBias    — gentle temperature nudge toward 5500K so
 *      the output feels like a daylight-balanced studio.
 *
 * All stages read/write directly on `ImageData`. All stages are
 * skippable via recipe flags. Timings are returned so the caller can
 * emit `stage_prolook_*_ms` metering.
 *
 * Reference standards (informational — none of the below are strict
 * requirements, but the tuning targets these envelopes):
 *   - FADGI 4-star guideline: neutral WB, ΔE ≤ 4 on X-Rite patches.
 *   - Metamorfoze: gentle tone curve, no highlight clipping.
 *   - ISO 19264-1 range B: color accuracy for cultural heritage.
 */

import type { ProLookRecipe } from "./types";
import { MATTE_WHITE_POINT_LUMA } from "./awb";

export type ProLookConfig = {
  exposureLumaTarget: number;
  claheEnabled: boolean;
  claheClipLimit: number;
  claheTiles: number;
  satBoost: number;
  warmthBias: number;
  unsharpAmount: number;
  /**
   * G3 (2026-08-10) — highlight compression amount [0..1]. Applied
   * before the unsharp stage to knock down the top 5 % of pixels so
   * glary shots don't blow out. Zero disables the stage.
   */
  highlightCompress?: number;
  /**
   * F2 (2026-08-10) — override the maximum output luma the adaptive
   * exposure pass will emit. The engine threads this through from
   * the user's wall-brightness chip so a "bright" (252) or "soft"
   * (245) matte target shifts the highlight roll-off in lockstep
   * with the AWB target. When omitted we fall back to the historical
   * cap of `MATTE_WHITE_POINT_LUMA + 7` (250).
   */
  whiteCapLuma?: number;
};

// 2026-08-09 Phase 2 defaults — see the header comment. Softer than
// the 2026-08-06 originals (satBoost 0.08 → 0.06, claheClipLimit 2.0
// → 1.2, warmthBias 0.03 → 0.02, unsharp 0.4 → 0.2) to land closer to
// FADGI/Metamorfoze envelopes for typical cultural-heritage capture.
export const PRO_LOOK_DEFAULTS: ProLookConfig = {
  exposureLumaTarget: 118,
  claheEnabled: true,
  claheClipLimit: 1.2,
  claheTiles: 8,
  satBoost: 0.06,
  warmthBias: 0.02,
  unsharpAmount: 0.2,
};

// ─── sRGB ↔ linear-light helpers ─────────────────────────────────
// Piecewise sRGB EOTF (IEC 61966-2-1). Cached as 256-entry LUTs so
// the hot inner loops don't call Math.pow per pixel.

const SRGB_TO_LINEAR_LUT = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return lut;
})();

export function srgbToLinear(u8: number): number {
  const i = u8 < 0 ? 0 : u8 > 255 ? 255 : u8 | 0;
  return SRGB_TO_LINEAR_LUT[i];
}

export function linearToSrgb(f: number): number {
  const x = f <= 0 ? 0 : f >= 1 ? 1 : f;
  const s = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/**
 * Compact ACES-style filmic tone curve. Maps linear-light [0..∞) into
 * [0..1) with a soft shoulder so bright highlights roll off instead of
 * clipping. Preserves the black point (0 → 0) so dark works don't
 * gain a muddy grey lift. See Krzysztof Narkowicz's 2016 "ACES
 * filmic tone mapping curve" post for the coefficient rationale.
 */
export function filmicToneCurve(x: number): number {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  const num = x * (a * x + b);
  const den = x * (c * x + d) + e;
  const y = num / den;
  return y <= 0 ? 0 : y >= 1 ? 1 : y;
}

export type ProLookTimings = {
  exposureMs: number;
  claheMs: number;
  satMs: number;
  sharpenMs: number;
  warmthMs: number;
};

export function resolveProLookConfig(recipe?: ProLookRecipe): ProLookConfig {
  if (!recipe) return { ...PRO_LOOK_DEFAULTS };
  return {
    exposureLumaTarget: recipe.exposureLumaTarget ?? PRO_LOOK_DEFAULTS.exposureLumaTarget,
    claheEnabled: recipe.claheEnabled ?? PRO_LOOK_DEFAULTS.claheEnabled,
    claheClipLimit: recipe.claheClipLimit ?? PRO_LOOK_DEFAULTS.claheClipLimit,
    claheTiles: recipe.claheTiles ?? PRO_LOOK_DEFAULTS.claheTiles,
    satBoost: recipe.satBoost ?? PRO_LOOK_DEFAULTS.satBoost,
    warmthBias: recipe.warmthBias ?? PRO_LOOK_DEFAULTS.warmthBias,
    // G3 (2026-08-10) — adaptive `unsharpAmount` + `highlightCompress`.
    // Recipe overrides win when present; otherwise the pre-adaptive
    // default holds.
    unsharpAmount: recipe.unsharpAmount ?? PRO_LOOK_DEFAULTS.unsharpAmount,
    highlightCompress: recipe.highlightCompress ?? 0,
    // F2 (2026-08-10) — undefined = keep legacy cap
    // (MATTE_WHITE_POINT_LUMA + 7 = 250). Wizard callers pass
    // `wallBrightnessTarget + 5` so a "bright" 252 chip yields a
    // 257→255 cap (no clipping headroom), and "soft" 245 yields
    // 250, matching the historical cap by coincidence.
    whiteCapLuma:
      typeof recipe.whiteCapLuma === "number" && Number.isFinite(recipe.whiteCapLuma)
        ? recipe.whiteCapLuma
        : undefined,
  };
}

/**
 * G3 highlight compression — reduce the top-5 % luminance pixels by
 * `amount` in linear light. Applied BEFORE unsharp so the unsharp
 * doesn't sharpen an already-clipped highlight. `amount` is a
 * fraction in [0, 0.4]; the pass is a no-op at 0. See
 * `proLook.tunables.ts` for the adaptive formula.
 */
export function highlightCompress(
  data: Uint8ClampedArray,
  amount: number,
): void {
  if (amount <= 0) return;
  const cap = Math.min(0.4, Math.max(0, amount));
  // Compute the 95th percentile luminance (u8) via a histogram.
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const y = luma(data[i], data[i + 1], data[i + 2]) | 0;
    hist[y < 0 ? 0 : y > 255 ? 255 : y] += 1;
  }
  const total = data.length / 4;
  const target = Math.round(total * 0.95);
  let acc = 0;
  let p95 = 255;
  for (let i = 0; i < 256; i += 1) {
    acc += hist[i];
    if (acc >= target) {
      p95 = i;
      break;
    }
  }
  if (p95 >= 255) return;
  // Reduce pixels above p95 by `cap` in LINEAR light — preserves
  // subtle textures instead of clipping.
  for (let i = 0; i < data.length; i += 4) {
    const y = luma(data[i], data[i + 1], data[i + 2]);
    if (y <= p95) continue;
    const rl = srgbToLinear(data[i]);
    const gl = srgbToLinear(data[i + 1]);
    const bl = srgbToLinear(data[i + 2]);
    const factor = 1 - cap;
    data[i] = linearToSrgb(rl * factor);
    data[i + 1] = linearToSrgb(gl * factor);
    data[i + 2] = linearToSrgb(bl * factor);
  }
}

// ─── Utilities ────────────────────────────────────────────────────

const REC709_R = 0.2126;
const REC709_G = 0.7152;
const REC709_B = 0.0722;

function luma(r: number, g: number, b: number): number {
  return REC709_R * r + REC709_G * g + REC709_B * b;
}

function clamp255(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Build a 256-bin luminance histogram. */
function histogram(data: Uint8ClampedArray): Uint32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const y = luma(data[i], data[i + 1], data[i + 2]) | 0;
    hist[y < 0 ? 0 : y > 255 ? 255 : y] += 1;
  }
  return hist;
}

/** Compute the P5..P95 luminance percentiles. Used by adaptive exposure
 *  and by CLAHE-skip detection. */
export function percentileRange(data: Uint8ClampedArray): { p5: number; p95: number } {
  const hist = histogram(data);
  const total = data.length / 4;
  const p5Target = Math.round(total * 0.05);
  const p95Target = Math.round(total * 0.95);
  let acc = 0;
  let p5 = 0;
  let p95 = 255;
  for (let i = 0; i < 256; i += 1) {
    acc += hist[i];
    if (p5 === 0 && acc >= p5Target) p5 = i;
    if (acc >= p95Target) {
      p95 = i;
      break;
    }
  }
  return { p5, p95 };
}

// ─── Stage 1: adaptive exposure (linear-light + filmic shoulder) ──
/**
 * Anchor the midtone luma toward `target`. 2026-08-09 rewrite: gain
 * is applied in LINEAR light (sRGB EOTF decode → multiply → re-encode)
 * so bright highlights don't crush. Above the linear knee the filmic
 * tone curve rolls off so we never hard-clip. Black point (0) is
 * preserved.
 *
 * Mid-anchored gain is computed from the P5..P95 luma band so the
 * long tails don't skew the target — the sRGB luma statistic is the
 * one we're already collecting for CLAHE-skip, so we keep the input
 * space consistent with the histogram helpers.
 */
export function adaptiveExposure(
  data: Uint8ClampedArray,
  target: number,
  capLumaOverride?: number,
): void {
  const { p5, p95 } = percentileRange(data);
  const total = data.length / 4;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const y = luma(data[i], data[i + 1], data[i + 2]);
    const yi = y | 0;
    if (yi >= p5 && yi <= p95) {
      sum += y;
      count += 1;
    }
  }
  if (count === 0 || total < 32) return;
  const mid = sum / count;
  if (mid < 4) return;
  // Cap gain to ±30 % so we never crush or blow the image. Applied in
  // linear light after the filmic curve so the numeric range still
  // reflects "how much brighter do we want the midtone?".
  const gain = Math.min(1.3, Math.max(0.7, target / mid));
  // G4 (2026-08-10) — never allow the final white point to exceed
  // (matte_target + 5) luminance. F2 (2026-08-10) parameterizes the
  // matte target so a "bright" wall (252) unlocks a 255 cap while
  // a "soft" wall (245) keeps the historical 250 cap. Legacy callers
  // (undefined) fall back to `MATTE_WHITE_POINT_LUMA + 7` (250) for
  // byte-identical replay of pre-F2 recipes.
  const capBase =
    typeof capLumaOverride === "number" && Number.isFinite(capLumaOverride)
      ? capLumaOverride
      : MATTE_WHITE_POINT_LUMA + 7;
  const cap = Math.min(255, capBase);
  for (let i = 0; i < data.length; i += 4) {
    const rl = srgbToLinear(data[i]) * gain;
    const gl = srgbToLinear(data[i + 1]) * gain;
    const bl = srgbToLinear(data[i + 2]) * gain;
    const rs = linearToSrgb(filmicToneCurve(rl));
    const gs = linearToSrgb(filmicToneCurve(gl));
    const bs = linearToSrgb(filmicToneCurve(bl));
    data[i] = rs > cap ? cap : rs;
    data[i + 1] = gs > cap ? cap : gs;
    data[i + 2] = bs > cap ? cap : bs;
  }
}

// ─── Stage 3: CLAHE-like local contrast ───────────────────────────
/**
 * Contrast-Limited Adaptive Histogram Equalization approximation.
 *
 * We build per-tile histograms of luminance, clip each histogram at
 * `clipLimit * mean(hist)`, redistribute the clipped mass, then
 * bilinearly interpolate the mapping across tile centers so tile
 * boundaries don't leave visible seams. Operates on luminance only;
 * chroma is preserved by scaling each channel by `newY / oldY`.
 *
 * Callers should skip this stage when the source is already
 * high-contrast (P95 - P5 > 200) — we return the buffer unchanged in
 * that case.
 */
export function claheLocalContrast(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tiles: number,
  clipLimit: number,
): void {
  if (tiles < 2 || width < 16 || height < 16) return;
  const tileW = Math.max(1, Math.floor(width / tiles));
  const tileH = Math.max(1, Math.floor(height / tiles));
  const nx = Math.ceil(width / tileW);
  const ny = Math.ceil(height / tileH);
  const maps = new Array<Uint8Array>(nx * ny);

  const buildMap = (tileHist: Uint32Array): Uint8Array => {
    // Clip at limit.
    const bins = 256;
    const total = tileHist.reduce((n, v) => n + v, 0);
    const mean = total / bins;
    const limit = Math.max(1, Math.floor(mean * clipLimit));
    let excess = 0;
    for (let i = 0; i < bins; i += 1) {
      if (tileHist[i] > limit) {
        excess += tileHist[i] - limit;
        tileHist[i] = limit;
      }
    }
    // Redistribute uniformly.
    const per = Math.floor(excess / bins);
    let remainder = excess - per * bins;
    for (let i = 0; i < bins; i += 1) {
      tileHist[i] += per;
      if (remainder > 0) {
        tileHist[i] += 1;
        remainder -= 1;
      }
    }
    // CDF → LUT.
    const lut = new Uint8Array(bins);
    let acc = 0;
    for (let i = 0; i < bins; i += 1) {
      acc += tileHist[i];
      lut[i] = Math.min(255, Math.round((acc / total) * 255));
    }
    return lut;
  };

  // Build per-tile histograms and LUTs.
  for (let ty = 0; ty < ny; ty += 1) {
    for (let tx = 0; tx < nx; tx += 1) {
      const x0 = tx * tileW;
      const y0 = ty * tileH;
      const x1 = Math.min(width, x0 + tileW);
      const y1 = Math.min(height, y0 + tileH);
      const hist = new Uint32Array(256);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * 4;
          const y0v = luma(data[i], data[i + 1], data[i + 2]) | 0;
          hist[y0v < 0 ? 0 : y0v > 255 ? 255 : y0v] += 1;
        }
      }
      maps[ty * nx + tx] = buildMap(hist);
    }
  }

  // Bilinear interpolation across tile centers.
  for (let y = 0; y < height; y += 1) {
    const fy = (y + 0.5) / tileH - 0.5;
    const ty0 = Math.max(0, Math.min(ny - 1, Math.floor(fy)));
    const ty1 = Math.max(0, Math.min(ny - 1, ty0 + 1));
    const wy = Math.max(0, Math.min(1, fy - ty0));
    for (let x = 0; x < width; x += 1) {
      const fx = (x + 0.5) / tileW - 0.5;
      const tx0 = Math.max(0, Math.min(nx - 1, Math.floor(fx)));
      const tx1 = Math.max(0, Math.min(nx - 1, tx0 + 1));
      const wx = Math.max(0, Math.min(1, fx - tx0));
      const i = (y * width + x) * 4;
      const yv = luma(data[i], data[i + 1], data[i + 2]) | 0;
      const yy = yv < 0 ? 0 : yv > 255 ? 255 : yv;
      const m00 = maps[ty0 * nx + tx0][yy];
      const m10 = maps[ty0 * nx + tx1][yy];
      const m01 = maps[ty1 * nx + tx0][yy];
      const m11 = maps[ty1 * nx + tx1][yy];
      const mapped =
        (1 - wy) * ((1 - wx) * m00 + wx * m10) +
        wy * ((1 - wx) * m01 + wx * m11);
      const scale = yv > 1 ? mapped / yv : 1;
      data[i] = clamp255(data[i] * scale);
      data[i + 1] = clamp255(data[i + 1] * scale);
      data[i + 2] = clamp255(data[i + 2] * scale);
    }
  }
}

// ─── Stage 4: perceptual saturation lift (linear-light) ───────────
/**
 * Add a small saturation lift, computed in LINEAR light so bright
 * saturated pixels don't blow. Shadows / highlights get a smaller lift
 * (weighted by `1 - |y - 128| / 128`) so blacks don't turn purple and
 * whites don't turn cyan. Cap raised from 0.08 → 0.09 in 2026-08-09
 * to keep the "strong" intensity chip visibly different from "normal".
 */
export function perceptualSaturation(data: Uint8ClampedArray, boost: number): void {
  if (boost <= 0) return;
  const b = Math.min(0.09, boost);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const bl = data[i + 2];
    const y = luma(r, g, bl);
    const shadowLift = 1 - Math.abs(y - 128) / 128;
    const s = 1 + b * shadowLift;
    const rl = srgbToLinear(r);
    const gl = srgbToLinear(g);
    const bll = srgbToLinear(bl);
    const yl = REC709_R * rl + REC709_G * gl + REC709_B * bll;
    data[i] = linearToSrgb(yl + (rl - yl) * s);
    data[i + 1] = linearToSrgb(yl + (gl - yl) * s);
    data[i + 2] = linearToSrgb(yl + (bll - yl) * s);
  }
}

// ─── Stage 5: micro unsharp (halo-safe) ────────────────────────────
export function microUnsharp(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
): void {
  if (amount <= 0 || width < 3 || height < 3) return;
  // 3×3 box blur → unsharp = original + amount * (original - blur).
  const src = new Uint8ClampedArray(data);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let rb = 0;
      let gb = 0;
      let bb = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          const p = ((y + ky) * width + (x + kx)) * 4;
          rb += src[p];
          gb += src[p + 1];
          bb += src[p + 2];
        }
      }
      rb /= 9;
      gb /= 9;
      bb /= 9;
      const p = (y * width + x) * 4;
      data[p] = clamp255(src[p] + amount * (src[p] - rb));
      data[p + 1] = clamp255(src[p + 1] + amount * (src[p + 1] - gb));
      data[p + 2] = clamp255(src[p + 2] + amount * (src[p + 2] - bb));
    }
  }
}

// ─── Stage 6: neutral warm bias (toward 5500K) ────────────────────
/**
 * Tiny channel gain: r+bias, b-bias. This is the "studio daylight"
 * feel — a monitored 5500K balance rather than the greenish cast phone
 * cameras sometimes leave after auto WB.
 */
export function neutralWarmBias(data: Uint8ClampedArray, bias: number): void {
  const b = Math.max(-0.1, Math.min(0.1, bias));
  if (Math.abs(b) < 0.001) return;
  const rGain = 1 + b;
  const bGain = 1 - b * 0.6;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp255(data[i] * rGain);
    data[i + 2] = clamp255(data[i + 2] * bGain);
  }
}

/**
 * Run the full pro-look pipeline on an ImageData buffer in-place.
 * `awb` handling lives in the engine (before proLook is called) since
 * it needs the analyzer rectangle. See `awb.ts`.
 *
 * Returns per-stage timings so the engine can emit `stage_prolook_*_ms`
 * telemetry.
 */
export function runProLook(
  image: ImageData,
  config: ProLookConfig,
): ProLookTimings {
  const timings: ProLookTimings = {
    exposureMs: 0,
    claheMs: 0,
    satMs: 0,
    sharpenMs: 0,
    warmthMs: 0,
  };
  const data = image.data;

  // Stage 1
  const t0 = now();
  adaptiveExposure(data, config.exposureLumaTarget, config.whiteCapLuma);
  timings.exposureMs = Math.max(0, Math.round(now() - t0));

  // Stage 3 — CLAHE (skip on already-high-contrast sources).
  const t1 = now();
  if (config.claheEnabled) {
    const { p5, p95 } = percentileRange(data);
    if (p95 - p5 <= 200) {
      claheLocalContrast(
        data,
        image.width,
        image.height,
        config.claheTiles,
        config.claheClipLimit,
      );
    }
  }
  timings.claheMs = Math.max(0, Math.round(now() - t1));

  // Stage 4
  const t2 = now();
  perceptualSaturation(data, config.satBoost);
  timings.satMs = Math.max(0, Math.round(now() - t2));

  // G3 (2026-08-10) — highlight compression runs BEFORE unsharp so
  // the unsharp mask doesn't amplify already-blown pixels. `amount`
  // is set by `resolveAdaptiveProLook` based on the analyzer's
  // glareScore; the pass is a fast no-op when 0.
  if (config.highlightCompress && config.highlightCompress > 0) {
    highlightCompress(data, config.highlightCompress);
  }

  // Stage 5 — micro unsharp. Amount pulled from config (default 0.2
  // as of 2026-08-09, down from the previous hardcoded 0.4 which was
  // producing haloing on high-contrast line art).
  const t3 = now();
  microUnsharp(data, image.width, image.height, config.unsharpAmount);
  timings.sharpenMs = Math.max(0, Math.round(now() - t3));

  // Stage 6
  const t4 = now();
  neutralWarmBias(data, config.warmthBias);
  timings.warmthMs = Math.max(0, Math.round(now() - t4));

  return timings;
}
