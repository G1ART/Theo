// 2026-08-06 — Contract test for gray-world / wall-biased AWB.
//
// Guardrails validated:
//   1. Multipliers are always inside [0.7, 1.4].
//   2. A monochrome red painting (R̄ ≫ Ḡ ≈ B̄) does NOT get pulled to
//      gray — the R multiplier is clamped so red stays visibly red.
//   3. Wall-biased mode picks the outer region when the rectangle
//      passes the confidence threshold.

import assert from "node:assert/strict";

(async () => {
  const {
    estimateAwb,
    applyAwb,
    AWB_MUL_MIN,
    AWB_MUL_MAX,
    MATTE_WHITE_POINT,
    computeWallAnchoredGains,
  } = await import("../awb");

  // ── 1. Multipliers stay inside [0.7, 1.4] on a strong red input.
  {
    const w = 32;
    const h = 32;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 220;      // R
      data[i + 1] = 30;   // G
      data[i + 2] = 30;   // B
      data[i + 3] = 255;
    }
    const awb = estimateAwb({ data, width: w, height: h });
    assert.equal(awb.source, "gray-world");
    assert.ok(awb.rMul >= AWB_MUL_MIN && awb.rMul <= AWB_MUL_MAX, `rMul ${awb.rMul} in bounds`);
    assert.ok(awb.gMul >= AWB_MUL_MIN && awb.gMul <= AWB_MUL_MAX, `gMul ${awb.gMul} in bounds`);
    assert.ok(awb.bMul >= AWB_MUL_MIN && awb.bMul <= AWB_MUL_MAX, `bMul ${awb.bMul} in bounds`);
    // rMul must be at the lower clamp (0.7) — target/red would be
    // ~0.4 without the clamp. The clamp is why the painting stays red.
    assert.ok(awb.rMul >= 0.699 && awb.rMul <= 0.71, `rMul ${awb.rMul} pinned at clamp`);
  }

  // ── 2. Wall-biased mode samples outside the rect when confidence is
  //     high. Inside = uniformly viridian (subject), outside = neutral
  //     white wall. The estimate should reflect the wall, not the
  //     subject.
  {
    const w = 40;
    const h = 40;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        // Rectangle in the middle: 25 % → 75 % of each axis.
        const inside = x >= 10 && x < 30 && y >= 10 && y < 30;
        if (inside) {
          data[i] = 20;
          data[i + 1] = 180;
          data[i + 2] = 90;
          data[i + 3] = 255;
        } else {
          // "Neutral" wall — but slightly warm (like tungsten). AWB
          // should push R multiplier < 1 and B multiplier > 1.
          data[i] = 220;
          data[i + 1] = 210;
          data[i + 2] = 200;
          data[i + 3] = 255;
        }
      }
    }
    const wallBiased = estimateAwb({
      data,
      width: w,
      height: h,
      rectangle: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      rectangleConfidence: 0.8,
    });
    assert.equal(wallBiased.source, "wall-biased", "high confidence -> wall-biased");
    assert.ok(wallBiased.rMul < 1.0, `wall-biased pulls R down (${wallBiased.rMul})`);
    assert.ok(wallBiased.bMul > 1.0, `wall-biased pushes B up (${wallBiased.bMul})`);

    const wholeFrame = estimateAwb({
      data,
      width: w,
      height: h,
      rectangle: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      rectangleConfidence: 0.3,
    });
    assert.equal(wholeFrame.source, "gray-world", "low confidence -> gray-world");
    // Whole-frame estimate is dragged toward the viridian subject —
    // its multipliers should differ from the wall-biased estimate.
    assert.notEqual(wholeFrame.rMul, wallBiased.rMul, "gray-world differs from wall-biased");
  }

  // ── 3. `applyAwb` clamps into [0,255] and preserves alpha.
  {
    const data = new Uint8ClampedArray([250, 100, 40, 255]);
    applyAwb(data, { rMul: 1.3, gMul: 1.0, bMul: 0.7 });
    assert.equal(data[0], 255, "R clamped at 255");
    assert.equal(data[3], 255, "alpha preserved");
  }

  // ── 4. G4: MATTE_WHITE_POINT is exactly #f3f3f3 = (243, 243, 243).
  assert.equal(MATTE_WHITE_POINT.r, 243, "matte white r");
  assert.equal(MATTE_WHITE_POINT.g, 243, "matte white g");
  assert.equal(MATTE_WHITE_POINT.b, 243, "matte white b");

  // ── 5. G1: computeWallAnchoredGains with a picked sample rect
  //     computes gains that map the sampled median to MATTE_WHITE_POINT.
  //     Uniform warm-white patch (220, 210, 200) → gains should
  //     produce ~(243, 243, 243) after `applyAwb`.
  {
    const w = 32;
    const h = 32;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 220;
      data[i + 1] = 210;
      data[i + 2] = 200;
      data[i + 3] = 255;
    }
    const gains = computeWallAnchoredGains(
      { data, width: w, height: h },
      { sampleRegion: { x: 0, y: 0, w: 32, h: 32 } },
    );
    assert.ok(gains, "gains computed");
    if (!gains) return;
    assert.equal(gains.source, "wall-pick");
    // Applying gains should push the median to ~243.
    const buffer = new Uint8ClampedArray([220, 210, 200, 255]);
    applyAwb(buffer, { rMul: gains.r, gMul: gains.g, bMul: gains.b });
    assert.ok(Math.abs(buffer[0] - 243) <= 2, `R landed at ~243 (got ${buffer[0]})`);
    assert.ok(Math.abs(buffer[1] - 243) <= 2, `G landed at ~243 (got ${buffer[1]})`);
    assert.ok(Math.abs(buffer[2] - 243) <= 2, `B landed at ~243 (got ${buffer[2]})`);
  }

  // ── 6. G1 auto-detect: a synthetic image with a bright neutral
  //     edge-touching wall + a colored subject in the middle should
  //     return valid gains sourced from `wall-auto`.
  {
    const w = 40;
    const h = 40;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        // Neutral wall around subject rect at (12..28, 12..28).
        const inside = x >= 12 && x < 28 && y >= 12 && y < 28;
        if (inside) {
          data[i] = 30;
          data[i + 1] = 180;
          data[i + 2] = 90;
        } else {
          data[i] = 220;
          data[i + 1] = 220;
          data[i + 2] = 220;
        }
        data[i + 3] = 255;
      }
    }
    const gains = computeWallAnchoredGains({ data, width: w, height: h });
    assert.ok(gains, "wall auto-detected");
    if (!gains) return;
    assert.equal(gains.source, "wall-auto", "source is wall-auto");
    assert.ok(gains.areaFraction > 0.3, `wall area > 30% (got ${gains.areaFraction})`);
    // Neutral wall → gains all close to 243/220 ~ 1.104.
    assert.ok(Math.abs(gains.r - 1.104) < 0.05, `r ~ 1.104 (got ${gains.r})`);
    assert.ok(Math.abs(gains.g - 1.104) < 0.05, `g ~ 1.104 (got ${gains.g})`);
    assert.ok(Math.abs(gains.b - 1.104) < 0.05, `b ~ 1.104 (got ${gains.b})`);
  }

  // ── 7. G1: uniform textured image (no bright neutral wall)
  //     yields null so the engine falls back to gray-world.
  {
    const w = 40;
    const h = 40;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      // A dark saturated red — not near-neutral, not bright.
      data[i] = 130;
      data[i + 1] = 30;
      data[i + 2] = 30;
      data[i + 3] = 255;
    }
    const gains = computeWallAnchoredGains({ data, width: w, height: h });
    assert.equal(gains, null, "no wall detected -> null");
  }

  console.log("awb contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
