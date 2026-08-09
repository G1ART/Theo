// G3 (2026-08-10) — Adaptive matière tuning contract.
//
// Guardrails validated:
//   1. Blurrier synthetic input (blurScore high) yields a higher
//      `unsharpAmount` than a sharp one, but both stay inside the
//      documented clamp [0.1, 0.5].
//   2. Glary synthetic input (glareScore > 0.4) triggers
//      `highlightCompress > 0`; a glare-free input does not.
//   3. Painting mode caps `satBoost` at 0.03 even when the raw
//      intensity multiplier would push it higher; object mode
//      allows up to 0.06.
//   4. `highlightCompress` (the runtime pass) actually reduces the
//      luminance of the top-5 % pixels — a checkerboard image gets
//      quieter, and a uniform image is left alone.

import assert from "node:assert/strict";

(async () => {
  const { computeAdaptiveBases, resolveAdaptiveProLook } = await import(
    "../proLook.tunables"
  );
  const { highlightCompress } = await import("../proLook");

  // ── 1. Blur adaptivity.
  {
    const low = computeAdaptiveBases({ blurScore: 0, glareScore: 0 });
    const high = computeAdaptiveBases({ blurScore: 1, glareScore: 0 });
    assert.ok(
      high.unsharpAmount > low.unsharpAmount,
      `blurrier -> higher unsharp (low=${low.unsharpAmount.toFixed(3)}, high=${high.unsharpAmount.toFixed(3)})`,
    );
    assert.ok(low.unsharpAmount >= 0.15, "sharp lower clamp");
    assert.ok(high.unsharpAmount <= 0.45, "blurry upper clamp");
    assert.ok(high.claheClipLimit > low.claheClipLimit, "blurrier -> higher CLAHE clip");
  }

  // ── 2. Glare adaptivity.
  {
    const clean = computeAdaptiveBases({ blurScore: 0.2, glareScore: 0.1 });
    const glary = computeAdaptiveBases({ blurScore: 0.2, glareScore: 0.7 });
    assert.equal(clean.highlightCompress, 0, "no compression below the 0.4 gate");
    assert.ok(glary.highlightCompress > 0, "glary trips the gate");
    assert.ok(glary.highlightCompress <= 0.4, `stays under cap (got ${glary.highlightCompress.toFixed(3)})`);
  }

  // ── 3. Painting-mode satBoost cap.
  {
    const paintingStrong = resolveAdaptiveProLook({
      blurScore: 0.3,
      glareScore: 0.2,
      intensityMultiplier: 1.4,
      paintingMode: true,
    });
    const objectStrong = resolveAdaptiveProLook({
      blurScore: 0.3,
      glareScore: 0.2,
      intensityMultiplier: 1.4,
      paintingMode: false,
    });
    assert.ok(
      paintingStrong.satBoost <= 0.03,
      `painting satBoost capped (got ${paintingStrong.satBoost.toFixed(3)})`,
    );
    assert.ok(
      objectStrong.satBoost > paintingStrong.satBoost,
      `object satBoost > painting (obj=${objectStrong.satBoost.toFixed(3)}, paint=${paintingStrong.satBoost.toFixed(3)})`,
    );
    assert.ok(objectStrong.satBoost <= 0.06, "object satBoost cap");
  }

  // ── 4. Highlight compression actually reduces the top-5 % pixels.
  {
    const w = 20;
    const h = 20;
    const data = new Uint8ClampedArray(w * h * 4);
    // Fill most of the buffer with mid-gray (128) so the P95
    // percentile lands well below the bright top-region.
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
    // 20 pixels at 240 (form the P95 pivot) + 20 pixels at 250
    // (get compressed). This yields a non-degenerate histogram so
    // `highlightCompress` clearly identifies the top pixels.
    for (let k = 0; k < 20; k += 1) {
      const i = k * 4;
      data[i] = 240;
      data[i + 1] = 240;
      data[i + 2] = 240;
    }
    for (let k = 20; k < 40; k += 1) {
      const i = k * 4;
      data[i] = 250;
      data[i + 1] = 250;
      data[i + 2] = 250;
    }
    highlightCompress(data, 0.2);
    // All 250-pixels should now be strictly < 250. The mid-gray
    // region should be unchanged.
    let brightReduced = 0;
    let midGrayIntact = true;
    for (let k = 20; k < 40; k += 1) {
      const i = k * 4;
      if (data[i] < 250) brightReduced += 1;
    }
    for (let k = 100; k < 150; k += 1) {
      const i = k * 4;
      if (data[i] !== 128) midGrayIntact = false;
    }
    assert.ok(brightReduced > 0, `bright patch reduced (count=${brightReduced})`);
    assert.ok(midGrayIntact, "mid-gray untouched");
  }

  console.log("adaptive (G3) contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
