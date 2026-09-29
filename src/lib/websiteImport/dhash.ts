import sharp from "sharp";
import type { WebsiteImportCandidate } from "./types";

/**
 * 64-bit difference hash as 16 hex chars.
 *
 * Notes on robustness:
 *   - We `.rotate()` *before* resizing so EXIF orientation is honored.
 *     Without this, an iPhone photo that displays as portrait but is stored
 *     as landscape gets a different dHash than the displayed crop, and the
 *     downstream match silently fails.
 *   - We deliberately do not flatten or apply a colorspace — `.grayscale()`
 *     handles both alpha and color.
 */
export async function dhashFromImageBuffer(buf: Buffer): Promise<string> {
  const { data } = await sharp(buf, { failOnError: false })
    .rotate()
    .resize(9, 8, { fit: "cover", position: "centre" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return computeDhashFromGrayscale(data);
}

/**
 * Single-pass dHash + intrinsic dimensions. Re-decoding a JPEG/PNG twice
 * (once for dhash, once for `metadata()`) burns CPU and was a measured
 * bottleneck in the website-import scan path. This helper does both off the
 * same `sharp(buf)` instance using a side-branch for the metadata.
 *
 * `width` / `height` reflect the post-rotate orientation, matching what the
 * user actually sees in their browser, so dimension-similarity scoring is
 * consistent with how the artwork was uploaded.
 */
export async function dhashAndMetadataFromImageBuffer(
  buf: Buffer,
): Promise<{ dhash_hex: string; width?: number; height?: number }> {
  const pipeline = sharp(buf, { failOnError: false }).rotate();
  const metaPromise = pipeline.clone().metadata();
  const dataPromise = pipeline
    .clone()
    .resize(9, 8, { fit: "cover", position: "centre" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [meta, data] = await Promise.all([metaPromise, dataPromise]);
  return {
    dhash_hex: computeDhashFromGrayscale(data.data),
    width: meta.width,
    height: meta.height,
  };
}

function computeDhashFromGrayscale(data: Buffer): string {
  let hi = 0 >>> 0;
  let lo = 0 >>> 0;
  let i = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * 9 + x] ?? 0;
      const right = data[y * 9 + x + 1] ?? 0;
      const bit = left > right ? 1 : 0;
      if (i < 32) hi = ((hi << 1) | bit) >>> 0;
      else lo = ((lo << 1) | bit) >>> 0;
      i += 1;
    }
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

function popcount32(n: number): number {
  let x = n >>> 0;
  let c = 0;
  while (x) {
    c += x & 1;
    x >>>= 1;
  }
  return c;
}

export function hammingDistanceHex(a: string, b: string): number {
  const pa = a.padStart(16, "0").slice(-16);
  const pb = b.padStart(16, "0").slice(-16);
  const hiA = parseInt(pa.slice(0, 8), 16) >>> 0;
  const loA = parseInt(pa.slice(8, 16), 16) >>> 0;
  const hiB = parseInt(pb.slice(0, 8), 16) >>> 0;
  const loB = parseInt(pb.slice(8, 16), 16) >>> 0;
  return popcount32(hiA ^ hiB) + popcount32(loA ^ loB);
}

export function dimensionSimilarity(
  wa: number | undefined,
  ha: number | undefined,
  wb: number | undefined,
  hb: number | undefined,
): number {
  if (!wa || !ha || !wb || !hb) return 0;
  const ar = wa / Math.max(ha, 1);
  const br = wb / Math.max(hb, 1);
  const ratioDiff = Math.abs(ar - br) / Math.max(ar, br, 0.001);
  if (ratioDiff > 0.12) return -2;
  const scale = Math.min(wa, wb) / Math.max(wa, wb);
  if (scale < 0.35) return -1;
  return Math.min(1, scale);
}

/**
 * Stage B scoring: lower is better. `dimensionBonus` subtracts from effective hamming when aspect/size align.
 */
export function scoreMatch(
  hamming: number,
  dimBonus: number,
): { effective: number; hamming: number; dimension_bonus: number } {
  return {
    hamming,
    dimension_bonus: dimBonus,
    effective: hamming - dimBonus * 3,
  };
}

export function rankCandidatesForUpload(
  uploadHash: string,
  uploadW: number | undefined,
  uploadH: number | undefined,
  candidates: WebsiteImportCandidate[],
  topK = 5,
): { candidate_id: string; hamming: number; dimension_bonus: number }[] {
  const scored = candidates.map((c) => {
    const h = hammingDistanceHex(uploadHash, c.dhash_hex);
    const dim = dimensionSimilarity(uploadW, uploadH, c.width, c.height);
    const s = scoreMatch(h, dim);
    return { candidate_id: c.id, hamming: s.hamming, dimension_bonus: s.dimension_bonus, effective: s.effective };
  });
  scored.sort((a, b) => a.effective - b.effective);
  return scored.slice(0, topK).map(({ candidate_id, hamming, dimension_bonus }) => ({
    candidate_id,
    hamming,
    dimension_bonus,
  }));
}

/**
 * Confidence buckets:
 * - high: best hamming <= 10 and gap to second >= 5 (or second hamming > 16)
 * - review: best hamming <= 18 but ambiguous or weak
 * - no_match: otherwise
 */
export function bucketMatch(
  ranked: { hamming: number; dimension_bonus: number }[],
): { status: "high_confidence" | "review_needed" | "no_match"; confidence: number } {
  if (ranked.length === 0) return { status: "no_match", confidence: 0 };
  const best = ranked[0]!;
  const second = ranked[1];
  const gap = second ? second.hamming - best.hamming : 99;
  if (best.hamming <= 12 && (gap >= 5 || !second || second.hamming > 16)) {
    return { status: "high_confidence", confidence: Math.max(0.55, 1 - best.hamming / 24) };
  }
  if (best.hamming <= 18 && (gap < 4 || best.hamming > 12)) {
    return { status: "review_needed", confidence: Math.max(0.25, 1 - best.hamming / 28) };
  }
  if (best.hamming <= 28) {
    return { status: "review_needed", confidence: 0.3 };
  }
  return { status: "no_match", confidence: 0 };
}
