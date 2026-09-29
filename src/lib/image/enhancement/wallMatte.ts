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
  if (left < 0.015 || top < 0.015 || right < 0.015 || bottom < 0.015) return null;
  const padX = Math.min(0.012, left * 0.35);
  const padY = Math.min(0.012, top * 0.35);
  const x0 = clamp01(minX / width - padX);
  const y0 = clamp01(minY / height - padY);
  const x1 = clamp01(maxX / width + padX);
  const y1 = clamp01(maxY / height + padY);
  if (x1 - x0 < 0.2 || y1 - y0 < 0.2) return null;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** Pull each corner slightly away from the quad center so a bowed phone edge stays inside the warp. */
export function outsetNormalizedQuad(corners: Quad, pad = 0.008): Quad {
  const cx = corners.reduce((sum, point) => sum + point[0], 0) / 4;
  const cy = corners.reduce((sum, point) => sum + point[1], 0) / 4;
  return corners.map(([x, y]) => [
    clamp01(x + Math.sign(x - cx) * pad),
    clamp01(y + Math.sign(y - cy) * pad),
  ]) as Quad;
}
