/**
 * Residual radial model. Forward D maps undistorted U to the photo S:
 *
 *   q = (u - c) / s
 *   r² = qx² + qy²
 *   f(r) = 1 + k1 r² + k2 r⁴
 *   D(u) = c + s q f(r)
 *
 * s = max(photo width, photo height). The center is the photo center
 * unless a later fit is allowed to move it. This is not a factory
 * lens calibration.
 */

import type { Point } from "./geometryPlan";

export type RadialModel = {
  cx: number;
  cy: number;
  scale: number;
  k1: number;
  k2: number;
};

export function radialModel(
  width: number,
  height: number,
  k1 = 0,
  k2 = 0,
  center?: Point,
): RadialModel {
  return {
    cx: center ? center[0] : width / 2,
    cy: center ? center[1] : height / 2,
    scale: Math.max(width, height),
    k1,
    k2,
  };
}

export function distortPoint(u: Point, model: RadialModel): Point | null {
  if (!Number.isFinite(u[0]) || !Number.isFinite(u[1]) || model.scale <= 0) return null;
  const qx = (u[0] - model.cx) / model.scale;
  const qy = (u[1] - model.cy) / model.scale;
  const r2 = qx * qx + qy * qy;
  const f = 1 + model.k1 * r2 + model.k2 * r2 * r2;
  if (!(f > 0.02)) return null;
  return [model.cx + model.scale * qx * f, model.cy + model.scale * qy * f];
}

/**
 * Solve k2 r^5 + k1 r^3 + r - rd = 0 for the undistorted radius.
 * Returns null when the mapping folds or Newton fails.
 */
export function undistortRadius(k1: number, k2: number, rd: number): number | null {
  if (!Number.isFinite(rd) || rd < 0) return null;
  if (rd < 1e-12) return 0;
  let r = rd;
  for (let i = 0; i < 14; i += 1) {
    const r2 = r * r;
    const f = k2 * r2 * r2 * r + k1 * r2 * r + r - rd;
    const fp = 5 * k2 * r2 * r2 + 3 * k1 * r2 + 1;
    if (!(fp > 1e-6)) return null;
    const next = r - f / fp;
    if (!Number.isFinite(next) || next < 0) return null;
    if (Math.abs(next - r) < 1e-12) {
      r = next;
      break;
    }
    r = next;
  }
  const r2 = r * r;
  const deriv = 1 + 3 * k1 * r2 + 5 * k2 * r2 * r2;
  if (!(deriv > 0.05)) return null;
  return r;
}

export function undistortPoint(p: Point, model: RadialModel): Point | null {
  if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || model.scale <= 0) return null;
  const dx = p[0] - model.cx;
  const dy = p[1] - model.cy;
  const rd = Math.hypot(dx, dy) / model.scale;
  const r = undistortRadius(model.k1, model.k2, rd);
  if (r == null) return null;
  if (rd < 1e-12) return [model.cx, model.cy];
  const gain = r / rd;
  return [model.cx + dx * gain, model.cy + dy * gain];
}

export function radialSafe(model: RadialModel, maxR: number): boolean {
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    const r = (maxR * i) / steps;
    const r2 = r * r;
    const f = 1 + model.k1 * r2 + model.k2 * r2 * r2;
    const deriv = 1 + 3 * model.k1 * r2 + 5 * model.k2 * r2 * r2;
    if (!(f > 0.05) || !(deriv > 0.05)) return false;
  }
  return true;
}

export function maxNormalizedRadius(width: number, height: number, model: RadialModel): number {
  const corners: Point[] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  let max = 0;
  for (const p of corners) {
    max = Math.max(max, Math.hypot(p[0] - model.cx, p[1] - model.cy) / model.scale);
  }
  return max;
}

export function lineDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / len;
}

function huber(d: number, sigma: number): number {
  const z = d / Math.max(sigma, 1e-3);
  const k = 1.5;
  const a = Math.abs(z);
  if (a <= k) return 0.5 * z * z;
  return k * (a - 0.5 * k);
}

export type FitPoint = {
  edge: 0 | 1 | 2 | 3;
  p: Point;
  heldOut: boolean;
  weight: number;
};

export type RadialFit = {
  model: RadialModel;
  accepted: boolean;
  heldOutBefore: number;
  heldOutAfter: number;
  improvement: number | null;
  reason: string;
};

/**
 * Fit a shared k1 (k2 stays 0, center stays at the photo center)
 * so undistorted edge points lie on the lines through the undistorted
 * endpoints. Held-out points are not part of the loss.
 */
export function fitRadialK1(
  width: number,
  height: number,
  corners: [Point, Point, Point, Point],
  points: FitPoint[],
): RadialFit {
  const base = radialModel(width, height, 0, 0);
  const zero = evaluate(base, corners, points);
  const usable = points.some((p) => !p.heldOut && p.weight > 0);
  if (!usable) {
    return {
      model: base,
      accepted: false,
      heldOutBefore: zero.heldOut,
      heldOutAfter: zero.heldOut,
      improvement: null,
      reason: "no_observations",
    };
  }
  const longEdge = Math.max(width, height);
  const zeroRef = (zero.heldOut * 2048) / longEdge;
  if (zeroRef <= 0.75) {
    return {
      model: base,
      accepted: false,
      heldOutBefore: zero.heldOut,
      heldOutAfter: zero.heldOut,
      improvement: null,
      reason: "already_straight",
    };
  }

  let bestK = 0;
  let bestLoss = zero.loss;
  for (let i = -80; i <= 80; i += 1) {
    const k1 = i * 0.01;
    const loss = evaluate(radialModel(width, height, k1, 0), corners, points).loss + 0.002 * k1 * k1;
    if (loss < bestLoss) {
      bestLoss = loss;
      bestK = k1;
    }
  }
  const seed = bestK;
  for (let i = -10; i <= 10; i += 1) {
    const k1 = seed + i * 0.001;
    const loss = evaluate(radialModel(width, height, k1, 0), corners, points).loss + 0.002 * k1 * k1;
    if (loss < bestLoss) {
      bestLoss = loss;
      bestK = k1;
    }
  }

  const fitted = radialModel(width, height, bestK, 0);
  if (!radialSafe(fitted, maxNormalizedRadius(width, height, fitted))) {
    return {
      model: base,
      accepted: false,
      heldOutBefore: zero.heldOut,
      heldOutAfter: zero.heldOut,
      improvement: null,
      reason: "unsafe_radial",
    };
  }
  const after = evaluate(fitted, corners, points);
  const improvement =
    zero.heldOut > 1e-6 ? (zero.heldOut - after.heldOut) / zero.heldOut : null;

  const neighbor = evaluate(radialModel(width, height, bestK + 0.02, 0), corners, points);
  const jump = Math.abs(neighbor.heldOut - after.heldOut);
  if (jump > Math.max(2, after.heldOut)) {
    return {
      model: base,
      accepted: false,
      heldOutBefore: zero.heldOut,
      heldOutAfter: after.heldOut,
      improvement,
      reason: "unstable",
    };
  }

  const cornersOk = corners.every((c) => undistortPoint(c, fitted) != null);
  const accepted =
    cornersOk &&
    Math.abs(bestK) >= 0.004 &&
    improvement != null &&
    improvement >= 0.7 &&
    after.heldOut < zero.heldOut;

  return {
    model: accepted ? fitted : base,
    accepted,
    heldOutBefore: zero.heldOut,
    heldOutAfter: accepted ? after.heldOut : zero.heldOut,
    improvement,
    reason: accepted ? "radial" : "radial_not_enough",
  };
}

function evaluate(
  model: RadialModel,
  corners: [Point, Point, Point, Point],
  points: FitPoint[],
): { loss: number; heldOut: number } {
  const undistorted: Array<Point | null> = corners.map((c) => undistortPoint(c, model));
  if (undistorted.some((p) => p == null)) return { loss: 1e6, heldOut: 1e6 };
  const ends = undistorted as [Point, Point, Point, Point];
  const lines: Array<[Point, Point]> = [
    [ends[0], ends[1]],
    [ends[1], ends[2]],
    [ends[3], ends[2]],
    [ends[0], ends[3]],
  ];
  const fit = [0, 0, 0, 0];
  const fitW = [0, 0, 0, 0];
  const held: number[] = [];
  for (const point of points) {
    if (point.weight <= 0) continue;
    const u = undistortPoint(point.p, model);
    if (!u) return { loss: 1e6, heldOut: 1e6 };
    const d = lineDistance(u, lines[point.edge][0], lines[point.edge][1]);
    if (point.heldOut) held.push(d);
    else {
      fit[point.edge] += point.weight * huber(d, 1);
      fitW[point.edge] += point.weight;
    }
  }
  let loss = 0;
  let edges = 0;
  for (let e = 0; e < 4; e += 1) {
    if (fitW[e] <= 0) continue;
    loss += fit[e] / fitW[e];
    edges += 1;
  }
  if (edges === 0) return { loss: 1e6, heldOut: 1e6 };
  const heldOut =
    held.length === 0 ? 0 : Math.sqrt(held.reduce((s, d) => s + d * d, 0) / held.length);
  return { loss: loss / edges, heldOut };
}
