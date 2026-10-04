/**
 * One inverse map from the frontal rectangle back to the photo:
 *   unit point → residual displacement → homography⁻¹ → radial D → S
 *
 * The rectangle crop does not repaint inward by wall color. Coverage
 * comes from the traced contour, not from RGB.
 */

import {
  applyHomography,
  estimateRectifiedAspect,
  invertHomography,
  solveHomography,
  type Homography,
  type Point2,
} from "./homography";
import {
  GEOMETRY_ENGINE_VERSION,
  GEOMETRY_EVAL_LONG_EDGE,
  homographyToArray,
  outputSizeForAspect,
  rms,
  toReferencePx,
  type GeometryRecipe,
  type Point,
  type Raster,
  type ResidualKnot,
} from "./geometryPlan";
import {
  distortPoint,
  fitRadialK1,
  lineDistance,
  radialModel,
  radialSafe,
  maxNormalizedRadius,
  undistortPoint,
  type FitPoint,
  type RadialModel,
} from "./radialDistortion";
import { traceArtworkEdges, tracedPolygon, type ArtworkTrace, type TracedEdge } from "./traceArtworkEdges";

export type FrameWindow = {
  width: number;
  height: number;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
};

export type EdgeNudges = { top: number; right: number; bottom: number; left: number };

export type RectifyRequest = {
  raster: Raster;
  /** Corners in the raster's pixel-edge coordinates, TL TR BR BL. */
  corners: [Point, Point, Point, Point];
  frame: FrameWindow;
  mode: "auto" | "off" | "adjust";
  manualK1?: number | null;
  nudges?: EdgeNudges | null;
  targetAspect?: number | null;
  aspectSource: "artwork_dimensions" | "user" | "estimated";
  longEdge: number;
};

export type RectifyPlan = {
  recipe: GeometryRecipe;
  kind: "copy" | "map";
  copyRect?: { x: number; y: number; w: number; h: number };
  radial: RadialModel | null;
  unitToUndistorted: Homography | null;
  knots: [ResidualKnot[], ResidualKnot[], ResidualKnot[], ResidualKnot[]] | null;
  mask: Uint8Array | null;
};

const ZERO_NUDGE: EdgeNudges = { top: 0, right: 0, bottom: 0, left: 0 };

export function planArtworkRectification(req: RectifyRequest): RectifyPlan {
  const { raster, corners, frame } = req;
  const aspect =
    req.targetAspect && req.targetAspect > 0
      ? req.targetAspect
      : estimateRectifiedAspect(corners);
  const size = outputSizeForAspect(req.longEdge, aspect);
  const sourceCorners = corners.map((p) => bufferToSource(p, frame)) as [
    Point,
    Point,
    Point,
    Point,
  ];

  if (req.mode === "off") {
    return perspectivePlan(req, sourceCorners, aspect, size, "disabled", "disabled", null);
  }

  const trace = traceArtworkEdges(raster.data, raster.width, raster.height, corners);
  applyNudges(trace, req.mode === "adjust" ? req.nudges ?? ZERO_NUDGE : ZERO_NUDGE);
  const fringe = trace.edges.some((e) => e.fringe);
  if (fringe) {
    return perspectivePlan(req, sourceCorners, aspect, size, "needs_review", "fringe", trace);
  }

  const fitPoints = fitPointsFromTrace(trace, frame);
  const fit = fitRadialK1(frame.width, frame.height, sourceCorners, fitPoints);
  let model = fit.model;
  let radialAccepted = fit.accepted;
  if (req.mode === "adjust" && typeof req.manualK1 === "number" && Number.isFinite(req.manualK1)) {
    const manual = radialModel(frame.width, frame.height, req.manualK1, 0);
    if (radialSafe(manual, maxNormalizedRadius(frame.width, frame.height, manual))) {
      model = manual;
      radialAccepted = Math.abs(req.manualK1) >= 0.004;
    }
  }

  const undistorted = sourceCorners.map((c) => undistortPoint(c, model));
  if (undistorted.some((p) => p == null)) {
    return perspectivePlan(req, sourceCorners, aspect, size, "needs_review", "undistort_failed", trace);
  }
  const uCorners = undistorted as [Point, Point, Point, Point];
  const H = solveHomography(
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    uCorners,
  );
  const Hinv = H ? invertHomography(H) : null;
  if (!H || !Hinv) {
    return perspectivePlan(req, sourceCorners, aspect, size, "failed", "homography", trace);
  }

  const knots = residualKnots(trace, frame, model, Hinv);
  const residual = residualMagnitude(knots);
  const coverage = trace.edges.map((e) => e.coverage);
  const straightEdges = residual < 0.004 && !radialAccepted;
  const bowed =
    trace.edges.filter((e) => !e.fringe && e.coverage >= 0.5 && Math.abs(e.medianOffset) >= 1.25)
      .length >= 3;
  const manual = req.mode === "adjust" && hasNudge(req.nudges);
  const useBoundary =
    (manual || (!radialAccepted && bowed && residual >= 0.008 && coverage.every((c) => c >= 0.45))) &&
    boundarySafe(knots);

  if (useBoundary && !jacobianPositive(H, model, knots, frame)) {
    return perspectivePlan(req, sourceCorners, aspect, size, "needs_review", "jacobian", trace);
  }

  const errors = edgeErrors(trace, frame, model, Hinv, useBoundary ? knots : null);
  const method = manual
    ? "boundary_manual"
    : useBoundary
      ? "boundary_traced"
      : radialAccepted
        ? "radial"
        : straightEdges && axisAligned(corners, Math.max(1.25, Math.min(raster.width, raster.height) * 0.005))
          ? "identity"
          : "perspective";

  if (method === "identity") {
    return copyPlan(req, sourceCorners, aspect, size, "already_straight", "already_straight", errors, coverage);
  }

  const status = method === "perspective" && !straightEdges && bowed ? "needs_review" : "applied";
  const reason =
    method === "boundary_manual"
      ? "manual"
      : method === "boundary_traced"
        ? radialAccepted
          ? "radial+boundary"
          : "boundary_traced"
        : method === "radial"
          ? "radial"
          : status === "needs_review"
            ? "low_confidence"
            : "perspective";

  const maskPoly = method === "radial" || method === "boundary_traced" || method === "boundary_manual"
    ? tracedPolygon(trace)
    : null;

  return {
    recipe: recipeOf({
      frame,
      method,
      status: status === "needs_review" && method === "perspective" ? "needs_review" : "applied",
      radial: method === "perspective" ? null : model,
      matrix: homographyToArray(H),
      boundary: boundarySource(trace, frame),
      knots: method === "boundary_traced" || method === "boundary_manual" ? knots : null,
      aspect,
      aspectSource: req.aspectSource,
      size,
      coverage,
      errors,
      reason,
    }),
    kind: "map",
    radial: method === "perspective" ? null : model.k1 === 0 && model.k2 === 0 ? null : model,
    unitToUndistorted: H,
    knots: method === "boundary_traced" || method === "boundary_manual" ? knots : null,
    mask: maskPoly ? rasterizePolygon(maskPoly, raster.width, raster.height) : null,
  };
}

function perspectivePlan(
  req: RectifyRequest,
  sourceCorners: [Point, Point, Point, Point],
  aspect: number,
  size: { width: number; height: number },
  status: GeometryRecipe["status"],
  reason: string,
  trace: ArtworkTrace | null,
): RectifyPlan {
  if (axisAligned(req.corners, Math.max(1.25, Math.min(req.raster.width, req.raster.height) * 0.005))) {
    return copyPlan(req, sourceCorners, aspect, size, status, reason, emptyErrors(), coverages(trace));
  }
  const unitH = solveHomography(
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    sourceCorners,
  );
  return {
    recipe: recipeOf({
      frame: req.frame,
      method: "perspective",
      status,
      radial: null,
      matrix: unitH ? homographyToArray(unitH) : null,
      boundary: null,
      knots: null,
      aspect,
      aspectSource: req.aspectSource,
      size,
      coverage: coverages(trace),
      errors: emptyErrors(),
      reason,
    }),
    kind: "map",
    radial: null,
    unitToUndistorted: unitH,
    knots: null,
    mask: null,
  };
}

function copyPlan(
  req: RectifyRequest,
  sourceCorners: [Point, Point, Point, Point],
  aspect: number,
  size: { width: number; height: number },
  status: GeometryRecipe["status"],
  reason: string,
  errors: { before: number[]; after: number[] },
  coverage: number[],
): RectifyPlan {
  const xs = req.corners.map((p) => p[0]);
  const ys = req.corners.map((p) => p[1]);
  const x0 = Math.max(0, Math.min(...xs));
  const y0 = Math.max(0, Math.min(...ys));
  const x1 = Math.min(req.raster.width, Math.max(...xs));
  const y1 = Math.min(req.raster.height, Math.max(...ys));
  return {
    recipe: recipeOf({
      frame: req.frame,
      method: "identity",
      status,
      radial: null,
      matrix: null,
      boundary: null,
      knots: null,
      aspect,
      aspectSource: req.aspectSource,
      size: {
        width: Math.max(1, Math.round(x1 - x0)),
        height: Math.max(1, Math.round(y1 - y0)),
      },
      coverage,
      errors,
      reason,
    }),
    kind: "copy",
    copyRect: {
      x: Math.floor(x0),
      y: Math.floor(y0),
      w: Math.max(1, Math.round(x1 - x0)),
      h: Math.max(1, Math.round(y1 - y0)),
    },
    radial: null,
    unitToUndistorted: null,
    knots: null,
    mask: null,
  };
}

function recipeOf(args: {
  frame: FrameWindow;
  method: GeometryRecipe["method"];
  status: GeometryRecipe["status"];
  radial: RadialModel | null;
  matrix: number[] | null;
  boundary: GeometryRecipe["boundary"];
  knots: [ResidualKnot[], ResidualKnot[], ResidualKnot[], ResidualKnot[]] | null;
  aspect: number;
  aspectSource: GeometryRecipe["target"]["aspectSource"];
  size: { width: number; height: number };
  coverage: number[];
  errors: { before: number[]; after: number[] };
  reason: string;
}): GeometryRecipe {
  const recipe: GeometryRecipe = {
    version: 1,
    engineVersion: GEOMETRY_ENGINE_VERSION,
    method: args.method,
    status: args.status,
    source: {
      width: args.frame.width,
      height: args.frame.height,
      orientationContract: "exif-applied-once-v1",
      coordinateContract: "image-edge-pixel-center-v1",
    },
    radial:
      args.radial && (args.method === "radial" || args.method === "boundary_traced" || args.method === "boundary_manual")
        ? {
            cx: args.radial.cx,
            cy: args.radial.cy,
            scale: args.radial.scale,
            k1: args.radial.k1,
            k2: args.radial.k2,
            model: "residual-polynomial-v1",
          }
        : null,
    unitOutputToUndistortedSource: args.matrix,
    boundary: args.boundary,
    target: {
      aspect: args.aspect,
      aspectSource: args.aspectSource,
      width: args.size.width,
      height: args.size.height,
    },
    sampling: {
      version: GEOMETRY_ENGINE_VERSION,
      interpolation: "bilinear-premultiplied-v1",
      alphaPolicy: "coverage-omit-exterior-v1",
    },
    diagnostics: {
      edgeCoverage: args.coverage,
      beforeErrorPx: args.errors.before,
      afterErrorPx: args.errors.after,
      evaluationScale: GEOMETRY_EVAL_LONG_EDGE,
      reason: args.reason,
    },
  };
  if (args.knots && (args.method === "boundary_traced" || args.method === "boundary_manual")) {
    recipe.manualResidual = {
      space: "unit-output",
      basis: "coons-residual-v1",
      top: args.knots[0],
      right: args.knots[1],
      bottom: args.knots[2],
      left: args.knots[3],
    };
  }
  return recipe;
}

export function bufferToSource(p: Point, frame: FrameWindow): Point {
  return [frame.originX + p[0] / frame.scaleX, frame.originY + p[1] / frame.scaleY];
}

export function sourceToBuffer(p: Point, frame: FrameWindow): Point {
  return [(p[0] - frame.originX) * frame.scaleX, (p[1] - frame.originY) * frame.scaleY];
}

function applyNudges(trace: ArtworkTrace, nudges: EdgeNudges): void {
  const values = [nudges.top, nudges.right, nudges.bottom, nudges.left];
  trace.edges.forEach((edge, idx) => {
    const extra = values[idx];
    if (!extra) return;
    for (const point of edge.points) {
      if (point.t === 0 || point.t === 1) continue;
      const ramp = Math.min(1, Math.min(point.t, 1 - point.t) / 0.12);
      const o = extra * ramp;
      point.x += edge.normal[0] * o;
      point.y += edge.normal[1] * o;
      point.offsetPx += o;
    }
  });
}

function hasNudge(nudges: EdgeNudges | null | undefined): boolean {
  if (!nudges) return false;
  return Math.abs(nudges.top) + Math.abs(nudges.right) + Math.abs(nudges.bottom) + Math.abs(nudges.left) > 0.5;
}

function fitPointsFromTrace(trace: ArtworkTrace, frame: FrameWindow): FitPoint[] {
  const out: FitPoint[] = [];
  trace.edges.forEach((edge, edgeIndex) => {
    for (const point of edge.points) {
      if (!point.observed || point.weight <= 0) continue;
      out.push({
        edge: edgeIndex as 0 | 1 | 2 | 3,
        p: bufferToSource([point.x, point.y], frame),
        heldOut: point.heldOut,
        weight: point.weight,
      });
    }
  });
  return out;
}

function residualKnots(
  trace: ArtworkTrace,
  frame: FrameWindow,
  model: RadialModel,
  Hinv: Homography,
): [ResidualKnot[], ResidualKnot[], ResidualKnot[], ResidualKnot[]] {
  return trace.edges.map((edge, index) => knotsForEdge(edge, index, frame, model, Hinv)) as [
    ResidualKnot[],
    ResidualKnot[],
    ResidualKnot[],
    ResidualKnot[],
  ];
}

function knotsForEdge(
  edge: TracedEdge,
  index: number,
  frame: FrameWindow,
  model: RadialModel,
  Hinv: Homography,
): ResidualKnot[] {
  const knots: ResidualKnot[] = [[0, 0, 0]];
  for (let i = 0; i < edge.points.length; i += 4) {
    const point = edge.points[i];
    if (point.t === 0 || point.t === 1) continue;
    if (!point.observed && point.weight <= 0) continue;
    const source = bufferToSource([point.x, point.y], frame);
    const u = undistortPoint(source, model);
    if (!u) continue;
    const unit = applyHomography(Hinv, u);
    if (!unit) continue;
    const delta = deltaFor(index, point.t, unit);
    knots.push([round5(point.t), round5(delta[0]), round5(delta[1])]);
  }
  knots.push([1, 0, 0]);
  knots.sort((a, b) => a[0] - b[0]);
  const compact: ResidualKnot[] = [];
  for (const knot of knots) {
    const prev = compact[compact.length - 1];
    if (prev && Math.abs(prev[0] - knot[0]) < 1e-4) compact[compact.length - 1] = knot;
    else compact.push(knot);
  }
  return compact;
}

function deltaFor(edge: number, t: number, unit: Point2): Point {
  const clamped = Math.min(1, Math.max(0, t));
  if (edge === 0) return [unit[0] - clamped, unit[1]];
  if (edge === 1) return [unit[0] - 1, unit[1] - clamped];
  if (edge === 2) return [unit[0] - clamped, unit[1] - 1];
  return [unit[0], unit[1] - clamped];
}

function residualMagnitude(knots: ResidualKnot[][]): number {
  let max = 0;
  for (const edge of knots) {
    for (const knot of edge) max = Math.max(max, Math.hypot(knot[1], knot[2]));
  }
  return max;
}

function boundarySafe(knots: ResidualKnot[][]): boolean {
  const top = knots[0];
  const right = knots[1];
  const bottom = knots[2];
  const left = knots[3];
  const ys = (edge: ResidualKnot[], base: number) => edge.map((k) => base + k[2]);
  const xs = (edge: ResidualKnot[], base: number) => edge.map((k) => base + k[1]);
  const topY = ys(top, 0);
  const botY = ys(bottom, 1);
  const leftX = xs(left, 0);
  const rightX = xs(right, 1);
  if (Math.max(...topY) >= Math.min(...botY) - 0.02) return false;
  if (Math.max(...leftX) >= Math.min(...rightX) - 0.02) return false;
  const all = knots.flat();
  return all.every((k) => Math.hypot(k[1], k[2]) <= 0.12);
}

function jacobianPositive(
  H: Homography,
  model: RadialModel,
  knots: [ResidualKnot[], ResidualKnot[], ResidualKnot[], ResidualKnot[]],
  frame: FrameWindow,
): boolean {
  const step = 0.08;
  for (let iy = 1; iy <= 4; iy += 1) {
    for (let ix = 1; ix <= 4; ix += 1) {
      const x = ix / 5;
      const y = iy / 5;
      const c = sourceAt(x, y, H, model, knots);
      const dx = sourceAt(x + step, y, H, model, knots);
      const dy = sourceAt(x, y + step, H, model, knots);
      if (!c || !dx || !dy) return false;
      const ax = (dx[0] - c[0]) / step;
      const ay = (dx[1] - c[1]) / step;
      const bx = (dy[0] - c[0]) / step;
      const by = (dy[1] - c[1]) / step;
      const det = ax * by - ay * bx;
      if (!(det > 0)) return false;
      if (Math.hypot(ax, ay) > Math.max(frame.width, frame.height) * 4) return false;
    }
  }
  return true;
}

function sourceAt(
  xi: number,
  eta: number,
  H: Homography,
  model: RadialModel,
  knots: [ResidualKnot[], ResidualKnot[], ResidualKnot[], ResidualKnot[]] | null,
): Point | null {
  const d = knots ? coons(xi, eta, knots) : [0, 0];
  const u = applyHomography(H, [xi + d[0], eta + d[1]]);
  if (!u) return null;
  return distortPoint(u, model);
}

export function coons(
  xi: number,
  eta: number,
  knots: [ResidualKnot[], ResidualKnot[], ResidualKnot[], ResidualKnot[]],
): Point {
  const top = sampleKnot(knots[0], xi);
  const bottom = sampleKnot(knots[2], xi);
  const left = sampleKnot(knots[3], eta);
  const right = sampleKnot(knots[1], eta);
  const c00 = sampleKnot(knots[0], 0);
  const c10 = sampleKnot(knots[0], 1);
  const c01 = sampleKnot(knots[2], 0);
  const c11 = sampleKnot(knots[2], 1);
  const bx = (1 - xi) * (1 - eta) * c00[0] + xi * (1 - eta) * c10[0] + (1 - xi) * eta * c01[0] + xi * eta * c11[0];
  const by = (1 - xi) * (1 - eta) * c00[1] + xi * (1 - eta) * c10[1] + (1 - xi) * eta * c01[1] + xi * eta * c11[1];
  return [
    (1 - eta) * top[0] + eta * bottom[0] + (1 - xi) * left[0] + xi * right[0] - bx,
    (1 - eta) * top[1] + eta * bottom[1] + (1 - xi) * left[1] + xi * right[1] - by,
  ];
}

function sampleKnot(knots: ResidualKnot[], t: number): Point {
  if (knots.length === 0) return [0, 0];
  const x = Math.min(1, Math.max(0, t));
  if (x <= knots[0][0]) return [knots[0][1], knots[0][2]];
  const last = knots[knots.length - 1];
  if (x >= last[0]) return [last[1], last[2]];
  for (let i = 1; i < knots.length; i += 1) {
    if (x <= knots[i][0]) {
      const a = knots[i - 1];
      const b = knots[i];
      const u = (x - a[0]) / (b[0] - a[0] || 1);
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
  }
  return [0, 0];
}

function edgeErrors(
  trace: ArtworkTrace,
  frame: FrameWindow,
  model: RadialModel,
  Hinv: Homography,
  knots: [ResidualKnot[], ResidualKnot[], ResidualKnot[], ResidualKnot[]] | null,
): { before: number[]; after: number[] } {
  const before: number[] = [];
  const after: number[] = [];
  const longEdge = Math.max(frame.width, frame.height);
  trace.edges.forEach((edge, index) => {
    const b: number[] = [];
    const a: number[] = [];
    const ends = [
      bufferToSource([edge.points[0].x, edge.points[0].y], frame),
      bufferToSource(
        [edge.points[edge.points.length - 1].x, edge.points[edge.points.length - 1].y],
        frame,
      ),
    ] as [Point, Point];
    for (const point of edge.points) {
      if (!point.heldOut || !point.observed) continue;
      const source = bufferToSource([point.x, point.y], frame);
      b.push(toReferencePx(lineDistance(source, ends[0], ends[1]), longEdge));
      if (knots) {
        const u = undistortPoint(source, model);
        const unit = u ? applyHomography(Hinv, u) : null;
        a.push(unit ? toReferencePx(Math.hypot(deltaFor(index, point.t, unit)[0], deltaFor(index, point.t, unit)[1]) * Math.max(frame.width, frame.height), longEdge) : b[b.length - 1]);
      } else {
        const u = undistortPoint(source, model);
        const ue = [undistortPoint(ends[0], model), undistortPoint(ends[1], model)];
        a.push(
          u && ue[0] && ue[1]
            ? toReferencePx(lineDistance(u, ue[0], ue[1]), longEdge)
            : b[b.length - 1],
        );
      }
    }
    before.push(rms(b));
    after.push(rms(a));
  });
  return { before, after };
}

function boundarySource(trace: ArtworkTrace, frame: FrameWindow): GeometryRecipe["boundary"] {
  const pack = (edge: TracedEdge) =>
    edge.points.filter((_, i) => i % 4 === 0 || i === edge.points.length - 1).map((p) => {
      const s = bufferToSource([p.x, p.y], frame);
      return [round5(s[0]), round5(s[1])];
    });
  return {
    space: "oriented-source-pixels",
    representation: "piecewise-curve-v1",
    top: pack(trace.edges[0]),
    right: pack(trace.edges[1]),
    bottom: pack(trace.edges[2]),
    left: pack(trace.edges[3]),
  };
}

function coverages(trace: ArtworkTrace | null): number[] {
  if (!trace) return [0, 0, 0, 0];
  return trace.edges.map((e) => e.coverage);
}

function emptyErrors(): { before: number[]; after: number[] } {
  return {
    before: [0, 0, 0, 0],
    after: [0, 0, 0, 0],
  };
}

function axisAligned(corners: [Point, Point, Point, Point], tol: number): boolean {
  const [tl, tr, br, bl] = corners;
  return (
    Math.abs(tl[1] - tr[1]) <= tol &&
    Math.abs(bl[1] - br[1]) <= tol &&
    Math.abs(tl[0] - bl[0]) <= tol &&
    Math.abs(tr[0] - br[0]) <= tol
  );
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

export function rasterizePolygon(poly: Point[], width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (poly.length < 3) return mask;
  let minY = height;
  let maxY = 0;
  for (const p of poly) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(height - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y += 1) {
    const scan = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const cross = (a[1] <= scan && b[1] > scan) || (b[1] <= scan && a[1] > scan);
      if (!cross) continue;
      const t = (scan - a[1]) / (b[1] - a[1]);
      xs.push(a[0] + t * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xStart = Math.max(0, Math.ceil(xs[i] - 0.5));
      const xEnd = Math.min(width - 1, Math.floor(xs[i + 1] + 0.5));
      for (let x = xStart; x <= xEnd; x += 1) mask[y * width + x] = 1;
    }
  }
  return mask;
}

export function sampleBilinear(
  raster: Raster,
  x: number,
  y: number,
  inside?: (ix: number, iy: number) => boolean,
): { r: number; g: number; b: number; a: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!(x >= 0 && y >= 0 && x <= raster.width && y <= raster.height)) return null;
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  let accR = 0;
  let accG = 0;
  let accB = 0;
  let accA = 0;
  let wsum = 0;
  const taps: Array<[number, number, number]> = [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x0 + 1, y0, tx * (1 - ty)],
    [x0, y0 + 1, (1 - tx) * ty],
    [x0 + 1, y0 + 1, tx * ty],
  ];
  for (const [ix, iy, wt] of taps) {
    if (wt <= 1e-8) continue;
    if (ix < 0 || iy < 0 || ix >= raster.width || iy >= raster.height) continue;
    if (inside && !inside(ix, iy)) continue;
    const i = (iy * raster.width + ix) * 4;
    const a = raster.data[i + 3] / 255;
    const w = wt * a;
    accR += raster.data[i] * w;
    accG += raster.data[i + 1] * w;
    accB += raster.data[i + 2] * w;
    accA += w;
    wsum += wt;
  }
  if (accA < 1e-5 || wsum < 1e-5) return null;
  return {
    r: accR / accA,
    g: accG / accA,
    b: accB / accA,
    a: (accA / wsum) * 255,
  };
}

export function mapUnitToSource(plan: RectifyPlan, xi: number, eta: number): Point | null {
  if (!plan.unitToUndistorted) return null;
  return sourceAt(xi, eta, plan.unitToUndistorted, plan.radial ?? radialIdentity(plan), plan.knots);
}

function radialIdentity(plan: RectifyPlan): RadialModel {
  return radialModel(plan.recipe.source.width, plan.recipe.source.height, 0, 0);
}

export function renderRectified(raster: Raster, plan: RectifyPlan, frame: FrameWindow): Raster {
  if (plan.kind === "copy" && plan.copyRect) {
    const { x, y, w, h } = plan.copyRect;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row += 1) {
      for (let col = 0; col < w; col += 1) {
        const sx = Math.min(raster.width - 1, Math.max(0, x + col));
        const sy = Math.min(raster.height - 1, Math.max(0, y + row));
        const si = (sy * raster.width + sx) * 4;
        const di = (row * w + col) * 4;
        data[di] = raster.data[si];
        data[di + 1] = raster.data[si + 1];
        data[di + 2] = raster.data[si + 2];
        data[di + 3] = raster.data[si + 3];
      }
    }
    return { data, width: w, height: h };
  }
  const outW = plan.recipe.target.width;
  const outH = plan.recipe.target.height;
  const data = new Uint8ClampedArray(outW * outH * 4);
  const inside = plan.mask
    ? (ix: number, iy: number) => plan.mask![iy * raster.width + ix] === 1
    : undefined;
  for (let row = 0; row < outH; row += 1) {
    for (let col = 0; col < outW; col += 1) {
      const xi = (col + 0.5) / outW;
      const eta = (row + 0.5) / outH;
      const source = mapUnitToSource(plan, xi, eta);
      if (!source) continue;
      const buf = sourceToBuffer(source, frame);
      const sample = sampleBilinear(raster, buf[0], buf[1], inside);
      if (!sample) continue;
      const di = (row * outW + col) * 4;
      data[di] = clampByte(sample.r);
      data[di + 1] = clampByte(sample.g);
      data[di + 2] = clampByte(sample.b);
      data[di + 3] = clampByte(sample.a);
    }
  }
  return { data, width: outW, height: outH };
}

function clampByte(n: number): number {
  if (n <= 0) return 0;
  if (n >= 255) return 255;
  return Math.round(n);
}

export function fullFrame(width: number, height: number): FrameWindow {
  return { width, height, originX: 0, originY: 0, scaleX: 1, scaleY: 1 };
}
