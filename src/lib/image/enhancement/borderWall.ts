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
 */
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
          Math.max(r, g, b) - Math.min(r, g, b) <= 24
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
  for (let x = 0; x < width; x += 1) {
    for (let depth = 0; depth < maxDepth; depth += 1) {
      if (!wall((depth * width + x) * 4)) break;
      paint(x, depth);
    }
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const y = height - 1 - depth;
      if (!wall((y * width + x) * 4)) break;
      paint(x, y);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let depth = 0; depth < maxDepth; depth += 1) {
      if (!wall((y * width + depth) * 4)) break;
      paint(depth, y);
    }
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const x = width - 1 - depth;
      if (!wall((y * width + x) * 4)) break;
      paint(x, y);
    }
  }
}
