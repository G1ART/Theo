/**
 * One inverse map from the frontal rectangle back to the photo.
 *
 * The rectangle crop is the four confirmed corners and one homography.
 * A radial coefficient, a per-edge curve, or a residual displacement
 * field would resample the interior and ripple a flat painting, so
 * none of those move pixels. A bow can still be measured elsewhere.
 * That measurement stays off the sampler. The rectangle path does not
 * repaint inward by wall color.
 */

import {
  applyHomography,
  estimateRectifiedAspect,
  solveHomography,
  type Homography,
  type Point2,
} from "./homography";
import {
  GEOMETRY_ENGINE_VERSION,
  GEOMETRY_EVAL_LONG_EDGE,
  homographyToArray,
  outputSizeForAspect,
  type GeometryRecipe,
  type Point,
  type Raster,
  type ResidualKnot,
} from "./geometryPlan";
import type { RadialModel } from "./radialDistortion";

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
  /**
   * Accepted so the existing wizard can keep sending a bow coefficient.
   * It does not move pixels.
   */
  manualK1?: number | null;
  /** Accepted so the existing wizard can keep sending edge nudges. Not applied. */
  nudges?: EdgeNudges | null;
  targetAspect?: number | null;
  aspectSource: "artwork_dimensions" | "user" | "estimated";
  longEdge: number;
};

export type RectifyPlan = {
  recipe: GeometryRecipe;
  kind: "copy" | "map";
  copyRect?: { x: number; y: number; w: number; h: number };
  /** Always null. A radial field is not applied to the rectangle crop. */
  radial: RadialModel | null;
  unitToUndistorted: Homography | null;
  /** Always null. Residual knots are not applied to the rectangle crop. */
  knots: [ResidualKnot[], ResidualKnot[], ResidualKnot[], ResidualKnot[]] | null;
  mask: Uint8Array | null;
  /** Always null. Per-edge curves are not applied to the rectangle crop. */
  sampleCurves: [Point[], Point[], Point[], Point[]] | null;
  contentMask: Uint8Array | null;
  pullToward: Point | null;
};

export function planArtworkRectification(req: RectifyRequest): RectifyPlan {
  const { corners, frame } = req;
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

  // `off` records that curvature was not requested. The pixels are the
  // same four-corner homography either way. manualK1 and nudges are
  // not read: applying them ripples the interior.
  if (req.mode === "off") {
    return perspectivePlan(req, sourceCorners, aspect, size, "disabled", "disabled");
  }
  if (axisAligned(corners, Math.max(1.25, Math.min(req.raster.width, req.raster.height) * 0.005))) {
    return copyPlan(req, aspect, "already_straight", "already_straight");
  }
  return perspectivePlan(req, sourceCorners, aspect, size, "applied", "perspective");
}

function perspectivePlan(
  req: RectifyRequest,
  sourceCorners: [Point, Point, Point, Point],
  aspect: number,
  size: { width: number; height: number },
  status: GeometryRecipe["status"],
  reason: string,
): RectifyPlan {
  if (axisAligned(req.corners, Math.max(1.25, Math.min(req.raster.width, req.raster.height) * 0.005))) {
    return copyPlan(req, aspect, status, reason);
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
      matrix: unitH ? homographyToArray(unitH) : null,
      aspect,
      aspectSource: req.aspectSource,
      size,
      reason,
    }),
    kind: "map",
    radial: null,
    unitToUndistorted: unitH,
    knots: null,
    mask: null,
    sampleCurves: null,
    contentMask: null,
    pullToward: null,
  };
}

function copyPlan(
  req: RectifyRequest,
  aspect: number,
  status: GeometryRecipe["status"],
  reason: string,
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
      matrix: null,
      aspect,
      aspectSource: req.aspectSource,
      size: {
        width: Math.max(1, Math.round(x1 - x0)),
        height: Math.max(1, Math.round(y1 - y0)),
      },
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
    sampleCurves: null,
    contentMask: null,
    pullToward: null,
  };
}

function recipeOf(args: {
  frame: FrameWindow;
  method: GeometryRecipe["method"];
  status: GeometryRecipe["status"];
  matrix: number[] | null;
  aspect: number;
  aspectSource: GeometryRecipe["target"]["aspectSource"];
  size: { width: number; height: number };
  reason: string;
}): GeometryRecipe {
  return {
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
    radial: null,
    unitOutputToUndistortedSource: args.matrix,
    boundary: null,
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
      edgeCoverage: [0, 0, 0, 0],
      beforeErrorPx: [0, 0, 0, 0],
      afterErrorPx: [0, 0, 0, 0],
      evaluationScale: GEOMETRY_EVAL_LONG_EDGE,
      reason: args.reason,
    },
  };
}

export function bufferToSource(p: Point, frame: FrameWindow): Point {
  return [frame.originX + p[0] / frame.scaleX, frame.originY + p[1] / frame.scaleY];
}

export function sourceToBuffer(p: Point, frame: FrameWindow): Point {
  return [(p[0] - frame.originX) * frame.scaleX, (p[1] - frame.originY) * frame.scaleY];
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

/** Unit square → source photo. The map is the corner homography alone. */
export function mapUnitToSource(plan: RectifyPlan, xi: number, eta: number): Point | null {
  if (!plan.unitToUndistorted) return null;
  const u = applyHomography(plan.unitToUndistorted, [xi, eta] as Point2);
  return u ? [u[0], u[1]] : null;
}

function bufferForUnit(plan: RectifyPlan, frame: FrameWindow, xi: number, eta: number): Point | null {
  const source = mapUnitToSource(plan, xi, eta);
  if (!source) return null;
  return sourceToBuffer(source, frame);
}

/**
 * Fill the frontal rectangle by the corner homography. Samples are not
 * walked inward, and the row is not repainted by wall color.
 * Transparent pixels would become white triangles on the studio wall,
 * so those holes are sealed by the caller.
 */
export function paintMappedRows(
  raster: Raster,
  plan: RectifyPlan,
  frame: FrameWindow,
  dest: Uint8ClampedArray,
  row0: number,
  row1: number,
): void {
  const outW = plan.recipe.target.width;
  const outH = plan.recipe.target.height;
  for (let row = row0; row < row1 && row < outH; row += 1) {
    const eta = (row + 0.5) / outH;
    for (let col = 0; col < outW; col += 1) {
      const buf = bufferForUnit(plan, frame, (col + 0.5) / outW, eta);
      if (!buf) continue;
      const sample = sampleBilinear(raster, buf[0], buf[1]);
      if (!sample || sample.a < 16) continue;
      const di = (row * outW + col) * 4;
      dest[di] = clampByte(sample.r);
      dest[di + 1] = clampByte(sample.g);
      dest[di + 2] = clampByte(sample.b);
      dest[di + 3] = sample.a >= 200 ? 255 : clampByte(sample.a);
    }
  }
}

/** Copy the nearest interior pixel into a destination hole. Does not invent wall white. */
export function sealUncoveredArtwork(data: Uint8ClampedArray, width: number, height: number): void {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const holes: number[] = [];
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 16) holes.push((i - 3) >> 2);
  }
  if (holes.length === 0) return;
  for (const idx of holes) {
    const x = idx % width;
    const y = (idx / width) | 0;
    const dx = cx - x;
    const dy = cy - y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    const ux = dx / len;
    const uy = dy / len;
    for (let d = 1; d <= len; d += 1) {
      const sx = Math.round(x + ux * d);
      const sy = Math.round(y + uy * d);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const si = (sy * width + sx) * 4;
      if (data[si + 3] < 16) continue;
      const di = idx * 4;
      data[di] = data[si];
      data[di + 1] = data[si + 1];
      data[di + 2] = data[si + 2];
      data[di + 3] = 255;
      break;
    }
  }
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
  paintMappedRows(raster, plan, frame, data, 0, outH);
  sealUncoveredArtwork(data, outW, outH);
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
