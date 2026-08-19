// Contract tests for `refineTightBboxByLuminanceFromImageData`.
//
// The helper is invoked after the Vision-LLM bbox crop as a
// defensive local trim. Each synthetic case here builds an RGBA
// buffer that mimics a common padding pattern the model leaves
// behind, then checks the refined rectangle stays inside the
// initial crop and matches the expected per-edge trim.
//
// Deliberately Node-only — no `document`, no canvas polyfill. The
// pure ImageData-based entry point is what production uses under
// the DOM wrapper.

import assert from "node:assert/strict";

(async () => {
  const {
    refineTightBboxByLuminanceFromImageData,
    isStripTrimmable,
    luminance601,
  } = await import("../cutoutTrim");

  type Rgba = [number, number, number, number];

  /**
   * Build an ImageData-like buffer of `w × h` and paint two
   * rectangles: an outer fill (`outer`) covering the whole frame,
   * then an inner rect (`inner`, `inner.rgba`) at
   * (innerX0..innerX1, innerY0..innerY1). Keeps the tests readable
   * without a canvas — every case boils down to "outer padding +
   * inner artwork".
   */
  function makeImage(
    w: number,
    h: number,
    outer: Rgba,
    inner: {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      rgba: Rgba;
    } | null,
  ): { data: Uint8ClampedArray; width: number; height: number } {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        let rgba: Rgba = outer;
        if (
          inner &&
          x >= inner.x0 &&
          x < inner.x1 &&
          y >= inner.y0 &&
          y < inner.y1
        ) {
          rgba = inner.rgba;
        }
        data[i] = rgba[0];
        data[i + 1] = rgba[1];
        data[i + 2] = rgba[2];
        data[i + 3] = rgba[3];
      }
    }
    return { data, width: w, height: h };
  }

  // ── 0. Luminance sanity check — Rec 601 weights add up ────────────
  {
    assert.equal(Math.round(luminance601(255, 255, 255)), 255);
    assert.equal(Math.round(luminance601(0, 0, 0)), 0);
    // Pure green is ~59% of the perceived brightness of white.
    assert.ok(luminance601(0, 255, 0) > 140);
    assert.ok(luminance601(0, 255, 0) < 160);
  }

  // ── 1. All-white matte around a colored painting ─────────────────
  //  Every edge should trim to the exact matte boundary (10 px per
  //  edge). Painting stays untouched.
  {
    const w = 100;
    const h = 100;
    const img = makeImage(
      w,
      h,
      [255, 255, 255, 255], // pure white matte
      { x0: 10, y0: 10, x1: 90, y1: 90, rgba: [40, 90, 160, 255] }, // blue painting
    );
    const refined = refineTightBboxByLuminanceFromImageData(
      img,
      { cropX: 0, cropY: 0, cropW: w, cropH: h },
      { maxAdditionalTrimFrac: 0.15 }, // cap 15 → allow trimming 10 px on 100 px
    );
    assert.equal(refined.trimmed.top, 10, "top edge trims to matte boundary");
    assert.equal(refined.trimmed.bottom, 10, "bottom edge trims to matte");
    assert.equal(refined.trimmed.left, 10, "left edge trims to matte");
    assert.equal(refined.trimmed.right, 10, "right edge trims to matte");
    assert.equal(refined.cropX, 10);
    assert.equal(refined.cropY, 10);
    assert.equal(refined.cropW, 80);
    assert.equal(refined.cropH, 80);
  }

  // ── 2. Dark shadow letterbox on top/bottom, painting on sides ─────
  //  Landscape shot with dark bands top + bottom; L/R already tight.
  //  Expect the trim to bite the top + bottom bands (up to the cap),
  //  and leave left/right alone (their border strip has variance).
  {
    const w = 100;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        let rgba: Rgba;
        if (y < 8 || y >= 92) {
          rgba = [5, 5, 5, 255]; // dark bands
        } else {
          // Painting body — high-variance texture (checkerboard-ish)
          // so the L/R border strip doesn't read as "uniform light".
          const v = ((x >> 2) ^ (y >> 2)) & 1 ? 60 : 200;
          rgba = [v, v, v, 255];
        }
        data[i] = rgba[0];
        data[i + 1] = rgba[1];
        data[i + 2] = rgba[2];
        data[i + 3] = rgba[3];
      }
    }
    const img = { data, width: w, height: h };
    const refined = refineTightBboxByLuminanceFromImageData(
      img,
      { cropX: 0, cropY: 0, cropW: w, cropH: h },
      { maxAdditionalTrimFrac: 0.15 },
    );
    assert.equal(refined.trimmed.top, 8, "trims the 8 px top shadow");
    assert.equal(refined.trimmed.bottom, 8, "trims the 8 px bottom shadow");
    // The painting body has high variance → the LEFT/RIGHT border
    // strip fails `isStripTrimmable`, so we leave those edges alone.
    assert.equal(
      refined.trimmed.left,
      0,
      "left edge untouched (painting has texture)",
    );
    assert.equal(refined.trimmed.right, 0, "right edge untouched");
  }

  // ── 3. Already tight (unframed, gallery-wrap) — no-op ─────────────
  //  Every pixel is a high-variance painting body; nothing should
  //  be trimmed even at the full 15 % cap.
  {
    const w = 60;
    const h = 60;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const v = ((x + y * 3) * 13) & 255;
        data[i] = v;
        data[i + 1] = (v + 60) & 255;
        data[i + 2] = (v + 120) & 255;
        data[i + 3] = 255;
      }
    }
    const img = { data, width: w, height: h };
    const refined = refineTightBboxByLuminanceFromImageData(img, {
      cropX: 0,
      cropY: 0,
      cropW: w,
      cropH: h,
    });
    assert.equal(refined.trimmed.top, 0);
    assert.equal(refined.trimmed.bottom, 0);
    assert.equal(refined.trimmed.left, 0);
    assert.equal(refined.trimmed.right, 0);
    assert.equal(refined.cropW, w);
    assert.equal(refined.cropH, h);
  }

  // ── 4. Mixed matte — cream/off-white padding + painting ───────────
  //  Off-white L*98 gray (245) still reads above the default
  //  lightLuminanceThreshold of 235 → should trim. Painting body has
  //  strong texture so the trim stops at the matte edge.
  {
    const w = 80;
    const h = 80;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        let rgba: Rgba;
        const isInner = x >= 6 && x < 74 && y >= 6 && y < 74;
        if (!isInner) {
          rgba = [245, 243, 240, 255]; // cream matte, high luma, low variance
        } else {
          // Painting: alternating red/dark green stripes → very high variance
          rgba = ((x >> 1) & 1) === 0 ? [200, 30, 30, 255] : [20, 80, 40, 255];
        }
        data[i] = rgba[0];
        data[i + 1] = rgba[1];
        data[i + 2] = rgba[2];
        data[i + 3] = rgba[3];
      }
    }
    const img = { data, width: w, height: h };
    const refined = refineTightBboxByLuminanceFromImageData(
      img,
      { cropX: 0, cropY: 0, cropW: w, cropH: h },
      { maxAdditionalTrimFrac: 0.15 },
    );
    assert.equal(refined.trimmed.top, 6, "cream matte trims 6 px top");
    assert.equal(refined.trimmed.bottom, 6, "cream matte trims 6 px bottom");
    assert.equal(refined.trimmed.left, 6, "cream matte trims 6 px left");
    assert.equal(refined.trimmed.right, 6, "cream matte trims 6 px right");
    assert.equal(refined.cropW, 68);
    assert.equal(refined.cropH, 68);
  }

  // ── 5. maxAdditionalTrimFrac cap enforced ─────────────────────────
  //  30 px of pure white on top; cap the trim at 10% of the initial
  //  height (100 → 10 px). Expect exactly 10 px trimmed, NOT 30.
  {
    const w = 100;
    const h = 100;
    const img = makeImage(w, h, [255, 255, 255, 255], null);
    const refined = refineTightBboxByLuminanceFromImageData(
      img,
      { cropX: 0, cropY: 0, cropW: w, cropH: h },
      { maxAdditionalTrimFrac: 0.1 },
    );
    // With no painting body the whole image is trimmable, but the
    // per-edge cap forbids more than 10 px on each side.
    assert.equal(refined.trimmed.top, 10, "cap holds on top edge");
    assert.equal(refined.trimmed.bottom, 10, "cap holds on bottom edge");
    assert.equal(refined.trimmed.left, 10, "cap holds on left edge");
    assert.equal(refined.trimmed.right, 10, "cap holds on right edge");
    assert.equal(refined.cropW, 80);
    assert.equal(refined.cropH, 80);
  }

  // ── 6. `isStripTrimmable` — high variance defeats the light band ──
  //  Even with a bright mean (240) a strip with strong variance
  //  (>400) should be treated as artwork, not padding.
  {
    const opts = {
      maxAdditionalTrimFrac: 0.15,
      borderSamplePct: 0.05,
      lightLuminanceThreshold: 235,
      darkLuminanceThreshold: 20,
      varianceThreshold: 400,
    };
    assert.equal(
      isStripTrimmable({ mean: 245, variance: 30 }, opts),
      true,
      "bright + calm → trim",
    );
    assert.equal(
      isStripTrimmable({ mean: 245, variance: 5000 }, opts),
      false,
      "bright but noisy → keep (real detail)",
    );
    assert.equal(
      isStripTrimmable({ mean: 100, variance: 20 }, opts),
      false,
      "midtones stay (not near-white or near-black)",
    );
    assert.equal(
      isStripTrimmable({ mean: 10, variance: 30 }, opts),
      true,
      "dark + calm → trim (letterbox)",
    );
  }

  console.log("cutoutTrim tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
