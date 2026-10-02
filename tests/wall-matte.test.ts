import assert from "node:assert/strict";
import { fitMatteForegroundQuad } from "../src/lib/image/enhancement/wallMatte";
import { paintBorderWall } from "../src/lib/image/enhancement/borderWall";
import { parseEnhanceSessionPreset } from "../src/lib/image/enhancement/sharedPreset";

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

assert.deepEqual(
  parseEnhanceSessionPreset({ inputType: "studio", intensity: "strong", b: 1.1, c: 0.9, s: 1 }),
  { inputType: "studio", intensity: "strong", b: 1.1, c: 0.9, s: 1 },
);
assert.equal(parseEnhanceSessionPreset({ inputType: "phone" }), null);

console.log("wall-matte.test.ts: ok");
