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
    nextCorner,
    quadFromRect,
    tryMoveCorner,
    orderQuadTlTrBrBl,
    parseVisionCorners,
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

  console.log("corner picker geometry contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
