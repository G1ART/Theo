/**
 * Theo Image Enhance (Beta) — Perspective corner picker geometry
 * helpers (2026-08-07).
 *
 * Pure math extracted from `PerspectiveCornerPicker` so the constraints
 * (in-bounds clamp, minimum quadrilateral area, keyboard nudge) can be
 * unit-tested without a DOM. The picker itself is a thin React shell
 * that binds these to pointer + keyboard events.
 */

import type { NormalizedPoint } from "./types";

export type Quad = [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];
/** Index into a Quad — 0 TL, 1 TR, 2 BR, 3 BL. */
export type CornerIndex = 0 | 1 | 2 | 3;

/** A quad must occupy at least this fraction of the image area to
 *  avoid producing a degenerate homography. Matches the "10 % of image"
 *  rule from the release brief. */
export const MIN_AREA_FRACTION = 0.1;

/** Keyboard nudge deltas in pixels — plain arrow is 1 px, Shift+arrow
 *  is 10 px. Values are always applied in image-pixel space and then
 *  converted to the [0,1] normalized coordinates that `sourceCorners`
 *  uses. */
export const NUDGE_PX = 1;
export const NUDGE_SHIFT_PX = 10;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Signed polygon area via the shoelace formula. Positive = CCW,
 * negative = CW. We only care about absolute value.
 */
function polygonArea(quad: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i += 1) {
    const [x1, y1] = quad[i];
    const [x2, y2] = quad[(i + 1) % 4];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/**
 * Returns true when the four corners describe a non-degenerate
 * quadrilateral covering >= MIN_AREA_FRACTION of the image.
 */
export function hasValidArea(quad: Quad): boolean {
  return polygonArea(quad) >= MIN_AREA_FRACTION;
}

/** Clamp a normalized point into the [0,1] × [0,1] box. */
export function clampNormalized([x, y]: NormalizedPoint): NormalizedPoint {
  return [clamp01(x), clamp01(y)];
}

/**
 * Attempt to move `corner` in `quad` to `next` (both in normalized
 * coords). Returns the resulting quad. If the move would make the quad
 * degenerate (area < MIN_AREA_FRACTION) OR would push the point out of
 * bounds, the point is clamped to bounds first; if the result is still
 * invalid the ORIGINAL quad is returned unchanged.
 *
 * 2026-10-01 — in addition to the area + bounds guards, the attempt
 * must remain:
 *   - CONVEX (no self-intersecting butterfly / bowtie shape — see
 *     `isConvexQuad`), AND
 *   - in canonical TL/TR/BR/BL order (`isTlTrBrBlOrder`).
 *
 * Together these two reject the "flip a corner across its opposite
 * edge" moves that caused Island III to render upside-down (bulk
 * claim 2, 2026-09-30). The user is bounced back to their previous
 * valid position instead of silently landing on a crossed quad.
 *
 * This function is the single source of truth for "can I drag this
 * corner here?" — reused by both pointer drag and keyboard nudge.
 */
export function tryMoveCorner(
  quad: Quad,
  corner: CornerIndex,
  next: NormalizedPoint,
): Quad {
  const clamped = clampNormalized(next);
  const attempt: Quad = [quad[0], quad[1], quad[2], quad[3]] as Quad;
  attempt[corner] = clamped;
  if (!hasValidArea(attempt)) return quad;
  if (!isConvexQuad(attempt)) return quad;
  if (!isTlTrBrBlOrder(attempt)) return quad;
  return attempt;
}

/**
 * True when the four vertices of `quad` form a convex polygon in the
 * order given. Checked by walking the four edges and verifying that
 * every cross product `(p[i+1]-p[i]) × (p[i+2]-p[i+1])` has the same
 * sign — all positive (CCW) or all negative (CW). Any sign flip means
 * the polygon turns "inward" at that vertex, which is the signature of
 * a self-intersecting (butterfly) quad.
 *
 * Rationale: `hasValidArea` only checks the absolute shoelace area, so
 * a butterfly can pass with a modest-looking area while actually
 * crossing its own edges — that quad, fed to the perspective solver,
 * produces the "picture flipped on its side" result users reported in
 * the Island III thread (bulk claim 2, 2026-09-30).
 */
export function isConvexQuad(quad: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % 4];
    const [cx, cy] = quad[(i + 2) % 4];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (cross === 0) continue; // collinear — tolerate; area check catches degeneracy
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

/**
 * True when `quad[0..3]` match the canonical TL/TR/BR/BL ordering —
 * i.e., sorting the vertices by y-then-x and splitting them into top
 * row / bottom row recovers the same points in the same slots.
 * Companion to `isConvexQuad`: convexity alone is not enough — a
 * CCW-oriented quad whose TL / BR corners were swapped is still
 * "convex" but produces a mirrored homography. Enforcing the TL/TR/BR/BL
 * order keeps the mapping intuitive for the user.
 */
export function isTlTrBrBlOrder(quad: Quad): boolean {
  const ordered = orderQuadTlTrBrBl(quad);
  for (let i = 0; i < 4; i += 1) {
    if (quad[i][0] !== ordered[i][0] || quad[i][1] !== ordered[i][1]) {
      return false;
    }
  }
  return true;
}

/**
 * Compute the nudge delta (in normalized coords) for a keyboard event.
 * `imgW` / `imgH` are the current image pixel dimensions so that a
 * 1 px nudge on a 4000-wide image still equals exactly 1 px, not
 * 1/(image height) which would visibly warp.
 */
export function computeKeyNudge(
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  shiftKey: boolean,
  imgW: number,
  imgH: number,
): { dx: number; dy: number } {
  const px = shiftKey ? NUDGE_SHIFT_PX : NUDGE_PX;
  if (imgW <= 0 || imgH <= 0) return { dx: 0, dy: 0 };
  switch (key) {
    case "ArrowLeft":
      return { dx: -px / imgW, dy: 0 };
    case "ArrowRight":
      return { dx: px / imgW, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -px / imgH };
    case "ArrowDown":
      return { dx: 0, dy: px / imgH };
  }
}

/**
 * Default seed corners when the analyzer's rectangle confidence is
 * low. Uses a 10 % inset from each edge, per release brief.
 */
export function defaultInsetQuad(inset: number = 0.1): Quad {
  const lo = Math.max(0, Math.min(0.4, inset));
  const hi = 1 - lo;
  return [
    [lo, lo],
    [hi, lo],
    [hi, hi],
    [lo, hi],
  ];
}

/**
 * Cycle to the next corner (Tab support). Wraps around at 3 → 0.
 */
export function nextCorner(current: CornerIndex): CornerIndex {
  return ((current + 1) % 4) as CornerIndex;
}

/**
 * Build an axis-aligned quad from a `{ x, y, w, h }` rectangle. Used
 * to seed the picker from `analyze.suggestedCrop` when the detector
 * only produced a bounding box (all releases through 2026-08-07).
 * Returns `null` when the rect is degenerate.
 */
export function quadFromRect(
  rect: { x: number; y: number; w: number; h: number } | null | undefined,
): Quad | null {
  if (!rect) return null;
  const x0 = clamp01(rect.x);
  const y0 = clamp01(rect.y);
  const x1 = clamp01(rect.x + rect.w);
  const y1 = clamp01(rect.y + rect.h);
  const quad: Quad = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  return hasValidArea(quad) ? quad : null;
}

/**
 * Max deviation (in normalized [0,1] units) that any corner may be
 * from an axis-aligned rectangle for the quad to still count as
 * "axis-aligned enough to skip a warp." A rotated / keystoned quad
 * always exceeds this on at least one corner.
 */
export const AXIS_ALIGNED_TOLERANCE = 0.005;

/**
 * True when every corner of `quad` sits within `AXIS_ALIGNED_TOLERANCE`
 * of the smallest enclosing axis-aligned rectangle. Used by the
 * pipeline to decide whether a homography warp is worth running —
 * micro-jitter on an edge detector shouldn't rotate the whole image.
 */
export function isAxisAligned(quad: Quad): boolean {
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const targets: Quad = [
    [xMin, yMin],
    [xMax, yMin],
    [xMax, yMax],
    [xMin, yMax],
  ];
  for (let i = 0; i < 4; i += 1) {
    if (
      Math.abs(quad[i][0] - targets[i][0]) > AXIS_ALIGNED_TOLERANCE ||
      Math.abs(quad[i][1] - targets[i][1]) > AXIS_ALIGNED_TOLERANCE
    ) {
      return false;
    }
  }
  return true;
}

/** Reorder any 4 points into TL, TR, BR, BL. */
export function orderQuadTlTrBrBl(quad: Quad): Quad {
  const sorted = [...quad].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const top = sorted.slice(0, 2).sort((a, b) => a[0] - b[0]);
  const bottom = sorted.slice(2, 4).sort((a, b) => a[0] - b[0]);
  return [top[0], top[1], bottom[1], bottom[0]];
}

/**
 * Scale that turns one axis of a vision payload into [0, 1].
 * Fractions, including a corner that sits a hair past 1, stay put and
 * are clamped later. Only a max clearly above that range is the 0–1000
 * grid some models emit. Larger numbers are pixels when they still fit
 * the image we sent.
 */
export function visionAxisScale(max: number, axisSize?: number): number {
  if (!(max > 1.5)) return 1;
  if (max <= 1000.5) return 1000;
  if (axisSize && axisSize > 1 && max <= axisSize * 1.05) return axisSize;
  return 1;
}

export type VisionFrame = { width: number; height: number };

/**
 * True when the quad sits on the photo frame itself — the shape left
 * after an edge envelope is clamped to 0 and 1. A canvas that only
 * touches one side of the photo (two corners) is not this case.
 */
export function isPhotoBoundQuad(quad: Quad, eps = 0.004): boolean {
  let onFrame = 0;
  for (const [x, y] of quad) {
    if (x <= eps || x >= 1 - eps || y <= eps || y >= 1 - eps) onFrame += 1;
  }
  return onFrame >= 3;
}

const VISION_CORNER_MIN_CONFIDENCE = 0.5;

/**
 * Corners for a rectangle crop, taken from a painting-bbox vision
 * result. A missing corner list is not filled in with the photograph.
 * Confidence 1 on a full-frame bbox stays "no quad".
 */
export function rectangleCornersFromVision(input: {
  corners: Quad | null;
  bbox: { x: number; y: number; width: number; height: number } | null;
  confidence: number;
  alreadyTight: boolean;
}): { corners: Quad | null; confidence: number } {
  const confidence = Number.isFinite(input.confidence) ? input.confidence : 0;
  const parsed =
    input.corners && hasValidArea(input.corners) && !isPhotoBoundQuad(input.corners)
      ? input.corners
      : null;
  if (parsed && confidence >= VISION_CORNER_MIN_CONFIDENCE) {
    return { corners: parsed, confidence };
  }
  if (!input.alreadyTight && confidence >= VISION_CORNER_MIN_CONFIDENCE && input.bbox) {
    const box = input.bbox;
    const area = box.width * box.height;
    if (area >= 0.12 && area <= 0.92 && box.width >= 0.2 && box.height >= 0.2) {
      const fromBox = quadFromRect({ x: box.x, y: box.y, w: box.width, h: box.height });
      if (fromBox && !isPhotoBoundQuad(fromBox)) {
        return { corners: fromBox, confidence };
      }
    }
  }
  return { corners: null, confidence };
}

/**
 * What the rectangle picker shows. Vision owns the corners. A local
 * fit may fill in only when it is not the photograph's own frame.
 * Missing vision never becomes the unit square at confidence 1.
 */
export function resolveRectangleSeed(input: {
  committed?: Quad | null;
  vision?: Quad | null;
  matte?: Quad | null;
  edge?: Quad | null;
  edgeConfidence?: number | null;
}): Quad {
  if (input.committed && hasValidArea(input.committed)) return input.committed;
  if (input.vision && hasValidArea(input.vision) && !isPhotoBoundQuad(input.vision)) {
    return input.vision;
  }
  if (input.matte && hasValidArea(input.matte) && !isPhotoBoundQuad(input.matte)) {
    return input.matte;
  }
  const edgeConf = input.edgeConfidence ?? 0;
  if (
    input.edge &&
    hasValidArea(input.edge) &&
    edgeConf >= 0.55 &&
    !isPhotoBoundQuad(input.edge)
  ) {
    return input.edge;
  }
  return defaultInsetQuad(0.15);
}

export type RectangleVisionStatus = "idle" | "loading" | "ok" | "miss";

/**
 * Corner handles and the quad outline on the crop step.
 *
 * gpt-5.6-sol owns the rectangle. While that request is in progress
 * (`idle` or `loading`, the "사진 안에서 작품을 찾는 중…" chip) the
 * 15% inset placeholder is not drawn and cannot confirm a crop.
 * A usable sol quad is shown dashed, at those corners, with no slide
 * in from the placeholder. A miss is manual placement: the handles
 * come up so the artist can set the corners, and the inset is not
 * stroked as a detection.
 */
export function rectangleQuadChrome(input: {
  visionStatus: RectangleVisionStatus;
  hasSolQuad: boolean;
  /** Model confidence. A non-finite value is not a detection. */
  solConfidence?: number;
  skipped?: boolean;
  userAdjusted?: boolean;
}): {
  show: boolean;
  dashed: boolean;
  canCrop: boolean;
} {
  if (input.skipped) {
    return { show: false, dashed: false, canCrop: true };
  }
  if (input.visionStatus === "idle" || input.visionStatus === "loading") {
    return { show: false, dashed: false, canCrop: false };
  }
  if (input.visionStatus === "ok" && input.hasSolQuad) {
    const confidence = input.solConfidence ?? 0;
    return {
      show: true,
      dashed: !input.userAdjusted && Number.isFinite(confidence),
      canCrop: true,
    };
  }
  if (input.visionStatus === "miss") {
    // Handles so the artist can place corners. The outline is manual,
    // not a dashed detection of the 15% inset.
    return { show: true, dashed: false, canCrop: true };
  }
  return { show: false, dashed: false, canCrop: false };
}

/**
 * Parse a vision model `corners` payload (array of [x,y] or {x,y})
 * into a TL/TR/BR/BL quad. Returns null when the shape is unusable.
 * `frame` is the pixel size of the image the model saw, so a pixel
 * payload is not clamped into a single point at (1, 1).
 */
export function parseVisionCorners(raw: unknown, frame?: VisionFrame | null): Quad | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of raw) {
    let x = Number.NaN;
    let y = Number.NaN;
    if (Array.isArray(p) && p.length >= 2) {
      x = Number(p[0]);
      y = Number(p[1]);
    } else if (p && typeof p === "object") {
      const o = p as { x?: unknown; y?: unknown };
      x = Number(o.x);
      y = Number(o.y);
    } else {
      return null;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    xs.push(x);
    ys.push(y);
  }
  const xScale = visionAxisScale(Math.max(...xs), frame?.width);
  const yScale = visionAxisScale(Math.max(...ys), frame?.height);
  const pts = xs.map((x, i) => clampNormalized([x / xScale, (ys[i] ?? 0) / yScale]));
  const ordered = orderQuadTlTrBrBl(pts as Quad);
  return hasValidArea(ordered) ? ordered : null;
}

/**
 * G2/§FixB (2026-08-10) — pick a safe auto-seed for the perspective
 * warp when the user has not manually placed corners.
 *
 * Priority:
 *   1. Edge-detected corners (`suggestedRectangleCorners`) when the
 *      edge detector is at least moderately confident AND the
 *      analyzer's rectangle-in-frame heuristic also fires. The gate
 *      is deliberately permissive (edge >= 0.55) so straight-on
 *      captures with visible frame edges get straightened, while
 *      the `!isAxisAligned` bail-out still ensures we only warp
 *      quads that are actually rotated / keystoned.
 *   2. Bounding-box quad from the analyzer's suggested crop when
 *      rectangle confidence is high. This is axis-aligned so
 *      `isAxisAligned` returns true and the engine skips the warp
 *      (crop-only path) — matching pre-G5 behavior on straight-on
 *      captures.
 *   3. Null — analyzer isn't confident enough; leave the image
 *      alone.
 *
 * F3 (2026-08-10): edge-corner adoption gate loosened from 0.65 to
 * 0.55 after users reported false-negatives on legitimate keystoned
 * shots. The `!isAxisAligned` check plus `rectConf >= 0.55` keep the
 * safety net intact — a low-confidence rotated-envelope fit still
 * gets rejected by the rectangle heuristic before it lands here.
 */
export function resolveAutoCorners(analysis: {
  suggestedRectangleCorners?: Quad | null;
  suggestedRectangleConfidence?: number | null;
  suggestedCrop?: { x: number; y: number; w: number; h: number } | null;
  rectangleConfidence?: number;
}): Quad | null {
  const rectConf = analysis.rectangleConfidence ?? 0;
  const edgeConf = analysis.suggestedRectangleConfidence ?? 0;
  const edge = analysis.suggestedRectangleCorners ?? null;
  if (
    edge &&
    hasValidArea(edge) &&
    edgeConf >= 0.55 &&
    rectConf >= 0.55 &&
    !isAxisAligned(edge)
  ) {
    return edge;
  }
  if (rectConf >= 0.55) {
    const bbox = quadFromRect(analysis.suggestedCrop);
    if (bbox) return bbox;
  }
  return null;
}
