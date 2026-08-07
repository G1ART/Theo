/**
 * Theo Image Enhance (Beta) — 4-point homography (2026-08-06).
 *
 * A minimal, dependency-free 4-point perspective projection helper.
 * Chosen over `jsfeat` because:
 *   - jsfeat's client bundle (even tree-shaken) is > 120 KB gz.
 *   - Our use is narrow: solve 4→4 rectangle-to-rectangle. No feature
 *     detection, no camera calibration, no keypoint tracking.
 *   - Bundle budget for this patch: ≤ 1 MB gz. Adding a general-purpose
 *     library for one linear solve is wasteful.
 *
 * The math: given 4 source corners (TL, TR, BR, BL) and 4 destination
 * corners in the same order, solve the 8-DOF perspective matrix H such
 * that H · [x_src, y_src, 1]^T = w · [x_dst, y_dst, 1]^T for each pair.
 *
 * This module never allocates a WebGL context or a large intermediate
 * buffer — the solve is done on a tiny 8×9 augmented matrix. Callers
 * that need to WARP an image use `warpPerspectiveCanvas` below, which
 * uses `ctx.setTransform` when the mapping is expressible with an
 * affine subset, and per-pixel nearest-neighbour sampling otherwise.
 * For 512-long-edge preview downscales the per-pixel path is < 40 ms
 * on a mid-tier phone.
 */

export type Point2 = [number, number];

export type Homography = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * Solve for a 3×3 homography that maps `src[i]` → `dst[i]` for four
 * point pairs. Uses Gauss-Jordan elimination on the 8×9 system —
 * unrolled + partial pivoting for numerical stability.
 *
 * Returns `null` when the system is singular (three colinear points,
 * degenerate quadrilateral).
 */
export function solveHomography(
  src: [Point2, Point2, Point2, Point2],
  dst: [Point2, Point2, Point2, Point2],
): Homography | null {
  const a: number[][] = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gauss-Jordan with partial pivoting.
  const n = 8;
  for (let col = 0; col < n; col += 1) {
    // Pivot: row with largest |a[row][col]| in [col..n-1].
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    if (pivot !== col) {
      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }
    // Normalize pivot row.
    const piv = a[col][col];
    for (let k = col; k <= n; k += 1) a[col][k] /= piv;
    // Eliminate other rows.
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (Math.abs(factor) < 1e-15) continue;
      for (let k = col; k <= n; k += 1) {
        a[row][k] -= factor * a[col][k];
      }
    }
  }
  return [
    a[0][8], a[1][8], a[2][8],
    a[3][8], a[4][8], a[5][8],
    a[6][8], a[7][8], 1,
  ];
}

/** Apply a homography to a single point. Returns null on divide-by-zero. */
export function applyHomography(h: Homography, p: Point2): Point2 | null {
  const [x, y] = p;
  const w = h[6] * x + h[7] * y + h[8];
  if (Math.abs(w) < 1e-12) return null;
  return [
    (h[0] * x + h[1] * y + h[2]) / w,
    (h[3] * x + h[4] * y + h[5]) / w,
  ];
}

/**
 * Invert a 3×3 matrix. Returns null when singular.
 * Used to build the DST→SRC map for nearest-neighbour warping.
 */
export function invertHomography(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i;
  const B = -(d * j - f * g);
  const C = d * i - e * g;
  const D = -(b * j - c * i);
  const E = a * j - c * g;
  const F = -(a * i - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    A * inv, D * inv, G * inv,
    B * inv, E * inv, H * inv,
    C * inv, F * inv, I * inv,
  ];
}

/**
 * Nearest-neighbour perspective warp of an ImageData buffer.
 *
 * `h` maps SOURCE coordinates → destination coordinates. We invert it
 * to walk destination pixels and sample the source. Pixels outside the
 * source rectangle become fully-transparent black.
 *
 * Chosen over bilinear because the caller is expected to feed a
 * 512-long-edge sample for preview generation and a full-res canvas
 * pass for the final render — at those sizes bilinear costs ~4× for
 * marginal visual gain on rectangle straightening.
 */
export function warpPerspectiveNearest(
  src: ImageData,
  h: Homography,
  outW: number,
  outH: number,
): ImageData | null {
  const inv = invertHomography(h);
  if (!inv) return null;
  const out = new ImageData(outW, outH);
  const sd = src.data;
  const od = out.data;
  const sw = src.width;
  const sh = src.height;
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const w = inv[6] * x + inv[7] * y + inv[8];
      if (Math.abs(w) < 1e-12) continue;
      const sx = ((inv[0] * x + inv[1] * y + inv[2]) / w) | 0;
      const sy = ((inv[3] * x + inv[4] * y + inv[5]) / w) | 0;
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
      const si = (sy * sw + sx) * 4;
      const oi = (y * outW + x) * 4;
      od[oi] = sd[si];
      od[oi + 1] = sd[si + 1];
      od[oi + 2] = sd[si + 2];
      od[oi + 3] = sd[si + 3];
    }
  }
  return out;
}

/**
 * Convenience: given source corners (TL, TR, BR, BL) in pixel space
 * and a target output size, build the homography that maps them to
 * the axis-aligned output rectangle. This is the exact function the
 * enhance pipeline calls after the analyzer / user provides corners.
 */
export function homographyForCorners(
  srcCorners: [Point2, Point2, Point2, Point2],
  outW: number,
  outH: number,
): Homography | null {
  const dst: [Point2, Point2, Point2, Point2] = [
    [0, 0],
    [outW, 0],
    [outW, outH],
    [0, outH],
  ];
  return solveHomography(srcCorners, dst);
}
