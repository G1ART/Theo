/**
 * Theo Image Enhance (Beta) — glare-region extraction (2026-08-07).
 *
 * Approximates "where the glare is" via connected-component labelling
 * on the saturated-highlight mask. Runs on the downsampled 256-long-edge
 * canvas the analyzer already prepares, so this is a fixed ≤ 65k-pixel
 * pass — cheap enough to run every time the analyzer runs.
 *
 * The output is at most 5 rectangles ({x, y, w, h} in normalized 0..1
 * coordinates + an average intensity), sorted by area descending so the
 * UI heatmap emphasises the largest patches first.
 */

export type GlareRegion = {
  /** Normalized top-left x. */
  x: number;
  /** Normalized top-left y. */
  y: number;
  /** Normalized width. */
  w: number;
  /** Normalized height. */
  h: number;
  /**
   * Mean saturation intensity over the region, in [0, 1]. Values near 1
   * signal a fully-blown highlight; values near 0.5 signal a bright but
   * still-recoverable area. Used to pick chip tone in the overlay.
   */
  intensity: number;
};

/** Luminance threshold (0-255). Matches `computeGlareScore` in
 *  `analyze.ts` so the region mask is consistent with the chip score. */
const SATURATED_LUMA = 245;

/** Minimum component size (pixels on the downsampled canvas) before we
 *  emit it as a region. 12 = a ~3×4 patch on the 256-edge canvas; below
 *  that we're chasing sensor noise. */
const MIN_COMPONENT_PX = 12;

/** Hard cap on emitted regions. Prevents the heatmap from becoming
 *  visual noise when nearly the whole image is over-exposed. */
const MAX_REGIONS = 5;

/**
 * Build the saturated-highlight mask + labels via a two-pass flood-fill
 * using an explicit stack (recursion would blow the JS engine on large
 * connected areas). 4-connectivity is enough for a chip-level heatmap.
 */
function labelSaturated(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): { labels: Int32Array; components: Map<number, {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumLuma: number;
  count: number;
}> } {
  const labels = new Int32Array(w * h);
  const components = new Map<number, {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    sumLuma: number;
    count: number;
  }>();
  let nextLabel = 1;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      if (labels[idx] !== 0) continue;
      const p = idx * 4;
      const luma = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      if (luma <= SATURATED_LUMA) continue;

      const label = nextLabel;
      nextLabel += 1;
      const stack: number[] = [idx];
      const stat = {
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
        sumLuma: 0,
        count: 0,
      };
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (labels[cur] !== 0) continue;
        const cy = Math.floor(cur / w);
        const cx = cur - cy * w;
        const cp = cur * 4;
        const cluma = 0.299 * data[cp] + 0.587 * data[cp + 1] + 0.114 * data[cp + 2];
        if (cluma <= SATURATED_LUMA) continue;
        labels[cur] = label;
        stat.sumLuma += cluma;
        stat.count += 1;
        if (cx < stat.minX) stat.minX = cx;
        if (cy < stat.minY) stat.minY = cy;
        if (cx > stat.maxX) stat.maxX = cx;
        if (cy > stat.maxY) stat.maxY = cy;
        if (cx > 0) stack.push(cur - 1);
        if (cx < w - 1) stack.push(cur + 1);
        if (cy > 0) stack.push(cur - w);
        if (cy < h - 1) stack.push(cur + w);
      }
      components.set(label, stat);
    }
  }
  return { labels, components };
}

/**
 * Extract up to `MAX_REGIONS` bounding boxes of saturated-highlight
 * connected components. Coordinates are normalized to [0,1] against the
 * source canvas dimensions.
 */
export function extractGlareRegions(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): GlareRegion[] {
  if (w <= 0 || h <= 0 || data.length < 4) return [];
  const { components } = labelSaturated(data, w, h);
  const regions: GlareRegion[] = [];
  for (const [, stat] of components) {
    if (stat.count < MIN_COMPONENT_PX) continue;
    const rw = stat.maxX - stat.minX + 1;
    const rh = stat.maxY - stat.minY + 1;
    regions.push({
      x: stat.minX / w,
      y: stat.minY / h,
      w: rw / w,
      h: rh / h,
      // Normalize the [SATURATED_LUMA, 255] band into [0, 1]. A region
      // averaging exactly at threshold reads ~0; a fully-clipped
      // region reads 1.
      intensity: Math.min(
        1,
        Math.max(0, (stat.sumLuma / stat.count - SATURATED_LUMA) / (255 - SATURATED_LUMA)),
      ),
    });
  }
  regions.sort((a, b) => b.w * b.h - a.w * a.h);
  return regions.slice(0, MAX_REGIONS);
}

export const GLARE_REGION_INTERNALS = {
  SATURATED_LUMA,
  MIN_COMPONENT_PX,
  MAX_REGIONS,
};
