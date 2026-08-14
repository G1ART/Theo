// QA 2026-06-26 (#4) — size unit toggle helpers must round-trip with
// parseSizeWithUnit and never destroy hosu or free-form notes.

import assert from "node:assert/strict";

(async () => {
  const { setSizeUnitSuffix, detectSizeUnit, parseSizeWithUnit, convertSizeString } = await import(
    "../src/lib/size/format"
  );

  // Toggling cm → in rewrites the suffix.
  assert.equal(setSizeUnitSuffix("30 x 40 cm", "in"), "30 × 40 in");
  // Toggling in → cm rewrites the suffix.
  assert.equal(setSizeUnitSuffix("24 x 18 in", "cm"), "24 × 18 cm");
  // Unitless gets the unit appended.
  assert.equal(setSizeUnitSuffix("100 x 80", "cm"), "100 × 80 cm");
  assert.equal(setSizeUnitSuffix("100 x 80", "in"), "100 × 80 in");
  // Hosu strings are left alone — they're cm-anchored by definition.
  const hosu = "30F (90.9 x 72.7 cm)";
  assert.equal(setSizeUnitSuffix(hosu, "in"), hosu);
  // Empty / non-size strings are returned unchanged.
  assert.equal(setSizeUnitSuffix("", "cm"), "");
  assert.equal(setSizeUnitSuffix("notes about scale", "in"), "notes about scale");

  // detectSizeUnit prefers explicit suffix, falls back to locale.
  assert.equal(detectSizeUnit("30 x 40 cm", "en"), "cm");
  assert.equal(detectSizeUnit("30 x 40 in", "ko"), "in");
  assert.equal(detectSizeUnit("30 x 40", "ko"), "cm");
  assert.equal(detectSizeUnit("30 x 40", "en"), "in");
  assert.equal(detectSizeUnit(null, "en"), "in");

  // Round-trip: toggle → parseSizeWithUnit recovers the unit.
  const v = setSizeUnitSuffix("30 x 40", "in");
  const p = parseSizeWithUnit(v);
  assert.ok(p, "round-trip parse must succeed");
  assert.equal(p!.unit, "in");

  assert.equal(convertSizeString("30 x 40 cm", "in"), "11.8 × 15.7 in");
  assert.equal(convertSizeString("11.8 x 15.7 in", "cm"), "30 × 39.9 cm");
  assert.equal(convertSizeString("30 x 40", "in"), "11.8 × 15.7 in");
  const hosuConvert = "30F (90.9 x 72.7 cm)";
  assert.equal(convertSizeString(hosuConvert, "in"), hosuConvert);
  assert.equal(convertSizeString("notes about scale", "in"), "notes about scale");

  console.log("size-unit-toggle.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
