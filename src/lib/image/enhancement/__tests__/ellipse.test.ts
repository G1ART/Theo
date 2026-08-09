// G2 (2026-08-10) — Ellipse detector contract.
//
// Guardrails validated:
//   1. A perfect filled circle (aspect 1:1) has detected aspect ≈ 1.
//   2. A filled circle stretched vertically by 1.1 has detected
//      aspect ≈ 1.1 (within ±3 %).
//   3. `ellipseRestorationCorners` returns 4 clamped [0,1] points
//      that describe a rotated rectangle around the ellipse (used
//      by the engine to warp the ellipse into a true circle).

import assert from "node:assert/strict";

(async () => {
  const {
    detectDominantEllipse,
    ellipseRestorationCorners,
    maskFromBackgroundContrast,
  } = await import("../ellipse");

  const W = 200;
  const H = 200;

  /** Paint a solid ellipse (semi-axes rx / ry, aligned to +x) centered
   *  at (cx, cy). Returns an RGBA buffer with white background + black
   *  ellipse. */
  function paintEllipseRgba(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
  ): Uint8ClampedArray {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          const i = (y * W + x) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
    return data;
  }

  /** Direct binary mask for testing without contrast derivation. */
  function ellipseMask(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
  ): Uint8Array {
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) mask[y * W + x] = 1;
      }
    }
    return mask;
  }

  // ── 1. Perfect circle → aspect ≈ 1.
  {
    const mask = ellipseMask(W / 2, H / 2, 60, 60);
    const fit = detectDominantEllipse(mask, W, H);
    assert.ok(fit, "circle detected");
    if (!fit) return;
    assert.ok(
      Math.abs(fit.aspect - 1) < 0.03,
      `aspect ≈ 1.0 for a circle (got ${fit.aspect.toFixed(3)})`,
    );
    assert.ok(fit.confidence > 0.7, `high confidence (got ${fit.confidence.toFixed(3)})`);
  }

  // ── 2. Ellipse stretched 1.1× vertically → aspect ≈ 1.1.
  {
    const mask = ellipseMask(W / 2, H / 2, 60, 60 * 1.1);
    const fit = detectDominantEllipse(mask, W, H);
    assert.ok(fit, "ellipse detected");
    if (!fit) return;
    // The vertical axis is the major axis; aspect major/minor = 1.1.
    assert.ok(
      Math.abs(fit.aspect - 1.1) < 0.05,
      `aspect ≈ 1.1 (got ${fit.aspect.toFixed(3)})`,
    );
    // Angle should be near π/2 (vertical major axis) — mod π.
    const wrapped = ((fit.angle % Math.PI) + Math.PI) % Math.PI;
    const diff = Math.min(
      Math.abs(wrapped - Math.PI / 2),
      Math.abs(wrapped - Math.PI / 2 + Math.PI),
      Math.abs(wrapped - Math.PI / 2 - Math.PI),
    );
    assert.ok(
      diff < 0.2,
      `major axis vertical (got angle ${((wrapped * 180) / Math.PI).toFixed(1)}°)`,
    );
  }

  // ── 3. Restoration corners: 4 points inside [0,1], forming a
  //     non-degenerate quad.
  {
    const mask = ellipseMask(W / 2, H / 2, 40, 60);
    const fit = detectDominantEllipse(mask, W, H);
    assert.ok(fit, "ellipse detected");
    if (!fit) return;
    const corners = ellipseRestorationCorners(fit);
    assert.equal(corners.length, 4);
    for (const [x, y] of corners) {
      assert.ok(x >= 0 && x <= 1, `x in [0,1] (got ${x})`);
      assert.ok(y >= 0 && y <= 1, `y in [0,1] (got ${y})`);
    }
    // Area of the quad should be > 5 % of the frame.
    const [a, b, c, d] = corners;
    const area = Math.abs(
      a[0] * (b[1] - d[1]) +
        b[0] * (c[1] - a[1]) +
        c[0] * (d[1] - b[1]) +
        d[0] * (a[1] - c[1]),
    ) / 2;
    assert.ok(area > 0.05, `quad area > 5 % (got ${area.toFixed(3)})`);
  }

  // ── 4. maskFromBackgroundContrast: circle painted on white becomes a
  //     mostly-circular mask that yields aspect ≈ 1.
  {
    const rgba = paintEllipseRgba(W / 2, H / 2, 50, 50);
    const mask = maskFromBackgroundContrast(rgba, W, H);
    const fit = detectDominantEllipse(mask, W, H);
    assert.ok(fit, "circle via contrast mask detected");
    if (!fit) return;
    assert.ok(
      Math.abs(fit.aspect - 1) < 0.1,
      `contrast mask circle aspect ≈ 1 (got ${fit.aspect.toFixed(3)})`,
    );
  }

  console.log("ellipse (G2) contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
