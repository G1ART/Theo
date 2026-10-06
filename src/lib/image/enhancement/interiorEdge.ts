/**
 * Measured curves between the confirmed corners.
 *
 * The rectangle crop does not sample through these curves. A Coons
 * patch of a traced bow remaps the interior and ripples a flat
 * painting. This measurement must not be wired back into the sampler.
 */

import type { Point } from "./geometryPlan";
import type { ArtworkTrace, TracedEdge } from "./traceArtworkEdges";

export type InteriorCurves = {
  /** Canvas side of the boundary, used as the sample mask. */
  content: [Point[], Point[], Point[], Point[]];
  /** Measured boundary. The frontal edge samples this curve. */
  sample: [Point[], Point[], Point[], Point[]];
  /** The corner chord and the canvas disagree enough to follow the curve. */
  follows: boolean;
  /** A confirmed corner sits on the wall, off the canvas. */
  cornerOutside: boolean;
  maxAbsOffset: number;
};

const HOLD_MIN_PX = 1.6;

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function edgeEnds(trace: ArtworkTrace, index: number): [Point, Point] {
  const c = trace.corners;
  if (index === 0) return [c[0], c[1]];
  if (index === 1) return [c[1], c[2]];
  if (index === 2) return [c[3], c[2]];
  return [c[0], c[3]];
}

/**
 * A bow that passes through the corner is small at the first station
 * and larger further along. A handle sitting on the wall is already
 * offset at the first station, by about the same amount as its neighbors.
 */
function holdAtEnd(raw: Array<number | null>, fromStart: boolean): number | null {
  const n = raw.length;
  const limit = Math.max(3, Math.floor(n * 0.18));
  const samples: number[] = [];
  if (fromStart) {
    for (let i = 1; i < limit; i += 1) {
      if (raw[i] != null) samples.push(raw[i] as number);
    }
  } else {
    for (let i = n - 2; i > n - 1 - limit; i -= 1) {
      if (raw[i] != null) samples.push(raw[i] as number);
    }
  }
  if (samples.length < 2) return null;
  const nearest = samples[0];
  if (Math.abs(nearest) < HOLD_MIN_PX) return null;
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  if (peak < HOLD_MIN_PX) return null;
  if (Math.abs(nearest) < peak * 0.45) return null;
  return nearest;
}

function smoothOffsets(values: number[], restoreEnds: boolean): number[] {
  const n = values.length;
  const next = values.slice();
  for (let i = 1; i < n - 1; i += 1) {
    next[i] = values[i - 1] * 0.2 + values[i] * 0.6 + values[i + 1] * 0.2;
  }
  if (restoreEnds) {
    next[0] = values[0];
    next[n - 1] = values[n - 1];
  }
  return next;
}

function interpolateRaw(raw: Array<number | null>, fallback: number[]): number[] {
  const n = raw.length;
  const known: number[] = [];
  for (let i = 0; i < n; i += 1) if (raw[i] != null) known.push(i);
  if (known.length < 4) return fallback.slice();
  const out = fallback.slice();
  for (let k = 0; k < known.length - 1; k += 1) {
    const i0 = known[k];
    const i1 = known[k + 1];
    const v0 = raw[i0] as number;
    const v1 = raw[i1] as number;
    for (let i = i0; i <= i1; i += 1) {
      const u = (i - i0) / (i1 - i0 || 1);
      out[i] = v0 + (v1 - v0) * u;
    }
  }
  return out;
}

function seatOnDetection(pinned: number[], raw: Array<number | null>): number[] {
  const seated = pinned.slice();
  for (let i = 0; i < pinned.length; i += 1) {
    if (raw[i] == null) continue;
    seated[i] = raw[i] as number;
  }
  // A one-pixel smooth. Clamped to the detection so a deckled edge is
  // not pulled back onto the wall between the teeth.
  const next = seated.slice();
  for (let i = 1; i < seated.length - 1; i += 1) {
    if (raw[i] == null) continue;
    const blurred = seated[i - 1] * 0.25 + seated[i] * 0.5 + seated[i + 1] * 0.25;
    const limit = 1.25;
    next[i] = Math.max((raw[i] as number) - limit, Math.min((raw[i] as number) + limit, blurred));
  }
  return next;
}

/**
 * A one-station jump toward the wall. A lens bow, inward or outward,
 * moves a fraction of a pixel per station, so its peak is left alone.
 */
function closeWallSpikes(values: number[]): number[] {
  const out = values.slice();
  for (let i = 1; i < values.length - 1; i += 1) {
    const lip = Math.min(values[i - 1], values[i + 1]);
    if (values[i] < lip - 2.5) out[i] = lip;
  }
  return out;
}

function offsetsForEdge(edge: TracedEdge): { offsets: number[]; held: boolean } {
  const n = edge.points.length;
  const pinned = edge.points.map((point) => point.offsetPx);
  const raw = edge.points.map((point) => point.rawOffset);
  const sustained = raw.filter((value): value is number => value != null && Math.abs(value) >= HOLD_MIN_PX);
  const fringeLocked = edge.fringe && pinned.every((value) => Math.abs(value) < 0.5);
  // Thread fringe stays on the chord. A real edge is the measured
  // boundary. That curve is the straight side of the output, not a
  // cut inside it.
  let base = fringeLocked ? pinned : seatOnDetection(pinned, raw);
  if (fringeLocked && sustained.length >= 8) base = interpolateRaw(raw, pinned);
  base = closeWallSpikes(base);

  const startHold = holdAtEnd(raw, true);
  const endHold = holdAtEnd(raw, false);
  const offsets = base.slice();
  if (startHold != null) {
    const limit = Math.max(3, Math.floor(n * 0.18));
    let idx = 1;
    for (let i = 1; i < limit; i += 1) {
      if (raw[i] != null) {
        idx = i;
        break;
      }
    }
    for (let i = 0; i <= idx; i += 1) offsets[i] = startHold;
  }
  if (endHold != null) {
    const limit = Math.max(3, Math.floor(n * 0.18));
    let idx = n - 2;
    for (let i = n - 2; i > n - 1 - limit; i -= 1) {
      if (raw[i] != null) {
        idx = i;
        break;
      }
    }
    for (let i = idx; i < n; i += 1) offsets[i] = endHold;
  }
  return {
    offsets: smoothOffsets(offsets, startHold != null || endHold != null),
    held: startHold != null || endHold != null,
  };
}

function pointOnEdge(edge: TracedEdge, ends: [Point, Point], t: number, offset: number): Point {
  const [a, b] = ends;
  return [
    a[0] + (b[0] - a[0]) * t + edge.normal[0] * offset,
    a[1] + (b[1] - a[1]) * t + edge.normal[1] * offset,
  ];
}

function curveFromOffsets(edge: TracedEdge, ends: [Point, Point], offsets: number[]): Point[] {
  return edge.points.map((point, index) => pointOnEdge(edge, ends, point.t, offsets[index]));
}

function lineIntersect(a0: Point, a1: Point, b0: Point, b1: Point): Point | null {
  const dax = a1[0] - a0[0];
  const day = a1[1] - a0[1];
  const dbx = b1[0] - b0[0];
  const dby = b1[1] - b0[1];
  const det = dax * dby - day * dbx;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((b0[0] - a0[0]) * dby - (b0[1] - a0[1]) * dbx) / det;
  if (!Number.isFinite(t)) return null;
  return [a0[0] + t * dax, a0[1] + t * day];
}

function snapCorner(a0: Point, a1: Point, b0: Point, b1: Point): Point {
  if (Math.hypot(a0[0] - b0[0], a0[1] - b0[1]) < 0.8) {
    return [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
  }
  const hit = lineIntersect(a0, a1, b0, b1);
  if (!hit) return [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
  const span = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
  const shift = Math.hypot(hit[0] - a0[0], hit[1] - a0[1]);
  if (shift > Math.max(48, span * 6)) return [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
  return hit;
}

function shareCorners(curves: [Point[], Point[], Point[], Point[]], corners: [Point, Point, Point, Point]): void {
  const [top, right, bottom, left] = curves;
  const tl = snapCorner(top[0], top[1], left[0], left[1]);
  const tr = snapCorner(top[top.length - 1], top[top.length - 2], right[0], right[1]);
  const br = snapCorner(
    right[right.length - 1],
    right[right.length - 2],
    bottom[bottom.length - 1],
    bottom[bottom.length - 2],
  );
  const bl = snapCorner(left[left.length - 1], left[left.length - 2], bottom[0], bottom[1]);
  // A corner that already sits on the sol point stays there. A wild
  // intersection must not drag a straight corner into the wall.
  const keep = (hit: Point, sol: Point, current: Point): Point => {
    const moved = Math.hypot(current[0] - sol[0], current[1] - sol[1]);
    if (moved < 0.75) return sol;
    return hit;
  };
  const tlP = keep(tl, corners[0], top[0]);
  const trP = keep(tr, corners[1], top[top.length - 1]);
  const brP = keep(br, corners[2], right[right.length - 1]);
  const blP = keep(bl, corners[3], left[left.length - 1]);
  top[0] = tlP;
  left[0] = tlP;
  top[top.length - 1] = trP;
  right[0] = trP;
  right[right.length - 1] = brP;
  bottom[bottom.length - 1] = brP;
  left[left.length - 1] = blP;
  bottom[0] = blP;
}

/**
 * Snapping a corner onto the canvas can leave the next station back
 * on the wall side of that corner. The curve would hook outward and
 * the patch would sample wall just inside the destination edge.
 * Replace that hook with a straight run to the first station that
 * actually continues along the edge.
 */
function unwindHooks(curve: Point[]): void {
  unwindEnd(curve, true);
  unwindEnd(curve, false);
}

function unwindEnd(curve: Point[], fromStart: boolean): void {
  const n = curve.length;
  if (n < 4) return;
  const origin = fromStart ? 0 : n - 1;
  const step = fromStart ? 1 : -1;
  const head = curve[origin];
  const far = curve[Math.floor(n / 2)];
  const dx = far[0] - head[0];
  const dy = far[1] - head[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let join = -1;
  const limit = Math.floor(n * 0.35);
  for (let k = 1; k < limit; k += 1) {
    const i = origin + step * k;
    const along = (curve[i][0] - head[0]) * ux + (curve[i][1] - head[1]) * uy;
    if (along >= 2) {
      join = i;
      break;
    }
  }
  if (join < 0) return;
  const count = Math.abs(join - origin);
  for (let k = 1; k < count; k += 1) {
    const i = origin + step * k;
    const u = k / count;
    curve[i] = [
      head[0] + (curve[join][0] - head[0]) * u,
      head[1] + (curve[join][1] - head[1]) * u,
    ];
  }
}

function cloneCurves(
  curves: [Point[], Point[], Point[], Point[]],
): [Point[], Point[], Point[], Point[]] {
  return curves.map((curve) => curve.map((point) => [point[0], point[1]] as Point)) as [
    Point[],
    Point[],
    Point[],
    Point[],
  ];
}

export function buildInteriorCurves(
  trace: ArtworkTrace,
  _data: Uint8ClampedArray,
  _width: number,
  _height: number,
): InteriorCurves {
  const built = trace.edges.map((edge, index) => {
    const ends = edgeEnds(trace, index);
    const { offsets, held } = offsetsForEdge(edge);
    let maxAbs = 0;
    for (const offset of offsets) maxAbs = Math.max(maxAbs, Math.abs(offset));
    // The mask is about a pixel on the canvas side along the whole
    // edge, and meets the sol corner. A wall pixel sitting on the
    // measured boundary is not part of the mask. The sample curve
    // itself is not moved.
    const gate = offsets.map((offset, index) => {
      const t = offsets.length <= 1 ? 0 : index / (offsets.length - 1);
      const ramp = Math.min(1, Math.min(t, 1 - t) / 0.05);
      return offset + ramp * 1.15;
    });
    return {
      content: curveFromOffsets(edge, ends, gate),
      sample: curveFromOffsets(edge, ends, offsets),
      held,
      maxAbs,
    };
  });
  const content = built.map((edge) => edge.content) as [Point[], Point[], Point[], Point[]];
  const sample = built.map((edge) => edge.sample) as [Point[], Point[], Point[], Point[]];
  shareCorners(content, trace.corners);
  shareCorners(sample, trace.corners);
  for (const curve of content) unwindHooks(curve);
  for (const curve of sample) unwindHooks(curve);
  const maxAbsOffset = built.reduce((max, edge) => Math.max(max, edge.maxAbs), 0);
  return {
    content,
    sample: cloneCurves(sample),
    follows: maxAbsOffset >= 1.25 || built.some((edge) => edge.held),
    cornerOutside: built.some((edge) => edge.held),
    maxAbsOffset,
  };
}

export function polygonFromCurves(curves: [Point[], Point[], Point[], Point[]]): Point[] {
  const [top, right, bottom, left] = curves;
  const poly: Point[] = [];
  for (const point of top) poly.push(point);
  for (let i = 1; i < right.length; i += 1) poly.push(right[i]);
  for (let i = bottom.length - 2; i >= 0; i -= 1) poly.push(bottom[i]);
  for (let i = left.length - 2; i > 0; i -= 1) poly.push(left[i]);
  return poly;
}

export function curvesAreUsable(
  curves: [Point[], Point[], Point[], Point[]],
  width: number,
  height: number,
): boolean {
  const ys = (curve: Point[]) => curve.map((point) => point[1]);
  const xs = (curve: Point[]) => curve.map((point) => point[0]);
  const [top, right, bottom, left] = curves;
  if (Math.max(...ys(top)) >= Math.min(...ys(bottom)) - 1) return false;
  if (Math.max(...xs(left)) >= Math.min(...xs(right)) - 1) return false;
  const limit = Math.max(width, height) * 1.5;
  for (const curve of curves) {
    for (const point of curve) {
      if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false;
      if (Math.abs(point[0]) > limit || Math.abs(point[1]) > limit) return false;
    }
  }
  return coonsOrientation(curves);
}

function samplePolyline(curve: Point[], t: number): Point {
  const n = curve.length;
  if (n === 0) return [0, 0];
  if (n === 1) return curve[0];
  const x = clamp01(t) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const u = x - i;
  return [curve[i][0] + (curve[i + 1][0] - curve[i][0]) * u, curve[i][1] + (curve[i + 1][1] - curve[i][1]) * u];
}

/** Unit square → source buffer. Edge parameters land on the curves. */
export function coonsFromCurves(
  u: number,
  v: number,
  curves: [Point[], Point[], Point[], Point[]],
): Point {
  const uu = clamp01(u);
  const vv = clamp01(v);
  const top = samplePolyline(curves[0], uu);
  const right = samplePolyline(curves[1], vv);
  const bottom = samplePolyline(curves[2], uu);
  const left = samplePolyline(curves[3], vv);
  const tl = curves[0][0];
  const tr = curves[0][curves[0].length - 1];
  const br = curves[1][curves[1].length - 1];
  const bl = curves[3][curves[3].length - 1];
  const bx =
    (1 - uu) * (1 - vv) * tl[0] + uu * (1 - vv) * tr[0] + (1 - uu) * vv * bl[0] + uu * vv * br[0];
  const by =
    (1 - uu) * (1 - vv) * tl[1] + uu * (1 - vv) * tr[1] + (1 - uu) * vv * bl[1] + uu * vv * br[1];
  return [
    (1 - vv) * top[0] + vv * bottom[0] + (1 - uu) * left[0] + uu * right[0] - bx,
    (1 - vv) * top[1] + vv * bottom[1] + (1 - uu) * left[1] + uu * right[1] - by,
  ];
}

function coonsOrientation(curves: [Point[], Point[], Point[], Point[]]): boolean {
  const step = 0.12;
  for (let iy = 1; iy <= 3; iy += 1) {
    for (let ix = 1; ix <= 3; ix += 1) {
      const x = ix / 4;
      const y = iy / 4;
      const c = coonsFromCurves(x, y, curves);
      const dx = coonsFromCurves(x + step, y, curves);
      const dy = coonsFromCurves(x, y + step, curves);
      const ax = (dx[0] - c[0]) / step;
      const ay = (dx[1] - c[1]) / step;
      const bx = (dy[0] - c[0]) / step;
      const by = (dy[1] - c[1]) / step;
      if (!(ax * by - ay * bx > 0)) return false;
    }
  }
  return true;
}
