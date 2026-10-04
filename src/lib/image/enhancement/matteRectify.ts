/**
 * Turn a Photoroom alpha matte into a frontal rectangle when the
 * matte is a quadrilateral.
 *
 * The contour is the alpha, not the paint inside the canvas. Small
 * outward bumps (impasto, a rough cut) are dropped while the hull is
 * reduced to four corners, then each side is a line fit that ignores
 * those bumps. The warp is the rectangle path's homography
 * (`homographyForCorners` + `warpPerspectiveNearest` +
 * `estimateRectifiedAspect`).
 *
 * A circle, ellipse, or organic outline does not fill a quadrilateral,
 * so it is returned unchanged and keeps its alpha.
 */

import type { Point2 } from "./homography";
import {
  estimateRectifiedAspect,
  homographyForCorners,
  warpPerspectiveNearest,
} from "./homography";

export type MatteQuad = [Point2, Point2, Point2, Point2];

export type MatteQuadFit = {
  /** TL, TR, BR, BL in the source pixel space. */
  corners: MatteQuad;
  /** High only when the alpha is explained by that quadrilateral. */
  confidence: number;
};

export type RectifyResult = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  unwarped: boolean;
  confidence: number;
};

/** Below this, the cutout stays a silhouette. */
export const RECTANGLE_MATTE_MIN_CONFIDENCE = 0.8;

const MAX_FIT_EDGE = 720;
const ALPHA_SUBJECT = 128;

type Line = { px: number; py: number; dx: number; dy: number };

function ensureImageData(): void {
  if (typeof globalThis.ImageData === "function") return;
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  }
  (globalThis as { ImageData?: unknown }).ImageData =
    ImageDataPolyfill as unknown as typeof ImageData;
}

function subjectMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { mask: Uint8Array; sw: number; sh: number } {
  const long = Math.max(width, height);
  const sw = long > MAX_FIT_EDGE ? Math.max(8, Math.round((width * MAX_FIT_EDGE) / long)) : width;
  const sh = long > MAX_FIT_EDGE ? Math.max(8, Math.round((height * MAX_FIT_EDGE) / long)) : height;
  const mask = new Uint8Array(sw * sh);
  if (sw === width && sh === height) {
    for (let i = 0; i < sw * sh; i += 1) {
      mask[i] = data[i * 4 + 3] >= ALPHA_SUBJECT ? 1 : 0;
    }
    return { mask, sw, sh };
  }
  for (let y = 0; y < sh; y += 1) {
    const y0 = Math.floor((y * height) / sh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / sh));
    for (let x = 0; x < sw; x += 1) {
      const x0 = Math.floor((x * width) / sw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / sw));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1 && yy < height; yy += 1) {
        const row = yy * width;
        for (let xx = x0; xx < x1 && xx < width; xx += 1) {
          sum += data[(row + xx) * 4 + 3];
          n += 1;
        }
      }
      mask[y * sw + x] = n > 0 && sum / n >= ALPHA_SUBJECT ? 1 : 0;
    }
  }
  return { mask, sw, sh };
}

function toFull(
  point: Point2,
  sw: number,
  sh: number,
  width: number,
  height: number,
): Point2 {
  if (sw === width && sh === height) return [point[0], point[1]];
  return [(point[0] + 0.5) * (width / sw) - 0.5, (point[1] + 0.5) * (height / sh) - 0.5];
}

function cross(o: Point2, a: Point2, b: Point2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function convexHull(points: Point2[]): Point2[] {
  if (points.length < 4) return points.slice();
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const lower: Point2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point2[] = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Drop the smallest convex bump until four corners remain. */
function simplifyConvexToQuad(hull: Point2[]): Point2[] | null {
  const pts = hull.slice();
  if (pts.length < 4) return null;
  while (pts.length > 4) {
    let best = 0;
    let bestArea = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if (area < bestArea) {
        bestArea = area;
        best = i;
      }
    }
    pts.splice(best, 1);
  }
  return pts;
}

function indexOfMin(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < values[best]) best = i;
  }
  return best;
}

function indexOfMax(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

function orderCorners(pts: Point2[]): MatteQuad | null {
  if (pts.length !== 4) return null;
  const sums = pts.map((p) => p[0] + p[1]);
  const diffs = pts.map((p) => p[1] - p[0]);
  const tl = pts[indexOfMin(sums)];
  const br = pts[indexOfMax(sums)];
  const tr = pts[indexOfMin(diffs)];
  const bl = pts[indexOfMax(diffs)];
  if (new Set([tl, tr, br, bl]).size === 4) return [tl, tr, br, bl];

  const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
  const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  const clockwise = pts
    .slice()
    .sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let start = 0;
  let best = Infinity;
  for (let i = 0; i < 4; i += 1) {
    const score = clockwise[i][0] + clockwise[i][1];
    if (score < best) {
      best = score;
      start = i;
    }
  }
  return [
    clockwise[start],
    clockwise[(start + 1) % 4],
    clockwise[(start + 2) % 4],
    clockwise[(start + 3) % 4],
  ];
}

function layoutOk(quad: MatteQuad): boolean {
  const [tl, tr, br, bl] = quad;
  return tl[0] < tr[0] && bl[0] < br[0] && tl[1] < bl[1] && tr[1] < br[1];
}

function isConvex(quad: MatteQuad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(turn) < 1e-6) return false;
    const s = turn > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function polygonArea(quad: MatteQuad): number {
  let area = 0;
  for (let i = 0; i < 4; i += 1) {
    const p = quad[i];
    const q = quad[(i + 1) % 4];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area) / 2;
}

function boundaryPoints(mask: Uint8Array, sw: number, sh: number): Point2[] {
  const pts: Point2[] = [];
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      if (!mask[y * sw + x]) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === sw - 1 ||
        y === sh - 1 ||
        !mask[y * sw + (x - 1)] ||
        !mask[y * sw + (x + 1)] ||
        !mask[(y - 1) * sw + x] ||
        !mask[(y + 1) * sw + x];
      if (edge) pts.push([x, y]);
    }
  }
  return pts;
}

function distToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function fitLine(points: Point2[]): Line | null {
  if (points.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p[0];
    my += p[1];
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p[0] - mx;
    const dy = p[1] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, (tr * tr) / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc);
  let vx = sxy;
  let vy = l1 - sxx;
  const mag = Math.hypot(vx, vy);
  if (mag < 1e-8) {
    if (sxx >= syy) {
      vx = 1;
      vy = 0;
    } else {
      vx = 0;
      vy = 1;
    }
  } else {
    vx /= mag;
    vy /= mag;
  }
  return { px: mx, py: my, dx: vx, dy: vy };
}

function lineFromSegment(a: Point2, b: Point2): Line | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-6) return null;
  return { px: a[0], py: a[1], dx: dx / mag, dy: dy / mag };
}

function distToLine(p: Point2, line: Line): number {
  return Math.abs(-line.dy * (p[0] - line.px) + line.dx * (p[1] - line.py));
}

function intersect(a: Line, b: Line): Point2 | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-8) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return [a.px + t * a.dx, a.py + t * a.dy];
}

function pointInQuad(px: number, py: number, quad: MatteQuad): boolean {
  const [tl, tr, br, bl] = quad;
  const sign = (a: Point2, b: Point2, c: Point2) =>
    (px - c[0]) * (a[1] - c[1]) - (a[0] - c[0]) * (py - c[1]);
  const inTri = (a: Point2, b: Point2, c: Point2) => {
    const d1 = sign(a, b, c);
    const d2 = sign(b, c, a);
    const d3 = sign(c, a, b);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };
  return inTri(tl, tr, br) || inTri(tl, br, bl);
}

function refineQuad(coarse: MatteQuad, boundary: Point2[], sw: number, sh: number): MatteQuad | null {
  const short = Math.min(sw, sh);
  const band = Math.max(4, short * 0.06);
  const outlier = Math.max(1.75, short * 0.015);
  const sides: [Point2, Point2][] = [
    [coarse[0], coarse[1]],
    [coarse[1], coarse[2]],
    [coarse[2], coarse[3]],
    [coarse[3], coarse[0]],
  ];
  const buckets: Point2[][] = [[], [], [], []];
  for (const p of boundary) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < 4; i += 1) {
      const d = distToSegment(p, sides[i][0], sides[i][1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD <= band) buckets[best].push(p);
  }

  const lines: Line[] = [];
  for (let i = 0; i < 4; i += 1) {
    const seed = lineFromSegment(sides[i][0], sides[i][1]);
    // Distance is measured from the corner-to-corner side, so a paint
    // bump between the corners does not tilt the fit.
    let pool = buckets[i].filter((p) => distToSegment(p, sides[i][0], sides[i][1]) <= outlier);
    if (pool.length < 6) pool = buckets[i];
    const line = fitLine(pool) ?? seed;
    if (!line) return null;
    let fitted: Line = line;
    if (pool.length >= 6) {
      const kept = pool.filter((p) => distToLine(p, fitted) <= outlier);
      if (kept.length >= 6) {
        pool = kept;
        fitted = fitLine(pool) ?? fitted;
      }
    }
    const length = Math.hypot(sides[i][1][0] - sides[i][0][0], sides[i][1][1] - sides[i][0][1]);
    if (pool.length < 6 || length < 4) return null;
    let minT = Infinity;
    let maxT = -Infinity;
    for (const p of pool) {
      const t = (p[0] - fitted.px) * fitted.dx + (p[1] - fitted.py) * fitted.dy;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    if (maxT - minT < length * 0.45) return null;
    lines.push(fitted);
  }

  const corners: Point2[] = [];
  for (let i = 0; i < 4; i += 1) {
    const prev = lines[(i + 3) % 4];
    const hit = intersect(prev, lines[i]);
    if (!hit || !Number.isFinite(hit[0]) || !Number.isFinite(hit[1])) return null;
    const margin = short * 0.12;
    if (hit[0] < -margin || hit[1] < -margin || hit[0] > sw + margin || hit[1] > sh + margin) {
      return null;
    }
    corners.push(hit);
  }
  return orderCorners(corners);
}

/**
 * Fit the canvas quad of an alpha matte. Returns null when the outline
 * is round or organic, or when the quadrilateral would be a weak guess.
 */
export function fitMatteQuad(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): MatteQuadFit | null {
  if (width < 16 || height < 16 || data.length < width * height * 4) return null;
  const { mask, sw, sh } = subjectMask(data, width, height);
  let subject = 0;
  for (let i = 0; i < mask.length; i += 1) subject += mask[i];
  if (subject < 64 || subject / mask.length < 0.08) return null;

  const boundary = boundaryPoints(mask, sw, sh);
  if (boundary.length < 32) return null;
  const hull = convexHull(boundary);
  const quadPts = simplifyConvexToQuad(hull);
  if (!quadPts) return null;
  const coarse = orderCorners(quadPts);
  if (!coarse || !layoutOk(coarse) || !isConvex(coarse)) return null;
  const refined = refineQuad(coarse, boundary, sw, sh);
  const quad = refined && layoutOk(refined) && isConvex(refined) ? refined : coarse;
  if (!layoutOk(quad) || !isConvex(quad)) return null;

  const area = polygonArea(quad);
  if (area < sw * sh * 0.12) return null;

  const short = Math.min(sw, sh);
  const tol = Math.max(2, short * 0.02);
  const sides: [Point2, Point2][] = [
    [quad[0], quad[1]],
    [quad[1], quad[2]],
    [quad[2], quad[3]],
    [quad[3], quad[0]],
  ];
  let inliers = 0;
  for (const p of boundary) {
    let near = false;
    for (const [a, b] of sides) {
      if (distToSegment(p, a, b) <= tol) {
        near = true;
        break;
      }
    }
    if (near) inliers += 1;
  }
  const inlierRatio = inliers / boundary.length;

  let inside = 0;
  let outside = 0;
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      if (!mask[y * sw + x]) continue;
      if (pointInQuad(x + 0.5, y + 0.5, quad)) inside += 1;
      else outside += 1;
    }
  }
  const outsideRatio = subject > 0 ? outside / subject : 1;
  const fill = inside / Math.max(1, area);
  const confidence = Math.min(inlierRatio, fill, 1 - outsideRatio);
  if (
    confidence < RECTANGLE_MATTE_MIN_CONFIDENCE ||
    inlierRatio < 0.78 ||
    outsideRatio > 0.08 ||
    fill < 0.9
  ) {
    return null;
  }

  const corners = quad.map((p) => toFull(p, sw, sh, width, height)) as MatteQuad;
  if (!layoutOk(corners) || !isConvex(corners)) return null;
  return { corners, confidence };
}

function rectifiedPixelSize(corners: MatteQuad, width: number, height: number): {
  outW: number;
  outH: number;
} {
  // Same destination sizing as the rectangle crop in localFlatEngine.
  const targetAspect = estimateRectifiedAspect(corners);
  const longEdge = Math.max(width, height);
  if (targetAspect >= 1) {
    return { outW: longEdge, outH: Math.max(1, Math.round(longEdge / targetAspect)) };
  }
  return { outH: longEdge, outW: Math.max(1, Math.round(longEdge * targetAspect)) };
}

function dilateSubject(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (out[o + 3] >= ALPHA_SUBJECT) continue;
      let best = -1;
      for (let dy = -1; dy <= 1 && best < 0; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const s = (yy * width + xx) * 4;
          if (data[s + 3] >= 200) {
            best = s;
            break;
          }
        }
      }
      if (best < 0) continue;
      out[o] = data[best];
      out[o + 1] = data[best + 1];
      out[o + 2] = data[best + 2];
      out[o + 3] = 255;
    }
  }
  return out;
}

function sealSmallGaps(data: Uint8ClampedArray, width: number, height: number): void {
  const n = width * height;
  const holes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (data[i * 4 + 3] < ALPHA_SUBJECT) holes.push(i);
  }
  if (holes.length === 0 || holes.length > n * 0.04) return;
  const radius = 3;
  for (const idx of holes) {
    const x = idx % width;
    const y = (idx / width) | 0;
    let best = -1;
    let bestD = radius + 1;
    for (let dy = -radius; dy <= radius; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        if (d === 0 || d >= bestD) continue;
        const s = (yy * width + xx) * 4;
        if (data[s + 3] >= 200) {
          bestD = d;
          best = s;
        }
      }
    }
    if (best < 0) continue;
    const o = idx * 4;
    data[o] = data[best];
    data[o + 1] = data[best + 1];
    data[o + 2] = data[best + 2];
    data[o + 3] = 255;
  }
}

function opaqueRatio(data: Uint8ClampedArray): number {
  let opaque = 0;
  const n = data.length / 4;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] >= ALPHA_SUBJECT) opaque += 1;
  }
  return n > 0 ? opaque / n : 0;
}

/**
 * Unwarp a trapezoid (or bumpy rectangular) matte onto a frontal
 * rectangle. Round and organic mattes come back with `unwarped: false`
 * and the original alpha buffer.
 */
export function rectifyRectangularMatte(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): RectifyResult {
  const unchanged = (): RectifyResult => ({
    data,
    width,
    height,
    unwarped: false,
    confidence: 0,
  });
  const fit = fitMatteQuad(data, width, height);
  if (!fit) return unchanged();
  const { outW, outH } = rectifiedPixelSize(fit.corners, width, height);
  if (outW < 8 || outH < 8) return unchanged();
  ensureImageData();
  const src = new ImageData(width, height);
  // The fitted edge sits on the matte boundary. Nearest-neighbor
  // sampling of that line otherwise reads the empty pixel just
  // outside the canvas and notches the frontal corners.
  src.data.set(dilateSubject(data, width, height));
  const H = homographyForCorners(fit.corners, outW, outH);
  if (!H) return unchanged();
  const warped = warpPerspectiveNearest(src, H, outW, outH);
  if (!warped) return unchanged();
  const out = new Uint8ClampedArray(warped.data);
  sealSmallGaps(out, outW, outH);
  if (opaqueRatio(out) < 0.96) return unchanged();
  return {
    data: out,
    width: outW,
    height: outH,
    unwarped: true,
    confidence: fit.confidence,
  };
}
