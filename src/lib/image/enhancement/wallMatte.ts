import { maskFromBackgroundContrast } from "@/lib/image/enhancement/ellipse";

type Quad = [[number, number], [number, number], [number, number], [number, number]];

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Axis-aligned canvas on a plain wall. Colorful paint against a light
 * matte leaves a margin on all four sides; the edge-moment fit misses
 * that and drops the corners inside the paint. Returns null when the
 * photo is already tight to the canvas.
 */
export function fitMatteForegroundQuad(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Quad | null {
  if (width < 8 || height < 8) return null;
  const mask = maskFromBackgroundContrast(data, width, height, { threshold: 28 });
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      count += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const ratio = count / (width * height);
  if (ratio < 0.12 || ratio > 0.9 || maxX < minX || maxY < minY) return null;
  const left = minX / width;
  const top = minY / height;
  const right = (width - 1 - maxX) / width;
  const bottom = (height - 1 - maxY) / height;
  // Only accept this auto-rect when wall margin exists on all four
  // sides. Without that, the detected edge is actually the frame edge
  // and padding outward just re-includes picture content as "wall".
  // Guard retained from pre-2026-10-01; keep the 1.5 % floor.
  if (left < 0.015 || top < 0.015 || right < 0.015 || bottom < 0.015) return null;
  // 2026-10-01 bulk-claim-2 fix: the previous `padX`/`padY` outward
  // bias (up to +1.2 % of each dimension) pushed the auto corners back
  // out past the real artwork edge, which is why the "집 그림" test
  // image placed the top two points mid-wall. The quad now sits
  // exactly on the detected min/max — users still get a non-destructive
  // nudge via the picker, and the engine's homography is no longer
  // asked to warp through a strip of wall.
  const x0 = clamp01(minX / width);
  const y0 = clamp01(minY / height);
  const x1 = clamp01(maxX / width);
  const y1 = clamp01(maxY / height);
  if (x1 - x0 < 0.2 || y1 - y0 < 0.2) return null;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

type RGB = [number, number, number];
type WallSide = "top" | "bottom" | "left" | "right";

function rgbAt(data: Uint8ClampedArray, width: number, x: number, y: number): RGB {
  const i = (y * width + x) * 4;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
}

function colorDist(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Axis-aligned canvas on a plain wall whose brightness is not uniform
 * (a white wall that falls off toward the floor, a grey vignette).
 * The corner-contrast mask treats that falloff as foreground and then
 * rejects the fit because it touches the photo edge. This scan uses
 * each side's own wall color and walks inward until the color leaves
 * the wall, so the corners sit on the canvas instead of the photo frame.
 * Returns null when the four sides do not agree on a single rectangle.
 */
export function fitPlainWallCanvasQuad(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Quad | null {
  if (width < 16 || height < 16) return null;
  const top = scanWallEdge(data, width, height, "top");
  const bottom = scanWallEdge(data, width, height, "bottom");
  const left = scanWallEdge(data, width, height, "left");
  const right = scanWallEdge(data, width, height, "right");
  if (top == null || bottom == null || left == null || right == null) return null;
  const x0 = clamp01(left / width);
  const y0 = clamp01(top / height);
  const x1 = clamp01(right / width);
  const y1 = clamp01(bottom / height);
  const marginL = x0;
  const marginT = y0;
  const marginR = 1 - x1;
  const marginB = 1 - y1;
  if (marginL < 0.015 || marginT < 0.015 || marginR < 0.015 || marginB < 0.015) return null;
  if (marginL > 0.42 || marginT > 0.42 || marginR > 0.42 || marginB > 0.42) return null;
  if (x1 - x0 < 0.2 || y1 - y0 < 0.2) return null;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function scanWallEdge(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  side: WallSide,
): number | null {
  const shortEdge = Math.min(width, height);
  const strip = Math.max(2, Math.round(shortEdge * 0.02));
  const wall = wallReference(data, width, height, side, strip);
  if (!wall) return null;
  const hits: number[] = [];
  const hard = 40;
  const soft = 22;
  const horizontal = side === "top" || side === "bottom";
  const axis = horizontal ? height : width;
  const limit = Math.floor(axis * 0.46);
  if (horizontal) {
    const dir = side === "top" ? 1 : -1;
    const start = side === "top" ? strip : height - 1 - strip;
    const step = Math.max(1, Math.floor(width / 64));
    for (let x = Math.floor(width * 0.12); x < width * 0.88; x += step) {
      const hit = firstDeparture(data, width, height, x, start, dir, true, limit, wall, hard, soft);
      if (hit != null) hits.push(hit);
    }
  } else {
    const dir = side === "left" ? 1 : -1;
    const start = side === "left" ? strip : width - 1 - strip;
    const step = Math.max(1, Math.floor(height / 64));
    for (let y = Math.floor(height * 0.12); y < height * 0.88; y += step) {
      const hit = firstDeparture(data, width, height, y, start, dir, false, limit, wall, hard, soft);
      if (hit != null) hits.push(hit);
    }
  }
  return modeEdge(hits, axis, strip);
}

/** The canvas edge is a straight line, so most rays land in one bin.
 *  Specks and wall shading fire early and scatter; drop those bins,
 *  including anything still in the outer wall strip. */
function modeEdge(hits: number[], axis: number, strip: number): number | null {
  const inner = hits.filter((h) => h > strip * 2 && h < axis - 1 - strip * 2);
  if (inner.length < 6) return null;
  const bin = Math.max(3, Math.round(axis * 0.015));
  const groups = new Map<number, number[]>();
  for (const h of inner) {
    const key = Math.round(h / bin) * bin;
    const list = groups.get(key) ?? [];
    list.push(h);
    groups.set(key, list);
  }
  let bestKey = 0;
  let bestCount = 0;
  for (const [key, list] of groups) {
    if (list.length > bestCount) {
      bestCount = list.length;
      bestKey = key;
    }
  }
  const merged = inner.filter((h) => Math.abs(h - bestKey) <= bin);
  if (merged.length < 6) return null;
  const sorted = merged.slice().sort((a, b) => a - b);
  const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? sorted[0];
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? sorted[sorted.length - 1];
  if (p90 - p10 > axis * 0.04) return null;
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function wallReference(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  side: WallSide,
  strip: number,
): RGB | null {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const [r, g, b] = rgbAt(data, width, x, y);
    rs.push(r);
    gs.push(g);
    bs.push(b);
  };
  if (side === "top" || side === "bottom") {
    const y0 = side === "top" ? 0 : height - strip;
    const x0 = Math.floor(width * 0.2);
    const x1 = Math.ceil(width * 0.8);
    for (let y = y0; y < y0 + strip && y < height; y += 1) {
      for (let x = x0; x < x1; x += 2) push(x, y);
    }
  } else {
    const x0 = side === "left" ? 0 : width - strip;
    const y0 = Math.floor(height * 0.2);
    const y1 = Math.ceil(height * 0.8);
    for (let x = x0; x < x0 + strip && x < width; x += 1) {
      for (let y = y0; y < y1; y += 2) push(x, y);
    }
  }
  if (rs.length < 8) return null;
  return [median(rs), median(gs), median(bs)];
}

function firstDeparture(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  fixed: number,
  start: number,
  dir: 1 | -1,
  alongY: boolean,
  limit: number,
  wall: RGB,
  hard: number,
  soft: number,
): number | null {
  let run = 0;
  for (let i = 0; i < limit; i += 1) {
    const pos = start + dir * i;
    const x = alongY ? fixed : pos;
    const y = alongY ? pos : fixed;
    if (x < 0 || y < 0 || x >= width || y >= height) break;
    const d = colorDist(rgbAt(data, width, x, y), wall);
    if (d >= hard) return pos;
    if (d >= soft) {
      run += 1;
      if (run >= 2) return pos - dir;
    } else {
      run = 0;
    }
  }
  return null;
}

// `outsetNormalizedQuad` was removed on 2026-10-02 (bulk-claim cleanup
// pass). It used to pull each user-placed corner ~0.8 % away from the
// quad center "so a bowed phone edge stays inside the warp", but in
// practice it re-included a strip of wall right along the edge the
// user had just carefully placed — the exact source of bulk claim 4.
// The post-warp `paintBorderWall` (reference-color aware since
// 2026-10-01) now handles any residual wall sliver without expanding
// the quad. If a future stage needs this geometry again, prefer a
// post-warp pixel pass over an inward/outward corner nudge so the
// user's manual placement always stays authoritative.
