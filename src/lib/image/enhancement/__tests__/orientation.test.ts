// 2026-08-06 — Contract test for EXIF orientation math.
//
// The local flat engine feeds a per-file crop rectangle in normalized
// [0,1] space into `createImageBitmap(...opts, imageOrientation:
// "from-image")`. Once orientation is applied, the visual width/height
// swap for EXIF orientations 5/6/7/8 (rotated ±90°). The engine assumes
// its `srcW/srcH` reflect the *visual* frame after orientation, so we
// document and lock that invariant with a small pure function.
//
// This test doesn't touch a real ImageBitmap (jsdom-free). It captures
// the geometry contract that portrait-shot photos (orientation 6/8)
// must be cropped against their visual — not sensor — dimensions.

import assert from "node:assert/strict";

type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Given the raw sensor dimensions and an EXIF orientation, return the
 * *visual* dimensions after auto-rotation. Mirrors what the browser
 * does when `imageOrientation: "from-image"` is set on createImageBitmap.
 */
function visualDimensions(
  rawW: number,
  rawH: number,
  orientation: Orientation,
): { w: number; h: number } {
  const rotated = orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;
  return rotated ? { w: rawH, h: rawW } : { w: rawW, h: rawH };
}

/**
 * Convert a normalized visual-frame crop rect back into sensor-space
 * pixel coordinates. This is the inverse the engine implicitly relies
 * on when it draws a cropped region — with imageOrientation applied
 * the browser handles the mapping, but for offline geometry validation
 * we replicate it.
 */
function visualCropToSensor(
  crop: { x: number; y: number; w: number; h: number },
  rawW: number,
  rawH: number,
  orientation: Orientation,
): { x: number; y: number; w: number; h: number } {
  const { w: vw, h: vh } = visualDimensions(rawW, rawH, orientation);
  const vx0 = crop.x * vw;
  const vy0 = crop.y * vh;
  const vw0 = crop.w * vw;
  const vh0 = crop.h * vh;
  switch (orientation) {
    case 1:
      return { x: vx0, y: vy0, w: vw0, h: vh0 };
    case 3: // 180°
      return { x: rawW - vx0 - vw0, y: rawH - vy0 - vh0, w: vw0, h: vh0 };
    case 6: // 90° CW (portrait iPhone)
      return { x: rawW - vy0 - vh0, y: vx0, w: vh0, h: vw0 };
    case 8: // 90° CCW
      return { x: vy0, y: rawH - vx0 - vw0, w: vh0, h: vw0 };
    default:
      // Mirror variants — treated as their non-mirror counterparts for
      // this MVP; artists rarely use 2/4/5/7 in phone captures.
      return { x: vx0, y: vy0, w: vw0, h: vh0 };
  }
}

// ── Landscape (orientation 1) is identity. ────────────────────────
{
  const dims = visualDimensions(4000, 3000, 1);
  assert.deepEqual(dims, { w: 4000, h: 3000 });
  const sensor = visualCropToSensor({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 4000, 3000, 1);
  assert.deepEqual(sensor, { x: 400, y: 300, w: 3200, h: 2400 });
}

// ── Portrait (orientation 6, iPhone default) swaps w/h. ───────────
{
  const dims = visualDimensions(4000, 3000, 6);
  assert.deepEqual(dims, { w: 3000, h: 4000 }, "visual w/h swap for orientation 6");
  // The visual crop (0.1,0.1)-(0.9,0.9) on a 3000×4000 visual frame
  // maps to a sensor rectangle rotated 90° CW into the 4000×3000
  // sensor. Locking the values lets us catch a regression the day
  // someone forgets to swap axes.
  const sensor = visualCropToSensor({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 4000, 3000, 6);
  assert.deepEqual(sensor, { x: 400, y: 300, w: 3200, h: 2400 });
}

// ── 180° rotate mirrors both origin axes. ─────────────────────────
{
  const sensor = visualCropToSensor({ x: 0.0, y: 0.0, w: 0.5, h: 0.5 }, 4000, 3000, 3);
  assert.deepEqual(sensor, { x: 2000, y: 1500, w: 2000, h: 1500 });
}

// ── Portrait (orientation 8, 90° CCW) also swaps. ─────────────────
{
  const dims = visualDimensions(4000, 3000, 8);
  assert.deepEqual(dims, { w: 3000, h: 4000 });
  const sensor = visualCropToSensor({ x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, 4000, 3000, 8);
  // Full-frame crop always maps to the full sensor rectangle (in
  // raw sensor orientation), regardless of visual orientation.
  assert.deepEqual(sensor, { x: 0, y: 0, w: 4000, h: 3000 });
}

console.log("EXIF orientation math contract: OK");
