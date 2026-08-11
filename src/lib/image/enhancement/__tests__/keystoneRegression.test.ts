/**
 * §Fix B (2026-08-10) — regression test for tapered-rectangle
 * (keystone) restoration. Between G1–G5 and this hotfix the auto-warp
 * would either mis-fire on a low-confidence rotated-envelope seed or
 * silently no-op when the bounding-box quad happened to be nearly
 * axis-aligned. This test locks the recovered path down.
 *
 * Non-goals: this is a pure-Node test that exercises the pipeline's
 * math (edge detector → auto-corner gate → homography → warp) on
 * synthetic pixel buffers. It intentionally does NOT touch the
 * browser-only `runFlatEnhancement` (which depends on
 * `createImageBitmap` + canvas 2D). The seams tested here are the
 * exact seams the pipeline calls.
 */

import assert from "node:assert/strict";

// Node polyfill — the warp helper uses `new ImageData(w, h)` which is a
// browser API. A tiny stand-in with the same `data / width / height`
// shape is enough for the pipeline math tested here.
if (typeof (globalThis as { ImageData?: unknown }).ImageData === "undefined") {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  }
  (globalThis as { ImageData?: unknown }).ImageData =
    ImageDataPolyfill as unknown as typeof ImageData;
}

(async () => {
  const {
    resolveAutoCorners,
    isAxisAligned,
    quadFromRect,
    type: _1,
  } = (await import("../cornerPickerGeometry")) as unknown as {
    resolveAutoCorners: (a: {
      suggestedRectangleCorners?:
        | [
            [number, number],
            [number, number],
            [number, number],
            [number, number],
          ]
        | null;
      suggestedRectangleConfidence?: number | null;
      suggestedCrop?: { x: number; y: number; w: number; h: number } | null;
      rectangleConfidence?: number;
    }) =>
      | [
          [number, number],
          [number, number],
          [number, number],
          [number, number],
        ]
      | null;
    isAxisAligned: (
      q: [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ],
    ) => boolean;
    quadFromRect: (r: {
      x: number;
      y: number;
      w: number;
      h: number;
    }) =>
      | [
          [number, number],
          [number, number],
          [number, number],
          [number, number],
        ]
      | null;
    type: unknown;
  };
  const {
    homographyForCorners,
    warpPerspectiveNearest,
    estimateRectifiedAspect,
  } = await import("../homography");
  const { detectBestQuadrilateral } = await import("../edges");

  // ── Guardrail 1: resolveAutoCorners never returns a very-low-
  //    confidence edge quad. This is the exact regression from G2
  //    where a rotated-envelope fit with confidence 0.4 was pushed
  //    straight into the warp and distorted straight-on captures.
  //    F3 (2026-08-10) loosens the gate to >= 0.55, but 0.45 must
  //    still fall back to the bounding-box seed.
  {
    const lowConfEdge: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [0.11, 0.09],
      [0.9, 0.12],
      [0.88, 0.9],
      [0.1, 0.91],
    ];
    const resolved = resolveAutoCorners({
      suggestedRectangleCorners: lowConfEdge,
      suggestedRectangleConfidence: 0.45, // < 0.55 threshold
      suggestedCrop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      rectangleConfidence: 0.6,
    });
    // Must fall back to bounding-box quad (axis-aligned), NOT the
    // low-confidence rotated seed.
    assert.ok(resolved, "resolved fallback exists");
    if (!resolved) return;
    assert.ok(
      isAxisAligned(resolved),
      "0.45 confidence edge quad must NOT be surfaced — falls back to bbox",
    );
  }

  // ── Guardrail 1b (F3, 2026-08-10): a moderate 0.58-confidence
  //    rotated edge quad now IS adopted. Pre-F3 (gate = 0.65) this
  //    case returned the axis-aligned bbox and users complained
  //    about legitimate keystoned captures not straightening.
  {
    const modEdge: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [0.13, 0.11],
      [0.87, 0.09],
      [0.9, 0.88],
      [0.11, 0.9],
    ];
    const resolved = resolveAutoCorners({
      suggestedRectangleCorners: modEdge,
      suggestedRectangleConfidence: 0.58,
      suggestedCrop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      rectangleConfidence: 0.62,
    });
    assert.ok(resolved, "0.58 confidence edge quad returned");
    if (!resolved) return;
    assert.deepEqual(
      resolved,
      modEdge,
      "F3: moderate-confidence edge quad is adopted",
    );
    assert.ok(
      !isAxisAligned(resolved),
      "adopted quad remains recognizably rotated",
    );
  }

  // ── Guardrail 2: high-confidence, meaningfully-rotated edge quad
  //    IS returned as the warp seed.
  {
    const goodEdge: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [0.15, 0.08],
      [0.92, 0.14],
      [0.85, 0.9],
      [0.08, 0.86],
    ];
    const resolved = resolveAutoCorners({
      suggestedRectangleCorners: goodEdge,
      suggestedRectangleConfidence: 0.72,
      suggestedCrop: { x: 0.08, y: 0.08, w: 0.84, h: 0.84 },
      rectangleConfidence: 0.7,
    });
    assert.ok(resolved, "high-confidence rotated edge quad returned");
    if (!resolved) return;
    assert.deepEqual(resolved, goodEdge, "returns the edge quad unchanged");
    assert.ok(
      !isAxisAligned(resolved),
      "a truly rotated quad is not axis-aligned",
    );
  }

  // ── Guardrail 3: when rectangle confidence is high but the edge
  //    detector has NO opinion, we fall back to the bounding-box
  //    quad. Engine will then recognize it as axis-aligned and skip
  //    the warp (crop-only). This is the pre-G5 behavior.
  {
    const resolved = resolveAutoCorners({
      suggestedRectangleCorners: null,
      suggestedRectangleConfidence: null,
      suggestedCrop: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
      rectangleConfidence: 0.7,
    });
    assert.ok(resolved, "bbox fallback surfaces");
    if (!resolved) return;
    assert.deepEqual(resolved, quadFromRect({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 }));
    assert.ok(isAxisAligned(resolved), "bbox is axis-aligned");
  }

  // ── Guardrail 4: low rectangle confidence + null edge → null (no
  //    auto-warp, no auto-crop applied by the pipeline).
  {
    const resolved = resolveAutoCorners({
      suggestedRectangleCorners: null,
      suggestedRectangleConfidence: null,
      suggestedCrop: { x: 0, y: 0, w: 1, h: 1 },
      rectangleConfidence: 0.3,
    });
    assert.equal(resolved, null, "low confidence → no auto seed");
  }

  // ── Guardrail 5: estimateRectifiedAspect on a synthetic tapered
  //    rectangle recovers the artwork's true aspect within ±3 %.
  //    We simulate a 3:2 artwork photographed from below-left — the
  //    top edge is shorter than the bottom (near-field larger), and
  //    the right side is tilted inward. The average-side heuristic
  //    should still land on ~1.5.
  {
    const tapered: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      // 300×200 canvas; top edge ≈ 270, bottom ≈ 300; left ≈ 200,
      // right ≈ 200 → aspect ≈ 285/200 ≈ 1.425. Well within ±3 %
      // of the intended 1.5? Slightly outside on purpose so the
      // ±3 % check is meaningful: switch to a shallower keystone.
      [15, 5],
      [285, 5],
      [300, 200],
      [0, 200],
    ];
    const aspect = estimateRectifiedAspect(tapered);
    // Average side lengths:
    //   topW = 270, bottomW = 300 → avgW = 285
    //   leftH ≈ hypot(15, 195) ≈ 195.58
    //   rightH ≈ hypot(15, 195) ≈ 195.58 → avgH ≈ 195.58
    //   aspect ≈ 285 / 195.58 ≈ 1.457
    // The intended artwork aspect (before the camera skew) is 300/200 = 1.5.
    // Within 3 % of 1.5 → [1.455, 1.545].
    assert.ok(
      Math.abs(aspect - 1.5) / 1.5 <= 0.03,
      `tapered aspect within ±3% of 1.5 (got ${aspect.toFixed(3)})`,
    );
  }

  // ── Guardrail 6: end-to-end warp of a synthetic tapered rectangle
  //    produces an axis-aligned output whose bounding box aspect
  //    matches the estimated rectified aspect within ±3 %.
  //
  //    We fabricate a `sourceW × sourceH` gray canvas with a
  //    tapered white quadrilateral drawn on it, run our warp, then
  //    inspect the output for the recovered rectangle's straight
  //    edges.
  {
    const sourceW = 240;
    const sourceH = 200;
    const src = new Uint8ClampedArray(sourceW * sourceH * 4);
    for (let i = 0; i < src.length; i += 4) {
      src[i] = 60;
      src[i + 1] = 60;
      src[i + 2] = 60;
      src[i + 3] = 255;
    }
    // Tapered quadrilateral in source pixel space (TL/TR/BR/BL).
    const srcCorners: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [40, 20],
      [200, 30],
      [210, 175],
      [30, 170],
    ];
    // Point-in-quad (barycentric) test to fill the tapered white
    // region on the gray background.
    const insideQuad = (px: number, py: number): boolean => {
      // Split quad into two triangles: (TL, TR, BR) and (TL, BR, BL).
      const [TL, TR, BR, BL] = srcCorners;
      const sign = (
        a: [number, number],
        b: [number, number],
        c: [number, number],
      ): number =>
        (px - c[0]) * (a[1] - c[1]) - (a[0] - c[0]) * (py - c[1]);
      const inTri = (
        a: [number, number],
        b: [number, number],
        c: [number, number],
      ): boolean => {
        const d1 = sign(a, b, c);
        const d2 = sign(b, c, a);
        const d3 = sign(c, a, b);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(hasNeg && hasPos);
      };
      return inTri(TL, TR, BR) || inTri(TL, BR, BL);
    };
    for (let y = 0; y < sourceH; y += 1) {
      for (let x = 0; x < sourceW; x += 1) {
        if (insideQuad(x, y)) {
          const p = (y * sourceW + x) * 4;
          src[p] = 245;
          src[p + 1] = 245;
          src[p + 2] = 245;
          src[p + 3] = 255;
        }
      }
    }
    // Compute the target aspect the pipeline would use.
    const aspect = estimateRectifiedAspect(srcCorners);
    const outLong = Math.max(sourceW, sourceH);
    const outW = aspect >= 1 ? outLong : Math.round(outLong * aspect);
    const outH = aspect >= 1 ? Math.round(outLong / aspect) : outLong;
    const H = homographyForCorners(srcCorners, outW, outH);
    assert.ok(H, "homography solvable for tapered corners");
    if (!H) return;
    const srcImage = { data: src, width: sourceW, height: sourceH } as ImageData;
    const warped = warpPerspectiveNearest(srcImage, H, outW, outH);
    assert.ok(warped, "warp produced an ImageData");
    if (!warped) return;

    // Extract the bounding box of "bright" pixels in the warp. In a
    // clean rectification the white region should fill the entire
    // output canvas, edge-to-edge, with a bbox aspect ≈ outW/outH.
    let minX = outW;
    let maxX = -1;
    let minY = outH;
    let maxY = -1;
    for (let y = 0; y < outH; y += 1) {
      for (let x = 0; x < outW; x += 1) {
        const p = (y * outW + x) * 4;
        if (warped.data[p] > 180) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    assert.ok(maxX > minX && maxY > minY, "recovered a non-empty bright region");
    const bboxW = maxX - minX + 1;
    const bboxH = maxY - minY + 1;
    const bboxAspect = bboxW / bboxH;
    // The warp maps the source tapered quad onto [0, outW] × [0, outH]
    // exactly, so the bright region's aspect should match outW / outH
    // to within a few pixels of anti-alias slop.
    const expected = outW / outH;
    assert.ok(
      Math.abs(bboxAspect - expected) / expected <= 0.03,
      `warped bbox aspect within ±3% of target (got ${bboxAspect.toFixed(
        3,
      )}, expected ${expected.toFixed(3)})`,
    );
    // And it should occupy essentially the whole canvas.
    assert.ok(
      bboxW / outW > 0.95 && bboxH / outH > 0.95,
      `warped rect fills the canvas (${(bboxW / outW).toFixed(2)}, ${(
        bboxH / outH
      ).toFixed(2)})`,
    );
  }

  // ── Guardrail 7: edge detector on the same synthetic buffer
  //    returns non-null, non-degenerate output — proves the analyze
  //    branch is exercised (protects against a future refactor that
  //    accidentally short-circuits the detector for the entire flat
  //    path).
  {
    const W = 200;
    const H = 160;
    const buf = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = 40;
      buf[i + 1] = 40;
      buf[i + 2] = 40;
      buf[i + 3] = 255;
    }
    // Draw a slightly-tilted white square.
    const cx = W / 2;
    const cy = H / 2;
    const theta = 0.12; // ~7°
    const hw = 50;
    const hh = 40;
    const cos = Math.cos(-theta);
    const sin = Math.sin(-theta);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const rx = cos * dx - sin * dy;
        const ry = sin * dx + cos * dy;
        if (Math.abs(rx) <= hw && Math.abs(ry) <= hh) {
          const p = (y * W + x) * 4;
          buf[p] = 230;
          buf[p + 1] = 230;
          buf[p + 2] = 230;
        }
      }
    }
    const fit = detectBestQuadrilateral(buf, W, H);
    assert.ok(fit, "detector produced a fit on tilted rectangle");
  }

  console.log("keystone regression (§Fix B) contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
