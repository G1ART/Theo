// Theo Image Enhance (Beta, 2026-08-05) — living contract for the
// enhancement recipe / meta shapes. Runnable via `tsx` (matches the
// repo's other unit tests). Exists to catch silent shape drift between
// the client engine, the /api/image-enhance/object route, and the DB
// jsonb column.

import assert from "node:assert/strict";

(async () => {
  const {
    clampTone,
    round3,
    isEnhancementMeta,
    normalizeEnhancementMeta,
    ENHANCEMENT_TONE_CAP,
    ENHANCEMENT_META_SCHEMA_VERSION,
  } = await import("../types");

  // ── clampTone: enforces the ±ENHANCEMENT_TONE_CAP window around 1.0
  //   (recipe tone values are multipliers, so "no change" is 1.0). ─
  assert.equal(clampTone(1), 1);
  assert.equal(clampTone(1 + ENHANCEMENT_TONE_CAP * 0.5), 1 + ENHANCEMENT_TONE_CAP * 0.5);
  assert.equal(clampTone(2), 1 + ENHANCEMENT_TONE_CAP, "clamps above the cap");
  assert.equal(clampTone(-5), 1 - ENHANCEMENT_TONE_CAP, "clamps below the cap");
  assert.equal(clampTone(Number.NaN), 1, "non-finite sanitizes to 1.0");

  // ── round3: deterministic 3-decimal rounding for JSON stability ──
  assert.equal(round3(0.123456), 0.123);
  assert.equal(round3(0.1235), 0.124);
  assert.equal(round3(1), 1);

  const validHash =
    "0000000000000000000000000000000000000000000000000000000000000000";

  // ── flat recipe roundtrip ────────────────────────────────────────
  const flatInput = {
    provider: "local_opencv",
    mode: "flat",
    recipe: {
      kind: "flat",
      params: {
        sourceCorners: [
          [0.02, 0.03],
          [0.98, 0.04],
          [0.97, 0.96],
          [0.03, 0.95],
        ],
        tone: { b: 1.05, c: 1.1, s: 0.95 },
        sharpen: 0.4,
        bezel: 0.02,
      },
    },
    confidence: 0.82,
    sourceHashSha256: validHash,
    processedAtIso: "2026-08-05T00:00:00.000Z",
    latencyMs: 320,
    versions: { schema: 1, engine: "local-flat/1" },
  };
  assert.ok(isEnhancementMeta(flatInput), "flat sample is recognised");
  const flatMeta = normalizeEnhancementMeta(flatInput);
  assert.ok(flatMeta, "flat sample normalizes non-null");
  if (flatMeta) {
    assert.equal(flatMeta.provider, "local_opencv");
    assert.equal(flatMeta.mode, "flat");
    assert.equal(flatMeta.recipe.kind, "flat");
    if (flatMeta.recipe.kind === "flat") {
      const t = flatMeta.recipe.params.tone;
      assert.ok(
        t.b <= 1 + ENHANCEMENT_TONE_CAP && t.b >= 1 - ENHANCEMENT_TONE_CAP,
        "tone.b is clamped",
      );
      assert.ok(flatMeta.recipe.params.sourceCorners, "corners preserved");
      assert.equal(flatMeta.recipe.params.sourceCorners?.length, 4);
    }
    // JSON stability: encode → decode → re-normalize should give the same shape.
    const roundtrip = JSON.parse(JSON.stringify(flatMeta));
    assert.deepEqual(normalizeEnhancementMeta(roundtrip), flatMeta);
  }

  // ── object recipe roundtrip ──────────────────────────────────────
  const objectInput = {
    provider: "photoroom_hybrid",
    mode: "object",
    recipe: { kind: "object", params: { padding: 0.06, bezel: 0 } },
    confidence: null,
    sourceHashSha256: validHash,
    processedAtIso: "2026-08-05T00:00:00.000Z",
    latencyMs: 1500,
    versions: { schema: ENHANCEMENT_META_SCHEMA_VERSION, engine: "photoroom-hybrid/1" },
  };
  assert.ok(isEnhancementMeta(objectInput), "object sample recognised");
  const objectMeta = normalizeEnhancementMeta(objectInput);
  assert.ok(objectMeta, "object sample normalizes non-null");
  if (objectMeta) {
    assert.equal(objectMeta.provider, "photoroom_hybrid");
    assert.equal(objectMeta.mode, "object");
    assert.equal(objectMeta.recipe.kind, "object");
  }

  // ── negative cases ───────────────────────────────────────────────
  assert.equal(isEnhancementMeta(null), false);
  assert.equal(isEnhancementMeta({ provider: "unknown" }), false);
  assert.equal(
    normalizeEnhancementMeta({ ...flatInput, provider: "nope" }),
    null,
    "invalid provider → null",
  );
  assert.equal(
    normalizeEnhancementMeta({ ...flatInput, sourceHashSha256: "not-a-hash" }),
    null,
    "bad sha256 → null (avoids persisting corrupt provenance)",
  );
  assert.equal(normalizeEnhancementMeta(null), null);
  assert.equal(normalizeEnhancementMeta("garbage"), null);

  console.log("enhancement recipe/meta contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
