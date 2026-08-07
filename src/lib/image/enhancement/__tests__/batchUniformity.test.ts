// 2026-08-06 — Contract test for batch uniformity.
//
// Guardrails:
//   1. Corrective deltas clamped to ±5 % envelope.
//   2. Provenance meta records the target stats and applied deltas.
//   3. Applier stays inside the [0.7, 1.3] tone box.

import assert from "node:assert/strict";

(async () => {
  const {
    computeToneDelta,
    buildBatchNormalizationMeta,
    toneSignature,
    BATCH_ENVELOPE,
    applyToneDelta,
  } = await import("../coherence");

  const current = toneSignature({ b: 0.75, c: 0.8, s: 0.85 });
  const target = toneSignature({ b: 1.05, c: 1.05, s: 1.05 });
  const delta = computeToneDelta(current, target, BATCH_ENVELOPE);
  for (const v of [delta.b, delta.c, delta.s]) {
    assert.ok(Math.abs(v) <= BATCH_ENVELOPE + 1e-9, `|${v}| ≤ ${BATCH_ENVELOPE}`);
  }
  // Non-zero when current is meaningfully off target.
  assert.ok(Math.abs(delta.b) > 0, "b delta non-zero");

  const meta = buildBatchNormalizationMeta(target, delta);
  assert.equal(meta.targetLuma, target.meanLuma);
  assert.equal(meta.targetSat, target.meanSat);
  for (const v of [meta.appliedDeltas.b, meta.appliedDeltas.c, meta.appliedDeltas.s]) {
    assert.ok(Math.abs(v) <= BATCH_ENVELOPE + 1e-9);
  }

  // Applier bounds.
  const base = { b: 1.05, c: 1.05, s: 1.05 };
  const nudged = applyToneDelta(base, delta);
  for (const v of [nudged.b, nudged.c, nudged.s]) {
    assert.ok(v >= 0.7 && v <= 1.3);
  }

  // A zero-target signature (all zero) produces zero-delta so callers
  // can safely feed the "artist has no prior works" empty result.
  const emptyTarget = { meanLuma: 0, meanChroma: 0, meanSat: 0, meanContrast: 0 };
  const emptyDelta = computeToneDelta(current, emptyTarget, BATCH_ENVELOPE);
  assert.equal(emptyDelta.b, 0, "empty target -> zero b");
  assert.equal(emptyDelta.s, 0, "empty target -> zero s");

  console.log("batch uniformity contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
