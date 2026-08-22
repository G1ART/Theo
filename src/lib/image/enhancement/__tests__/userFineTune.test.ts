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

  console.log("user fine-tune post-pass: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
