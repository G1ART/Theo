/**
 * After a perspective warp, a phone lens leaves a thin crescent of the
 * real wall inside an otherwise straight quad. Recolor only the near-white
 * pixels that touch the frame edge, and stop at the first painted pixel.
 */
export function paintBorderWall(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  if (width < 4 || height < 4) return;
  const maxDepth = Math.max(2, Math.round(Math.min(width, height) * 0.06));
  const wall = (offset: number) => {
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
