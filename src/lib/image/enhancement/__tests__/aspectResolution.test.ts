// Theo Image Enhance (Aspect Selector, 2026-10-02) — pure resolver
// contract for the Step 1 output-ratio selector. The helper collapses
// an `AspectMode` + context into a single numeric target aspect (or
// undefined → "let the engine auto-estimate"). The editor UI, bulk
// dialog, and engine all read through this same helper, so a
// regression here is a cross-cutting bug.

import assert from "node:assert/strict";

(async () => {
  const { resolveTargetAspect, formatAspectLabel } = await import(
    "../aspectResolve"
  );

  // 1) `auto` → undefined, regardless of context. This is the default
  //    path and must preserve the pre-2026-10-02 engine behavior
  //    (Zhang/Cao heuristic from corner edge lengths).
  assert.equal(resolveTargetAspect("auto", {}), undefined);
  assert.equal(
    resolveTargetAspect("auto", {
      customAspect: { w: 2, h: 3 },
      artworkCm: { w: 50, h: 50 },
      sourceAspect: 1.333,
    }),
    undefined,
    "auto ignores all context",
  );

  // 2) `square` → 1 exactly.
  assert.equal(resolveTargetAspect("square", {}), 1);

  // 3) Preset tokens parse to their numeric ratio.
  assert.ok(
    Math.abs((resolveTargetAspect("2:3", {}) ?? 0) - 2 / 3) < 1e-9,
    "2:3 → 0.667",
  );
  assert.ok(
    Math.abs((resolveTargetAspect("3:2", {}) ?? 0) - 1.5) < 1e-9,
    "3:2 → 1.5",
  );
  assert.ok(
    Math.abs((resolveTargetAspect("16:9", {}) ?? 0) - 16 / 9) < 1e-9,
    "16:9 → 1.778",
  );
  assert.ok(
    Math.abs((resolveTargetAspect("9:16", {}) ?? 0) - 9 / 16) < 1e-9,
    "9:16 → 0.5625",
  );
  assert.ok(
    Math.abs((resolveTargetAspect("4:5", {}) ?? 0) - 0.8) < 1e-9,
    "4:5 → 0.8",
  );

  // 4) `artwork_cm` with both dimensions > 0 → cm width / cm height.
  assert.ok(
    Math.abs(
      (resolveTargetAspect("artwork_cm", {
        artworkCm: { w: 60, h: 40 },
      }) ?? 0) - 1.5,
    ) < 1e-9,
    "artwork_cm 60×40 → 1.5",
  );
  // 4a) `artwork_cm` with missing / zero / NaN dimensions → undefined
  //      (falls back to engine auto estimate).
  assert.equal(
    resolveTargetAspect("artwork_cm", { artworkCm: { w: null, h: 40 } }),
    undefined,
    "artwork_cm missing w → undefined",
  );
  assert.equal(
    resolveTargetAspect("artwork_cm", { artworkCm: { w: 60, h: null } }),
    undefined,
    "artwork_cm missing h → undefined",
  );
  assert.equal(
    resolveTargetAspect("artwork_cm", { artworkCm: { w: 0, h: 40 } }),
    undefined,
    "artwork_cm zero w → undefined",
  );
  assert.equal(
    resolveTargetAspect("artwork_cm", { artworkCm: { w: 60, h: Number.NaN } }),
    undefined,
    "artwork_cm NaN h → undefined",
  );
  assert.equal(
    resolveTargetAspect("artwork_cm", {}),
    undefined,
    "artwork_cm with no context → undefined",
  );

  // 5) `photo_sensor` → sourceAspect when positive & finite, else
  //    undefined. Direct replacement for the old `keepOriginalAspect`
  //    checkbox.
  assert.ok(
    Math.abs(
      (resolveTargetAspect("photo_sensor", { sourceAspect: 4 / 3 }) ?? 0) -
        4 / 3,
    ) < 1e-9,
    "photo_sensor 4:3 → 1.333",
  );
  assert.equal(
    resolveTargetAspect("photo_sensor", { sourceAspect: 0 }),
    undefined,
    "photo_sensor sourceAspect=0 → undefined",
  );
  assert.equal(
    resolveTargetAspect("photo_sensor", {}),
    undefined,
    "photo_sensor no context → undefined",
  );

  // 6) `custom` with valid numbers > 0 → w/h; otherwise undefined.
  assert.ok(
    Math.abs(
      (resolveTargetAspect("custom", { customAspect: { w: 7, h: 5 } }) ?? 0) -
        7 / 5,
    ) < 1e-9,
    "custom 7×5 → 1.4",
  );
  assert.equal(
    resolveTargetAspect("custom", { customAspect: null }),
    undefined,
    "custom null → undefined",
  );
  assert.equal(
    resolveTargetAspect("custom", { customAspect: { w: 0, h: 5 } }),
    undefined,
    "custom w=0 → undefined",
  );
  assert.equal(
    resolveTargetAspect("custom", { customAspect: { w: 7, h: Number.NaN } }),
    undefined,
    "custom NaN h → undefined",
  );
  assert.equal(
    resolveTargetAspect("custom", {}),
    undefined,
    "custom no context → undefined",
  );

  // 7) `formatAspectLabel` snaps to common ratios within 1 %, and
  //    otherwise prints a normalized "W : H" string.
  assert.equal(formatAspectLabel(1), "1:1");
  assert.equal(formatAspectLabel(1.5), "3:2");
  assert.equal(formatAspectLabel(2 / 3), "2:3");
  assert.equal(formatAspectLabel(16 / 9), "16:9");
  assert.equal(formatAspectLabel(9 / 16), "9:16");
  // 1 % snap: 1.49 is within 1 % of 1.5 so it should still read as 3:2.
  assert.equal(formatAspectLabel(1.49), "3:2");
  // Beyond 1 %: 1.03 is not a common ratio → normalized form.
  assert.equal(formatAspectLabel(1.03), "1.03 : 1");
  // Non-finite / zero → placeholder, not a crash.
  assert.equal(formatAspectLabel(Number.NaN), "—");
  assert.equal(formatAspectLabel(0), "—");

  console.log("aspect resolution contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
