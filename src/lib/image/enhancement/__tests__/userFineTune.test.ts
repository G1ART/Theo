// 2026-08-22 — Post-engine user fine-tune math.
// Guard: multiplicative `((x-128)*c+128)*b` then sat around luma,
// clamped to ±30% — NOT the portfolio ±0.05 additive delta.

import assert from "node:assert/strict";

(async () => {
  const { applyUserFineTuneToImageData } = await import("../applyToneDelta");

  const gray = (v: number) => new Uint8ClampedArray([v, v, v, 255]);

  const identity = gray(160);
  applyUserFineTuneToImageData(identity, { b: 1, c: 1, s: 1 });
  assert.equal(identity[0], 160, "neutral 1/1/1 is a no-op");
  assert.equal(identity[3], 255, "alpha untouched");

  const lifted = gray(160);
  applyUserFineTuneToImageData(lifted, { b: 1.3, c: 1, s: 1 });
  assert.equal(lifted[0], 208, "b=1.3 multiplies 160 → 208");
  assert.ok(lifted[0] > 160, "max brightness visibly lifts crushed gray");

  const crushed = gray(80);
  applyUserFineTuneToImageData(crushed, { b: 1.3, c: 1, s: 1 });
  assert.equal(crushed[0], 104, "crushed 80 lifts to 104, not +128*0.05");

  const capped = gray(160);
  applyUserFineTuneToImageData(capped, { b: 2, c: 1, s: 1 });
  assert.equal(capped[0], 208, "b=2 clamps to TONE_MAX 1.3");

  const { artworkBezelInsetPx } = await import("../applyToneDelta");
  // work 1000×800, bezel 0.08 → 64px; final 1128×928 → same inset.
  assert.equal(artworkBezelInsetPx(1128, 928, 0.08), 64);
  assert.equal(artworkBezelInsetPx(100, 100, 0), 0);

  const w = 6;
  const h = 6;
  const inset = 2;
  const wall = 243; // #f3f3f3
  const art = 80;
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const inside = x >= inset && x < w - inset && y >= inset && y < h - inset;
      const v = inside ? art : wall;
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
  }
  applyUserFineTuneToImageData(
    pixels,
    { b: 1.3, c: 1, s: 1 },
    { width: w, height: h, insetPx: inset },
  );
  assert.equal(pixels[0], wall, "top-left wall pixel unchanged");
  assert.equal(pixels[(5 * w + 5) * 4], wall, "bottom-right wall pixel unchanged");
  assert.equal(
    pixels[(2 * w + 2) * 4],
    104,
    "artwork pixel at inset lifts 80 → 104",
  );

  console.log("user fine-tune post-pass: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
