// Sprint 5 — Visibility copy tone audit.
//
// Asserts the GatedField copy helper:
//   1. Never emits forbidden paywall vocabulary
//      ("pay to unlock", "upgrade to see", "locked",
//       "subscribe to view price").
//   2. Reads as hospitality (the EN copy contains "share/shares").
//   3. Renders for every audience × every first-class field combination.

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://stub.example.com";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "stub-anon-key";

import assert from "node:assert/strict";

(async () => {
  const copyMod = await import("../src/lib/visibility/copy");
  const typesMod = await import("../src/lib/visibility/types");
  const presetsMod = await import("../src/lib/visibility/presets");

  const {
    getVisibilityGateCopy,
    copyContainsForbidden,
    copyHasHospitalityTone,
    FORBIDDEN_GATE_PHRASES,
  } = copyMod;

  const audiences = typesMod.PUBLIC_AUDIENCE_PICKER_ORDER;
  const fields = ["price", "availability", "description", "studio_note", "room", "*"];

  // 1. Forbidden phrases — none of the produced copy may contain them.
  for (const a of audiences) {
    for (const f of fields) {
      const en = getVisibilityGateCopy({ requiredAudience: a, fieldKey: f, locale: "en" });
      const ko = getVisibilityGateCopy({ requiredAudience: a, fieldKey: f, locale: "ko" });
      const enBad = copyContainsForbidden(en);
      const koBad = copyContainsForbidden(ko);
      assert.equal(
        enBad,
        null,
        `EN copy for audience=${a} field=${f} contained forbidden phrase: ${enBad}`
      );
      assert.equal(
        koBad,
        null,
        `KO copy for audience=${a} field=${f} contained forbidden phrase: ${koBad}`
      );
      assert.ok(en.length > 0, `EN copy must be non-empty for ${a}/${f}`);
      assert.ok(ko.length > 0, `KO copy must be non-empty for ${a}/${f}`);
    }
  }

  // 2. EN copy carries the hospitality tone in at least one
  //    "shares"-flavored field (we don't insist on every single line so the
  //    helper can phrase 'owner_only' as "keeps private for now").
  let toneCount = 0;
  for (const a of audiences) {
    const en = getVisibilityGateCopy({ requiredAudience: a, fieldKey: "price", locale: "en" });
    if (copyHasHospitalityTone(en)) toneCount++;
  }
  assert.ok(
    toneCount >= audiences.length - 2,
    `Expected hospitality tone in most EN audience phrasings; got ${toneCount}/${audiences.length}`
  );

  // 3. Spot-check the forbidden list is non-empty and includes at least one
  //    payment-related word (regression guard against accidental shrinkage).
  assert.ok(FORBIDDEN_GATE_PHRASES.length >= 4);
  assert.ok(
    FORBIDDEN_GATE_PHRASES.some((p) => p.includes("pay") || p.includes("subscribe"))
  );

  // 4. Preset → field default audience map is complete: every preset has
  //    a defined default audience for the first-class fields plus '*'.
  for (const preset of typesMod.PRESET_ORDER) {
    for (const f of [...typesMod.FIRST_CLASS_ARTWORK_FIELDS, "*"]) {
      const aud = presetsMod.defaultAudienceForField(preset, f);
      assert.ok(
        typesMod.PUBLIC_AUDIENCE_PICKER_ORDER.includes(aud) || aud === "delegates",
        `preset ${preset} field ${f} produced unknown audience ${aud}`
      );
    }
  }

  console.log("visibility-copy.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
