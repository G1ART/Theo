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

function clampMul(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(AWB_MUL_MAX, Math.max(AWB_MUL_MIN, n));
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
  const rMul = clampMul(target / r);
  const gMul = clampMul(target / g);
  const bMul = clampMul(target / b);

  return {
    rMul: round3(rMul),
    gMul: round3(gMul),
    bMul: round3(bMul),
    source,
  };
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
