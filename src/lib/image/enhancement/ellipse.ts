/**
 * Theo Image Enhance (Beta) — G2 (2026-08-10)
 *
 * Moment-based dominant-ellipse detector for pottery / circular
 * subjects photographed slightly off-perpendicular (ellipse projection
 * of a true circle).
 *
 * Approach
 * --------
 * Photographs of a round object from a small tilt project the disc
 * as an ellipse whose principal axes reveal the tilt angle. We can
 * reverse the distortion with a single axis-aligned scale in the
 * ellipse's rotated frame — no full 3D reconstruction, no calibration.
 *
 * Given a subject mask (or an edge map when no mask is available),
 * we compute the 2×2 covariance of the subject pixels, then extract:
 *
 *   - Center (cx, cy) — the centroid.
 *   - Orientation θ — angle of the major-axis eigenvector.
 *   - Semi-axes (a, b) — sqrt(4 * eigenvalue) for a uniform ellipse
 *     (the factor comes from the moment of inertia of a filled
 *     ellipse being π ab (a² + b²) / 4).
 *
 * Aspect ratio ε = a / b. A perfect circle projects with ε = 1.
 * When ε deviates from 1 by more than a small tolerance (default 3 %)
 * AND the detection is confident (fraction of "on-ellipse" pixels
 * relative to the fitted ellipse's expected area > 0.7), we call it
 * "circular but tilted" and return the parameters. The caller then
 * decides whether to apply an axis-restoration transform.
 *
 * Non-goals: this is not a full ellipse-fit-by-least-squares (Fitzgibbon
 * 1999). It won't correctly reconstruct arbitrarily-oriented ellipses
 * from a subset of edge points. For our use case — a well-isolated
 * disc-shaped subject — the moment-of-inertia approach is stable and
 * cheap (~2 ms on 128-long-edge). Should we later find false positives
 * on non-circular subjects (rectangular sculpture, framed pieces), we
 * add the "does the mask look elliptical vs box-like?" round-trip
 * confidence gate; not needed for the initial release.
 */

export type EllipseFit = {
  /** Ellipse center in normalized [0,1] image coordinates. */
  center: [number, number];
  /** Semi-axes in normalized [0,1] image units. `major >= minor`. */
  major: number;
  minor: number;
  /** Orientation of the major axis, radians relative to +x. */
  angle: number;
  /** major / minor. 1.0 = perfect circle projection. */
  aspect: number;
  /**
   * Confidence in [0,1]. Ratio of subject pixels that fall inside the
   * fitted ellipse to the ellipse's expected pixel area. Higher means
   * the subject fills the fitted ellipse (i.e., IS an ellipse).
   */
  confidence: number;
};

/**
 * Detect the dominant ellipse in a binary mask. `mask[i] === 1` means
 * subject; `0` means background. Any non-zero value is treated as
 * subject so callers can pass an alpha channel byte directly.
 *
 * When no mask is available the caller can pass the Sobel edge map
 * (see `edges.ts` in this directory) — the fit will still be
 * mathematically sound but confidence will be lower.
 */
export function detectDominantEllipse(
  mask: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): EllipseFit | null {
  if (width < 8 || height < 8) return null;

  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) {
        count += 1;
        sumX += x;
        sumY += y;
      }
    }
  }
  if (count < 32) return null;
  const cx = sumX / count;
  const cy = sumY / count;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) {
        const dx = x - cx;
        const dy = y - cy;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
      }
    }
  }
  const mxx = sxx / count;
  const myy = syy / count;
  const mxy = sxy / count;

  const tr = mxx + myy;
  const det = mxx * myy - mxy * mxy;
  const disc = Math.max(0, (tr * tr) / 4 - det);
  const s = Math.sqrt(disc);
  const l1 = tr / 2 + s;
  const l2 = tr / 2 - s;
  if (l1 < 1e-6 || l2 < 1e-6) return null;

  // Uniform-ellipse relation: variance along a principal axis of a
  // filled ellipse with semi-axis r equals r² / 4. So r = 2 sqrt(l).
  const major = 2 * Math.sqrt(l1);
  const minor = 2 * Math.sqrt(l2);
  const aspect = major / Math.max(1e-6, minor);

  // Angle of the major-axis eigenvector.
  let vx = mxy;
  let vy = l1 - mxx;
  const vMag = Math.hypot(vx, vy);
  if (vMag < 1e-9) {
    vx = 1;
    vy = 0;
  } else {
    vx /= vMag;
    vy /= vMag;
  }
  const angle = Math.atan2(vy, vx);

  // Confidence — fraction of subject pixels that lie inside the fitted
  // ellipse, normalized by the ellipse's own pixel area. For a true
  // ellipse this approaches 1.0.
  const ellipseArea = Math.PI * major * minor;
  const v2x = -vy;
  const v2y = vx;
  let inside = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      const dx = x - cx;
      const dy = y - cy;
      const a = dx * vx + dy * vy;
      const b = dx * v2x + dy * v2y;
      if ((a / major) ** 2 + (b / minor) ** 2 <= 1) inside += 1;
    }
  }
  const confidence = ellipseArea > 0 ? Math.min(1, inside / ellipseArea) : 0;

  return {
    center: [cx / width, cy / height],
    major: major / Math.min(width, height),
    minor: minor / Math.min(width, height),
    angle,
    aspect,
    confidence,
  };
}

/**
 * Given an ellipse fit, produce the four source-corner points that,
 * when warped to an axis-aligned rectangle of aspect 1:1, restore
 * the ellipse to a circle. Returned as normalized [0,1] TL/TR/BR/BL,
 * matching `NormalizedPoint` in `types.ts`.
 *
 * The math: the ellipse's *tight* rotated bounding box has aspect
 * major/minor. Warping THAT rectangle to a 1:1 square scales the
 * minor axis up by `aspect`, mapping the ellipse into a circle. This
 * is the exact operation the user's Lightroom workflow calls
 * "restore roundness on a pottery shot".
 */
export function ellipseRestorationCorners(
  fit: EllipseFit,
): [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] {
  const [ncx, ncy] = fit.center;
  const angle = fit.angle;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Semi-axes are in "shorter-edge units" (see `detectDominantEllipse`
  // above where we divided by `min(width, height)`). For an axis-agnostic
  // approximation we treat both as fractions of the shorter edge; small
  // aspect distortion from the container aspect ratio is acceptable
  // since the picker lets the user nudge afterwards.
  const a = fit.major;
  const b = fit.minor;
  const ax = cos * a;
  const ay = sin * a;
  const bx = -sin * b;
  const by = cos * b;
  const raw: [number, number][] = [
    [ncx - ax - bx, ncy - ay - by],
    [ncx + ax - bx, ncy + ay - by],
    [ncx + ax + bx, ncy + ay + by],
    [ncx - ax + bx, ncy - ay + by],
  ];
  // Order by (y, x) as TL/TR/BR/BL, matching engine expectations.
  const sorted = raw.slice().sort((p1, p2) => p1[1] - p2[1]);
  const top = sorted.slice(0, 2).sort((p1, p2) => p1[0] - p2[0]);
  const bottom = sorted.slice(2, 4).sort((p1, p2) => p1[0] - p2[0]);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    [clamp(top[0][0]), clamp(top[0][1])],
    [clamp(top[1][0]), clamp(top[1][1])],
    [clamp(bottom[1][0]), clamp(bottom[1][1])],
    [clamp(bottom[0][0]), clamp(bottom[0][1])],
  ];
}

/**
 * Convenience: derive a subject mask from an RGBA buffer by
 * thresholding against a plain-background assumption. Pixels
 * significantly different from the 8-corner mean colour become
 * subject (1); others become background (0).
 *
 * Not a segmentation model — meant only as a cheap fallback when
 * a Photoroom alpha mask is unavailable and the subject sits on a
 * clean matte background (studio shot on white paper, etc.).
 */
export function maskFromBackgroundContrast(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: { threshold?: number } = {},
): Uint8Array {
  const threshold = opts.threshold ?? 30;
  // Sample corners for a background reference.
  const samples: [number, number, number][] = [];
  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  push(0, 0);
  push(width - 1, 0);
  push(0, height - 1);
  push(width - 1, height - 1);
  const meanR = samples.reduce((s, p) => s + p[0], 0) / samples.length;
  const meanG = samples.reduce((s, p) => s + p[1], 0) / samples.length;
  const meanB = samples.reduce((s, p) => s + p[2], 0) / samples.length;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const dr = data[i] - meanR;
      const dg = data[i + 1] - meanG;
      const db = data[i + 2] - meanB;
      const d = Math.sqrt(dr * dr + dg * dg + db * db);
      mask[y * width + x] = d > threshold ? 1 : 0;
    }
  }
  return mask;
}
