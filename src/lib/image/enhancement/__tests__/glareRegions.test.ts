// 2026-08-07 — Contract test for the glare-region extractor.
//
// Guardrails:
//   1. Empty input returns [].
//   2. A fully-dark canvas returns [].
//   3. A synthetic bright patch is picked up as a single region with
//      the correct normalized bounds.
//   4. Multiple disjoint patches produce multiple regions, sorted by
//      area descending.
//   5. Region count is capped at 5.

import assert from "node:assert/strict";

(async () => {
  const { extractGlareRegions, GLARE_REGION_INTERNALS } = await import(
    "../glareRegions"
  );

  const { SATURATED_LUMA, MAX_REGIONS } = GLARE_REGION_INTERNALS;
  assert.equal(SATURATED_LUMA, 245, "threshold matches analyze.ts");
  assert.equal(MAX_REGIONS, 5, "cap contract");

  // 1. Empty input.
  assert.deepEqual(extractGlareRegions(new Uint8ClampedArray(0), 0, 0), []);

  const W = 32;
  const H = 32;
  const total = W * H * 4;

  const fillDark = (): Uint8ClampedArray => {
    const buf = new Uint8ClampedArray(total);
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = 10;
      buf[i + 1] = 10;
      buf[i + 2] = 10;
      buf[i + 3] = 255;
    }
    return buf;
  };

  const paintRect = (
    buf: Uint8ClampedArray,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    intensity = 250,
  ) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const p = (y * W + x) * 4;
        buf[p] = intensity;
        buf[p + 1] = intensity;
        buf[p + 2] = intensity;
        buf[p + 3] = 255;
      }
    }
  };

  // 2. Fully dark → empty.
  assert.deepEqual(extractGlareRegions(fillDark(), W, H), []);

  // 3. Single bright square: 8×8 at (4,4)..(12,12).
  const buf3 = fillDark();
  paintRect(buf3, 4, 4, 12, 12);
  const regions3 = extractGlareRegions(buf3, W, H);
  assert.equal(regions3.length, 1, "one region emitted");
  const r = regions3[0];
  // Bounding box in normalized coords.
  assert.equal(r.x, 4 / W);
  assert.equal(r.y, 4 / H);
  assert.equal(r.w, 8 / W);
  assert.equal(r.h, 8 / H);
  assert.ok(r.intensity >= 0 && r.intensity <= 1);

  // 4. Two disjoint patches — larger first.
  const buf4 = fillDark();
  paintRect(buf4, 4, 4, 8, 8); // 4×4 patch
  paintRect(buf4, 20, 20, 30, 30); // 10×10 patch (bigger)
  const regions4 = extractGlareRegions(buf4, W, H);
  assert.equal(regions4.length, 2);
  assert.ok(
    regions4[0].w * regions4[0].h >= regions4[1].w * regions4[1].h,
    "sorted by area descending",
  );

  // 5. Cap at MAX_REGIONS. Paint 8 disjoint 4×4 patches.
  const buf5 = fillDark();
  for (let i = 0; i < 8; i += 1) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x0 = col * 8;
    const y0 = 16 + row * 8;
    paintRect(buf5, x0, y0, x0 + 4, y0 + 4);
  }
  const regions5 = extractGlareRegions(buf5, W, H);
  assert.ok(regions5.length <= MAX_REGIONS, "capped at MAX_REGIONS");

  console.log("glare region extraction contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
