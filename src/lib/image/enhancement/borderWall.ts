/**
 * After a perspective warp, a phone lens leaves a thin crescent of the
 * real wall inside an otherwise straight quad. Recolor only the pixels
 * near the frame edge that match the wall, and stop at the first
 * painted pixel so we never bleed into the artwork.
 *
 * 2026-10-01 bulk-claim-4: when `wallRef` is supplied (the engine
 * samples the actual wall color outside the user's quad before
 * warping, see `sampleWallRefOutsideQuad`), the match predicate is
 * "close to wallRef" (ΔR/ΔG/ΔB each ≤ 24 AND |max-min| ≤ 24, i.e.
 * approximately the same color AND still near-neutral) instead of the
 * old "near-white" check. This repaints beige / warm-grey / painted
 * walls that the pre-fix near-white gate ignored.
 *
 * When `wallRef` is absent (null/undefined) we fall back to the
 * legacy near-white check for backward compat with callers that have
 * not been updated.
 *
 * Paint target is always #f3f3f3 (243,243,243) — the gallery matte
 * white the rest of the pipeline anchors to.
 *
 * A white or off-white wall reference is the same bucket as an
 * unpainted canvas margin. Walking inward up to 6% of the short side
 * then turns that margin into #f3f3f3 and the painting looks zoomed.
 * If the matching run is not bounded by a different color inside the
 * search depth, this function leaves those pixels alone. A thin
 * crescent that stops at real paint is still recolored. The studio
 * drop shadow is painted later, around the matte, and is not this pass.
 */
function looksLikeWhiteCanvas(r: number, g: number, b: number): boolean {
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Beige (spread ~40, luma ~180) and mid-grey stay out of this bucket.
  return luma >= 226 && spread <= 28;
}

export function paintBorderWall(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  wallRef?: { r: number; g: number; b: number } | null,
): void {
  if (width < 4 || height < 4) return;
  const maxDepth = Math.max(2, Math.round(Math.min(width, height) * 0.06));
  const refR = wallRef ? wallRef.r : 0;
  const refG = wallRef ? wallRef.g : 0;
  const refB = wallRef ? wallRef.b : 0;
  // 2026-10-02 — chroma-spread cap is derived from the reference
  // itself: a beige wall ref (e.g. 200/185/160, spread 40) must not be
  // excluded by a "near-neutral" check that was tuned for cool whites.
  // Allow the reference's own spread plus a modest 10-unit tolerance.
  const refSpread = wallRef
    ? Math.max(refR, refG, refB) - Math.min(refR, refG, refB)
    : 0;
  const refChromaCap = Math.max(24, refSpread + 10);
  const wall = wallRef
    ? (offset: number) => {
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const dr = r > refR ? r - refR : refR - r;
        const dg = g > refG ? g - refG : refG - g;
        const db = b > refB ? b - refB : refB - b;
        return (
          dr <= 24 &&
          dg <= 24 &&
          db <= 24 &&
          Math.max(r, g, b) - Math.min(r, g, b) <= refChromaCap
        );
      }
    : (offset: number) => {
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return luma >= 228 && Math.max(r, g, b) - Math.min(r, g, b) <= 18;
      };
  const paint = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    data[offset] = 243;
    data[offset + 1] = 243;
    data[offset + 2] = 243;
  };
  // Only when the sampled wall could be an unpainted canvas. A colored
  // wall still walks the full depth and stops at the first different pixel.
  const guardWhiteCanvas =
    !!wallRef && looksLikeWhiteCanvas(wallRef.r, wallRef.g, wallRef.b);
  const repaintInward = (
    offsetAt: (depth: number) => number,
    paintAt: (depth: number) => void,
  ) => {
    let run = 0;
    while (run < maxDepth && wall(offsetAt(run))) run += 1;
    if (guardWhiteCanvas) {
      const peek = offsetAt(run);
      // White continues through the search depth — wall and canvas
      // cannot be told apart. Leave the artwork's light margin.
      if (peek < 0 || wall(peek)) return;
    }
    for (let depth = 0; depth < run; depth += 1) paintAt(depth);
  };
  for (let x = 0; x < width; x += 1) {
    repaintInward(
      (depth) => (depth < height ? (depth * width + x) * 4 : -1),
      (depth) => paint(x, depth),
    );
    repaintInward(
      (depth) => {
        const y = height - 1 - depth;
        return y >= 0 ? (y * width + x) * 4 : -1;
      },
      (depth) => paint(x, height - 1 - depth),
    );
  }
  for (let y = 0; y < height; y += 1) {
    repaintInward(
      (depth) => (depth < width ? (y * width + depth) * 4 : -1),
      (depth) => paint(depth, y),
    );
    repaintInward(
      (depth) => {
        const x = width - 1 - depth;
        return x >= 0 ? (y * width + x) * 4 : -1;
      },
      (depth) => paint(width - 1 - depth, y),
    );
  }
}

/** Gallery wall. Color passes must not move these pixels. */
export const GALLERY_MATTE_RGB = 243;

/**
 * Pixels connected to the image border that are already the gallery
 * matte. A pale sky inside a circle is not included, because it does
 * not touch the border through matte pixels.
 * Returns null when there is no meaningful matte surround.
 */
export function galleryMatteMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = 2,
): Uint8Array | null {
  if (width < 4 || height < 4) return null;
  const mask = new Uint8Array(width * height);
  const isMatte = (i: number) => {
    const p = i * 4;
    return (
      Math.abs(data[p] - GALLERY_MATTE_RGB) <= tolerance &&
      Math.abs(data[p + 1] - GALLERY_MATTE_RGB) <= tolerance &&
      Math.abs(data[p + 2] - GALLERY_MATTE_RGB) <= tolerance
    );
  };
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * width + x;
    if (mask[i] || !isMatte(i)) return;
    mask[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % width;
    const y = (i / width) | 0;
    if (x > 0) push(x - 1, y);
    if (x + 1 < width) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < height) push(x, y + 1);
  }
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) count += 1;
  const ratio = count / mask.length;
  if (ratio < 0.02 || ratio > 0.92) return null;
  return mask;
}

/** Force masked pixels back to flat #f3f3f3. */
export function restoreGalleryMatte(data: Uint8ClampedArray, mask: Uint8Array): void {
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const p = i * 4;
    data[p] = GALLERY_MATTE_RGB;
    data[p + 1] = GALLERY_MATTE_RGB;
    data[p + 2] = GALLERY_MATTE_RGB;
    data[p + 3] = 255;
  }
}
