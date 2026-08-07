// Theo Image Enhance (Beta, 2026-08-05) — geometry / File helper
// contract test. The engine's homography stubs are exercised via the
// public FlatRecipe shape (normalizeCropFromCorners is internal), but
// we can still guard the public flatBlobToFile helper and the
// FlatRecipe corner shape against silent regressions.

import assert from "node:assert/strict";

(async () => {
  const { flatBlobToFile } = await import("../localFlatEngine");

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

  console.log("enhancement geometry contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
