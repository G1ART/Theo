/**
 * Theo Image Enhance (Beta) — Auto White Balance (gray-world + wall-biased).
 *
 * 2026-08-06 audit follow-up. The prior local pipeline lacked any
 * white-balance step, so phone-shot artworks under tungsten / mixed
 * lighting kept their yellow cast even after tone + sharpen. This
 * module estimates a per-channel gain that pushes the "average color"
 * toward gray — but with two safeguards so we never neutralize a
 * legitimately colored artwork:
 *
 *   1. Multipliers are clamped to `[MIN_MUL, MAX_MUL]` = `[0.7, 1.4]`.
 *      A monochrome red painting has R̄ ≫ Ḡ ≈ B̄; gray-world would
 *      pull R down 0.3× (turning it gray). The clamp caps that at
 *      0.7×, leaving the painting visibly red just slightly warmed.
 *   2. When the analyzer reports a flat framed work with confident
 *      rectangle borders (`rectangleConfidence ≥ 0.55`), we prefer a
 *      wall-biased estimate that samples ONLY the pixels outside the
 *      rect (wall, not artwork). That region is a much better neutral
 *      reference than mixed subject pixels — a viridian painting with
 *      a white wall around it gets balanced against the wall, not
 *      against its own dominant hue.
 *
 * The module is pure — no DOM, no Canvas API access — so it runs in
 * both browser and Node/tsx tests. Callers provide an already-sampled
 * downscaled RGBA buffer (typically the same 256-long-edge sample the
 * analyzer uses).
 */

export type AwbSource = "gray-world" | "wall-biased";

export type AwbMultipliers = {
  rMul: number;
  gMul: number;
  bMul: number;
  source: AwbSource;
};

export type AwbEstimateInput = {
  /** RGBA data of a downscaled sample. Callers should aim for a
   *  256-long-edge canvas so this stays under ~1ms even on mid-tier
   *  phones. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Normalized [0,1] rectangle of the artwork inside the frame, if
   *  the analyzer detected one with high confidence. When present we
   *  sample the OUTSIDE (wall). When absent we fall back to whole-frame
   *  gray-world. */
  rectangle?: { x: number; y: number; w: number; h: number } | null;
  /** Rectangle confidence [0,1]. Below this threshold we don't trust
   *  the mask and fall back to gray-world. Default 0.55 matches the
   *  analyzer's own `flat` threshold. */
  rectangleConfidenceThreshold?: number;
  /** The reported rectangleConfidence value from the analyzer. */
  rectangleConfidence?: number;
};

export const AWB_MUL_MIN = 0.7;
export const AWB_MUL_MAX = 1.4;

/**
 * 2026-08-09 relaxed clamps for the wall-biased branch. Warm indoor
 * lighting on a truly-neutral wall would otherwise get pulled full
 * ±30 % toward gray and strip the room feel; a narrower ±15 % window
 * preserves the warm cast while still fixing bad phone AWB. Gray-world
 * fallback keeps the wider [0.7, 1.4] window since it has less prior
 * information to work with.
 */
export const AWB_WALL_MUL_MIN = 0.85;
export const AWB_WALL_MUL_MAX = 1.25;

/**
 * Gallery reference matte white (G4, 2026-08-10). #f3f3f3 —
 * the muted matte the user's professional Lightroom+Photoshop
 * workflow uses as the wall-reference point. We anchor to THIS,
 * not (255, 255, 255), so a neutral wall never clips to sterile
 * pure white and the piece retains room feel. Sourced from the
 * user's professional workflow PDF; not a rendering background —
 * a purely numeric tone target.
 */
export const MATTE_WHITE_POINT = { r: 243, g: 243, b: 243 } as const;

/**
 * Convenience: MATTE_WHITE_POINT.g / 255, expressed as a linear-luma
 * fraction. proLook's adaptive exposure caps highlight targets here.
 */
export const MATTE_WHITE_POINT_LUMA = 243;

/** Gains produced by `computeWallAnchoredGains` (G1). Named
 *  `WallAnchoredGains` to keep it separate from `AwbMultipliers`,
 *  which represents the whole-image gray-world path. */
export type WallAnchoredGains = {
  r: number;
  g: number;
  b: number;
  source: "wall-auto" | "wall-pick";
  /** Fraction of the sampled buffer that belonged to the wall region.
   *  Callers surface this in metering / UI. */
  areaFraction: number;
};

function clampMul(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(max, Math.max(min, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Compute gray-world multipliers over a rectangular region. When
 * `insideRect` is provided we skip pixels inside the rect (wall
 * sampling). When it is null we take every pixel (whole-frame
 * gray-world).
 *
 * Returns `null` when the sampled region has < 32 pixels — too few
 * for a stable estimate — so callers can fall back gracefully.
 */
function estimateChannelMeans(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  excludeRect: { x0: number; y0: number; x1: number; y1: number } | null,
): { r: number; g: number; b: number } | null {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (excludeRect) {
        if (
          x >= excludeRect.x0 &&
          x < excludeRect.x1 &&
          y >= excludeRect.y0 &&
          y < excludeRect.y1
        ) {
          continue;
        }
      }
      const i = (y * width + x) * 4;
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
      count += 1;
    }
  }
  if (count < 32) return null;
  return { r: sumR / count, g: sumG / count, b: sumB / count };
}

/**
 * Gray-world estimation with an optional wall-biased mode.
 *
 * Algorithm:
 *   1. If a confident rectangle is provided, sample only the
 *      outside-of-rect (wall) pixels. Otherwise, sample the whole frame.
 *   2. Compute per-channel means R̄, Ḡ, B̄.
 *   3. Target = (R̄ + Ḡ + B̄) / 3.
 *   4. mul_c = target / c̄ for each channel, clamped to [0.7, 1.4].
 */
export function estimateAwb(input: AwbEstimateInput): AwbMultipliers {
  const { data, width, height, rectangle, rectangleConfidence } = input;
  const threshold = input.rectangleConfidenceThreshold ?? 0.55;

  let source: AwbSource = "gray-world";
  let means: { r: number; g: number; b: number } | null = null;

  if (
    rectangle &&
    typeof rectangleConfidence === "number" &&
    rectangleConfidence >= threshold
  ) {
    const x0 = Math.max(0, Math.floor(rectangle.x * width));
    const y0 = Math.max(0, Math.floor(rectangle.y * height));
    const x1 = Math.min(width, Math.ceil((rectangle.x + rectangle.w) * width));
    const y1 = Math.min(height, Math.ceil((rectangle.y + rectangle.h) * height));
    if (x1 > x0 && y1 > y0) {
      means = estimateChannelMeans(data, width, height, { x0, y0, x1, y1 });
      if (means) source = "wall-biased";
    }
  }

  if (!means) {
    means = estimateChannelMeans(data, width, height, null);
  }

  if (!means) {
    // Degenerate input — return identity.
    return { rMul: 1, gMul: 1, bMul: 1, source };
  }

  // A near-black region (e.g. all wall pixels are shadowed) yields
  // near-zero means; guard the divisions.
  const eps = 4;
  const r = Math.max(eps, means.r);
  const g = Math.max(eps, means.g);
  const b = Math.max(eps, means.b);
  const target = (r + g + b) / 3;
  const minMul = source === "wall-biased" ? AWB_WALL_MUL_MIN : AWB_MUL_MIN;
  const maxMul = source === "wall-biased" ? AWB_WALL_MUL_MAX : AWB_MUL_MAX;
  const rMul = clampMul(target / r, minMul, maxMul);
  const gMul = clampMul(target / g, minMul, maxMul);
  const bMul = clampMul(target / b, minMul, maxMul);

  return {
    rMul: round3(rMul),
    gMul: round3(gMul),
    bMul: round3(bMul),
    source,
  };
}

/**
 * G1 (2026-08-10) — Wall-anchored white balance.
 *
 * Instead of pulling the average color of the frame toward gray
 * (`estimateAwb`), this samples pixels the user's professional
 * workflow would treat as the "reference matte" — a bright,
 * near-neutral region touching one of the four image edges (auto)
 * or a user-picked 32×32 patch (manual) — and derives per-channel
 * gains that map the wall's median RGB onto `MATTE_WHITE_POINT`
 * (#f3f3f3 = 243/255).
 *
 * Anchoring to (243, 243, 243) — NOT (255, 255, 255) — is the
 * hinge of the gallery look: pure white makes the wall feel
 * sterile / clipped; a slight roll-off preserves paper-in-a-room
 * texture. The constant is the same one referenced by the user's
 * Lightroom+Photoshop PDF.
 *
 * Callers can:
 *   - Provide `sampleRegion` (typically the user's click point,
 *     wrapped to a 32×32 patch clamped inside the image) → source
 *     is `wall-pick`.
 *   - Omit `sampleRegion` → the module auto-detects the largest
 *     connected edge-touching region of near-neutral bright pixels.
 *     Source is `wall-auto`.
 *
 * Returns `null` (= "no wall found") when:
 *   - The sample region is empty / too small (< 32 pixels), OR
 *   - The auto-detected region is < 3 % of the image, OR
 *   - The region's luminance stddev > 20 (i.e., it's textured, not
 *     a flat wall — think patterned wallpaper).
 * Callers are expected to fall back to `estimateAwb` in that case.
 *
 * Per-channel gains are clamped to `[AWB_MUL_MIN, AWB_MUL_MAX]`
 * (0.7 .. 1.4) so a dim shot on a genuine grey wall never blows out
 * to full 243 in one hop.
 */

/** Median of a plain number[] via in-place partial sort. */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = nums.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length & 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function rgbRange(r: number, g: number, b: number): number {
  const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
  const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
  return mx - mn;
}

/**
 * Auto-detect the wall region. Returns the flat-indexed pixel list
 * (index into `width*height` grid, not the RGBA byte offset) plus
 * per-pixel luminance stats over the region. `null` when no region
 * meets the size + uniformity gate.
 */
function autoDetectWallRegion(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { pixels: Uint32Array; lumStddev: number; areaFraction: number } | null {
  const n = width * height;
  if (n < 64) return null;
  const lum = new Float32Array(n);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    // Rec.601 luma proxy — matches the rest of the analyzer.
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  // Top-40 % luminance threshold from the sorted copy (partitioning
  // would be marginally faster on huge images, but at 256×256 the
  // sort is < 5 ms and simpler to reason about).
  const sorted = Float32Array.from(lum);
  sorted.sort();
  const t60Idx = Math.floor(sorted.length * 0.6);
  const lumThreshold = sorted[t60Idx];

  const qualifies = new Uint8Array(n);
  // Chroma proxy: RGB range < 12 (u8) ≈ CIELAB chroma < ~6 for
  // bright pixels. Cheap, avoids a full sRGB → Lab conversion.
  const CHROMA_RANGE_MAX = 12;
  for (let y = 0, p = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, p += 1) {
      const i = p * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (lum[p] >= lumThreshold && rgbRange(r, g, b) < CHROMA_RANGE_MAX) {
        qualifies[p] = 1;
      }
    }
  }

  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);
  const reachable = new Uint32Array(n);
  let reachableCount = 0;
  let stackTop = 0;

  const push = (idx: number) => {
    if (idx < 0 || idx >= n) return;
    if (visited[idx] || !qualifies[idx]) return;
    stack[stackTop++] = idx;
    visited[idx] = 1;
  };

  // Seed from every edge-touching qualifying pixel; flood inward.
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + (width - 1));
  }
  while (stackTop > 0) {
    const p = stack[--stackTop];
    reachable[reachableCount++] = p;
    const x = p % width;
    const y = (p / width) | 0;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }

  const areaFraction = reachableCount / n;
  if (areaFraction < 0.03) return null;

  // Uniformity gate — a "wall" should be nearly flat in luminance.
  let sumL = 0;
  let sumL2 = 0;
  for (let i = 0; i < reachableCount; i += 1) {
    const l = lum[reachable[i]];
    sumL += l;
    sumL2 += l * l;
  }
  const meanL = sumL / reachableCount;
  const varL = Math.max(0, sumL2 / reachableCount - meanL * meanL);
  const lumStddev = Math.sqrt(varL);
  if (lumStddev > 20) return null;

  return { pixels: reachable.subarray(0, reachableCount), lumStddev, areaFraction };
}

/**
 * Sample the median RGB across the given rectangle (byte-clamped
 * to the image). Returns `null` when the intersection has < 32
 * pixels (too small to be a stable estimate — the callers gate
 * on this).
 */
function sampleRegionMedian(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  region: { x: number; y: number; w: number; h: number },
): { medianR: number; medianG: number; medianB: number; areaFraction: number } | null {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(width, Math.ceil(region.x + region.w));
  const y1 = Math.min(height, Math.ceil(region.y + region.h));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const count = w * h;
  if (count < 32) return null;
  const rs = new Array<number>(count);
  const gs = new Array<number>(count);
  const bs = new Array<number>(count);
  let k = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      rs[k] = data[i];
      gs[k] = data[i + 1];
      bs[k] = data[i + 2];
      k += 1;
    }
  }
  return {
    medianR: median(rs),
    medianG: median(gs),
    medianB: median(bs),
    areaFraction: count / (width * height),
  };
}

export type ComputeWallAnchoredInput = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type ComputeWallAnchoredOptions = {
  /**
   * When provided, the caller has pinpointed the wall (typically a
   * 32×32 patch centered on the user's click). We sample this rect,
   * clamped inside the image, and skip auto-detection entirely.
   */
  sampleRegion?: { x: number; y: number; w: number; h: number };
};

export function computeWallAnchoredGains(
  input: ComputeWallAnchoredInput,
  opts: ComputeWallAnchoredOptions = {},
): WallAnchoredGains | null {
  const { data, width, height } = input;
  const target = MATTE_WHITE_POINT;

  const finalize = (
    medianR: number,
    medianG: number,
    medianB: number,
    source: WallAnchoredGains["source"],
    areaFraction: number,
  ): WallAnchoredGains => {
    const eps = 4;
    const r = Math.max(eps, medianR);
    const g = Math.max(eps, medianG);
    const b = Math.max(eps, medianB);
    return {
      r: round3(clampMul(target.r / r, AWB_MUL_MIN, AWB_MUL_MAX)),
      g: round3(clampMul(target.g / g, AWB_MUL_MIN, AWB_MUL_MAX)),
      b: round3(clampMul(target.b / b, AWB_MUL_MIN, AWB_MUL_MAX)),
      source,
      areaFraction: round3(areaFraction),
    };
  };

  if (opts.sampleRegion) {
    const s = sampleRegionMedian(data, width, height, opts.sampleRegion);
    if (!s) return null;
    return finalize(s.medianR, s.medianG, s.medianB, "wall-pick", s.areaFraction);
  }

  const region = autoDetectWallRegion(data, width, height);
  if (!region) return null;

  const rs = new Array<number>(region.pixels.length);
  const gs = new Array<number>(region.pixels.length);
  const bs = new Array<number>(region.pixels.length);
  for (let i = 0; i < region.pixels.length; i += 1) {
    const p = region.pixels[i] * 4;
    rs[i] = data[p];
    gs[i] = data[p + 1];
    bs[i] = data[p + 2];
  }
  return finalize(
    median(rs),
    median(gs),
    median(bs),
    "wall-auto",
    region.areaFraction,
  );
}

/**
 * Apply channel multipliers in-place on an RGBA buffer. Alpha is
 * preserved. Values are clamped into [0,255].
 */
export function applyAwb(
  data: Uint8ClampedArray,
  awb: Pick<AwbMultipliers, "rMul" | "gMul" | "bMul">,
): void {
  const r = awb.rMul;
  const g = awb.gMul;
  const b = awb.bMul;
  for (let i = 0; i < data.length; i += 4) {
    const nr = data[i] * r;
    const ng = data[i + 1] * g;
    const nb = data[i + 2] * b;
    data[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
    data[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
    data[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
  }
}
