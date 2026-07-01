// Artwork size display (2026-07-01) — locale/preference-based cm↔inch
// rendering. Verifies:
//   - resolveViewUnit priority (preference > locale default)
//   - parseSizeWithUnit robustness on messy production formats
//   - formatSizeForLocale conversion (1in = 2.54cm), 1-decimal rounding,
//     explicit-only hosu labelling, and unit-unknown passthrough.

import assert from "node:assert/strict";

(async () => {
  const {
    resolveViewUnit,
    parseSizeWithUnit,
    formatSizeForLocale,
  } = await import("../src/lib/size/format");

  // ── resolveViewUnit ──────────────────────────────────────────────
  assert.equal(resolveViewUnit("cm", "en"), "cm", "explicit pref wins over locale");
  assert.equal(resolveViewUnit("in", "ko"), "in", "explicit pref wins over locale");
  assert.equal(resolveViewUnit("auto", "ko"), "cm", "auto → ko = cm");
  assert.equal(resolveViewUnit("auto", "en"), "in", "auto → en = in");
  assert.equal(resolveViewUnit(null, "ko"), "cm", "null → locale default");
  assert.equal(resolveViewUnit(undefined, "en"), "in", "undefined → locale default");

  // ── parseSizeWithUnit robustness ─────────────────────────────────
  const cases: Array<[string, "cm" | "in" | null, number]> = [
    ["91*72.2", null, 91], // bare numbers, star separator
    ["42x29.7(cm)", "cm", 42], // parenthesised cm
    ['9" x 12"', "in", 9 * 2.54], // inch double-quote marks
    ["53cm x 45.5cm", "cm", 53], // cm on each dim
    ["24 x 24 inch", "in", 24 * 2.54], // spelled-out inch
    ["50 X 50cm", "cm", 50], // uppercase X + trailing cm
    ["130 × 324", null, 130], // unicode ×, no unit
  ];
  for (const [input, unit, widthCm] of cases) {
    const p = parseSizeWithUnit(input);
    assert.ok(p, `should parse: ${input}`);
    assert.equal(p!.unit, unit, `unit for ${input}`);
    assert.ok(
      Math.abs(p!.parsed.widthCm - widthCm) < 0.001,
      `widthCm for ${input}: ${p!.parsed.widthCm} vs ${widthCm}`
    );
  }
  // Free-form / no dimensions → null.
  assert.equal(parseSizeWithUnit("Variable size"), null);
  assert.equal(parseSizeWithUnit("N/A"), null);
  // Explicit hosu → cm + label metadata.
  const hosu = parseSizeWithUnit("30F (90.9 x 72.7 cm)");
  assert.ok(hosu);
  assert.equal(hosu!.unit, "cm");
  assert.equal(hosu!.parsed.hosuNumber, 30);
  assert.equal(hosu!.parsed.hosuType, "F");

  // ── formatSizeForLocale ──────────────────────────────────────────
  // cm stored: KO shows cm, EN converts to inch (rounded 1dp).
  assert.equal(formatSizeForLocale("53 x 45.5", "ko", "cm"), "53 × 45.5 cm");
  assert.equal(formatSizeForLocale("53 x 45.5", "en", "cm"), "20.9 × 17.9 in");
  // in stored: EN shows inch, KO converts to cm.
  assert.equal(formatSizeForLocale("24 x 24", "en", "in"), "24 × 24 in");
  assert.equal(formatSizeForLocale("24 x 24", "ko", "in"), "61 × 61 cm");
  // Preference overrides locale.
  assert.equal(formatSizeForLocale("53 x 45.5", "ko", "cm", "in"), "20.9 × 17.9 in");
  assert.equal(formatSizeForLocale("24 x 24", "en", "in", "cm"), "61 × 61 cm");
  // Explicit hosu label kept; converted per view unit.
  assert.equal(formatSizeForLocale("30F", "ko"), "30F · 92 × 73 cm");
  assert.equal(formatSizeForLocale("30F", "en"), "30F · 36.2 × 28.7 in");
  // Embedded unit, no stored column → detected from text.
  assert.equal(formatSizeForLocale("42x29.7(cm)", "en"), "16.5 × 11.7 in");
  // Unknown unit (bare numbers, no stored) → numbers only, no unit suffix.
  assert.equal(formatSizeForLocale("91*72.2", "ko"), "91 × 72.2");
  // Free-form note returned verbatim.
  assert.equal(formatSizeForLocale("Variable size", "en"), "Variable size");
  // Trailing .0 dropped.
  assert.equal(formatSizeForLocale("100 x 80", "ko", "cm"), "100 × 80 cm");

  console.log("size-display.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
