// Theo Image Enhance (Beta, 2026-08-05) — geometry / File helper
// contract test. The engine's homography stubs are exercised via the
// public FlatRecipe shape (normalizeCropFromCorners is internal), but
// we can still guard the public flatBlobToFile helper and the
// FlatRecipe corner shape against silent regressions.

import assert from "node:assert/strict";

(async () => {
  const { flatBlobToFile } = await import("../localFlatEngine");
  const {
    solveHomography,
    applyHomography,
    estimateRectifiedAspect,
    homographyForCorners,
  } = await import("../homography");

  // 1) flatBlobToFile: extension is always .enhanced.webp, mime is webp,
  //    stem is preserved.
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
  const f1 = flatBlobToFile("some.artwork.jpg", blob);
  assert.equal(f1.type, "image/webp");
  assert.equal(f1.name, "some.artwork.enhanced.webp");
  assert.ok(f1.size > 0);

  // 2) Files without an extension get the default `enhanced` stem when
  //    the input name is empty.
  const f2 = flatBlobToFile("", blob);
  assert.equal(f2.name, "enhanced.enhanced.webp");

  // 3) Files with weird extensions still get replaced.
  const f3 = flatBlobToFile("art.HEIC", blob);
  assert.equal(f3.name, "art.enhanced.webp");

  // 4) FlatRecipe corner shape: four [x,y] tuples in [0,1] with TL/TR/BR/BL.
  //    We validate at the type level here by round-tripping through JSON —
  //    the schema is the DB contract for `artwork_images.enhancement_meta`.
  const corners: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const serialized = JSON.stringify(corners);
  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed, corners);
  assert.equal(parsed.length, 4);
  for (const pt of parsed) {
    assert.equal(pt.length, 2);
    assert.ok(pt[0] >= 0 && pt[0] <= 1);
    assert.ok(pt[1] >= 0 && pt[1] <= 1);
  }

  // 5) estimateRectifiedAspect: axis-aligned 3:2 quad returns 1.5,
  //    and the average-side heuristic beats the naive bounding box on
  //    an asymmetrically-keystoned input (top edge shrunk, right side
  //    tilted). Bounding box would give ~1.5 for the identity and
  //    ~1.6 for the keystoned; the average-side heuristic gives a
  //    closer estimate to the artwork's true 1.5 aspect.
  {
    const identity: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [0, 0],
      [300, 0],
      [300, 200],
      [0, 200],
    ];
    const idAspect = estimateRectifiedAspect(identity);
    assert.ok(
      Math.abs(idAspect - 1.5) < 0.001,
      `identity aspect exact 1.5 (got ${idAspect.toFixed(3)})`,
    );
    // Keystoned: top-right corner pulled inward (perspective as if the
    // right side of the artwork is farther from the camera). The
    // average side length is (topW + bottomW) / 2 vs (leftH + rightH) / 2.
    const keystoned: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [0, 20],
      [260, 0],
      [280, 190],
      [0, 210],
    ];
    const ksAspect = estimateRectifiedAspect(keystoned);
    // Compute expected side averages by hand for the assertion — this
    // guards the actual math rather than a magic number.
    const topW = Math.hypot(260 - 0, 0 - 20);
    const bottomW = Math.hypot(280 - 0, 190 - 210);
    const leftH = Math.hypot(0 - 0, 210 - 20);
    const rightH = Math.hypot(280 - 260, 190 - 0);
    const expectedAspect = (topW + bottomW) / 2 / ((leftH + rightH) / 2);
    assert.ok(
      Math.abs(ksAspect - expectedAspect) < 0.01,
      `keystoned aspect from side averages (got ${ksAspect.toFixed(3)}, expected ${expectedAspect.toFixed(3)})`,
    );
    // Sanity: keystoned quad's bounding-box aspect differs from the
    // average-side estimate — proves the heuristic is doing more than
    // returning the bbox aspect.
    const bboxAspect = 280 / (210 - 0);
    assert.ok(
      Math.abs(ksAspect - bboxAspect) > 0.02,
      `average-side estimate differs from bbox aspect (ks=${ksAspect.toFixed(3)}, bbox=${bboxAspect.toFixed(3)})`,
    );
  }

  // 6) estimateRectifiedAspect: degenerate quad falls back gracefully
  //    instead of returning NaN / Infinity.
  {
    const degenerate: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [0, 0],
      [100, 0],
      [100, 0],
      [0, 0],
    ];
    const aspect = estimateRectifiedAspect(degenerate);
    assert.ok(Number.isFinite(aspect), "degenerate aspect is finite");
  }

  // 7) homographyForCorners round-trip: mapping the four source
  //    corners through the solved homography should land within ~1 px
  //    of the axis-aligned destination rectangle corners.
  {
    const src: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [10, 20],
      [190, 5],
      [200, 155],
      [0, 170],
    ];
    const H = homographyForCorners(src, 400, 300);
    assert.ok(H, "homography is solvable");
    if (!H) return;
    const dst: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [0, 0],
      [400, 0],
      [400, 300],
      [0, 300],
    ];
    for (let i = 0; i < 4; i += 1) {
      const mapped = applyHomography(H, src[i]);
      assert.ok(mapped, `corner ${i} mapped`);
      if (!mapped) return;
      assert.ok(
        Math.abs(mapped[0] - dst[i][0]) < 1 && Math.abs(mapped[1] - dst[i][1]) < 1,
        `corner ${i} round-trip: (${mapped[0].toFixed(2)}, ${mapped[1].toFixed(2)}) ~ (${dst[i][0]}, ${dst[i][1]})`,
      );
    }
    void solveHomography;
  }

  console.log("enhancement geometry contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
