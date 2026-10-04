/**
 * Coordinate contract and persisted geometry plan for flat artwork.
 *
 * S is the full photo after EXIF orientation is applied once.
 * The continuous image domain is [0, width] × [0, height].
 * Pixel (i, j) is centered at (i + 0.5, j + 0.5).
 * A normalized corner [nx, ny] is the edge point (nx * width, ny * height),
 * the same contract the existing corner picker stores.
 *
 * U is S after the residual radial model is removed.
 * R is the frontal artwork rectangle, before the studio wall is added.
 *
 * The radial polynomial is a residual fit for this photo. It is not a
 * claim about a specific phone lens.
 */

import type { Homography } from "./homography";

export const GEOMETRY_ENGINE_VERSION = "geometry-radial-v1";
export const GEOMETRY_RECIPE_VERSION = 1 as const;
export const GEOMETRY_EVAL_LONG_EDGE = 2048;

export type GeometryMethod =
  | "identity"
  | "perspective"
  | "radial"
  | "boundary_traced"
  | "boundary_manual";

export type GeometryStatus =
  | "applied"
  | "already_straight"
  | "disabled"
  | "needs_review"
  | "failed";

export type EdgeName = "top" | "right" | "bottom" | "left";

/** [t, deltaX, deltaY] in unit-output space. t increases along the edge. */
export type ResidualKnot = [number, number, number];

export type GeometryRecipe = {
  version: 1;
  engineVersion: string;
  method: GeometryMethod;
  status: GeometryStatus;
  source: {
    width: number;
    height: number;
    orientationContract: "exif-applied-once-v1";
    coordinateContract: "image-edge-pixel-center-v1";
  };
  radial: {
    cx: number;
    cy: number;
    scale: number;
    k1: number;
    k2: number;
    model: "residual-polynomial-v1";
  } | null;
  /** Row-major 3×3. Maps unit output [0,1]² to undistorted source pixels. */
  unitOutputToUndistortedSource: number[] | null;
  boundary: {
    space: "oriented-source-pixels";
    representation: "piecewise-curve-v1";
    top: number[][];
    right: number[][];
    bottom: number[][];
    left: number[][];
  } | null;
  manualResidual?: {
    space: "unit-output";
    basis: "coons-residual-v1";
    top: ResidualKnot[];
    right: ResidualKnot[];
    bottom: ResidualKnot[];
    left: ResidualKnot[];
  };
  target: {
    aspect: number;
    aspectSource: "artwork_dimensions" | "user" | "estimated";
    width: number;
    height: number;
  };
  sampling: {
    version: string;
    interpolation: "bilinear-premultiplied-v1";
    alphaPolicy: "coverage-omit-exterior-v1";
  };
  diagnostics: {
    edgeCoverage: number[];
    beforeErrorPx: number[];
    afterErrorPx: number[];
    evaluationScale: number;
    reason: string | null;
  };
};

export type Raster = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type Point = [number, number];

export function normalizedToSource(
  nx: number,
  ny: number,
  width: number,
  height: number,
): Point {
  return [nx * width, ny * height];
}

export function sourceToNormalized(
  x: number,
  y: number,
  width: number,
  height: number,
): Point {
  return [width > 0 ? x / width : 0, height > 0 ? y / height : 0];
}

/** Reference-scale a measured pixel error. Does not resize an image. */
export function toReferencePx(measuredPx: number, longEdge: number): number {
  if (!Number.isFinite(measuredPx) || !Number.isFinite(longEdge) || longEdge <= 0) {
    return Number.NaN;
  }
  return (measuredPx * GEOMETRY_EVAL_LONG_EDGE) / longEdge;
}

export function rms(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v * v;
  return Math.sqrt(sum / values.length);
}

export function percentileAbs(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.map((v) => Math.abs(v)).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function outputSizeForAspect(
  longEdge: number,
  aspect: number,
): { width: number; height: number } {
  const edge = Math.max(1, Math.round(longEdge));
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (safe >= 1) {
    return { width: edge, height: Math.max(1, Math.round(edge / safe)) };
  }
  return { height: edge, width: Math.max(1, Math.round(edge * safe)) };
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isPointList(raw: unknown, min: number, max: number): raw is number[][] {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) return false;
  return raw.every(
    (row) =>
      Array.isArray(row) &&
      row.length >= 2 &&
      row.every((n) => finite(n)),
  );
}

function isKnotList(raw: unknown): raw is ResidualKnot[] {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 96) return false;
  let prev = -Infinity;
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== 3) return false;
    const [t, dx, dy] = row;
    if (!finite(t) || !finite(dx) || !finite(dy)) return false;
    if (t < -0.001 || t > 1.001 || t + 1e-9 < prev) return false;
    if (Math.hypot(dx, dy) > 0.25) return false;
    prev = t;
  }
  return true;
}

function isHomography(raw: unknown): raw is number[] {
  return (
    Array.isArray(raw) &&
    raw.length === 9 &&
    raw.every((n) => finite(n)) &&
    Math.abs(raw[8] - 1) < 1e-3
  );
}

/**
 * Returns null when geometry is absent. Returns the recipe when it is
 * valid. Throws nothing: invalid payloads return the sentinel "invalid"
 * so callers do not rewrite them into a successful plan.
 */
export function parseGeometryRecipe(raw: unknown): GeometryRecipe | null | "invalid" {
  if (raw == null) return null;
  if (!raw || typeof raw !== "object") return "invalid";
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return "invalid";
  if (o.engineVersion !== GEOMETRY_ENGINE_VERSION && typeof o.engineVersion !== "string") {
    return "invalid";
  }
  if (typeof o.engineVersion !== "string" || !o.engineVersion) return "invalid";
  const method = o.method;
  if (
    method !== "identity" &&
    method !== "perspective" &&
    method !== "radial" &&
    method !== "boundary_traced" &&
    method !== "boundary_manual"
  ) {
    return "invalid";
  }
  const status = o.status;
  if (
    status !== "applied" &&
    status !== "already_straight" &&
    status !== "disabled" &&
    status !== "needs_review" &&
    status !== "failed"
  ) {
    return "invalid";
  }
  const source = o.source as Record<string, unknown> | undefined;
  if (!source || !finite(source.width) || !finite(source.height)) return "invalid";
  if (source.width < 2 || source.height < 2 || source.width > 20000 || source.height > 20000) {
    return "invalid";
  }
  if (source.orientationContract !== "exif-applied-once-v1") return "invalid";
  if (source.coordinateContract !== "image-edge-pixel-center-v1") return "invalid";

  let radial: GeometryRecipe["radial"] = null;
  if (o.radial != null) {
    const r = o.radial as Record<string, unknown>;
    if (
      !r ||
      !finite(r.cx) ||
      !finite(r.cy) ||
      !finite(r.scale) ||
      !finite(r.k1) ||
      !finite(r.k2) ||
      r.scale <= 0 ||
      r.model !== "residual-polynomial-v1" ||
      Math.abs(r.k1) > 1.5 ||
      Math.abs(r.k2) > 0.8
    ) {
      return "invalid";
    }
    radial = {
      cx: r.cx,
      cy: r.cy,
      scale: r.scale,
      k1: r.k1,
      k2: r.k2,
      model: "residual-polynomial-v1",
    };
  }

  const matrix = o.unitOutputToUndistortedSource;
  if (matrix != null && !isHomography(matrix)) return "invalid";

  let boundary: GeometryRecipe["boundary"] = null;
  if (o.boundary != null) {
    const b = o.boundary as Record<string, unknown>;
    if (!b || b.space !== "oriented-source-pixels" || b.representation !== "piecewise-curve-v1") {
      return "invalid";
    }
    if (
      !isPointList(b.top, 2, 96) ||
      !isPointList(b.right, 2, 96) ||
      !isPointList(b.bottom, 2, 96) ||
      !isPointList(b.left, 2, 96)
    ) {
      return "invalid";
    }
    const limit = Math.max(source.width as number, source.height as number) * 1.25;
    const inFrame = (pts: number[][]) =>
      pts.every((p) => Math.abs(p[0]) <= limit && Math.abs(p[1]) <= limit);
    if (!inFrame(b.top) || !inFrame(b.right) || !inFrame(b.bottom) || !inFrame(b.left)) {
      return "invalid";
    }
    boundary = {
      space: "oriented-source-pixels",
      representation: "piecewise-curve-v1",
      top: b.top.map((p) => [p[0], p[1]]),
      right: b.right.map((p) => [p[0], p[1]]),
      bottom: b.bottom.map((p) => [p[0], p[1]]),
      left: b.left.map((p) => [p[0], p[1]]),
    };
  }

  let manualResidual: GeometryRecipe["manualResidual"];
  if (o.manualResidual != null) {
    const m = o.manualResidual as Record<string, unknown>;
    if (!m || m.space !== "unit-output" || m.basis !== "coons-residual-v1") return "invalid";
    if (!isKnotList(m.top) || !isKnotList(m.right) || !isKnotList(m.bottom) || !isKnotList(m.left)) {
      return "invalid";
    }
    manualResidual = {
      space: "unit-output",
      basis: "coons-residual-v1",
      top: m.top.map((k) => [k[0], k[1], k[2]] as ResidualKnot),
      right: m.right.map((k) => [k[0], k[1], k[2]] as ResidualKnot),
      bottom: m.bottom.map((k) => [k[0], k[1], k[2]] as ResidualKnot),
      left: m.left.map((k) => [k[0], k[1], k[2]] as ResidualKnot),
    };
  }

  const target = o.target as Record<string, unknown> | undefined;
  if (!target || !finite(target.aspect) || target.aspect <= 0) return "invalid";
  if (!finite(target.width) || !finite(target.height) || target.width < 1 || target.height < 1) {
    return "invalid";
  }
  if (
    target.aspectSource !== "artwork_dimensions" &&
    target.aspectSource !== "user" &&
    target.aspectSource !== "estimated"
  ) {
    return "invalid";
  }
  const sampling = o.sampling as Record<string, unknown> | undefined;
  if (
    !sampling ||
    typeof sampling.version !== "string" ||
    sampling.interpolation !== "bilinear-premultiplied-v1" ||
    sampling.alphaPolicy !== "coverage-omit-exterior-v1"
  ) {
    return "invalid";
  }
  const diagnostics = o.diagnostics as Record<string, unknown> | undefined;
  if (!diagnostics) return "invalid";
  const num4 = (v: unknown) =>
    Array.isArray(v) && v.length === 4 && v.every((n) => finite(n));
  if (!num4(diagnostics.edgeCoverage) || !num4(diagnostics.beforeErrorPx) || !num4(diagnostics.afterErrorPx)) {
    return "invalid";
  }
  if (!finite(diagnostics.evaluationScale)) return "invalid";
  if (diagnostics.reason != null && typeof diagnostics.reason !== "string") return "invalid";

  if ((method === "radial" || method === "boundary_traced" || method === "boundary_manual") && status === "applied") {
    if (!radial && method === "radial") return "invalid";
    if (!isHomography(matrix)) return "invalid";
  }

  const recipe: GeometryRecipe = {
    version: 1,
    engineVersion: o.engineVersion,
    method,
    status,
    source: {
      width: source.width as number,
      height: source.height as number,
      orientationContract: "exif-applied-once-v1",
      coordinateContract: "image-edge-pixel-center-v1",
    },
    radial,
    unitOutputToUndistortedSource: matrix == null ? null : [...(matrix as number[])],
    boundary,
    target: {
      aspect: target.aspect as number,
      aspectSource: target.aspectSource,
      width: Math.round(target.width as number),
      height: Math.round(target.height as number),
    },
    sampling: {
      version: sampling.version,
      interpolation: "bilinear-premultiplied-v1",
      alphaPolicy: "coverage-omit-exterior-v1",
    },
    diagnostics: {
      edgeCoverage: [...(diagnostics.edgeCoverage as number[])],
      beforeErrorPx: [...(diagnostics.beforeErrorPx as number[])],
      afterErrorPx: [...(diagnostics.afterErrorPx as number[])],
      evaluationScale: diagnostics.evaluationScale as number,
      reason: typeof diagnostics.reason === "string" ? diagnostics.reason : null,
    },
  };
  if (manualResidual) recipe.manualResidual = manualResidual;
  return recipe;
}

export function homographyToArray(h: Homography): number[] {
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]];
}
