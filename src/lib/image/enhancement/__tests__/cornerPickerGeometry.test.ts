// 2026-08-07 — Contract test for the perspective corner picker geometry
// helpers. The picker itself is a DOM component; these tests focus on
// the pure math extracted into `cornerPickerGeometry.ts`.
//
// Guardrails:
//   1. Bounds clamping: every corner stays in [0,1] × [0,1].
//   2. Minimum quadrilateral area (10 % of image).
//   3. Keyboard nudge math: 1 px arrow, 10 px Shift+arrow, converted
//      into image-pixel-correct normalized deltas.
//   4. Reset seed: 10 % inset when confidence is low.

import assert from "node:assert/strict";

(async () => {
  const {
    MIN_AREA_FRACTION,
    NUDGE_PX,
    NUDGE_SHIFT_PX,
    clampNormalized,
    computeKeyNudge,
    defaultInsetQuad,
    hasValidArea,
    isConvexQuad,
    isTlTrBrBlOrder,
    nextCorner,
    quadFromRect,
    tryMoveCorner,
    orderQuadTlTrBrBl,
    parseVisionCorners,
    isPhotoBoundQuad,
  } = await import("../cornerPickerGeometry");

  // Sanity constants.
  assert.equal(MIN_AREA_FRACTION, 0.1, "min area contract at 10%");
  assert.equal(NUDGE_PX, 1, "1 px arrow nudge");
  assert.equal(NUDGE_SHIFT_PX, 10, "10 px shift nudge");

  // 1. Bounds clamping — points outside [0,1] snap to the box.
  assert.deepEqual(clampNormalized([-0.1, 0.5]), [0, 0.5]);
  assert.deepEqual(clampNormalized([0.5, 1.4]), [0.5, 1]);
  assert.deepEqual(clampNormalized([2, -3]), [1, 0]);
  assert.deepEqual(clampNormalized([Number.NaN, 0.2]), [0, 0.2]);

  // 2. Default inset quad (10 % inset by default).
  const inset10 = defaultInsetQuad();
  assert.deepEqual(inset10, [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ]);
  // Area of a full-box quad is 0.64 (0.8 × 0.8), well above the 10% floor.
  assert.ok(hasValidArea(inset10));

  // 3. Minimum area enforcement — a degenerate quad rejects.
  const degenerate: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ] = [
    [0.5, 0.5],
    [0.5, 0.5],
    [0.5, 0.5],
    [0.5, 0.5],
  ];
  assert.equal(hasValidArea(degenerate), false, "collapsed quad rejected");

  // tryMoveCorner refuses to collapse the quad.
  const collapsed = tryMoveCorner(inset10, 0, [0.85, 0.85]);
  // With TL at (0.85, 0.85) the quad is a tiny sliver — should be
  // rejected and return the original inset10.
  assert.deepEqual(collapsed, inset10, "move that collapses area is rejected");

  // Valid moves keep the shape.
  const moved = tryMoveCorner(inset10, 0, [0.2, 0.2]);
  assert.deepEqual(moved[0], [0.2, 0.2]);
  assert.ok(hasValidArea(moved));

  // Out-of-bounds moves clamp before area-checking.
  const clampedMove = tryMoveCorner(inset10, 1, [1.5, -0.4]);
  assert.deepEqual(clampedMove[1], [1, 0], "out-of-bounds clamps into box");

  // 4. Keyboard nudge math — 1 px on a 2000-wide image is 0.0005.
  const arrow = computeKeyNudge("ArrowRight", false, 2000, 1000);
  assert.equal(arrow.dx, 1 / 2000);
  assert.equal(arrow.dy, 0);
  const shift = computeKeyNudge("ArrowRight", true, 2000, 1000);
  assert.equal(shift.dx, 10 / 2000);
  assert.equal(shift.dy, 0);
  const up = computeKeyNudge("ArrowUp", false, 2000, 1000);
  assert.equal(up.dx, 0);
  assert.equal(up.dy, -1 / 1000);
  const zero = computeKeyNudge("ArrowLeft", false, 0, 0);
  assert.deepEqual(zero, { dx: 0, dy: 0 });

  // 5. Corner cycling — Tab support.
  assert.equal(nextCorner(0), 1);
  assert.equal(nextCorner(1), 2);
  assert.equal(nextCorner(2), 3);
  assert.equal(nextCorner(3), 0);

  // 6. Rect → quad conversion + degenerate rejection.
  const q = quadFromRect({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  assert.deepEqual(q, [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ]);
  const nullQ = quadFromRect({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 });
  assert.equal(nullQ, null, "tiny rect rejected");
  const emptyQ = quadFromRect(null);
  assert.equal(emptyQ, null);

  // Vision corners — unordered points reordered to TL TR BR BL.
  const shuffled = orderQuadTlTrBrBl([
    [0.8, 0.9],
    [0.1, 0.2],
    [0.85, 0.15],
    [0.12, 0.88],
  ]);
  assert.deepEqual(shuffled[0], [0.1, 0.2], "TL");
  assert.deepEqual(shuffled[1], [0.85, 0.15], "TR");
  assert.deepEqual(shuffled[2], [0.8, 0.9], "BR");
  assert.deepEqual(shuffled[3], [0.12, 0.88], "BL");

  const parsed = parseVisionCorners([
    { x: 0.2, y: 0.7 },
    { x: 0.8, y: 0.7 },
    { x: 0.8, y: 0.2 },
    { x: 0.2, y: 0.2 },
  ]);
  assert.ok(parsed);
  assert.deepEqual(parsed![0], [0.2, 0.2]);
  assert.deepEqual(parsed![1], [0.8, 0.2]);
  assert.deepEqual(parsed![2], [0.8, 0.7]);
  assert.deepEqual(parsed![3], [0.2, 0.7]);
  assert.equal(parseVisionCorners([[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]), null);

  // 2026-10-02 — regression tests for bulk-claim-2:
  //   `tryMoveCorner` must reject self-intersecting (butterfly) quads
  //   and moves that put the vertices in a non-TL/TR/BR/BL order,
  //   even when the shoelace area still clears MIN_AREA_FRACTION.
  //   The engine's homography solver on a crossed quad produced the
  //   "picture flipped on its side" Island III result users reported.
  const okQuad: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ] = [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ];
  assert.ok(isConvexQuad(okQuad), "rectangle is convex");
  assert.ok(isTlTrBrBlOrder(okQuad), "rectangle is in canonical order");

  // Butterfly / bowtie: TL ↔ TR vertices swapped so edges 0-1 and 2-3
  // cross. Signed cross products change sign around the loop →
  // `isConvexQuad` → false. (The symmetric bowtie collapses to zero
  // shoelace area so `hasValidArea` would also reject it; the
  // convexity gate is what catches the asymmetric cases that would
  // otherwise sneak past the area floor.)
  const bowtie: typeof okQuad = [
    [0.9, 0.1],
    [0.1, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ];
  assert.equal(isConvexQuad(bowtie), false, "bowtie quad flagged as non-convex");

  // Concave (dart) quad whose unsigned shoelace area still clears the
  // 10 % floor — this is the exact case the convexity gate must catch
  // on its own (claim 2 regression). BR vertex is pulled toward the
  // interior, producing a sign flip in the per-vertex cross product.
  const dart: typeof okQuad = [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.5, 0.3],
    [0.1, 0.9],
  ];
  assert.ok(hasValidArea(dart), "dart passes raw area gate");
  assert.equal(isConvexQuad(dart), false, "dart flagged non-convex");

  // tryMoveCorner must bounce a move that would create a bowtie:
  // drag TL (index 0) past BR to produce a crossed shape.
  const attemptedCross = tryMoveCorner(okQuad, 0, [0.95, 0.95]);
  assert.deepEqual(
    attemptedCross,
    okQuad,
    "cross-the-diagonal move rejected, original quad preserved",
  );

  // Order-flip: push TL down past the BL vertex so top row and bottom
  // row swap. isTlTrBrBlOrder detects it; tryMoveCorner refuses.
  const attemptedFlip = tryMoveCorner(okQuad, 0, [0.1, 0.95]);
  assert.deepEqual(
    attemptedFlip,
    okQuad,
    "flip-top-row-below-bottom move rejected",
  );
  // Confirm the hypothetical post-flip shape is indeed invalid order.
  const flippedShape: typeof okQuad = [
    [0.1, 0.95],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ];
  assert.equal(isTlTrBrBlOrder(flippedShape), false, "flipped quad fails TL/TR/BR/BL order");

  // Degenerate collinear quad: cross products are all zero, convexity
  // check tolerates (returns true), but area gate still rejects.
  const collinear: typeof okQuad = [
    [0.1, 0.5],
    [0.4, 0.5],
    [0.7, 0.5],
    [0.9, 0.5],
  ];
  assert.equal(hasValidArea(collinear), false, "collinear quad fails area");

  // 2026-10-03 — a plain-wall miss used to clamp pixel / 0–1000 corners
  // onto (1, 1) and then fall back to the photo frame.
  const milli = parseVisionCorners([
    [90, 160],
    [830, 150],
    [840, 900],
    [80, 920],
  ]);
  assert.ok(milli, "0–1000 corners stay a quad");
  assert.ok(milli![0][0] > 0.05 && milli![0][0] < 0.12, "TL x on the canvas");
  assert.ok(milli![1][0] > 0.8 && milli![1][0] < 0.9, "TR x on the canvas");
  assert.equal(isPhotoBoundQuad(milli!), false, "rescaled quad is not the photo frame");

  const pixels = parseVisionCorners(
    [
      [120, 140],
      [1400, 130],
      [1420, 980],
      [100, 1000],
    ],
    { width: 1600, height: 1200 },
  );
  assert.ok(pixels, "pixel corners on a 1600px frame parse");
  assert.ok(Math.abs(pixels![1][0] - 1400 / 1600) < 0.02, "TR follows image width");
  assert.equal(
    parseVisionCorners([
      [4000, 10],
      [4000, 10],
      [4000, 10],
      [4000, 10],
    ]),
    null,
    "unscaled pixels still collapse",
  );

  const photoFrame: typeof okQuad = [
    [0.05, 0],
    [1, 0.16],
    [0.94, 1],
    [0, 0.78],
  ];
  assert.equal(isPhotoBoundQuad(photoFrame), true, "clamped photo-frame quad");
  assert.equal(isPhotoBoundQuad(okQuad), false, "inset quad is not the photo frame");

  console.log("corner picker geometry contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
