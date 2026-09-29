import assert from "node:assert/strict";
import { fitMatteForegroundQuad, outsetNormalizedQuad } from "../src/lib/image/enhancement/wallMatte";
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

const outset = outsetNormalizedQuad(
  [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ],
  0.01,
);
assert.ok(outset[0][0] < 0.2 && outset[1][0] > 0.8);

const frame = solid(20, 20, [10, 10, 10], { x: 2, y: 2, w: 16, h: 16 });
paintBorderWall(frame, 20, 20);
assert.equal(frame[0], 243);
assert.equal(frame[(10 * 20 + 10) * 4], 10);

assert.deepEqual(
  parseEnhanceSessionPreset({ inputType: "studio", intensity: "strong", b: 1.1, c: 0.9, s: 1 }),
  { inputType: "studio", intensity: "strong", b: 1.1, c: 0.9, s: 1 },
);
assert.equal(parseEnhanceSessionPreset({ inputType: "phone" }), null);

console.log("wall-matte.test.ts: ok");
