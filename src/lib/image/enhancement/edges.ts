/**
 * Theo Image Enhance (Beta) — G2 (2026-08-10)
 *
 * Lightweight edge-based rectangle detector.
 *
 * The perspective-corner picker (`PerspectiveCornerPicker.tsx`)
 * currently gets its auto-seed from `analysis.suggestedCrop` —
 * an axis-aligned bounding box derived from *background* uniformity.
 * That's a decent seed for scans and dead-on wall shots, but it
 * fails on real phone captures where the artwork is a few degrees
 * off-axis: the seed becomes the bounding box of the tilted quad,
 * which is bigger than the artwork itself and always requires manual
 * nudging.
 *
 * This module gives the picker a better first guess by fitting an
 * *oriented* bounding box to the strongest edge pixels of the
 * downsampled image. The math is a moment-based principal-axis fit:
 *
 *   1. Downsample to a 128-long-edge grayscale buffer (Sobel is
 *      cheap here; ~1 ms even on a mid-tier phone).
 *   2. Sobel magnitude → threshold at the top 10 % percentile so
 *      we keep only high-confidence edge pixels.
 *   3. Compute 2nd moments (centroid + covariance) of the edge
 *      pixel positions.
 *   4. Eigendecompose the 2×2 covariance → major/minor axis lengths
 *      and orientation.
 *   5. Return the four corners of the oriented rectangle whose long
 *      side aligns with the major axis and whose extents are the
 *      6σ envelope of the edge distribution along each axis (≈
 *      captures 99.7 % of the edge mass for a well-defined
 *      rectangular subject).
 *
 * Non-goals: this is NOT a full contour/quad detector. It won't
 * recover corners on a rectangle that's severely occluded, or when
 * the background has more edges than the artwork does. The picker
 * still lets the user drag; this is only about the seed.
 *
 * Confidence: fraction of thresholded edge pixels that fall inside
 * the fitted rectangle. High confidence (> ~0.65) means the edges
 * are concentrated on the artwork's border; low means the pattern
 * is more diffuse (busy background, multiple subjects).
 */

export type EdgeRectFit = {
  /** 4 corners in the input's normalized [0,1] coordinate space,
   *  order TL / TR / BR / BL. */
  corners: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  /** Angle of the major axis in radians (relative to +x). */
  angle: number;
  /** Fraction of thresholded edge pixels inside the returned quad. */
  confidence: number;
};

/** Downsample the given RGBA buffer into a luminance Float32Array of
 *  target size `tw × th` via simple box averaging. Sufficient for the
 *  Sobel pass — no need for a proper Lanczos here. */
function toLumaDownsampled(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tw: number,
  th: number,
): Float32Array {
  const out = new Float32Array(tw * th);
  const sx = width / tw;
  const sy = height / th;
  for (let y = 0; y < th; y += 1) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < tw; x += 1) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let sum = 0;
      let count = 0;
      for (let yy = y0; yy < y1 && yy < height; yy += 1) {
        for (let xx = x0; xx < x1 && xx < width; xx += 1) {
          const i = (yy * width + xx) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          count += 1;
        }
      }
      out[y * tw + x] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/** Sobel magnitude of a Float32 luma buffer. Returned as a same-sized
 *  Float32Array; borders are zeroed. */
function sobelMagnitude(
  lum: Float32Array,
  w: number,
  h: number,
): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const p = y * w + x;
      const gx =
        -lum[p - w - 1] + lum[p - w + 1] +
        -2 * lum[p - 1] + 2 * lum[p + 1] +
        -lum[p + w - 1] + lum[p + w + 1];
      const gy =
        -lum[p - w - 1] - 2 * lum[p - w] - lum[p - w + 1] +
        lum[p + w - 1] + 2 * lum[p + w] + lum[p + w + 1];
      out[p] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/**
 * Threshold at the given percentile — returns an Int32Array of pixel
 * indices whose magnitude is >= the percentile cutoff.
 */
function thresholdTop(mag: Float32Array, keepFraction: number): Int32Array {
  const sorted = Float32Array.from(mag);
  sorted.sort();
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - keepFraction))),
  );
  const cutoff = sorted[idx];
  const keep: number[] = [];
  for (let i = 0; i < mag.length; i += 1) {
    if (mag[i] >= cutoff && mag[i] > 0) keep.push(i);
  }
  return Int32Array.from(keep);
}

/**
 * Eigendecomposition of a symmetric 2×2 matrix [[a, b], [b, c]].
 * Returns { l1, l2, v1x, v1y } with l1 >= l2 and (v1x, v1y) the unit
 * eigenvector of the larger eigenvalue.
 */
function eig2x2(
  a: number,
  b: number,
  c: number,
): { l1: number; l2: number; v1x: number; v1y: number } {
  const tr = a + c;
  const det = a * c - b * b;
  const disc = Math.max(0, tr * tr / 4 - det);
  const s = Math.sqrt(disc);
  const l1 = tr / 2 + s;
  const l2 = tr / 2 - s;
  // Eigenvector for l1: solve (A - l1 I) v = 0 → row 1: (a-l1)vx + b vy = 0.
  let vx = b;
  let vy = l1 - a;
  const mag = Math.hypot(vx, vy);
  if (mag < 1e-9) {
    vx = 1;
    vy = 0;
  } else {
    vx /= mag;
    vy /= mag;
  }
  return { l1, l2, v1x: vx, v1y: vy };
}

/**
 * Detect the strongest edge-based rectangle in an image and return
 * its four corners in the input's normalized [0,1] space. Returns
 * `null` on degenerate input (< 32 thresholded edge pixels or a
 * flat covariance).
 *
 * `keepFraction` (default 0.10) — fraction of edge pixels retained
 * after the magnitude threshold. Higher = more permissive (works
 * on soft-edged artworks but risks capturing background clutter);
 * lower = crisper detection but may miss the rectangle entirely
 * on low-contrast subjects. 0.10 is a sensible default across our
 * fixture set.
 *
 * `envelopeSigma` (default 2.5) — how many standard deviations of
 * the projected edge coordinates the returned rectangle should
 * cover along each principal axis. A pure rectangle has a uniform
 * edge distribution along its perimeter, so ~2 σ covers > 95 %
 * of the mass; 2.5 σ gives some slack for anti-aliased edges.
 */
export function detectBestQuadrilateral(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: {
    keepFraction?: number;
    envelopeSigma?: number;
    downsampleLongEdge?: number;
  } = {},
): EdgeRectFit | null {
  const keepFraction = opts.keepFraction ?? 0.1;
  const envelopeSigma = opts.envelopeSigma ?? 2.5;
  const targetLongEdge = opts.downsampleLongEdge ?? 128;
  if (width < 8 || height < 8) return null;

  const longEdge = Math.max(width, height);
  const scale = longEdge > targetLongEdge ? targetLongEdge / longEdge : 1;
  const tw = Math.max(4, Math.round(width * scale));
  const th = Math.max(4, Math.round(height * scale));

  const lum = toLumaDownsampled(data, width, height, tw, th);
  const mag = sobelMagnitude(lum, tw, th);
  const idxs = thresholdTop(mag, keepFraction);
  if (idxs.length < 32) return null;

  // Compute weighted centroid + covariance of edge pixel positions.
  // Weight by magnitude so stronger edges pull the fit more.
  let sumW = 0;
  let sumX = 0;
  let sumY = 0;
  for (let k = 0; k < idxs.length; k += 1) {
    const p = idxs[k];
    const w = mag[p];
    const x = p % tw;
    const y = (p / tw) | 0;
    sumW += w;
    sumX += w * x;
    sumY += w * y;
  }
  if (sumW <= 0) return null;
  const cx = sumX / sumW;
  const cy = sumY / sumW;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let k = 0; k < idxs.length; k += 1) {
    const p = idxs[k];
    const w = mag[p];
    const dx = (p % tw) - cx;
    const dy = ((p / tw) | 0) - cy;
    sxx += w * dx * dx;
    syy += w * dy * dy;
    sxy += w * dx * dy;
  }
  const varX = sxx / sumW;
  const varY = syy / sumW;
  const cov = sxy / sumW;

  const { l1, l2, v1x, v1y } = eig2x2(varX, cov, varY);
  if (l1 < 1e-3 || l2 < 1e-3) return null;

  const halfLenMajor = envelopeSigma * Math.sqrt(l1);
  const halfLenMinor = envelopeSigma * Math.sqrt(l2);
  const v2x = -v1y;
  const v2y = v1x;

  // 4 corners in downsampled pixel space, order TL/TR/BR/BL relative
  // to the major axis. To land on TL/TR/BR/BL in image space we sort
  // by (y, x) below.
  const rawCorners: [number, number][] = [
    [cx - halfLenMajor * v1x - halfLenMinor * v2x, cy - halfLenMajor * v1y - halfLenMinor * v2y],
    [cx + halfLenMajor * v1x - halfLenMinor * v2x, cy + halfLenMajor * v1y - halfLenMinor * v2y],
    [cx + halfLenMajor * v1x + halfLenMinor * v2x, cy + halfLenMajor * v1y + halfLenMinor * v2y],
    [cx - halfLenMajor * v1x + halfLenMinor * v2x, cy - halfLenMajor * v1y + halfLenMinor * v2y],
  ];
  // Order as TL/TR/BR/BL by image coordinates: sort by y, split into
  // top-2 and bottom-2, then order each pair by x.
  const sorted = rawCorners.slice().sort((a, b) => a[1] - b[1]);
  const top = sorted.slice(0, 2).sort((a, b) => a[0] - b[0]);
  const bottom = sorted.slice(2, 4).sort((a, b) => a[0] - b[0]);
  const ordered: [[number, number], [number, number], [number, number], [number, number]] = [
    top[0],
    top[1],
    bottom[1],
    bottom[0],
  ];

  // Confidence — count edge pixels inside the fitted rect.
  const inside = (px: number, py: number): boolean => {
    const dx = px - cx;
    const dy = py - cy;
    // Project onto principal axes and check against half-lengths.
    const a = dx * v1x + dy * v1y;
    const b = dx * v2x + dy * v2y;
    return Math.abs(a) <= halfLenMajor && Math.abs(b) <= halfLenMinor;
  };
  let insideCount = 0;
  for (let k = 0; k < idxs.length; k += 1) {
    const p = idxs[k];
    if (inside(p % tw, (p / tw) | 0)) insideCount += 1;
  }
  const confidence = insideCount / idxs.length;

  // Normalize corners into [0,1] image space (clamped).
  const corners = ordered.map(([x, y]) => [
    Math.min(1, Math.max(0, x / tw)),
    Math.min(1, Math.max(0, y / th)),
  ]) as [[number, number], [number, number], [number, number], [number, number]];

  return {
    corners,
    angle: Math.atan2(v1y, v1x),
    confidence,
  };
}
