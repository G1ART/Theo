import assert from "node:assert/strict";
import { fitMatteForegroundQuad } from "../src/lib/image/enhancement/wallMatte";
import { galleryMatteMask, paintBorderWall, restoreGalleryMatte } from "../src/lib/image/enhancement/borderWall";
import { parseEnhanceSessionPreset } from "../src/lib/image/enhancement/sharedPreset";
import { dampenAwbGain } from "../src/lib/image/enhancement/awb";

function solid(w: number, h: number, fill: [number, number, number], box: { x: number; y: number; w: number; h: number }) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      const [r, g, b] = inside ? fill : [250, 250, 250];
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

const painted = solid(100, 80, [180, 40, 40], { x: 12, y: 10, w: 70, h: 56 });
const quad = fitMatteForegroundQuad(painted, 100, 80);
assert.ok(quad);
assert.ok(quad[0][0] < 0.2 && quad[0][1] < 0.2);
assert.ok(quad[2][0] > 0.75 && quad[2][1] > 0.75);

const tight = solid(40, 40, [20, 20, 200], { x: 0, y: 0, w: 40, h: 40 });
assert.equal(fitMatteForegroundQuad(tight, 40, 40), null);

// Fit must sit exactly on the detected min/max rect — the pre-2026-10-01
// outward `padX`/`padY` nudge used to drift back into the wall and was
// the direct cause of bulk claim 2 (auto corners landing mid-wall).
const flush = solid(100, 80, [180, 40, 40], { x: 12, y: 10, w: 70, h: 56 });
const flushQuad = fitMatteForegroundQuad(flush, 100, 80);
assert.ok(flushQuad);
// min x = 12/100 = 0.12 exactly, no padding bias either direction.
assert.ok(Math.abs(flushQuad![0][0] - 0.12) < 0.001);
assert.ok(Math.abs(flushQuad![0][1] - 10 / 80) < 0.001);

const frame = solid(20, 20, [10, 10, 10], { x: 2, y: 2, w: 16, h: 16 });
paintBorderWall(frame, 20, 20);
assert.equal(frame[0], 243);
assert.equal(frame[(10 * 20 + 10) * 4], 10);

// Reference-color aware repaint: a beige wall around a dark subject
// should still be repainted even though the near-white fallback would
// have skipped it. Simulate a 20×20 beige frame with a dark center.
const beige = solid(20, 20, [10, 10, 10], { x: 4, y: 4, w: 12, h: 12 });
// Overwrite the matte with a beige value (200, 185, 160).
for (let y = 0; y < 20; y += 1) {
  for (let x = 0; x < 20; x += 1) {
    const insideSubject = x >= 4 && x < 16 && y >= 4 && y < 16;
    if (insideSubject) continue;
    const i = (y * 20 + x) * 4;
    beige[i] = 200;
    beige[i + 1] = 185;
    beige[i + 2] = 160;
  }
}
paintBorderWall(beige, 20, 20, { r: 200, g: 185, b: 160 });
// Edge pixels should be the matte reference, not the beige wall.
assert.equal(beige[0], 243);
assert.equal(beige[1], 243);
assert.equal(beige[2], 243);
// Subject pixel is untouched.
assert.equal(beige[(10 * 20 + 10) * 4], 10);

// 2026-10-02 color-handling redesign — the two-way fidelity union plus
// legacy migration. New values pass through verbatim; the old capture
// trio maps forward (scanner → original, auto/studio → enhance); unknown
// values still reject the whole blob.
assert.deepEqual(
  parseEnhanceSessionPreset({ inputType: "enhance", intensity: "strong", b: 1.1, c: 0.9, s: 1 }),
  { inputType: "enhance", intensity: "strong", b: 1.1, c: 0.9, s: 1 },
);
assert.deepEqual(
  parseEnhanceSessionPreset({ inputType: "original", intensity: "normal", b: 1, c: 1, s: 1 }),
  { inputType: "original", intensity: "normal", b: 1, c: 1, s: 1 },
);
assert.equal(
  parseEnhanceSessionPreset({ inputType: "scanner", intensity: "normal" })?.inputType,
  "original",
  "legacy scanner → original",
);
assert.equal(
  parseEnhanceSessionPreset({ inputType: "studio", intensity: "strong" })?.inputType,
  "enhance",
  "legacy studio → enhance",
);
assert.equal(
  parseEnhanceSessionPreset({ inputType: "auto", intensity: "light" })?.inputType,
  "enhance",
  "legacy auto → enhance",
);
assert.equal(parseEnhanceSessionPreset({ inputType: "phone" }), null);

// 2026-10-02 partial white balance. strength=1 is identity (byte-identical
// legacy replay); 0.5 halves the deviation from 1.0; 0 collapses to no-op;
// non-finite inputs are handled defensively.
assert.equal(dampenAwbGain(1.4, 1), 1.4, "full strength = identity");
assert.ok(Math.abs(dampenAwbGain(1.4, 0.5) - 1.2) < 1e-9, "half strength halves deviation");
assert.ok(Math.abs(dampenAwbGain(0.8, 0.5) - 0.9) < 1e-9, "half strength works below 1 too");
assert.equal(dampenAwbGain(1.4, 0), 1, "zero strength = no-op");
assert.equal(dampenAwbGain(1.4, NaN), 1.4, "bad strength falls back to full");
assert.equal(dampenAwbGain(NaN, 0.5), 1, "bad multiplier falls back to 1");

// Edge-connected #f3f3f3 is the wall. A pale pixel inside the subject
// that does not touch that wall stays paintable.
const framed = new Uint8ClampedArray(10 * 10 * 4);
for (let i = 0; i < framed.length; i += 4) {
  framed[i] = framed[i + 1] = framed[i + 2] = 243;
  framed[i + 3] = 255;
}
for (let y = 3; y <= 6; y += 1) {
  for (let x = 3; x <= 6; x += 1) {
    const p = (y * 10 + x) * 4;
    framed[p] = 20;
    framed[p + 1] = 40;
    framed[p + 2] = 80;
  }
}
// A 243 pixel trapped inside the subject must not count as wall.
framed[(4 * 10 + 4) * 4] = 243;
framed[(4 * 10 + 4) * 4 + 1] = 243;
framed[(4 * 10 + 4) * 4 + 2] = 243;
const matte = galleryMatteMask(framed, 10, 10);
assert.ok(matte);
assert.equal(matte[0], 1);
assert.equal(matte[4 * 10 + 4], 0);
assert.equal(matte[3 * 10 + 3], 0);
framed[0] = 10;
restoreGalleryMatte(framed, matte);
assert.equal(framed[0], 243);
assert.equal(framed[(3 * 10 + 3) * 4], 20);

console.log("wall-matte.test.ts: ok");
