/**
 * Follow each artwork edge between the confirmed corners.
 *
 * Corners stay where the artist (or sol) put them. The search only
 * moves the points between those endpoints. The outermost sustained
 * color change wins, so an interior brush stroke does not become the
 * frame. A light, jumpy band is treated as thread fringe and is not
 * pulled inward.
 */

import type { EdgeName, Point } from "./geometryPlan";

export type TracedPoint = {
  t: number;
  x: number;
  y: number;
  offsetPx: number;
  /**
   * Gradient peak before the endpoint pin. Null at the confirmed
   * corners and on stations skipped as thread fringe.
   */
  rawOffset: number | null;
  weight: number;
  observed: boolean;
  heldOut: boolean;
};

export type TracedEdge = {
  edge: EdgeName;
  points: TracedPoint[];
  coverage: number;
  fringe: boolean;
  /** Inward unit normal. Positive offset moves toward the artwork. */
  normal: Point;
  medianOffset: number;
};

export type ArtworkTrace = {
  edges: [TracedEdge, TracedEdge, TracedEdge, TracedEdge];
  corners: [Point, Point, Point, Point];
};

const STATIONS = 64;
const SCORE_MIN = 34;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function rgbAt(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number] | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) return null;
  const i = (iy * width + ix) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

function dist3(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function luma(c: [number, number, number]): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function traceArtworkEdges(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  corners: [Point, Point, Point, Point],
): ArtworkTrace {
  const short = Math.min(width, height);
  // Deep enough for a bowed edge whose middle sits well inside the
  // corner chord. The outermost gradient still wins, so a longer
  // search does not lock onto an interior stroke.
  const band = clamp(Math.round(short * 0.14), 14, 120);
  const outward = Math.max(12, Math.round(band * 0.4));
  const centroid: Point = [
    (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4,
    (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4,
  ];
  const specs: Array<{ edge: EdgeName; a: Point; b: Point }> = [
    { edge: "top", a: corners[0], b: corners[1] },
    { edge: "right", a: corners[1], b: corners[2] },
    { edge: "bottom", a: corners[3], b: corners[2] },
    { edge: "left", a: corners[0], b: corners[3] },
  ];
  const edges = specs.map((spec) =>
    traceEdge(data, width, height, spec.edge, spec.a, spec.b, centroid, band, outward),
  ) as [TracedEdge, TracedEdge, TracedEdge, TracedEdge];
  inferConsistentGap(edges);
  return { edges, corners };
}

function traceEdge(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  edge: EdgeName,
  a: Point,
  b: Point,
  centroid: Point,
  band: number,
  outward: number,
): TracedEdge {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  if ((centroid[0] - mx) * nx + (centroid[1] - my) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const step = 0.5;
  const offsets: number[] = [];
  for (let o = -outward; o <= band + 1e-6; o += step) offsets.push(Math.round(o * 2) / 2);
  const nState = offsets.length;
  const indexOf = (o: number) => {
    const idx = Math.round((o + outward) / step);
    return Math.max(0, Math.min(nState - 1, idx));
  };

  const outerAt: Array<number | null> = [];
  const fringeVotes: boolean[] = [];
  for (let i = 0; i < STATIONS; i += 1) {
    const t = i / (STATIONS - 1);
    const px = a[0] + dx * t;
    const py = a[1] + dy * t;
    if (i === 0 || i === STATIONS - 1) {
      outerAt.push(0);
      fringeVotes.push(false);
      continue;
    }
    const wall = rgbAt(data, width, height, px - nx * outward, py - ny * outward);
    let chosen: number | null = null;
    let light = 0;
    let jumps = 0;
    let samples = 0;
    let prevL = -1;
    const grads: number[] = [];
    for (const o of offsets) {
      const c = rgbAt(data, width, height, px + nx * o, py + ny * o);
      const prevC = rgbAt(data, width, height, px + nx * (o - 1), py + ny * (o - 1));
      const nextC = rgbAt(data, width, height, px + nx * (o + 1), py + ny * (o + 1));
      grads.push(prevC && nextC ? dist3(prevC, nextC) : 0);
      if (!c || !wall) continue;
      samples += 1;
      const l = luma(c);
      if (l >= 150) light += 1;
      if (prevL >= 0 && l >= 150 && prevL >= 150 && Math.abs(l - prevL) >= 18) jumps += 1;
      prevL = l;
    }
    for (let si = 1; si < offsets.length - 1; si += 1) {
      const g = grads[si];
      if (g < 28) continue;
      const inn = rgbAt(
        data,
        width,
        height,
        px + nx * (offsets[si] + 3),
        py + ny * (offsets[si] + 3),
      );
      if (!inn || !wall || dist3(wall, inn) < SCORE_MIN) continue;
      let peak = si;
      const limit = Math.min(offsets.length - 2, si + 8);
      for (let k = si + 1; k <= limit; k += 1) {
        if (grads[k] >= grads[peak]) peak = k;
        else if (grads[k] < grads[peak] * 0.65) break;
      }
      const g0 = grads[Math.max(0, peak - 1)];
      const g1 = grads[peak];
      const g2 = grads[Math.min(grads.length - 1, peak + 1)];
      const denom = g0 - 2 * g1 + g2;
      const shift = Math.abs(denom) > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (g0 - g2)) / denom)) : 0;
      chosen = offsets[peak] + shift * step;
      break;
    }
    const fringy = samples >= 8 && light / samples >= 0.55 && jumps / samples >= 0.18;
    fringeVotes.push(fringy);
    outerAt.push(fringy ? null : chosen);
  }
  const fringe = fringeVotes.filter(Boolean).length >= (STATIONS - 2) * 0.45;

  const inf = 1e9;
  const cost = new Float64Array(STATIONS * nState);
  const prev = new Int16Array(STATIONS * nState);
  cost.fill(inf);
  cost[indexOf(0)] = 0;
  prev[indexOf(0)] = -1;

  for (let i = 1; i < STATIONS; i += 1) {
    const locked = i === STATIONS - 1 || fringe;
    const target = outerAt[i];
    for (let s = 0; s < nState; s += 1) {
      const o = offsets[s];
      if (locked && Math.abs(o) > 1e-6) continue;
      let dataCost = 0;
      if (!locked) {
        if (target == null) dataCost = o * o * 0.35 + 0.5;
        else dataCost = (o - target) * (o - target) * 0.45;
      }
      let best = inf;
      let bestPrev = 0;
      const lo = Math.max(0, s - 12);
      const hi = Math.min(nState - 1, s + 12);
      for (let ps = lo; ps <= hi; ps += 1) {
        const pc = cost[(i - 1) * nState + ps];
        if (pc >= inf) continue;
        const jump = offsets[s] - offsets[ps];
        const c = pc + dataCost + jump * jump * 0.08;
        if (c < best) {
          best = c;
          bestPrev = ps;
        }
      }
      cost[i * nState + s] = best;
      prev[i * nState + s] = bestPrev;
    }
  }

  const chosen: number[] = new Array(STATIONS);
  let s = indexOf(0);
  if (cost[(STATIONS - 1) * nState + s] >= inf) s = 0;
  for (let i = STATIONS - 1; i >= 0; i -= 1) {
    chosen[i] = offsets[s] ?? 0;
    s = prev[i * nState + s];
    if (s < 0) s = indexOf(0);
  }
  chosen[0] = 0;
  chosen[STATIONS - 1] = 0;

  const points: TracedPoint[] = [];
  let observed = 0;
  const offsetsUsed: number[] = [];
  for (let i = 0; i < STATIONS; i += 1) {
    const t = i / (STATIONS - 1);
    const o = fringe ? 0 : chosen[i];
    const inBand = t >= 0.18 && t <= 0.82;
    const seen = !fringe && i > 0 && i < STATIONS - 1 && outerAt[i] != null;
    if (seen && inBand) {
      observed += 1;
      offsetsUsed.push(o);
    }
    const measured = i > 0 && i < STATIONS - 1 ? outerAt[i] : null;
    points.push({
      t,
      x: a[0] + dx * t + nx * o,
      y: a[1] + dy * t + ny * o,
      offsetPx: o,
      rawOffset: measured,
      weight: seen && inBand ? 1 : 0,
      observed: seen,
      heldOut: i % 4 === 3 && i !== STATIONS - 1,
    });
  }
  offsetsUsed.sort((p, q) => p - q);
  const medianOffset =
    offsetsUsed.length === 0
      ? 0
      : offsetsUsed[offsetsUsed.length >> 1];
  return {
    edge,
    points,
    coverage: observed / (STATIONS - 2),
    fringe,
    normal: [nx, ny],
    medianOffset,
  };
}

function inferConsistentGap(edges: TracedEdge[]): void {
  const known = edges.filter((e) => !e.fringe && e.coverage >= 0.55);
  if (known.length < 3) return;
  const medians = known.map((e) => e.medianOffset);
  const mean = medians.reduce((s, n) => s + n, 0) / medians.length;
  if (medians.some((n) => Math.abs(n - mean) > 3.5)) return;
  if (mean < 1.5) return;
  for (const edge of edges) {
    if (edge.fringe || edge.coverage >= 0.45) continue;
    const a = edge.points[0];
    const b = edge.points[edge.points.length - 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    for (let i = 1; i < edge.points.length - 1; i += 1) {
      const point = edge.points[i];
      const t = point.t;
      const ramp = Math.min(1, Math.min(t, 1 - t) / 0.12);
      const o = mean * ramp;
      point.x = a.x + dx * t + edge.normal[0] * o;
      point.y = a.y + dy * t + edge.normal[1] * o;
      point.offsetPx = o;
      point.weight = 0.35;
      point.observed = true;
    }
    const used = edge.points.filter((p) => p.t >= 0.2 && p.t <= 0.8).map((p) => p.offsetPx);
    used.sort((p, q) => p - q);
    edge.medianOffset = used.length ? used[used.length >> 1] : mean;
    edge.coverage = Math.max(edge.coverage, 0.5);
  }
}

/** Polygon around the traced boundary, clockwise from the top-left corner. */
export function tracedPolygon(trace: ArtworkTrace): Point[] {
  const [top, right, bottom, left] = trace.edges;
  const poly: Point[] = [];
  for (const p of top.points) poly.push([p.x, p.y]);
  for (let i = 1; i < right.points.length; i += 1) poly.push([right.points[i].x, right.points[i].y]);
  for (let i = bottom.points.length - 2; i >= 0; i -= 1) {
    poly.push([bottom.points[i].x, bottom.points[i].y]);
  }
  for (let i = left.points.length - 2; i > 0; i -= 1) poly.push([left.points[i].x, left.points[i].y]);
  return poly;
}
