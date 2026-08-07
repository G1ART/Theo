// 2026-08-06 — Contract test for artist-portfolio coherence.
//
// Guardrails:
//   1. Applied deltas are clamped to ±4 % envelope.
//   2. Provenance meta refuses to write outside ±4 %.
//   3. When sampleCount < 3, caller-side helpers still return safely
//      but produce a meta with sampleCount < 3 so consumers know to
//      skip the step.

import assert from "node:assert/strict";

(async () => {
  const {
    computeToneDelta,
    buildPortfolioCoherenceMeta,
    toneSignature,
    PORTFOLIO_ENVELOPE,
    applyToneDelta,
  } = await import("../coherence");

  // A dark image; target is much brighter/saturated.
  const current = toneSignature({ b: 0.8, c: 0.9, s: 0.9 });
  const target = toneSignature({ b: 1.2, c: 1.15, s: 1.2 });
  const delta = computeToneDelta(current, target, PORTFOLIO_ENVELOPE);
  assert.ok(Math.abs(delta.b) <= PORTFOLIO_ENVELOPE + 1e-9, "b clamped");
  assert.ok(Math.abs(delta.c) <= PORTFOLIO_ENVELOPE + 1e-9, "c clamped");
  assert.ok(Math.abs(delta.s) <= PORTFOLIO_ENVELOPE + 1e-9, "s clamped");
  // Direction check — going brighter/warmer means b delta > 0.
  assert.ok(delta.b > 0, "b nudged up toward target");

  const meta = buildPortfolioCoherenceMeta(target, delta, 12);
  assert.equal(meta.sampleCount, 12);
  assert.ok(Math.abs(meta.appliedDeltas.b) <= PORTFOLIO_ENVELOPE + 1e-9);
  assert.equal(meta.targetStats.meanLuma, target.meanLuma);
  assert.equal(meta.targetStats.meanSat, target.meanSat);

  // Skip guard: sampleCount < 3 — caller should skip. We still build
  // a meta with sampleCount = 0 to make the intent explicit.
  const skipMeta = buildPortfolioCoherenceMeta(target, { b: 0, c: 0, s: 0 }, 0);
  assert.equal(skipMeta.sampleCount, 0, "sampleCount preserved");
  assert.deepEqual(skipMeta.appliedDeltas, { b: 0, c: 0, s: 0 }, "no delta when zero");

  // applyToneDelta stays inside the safe absolute [0.7, 1.3] tone box.
  const base = { b: 1.15, c: 1.05, s: 1.1 };
  const nudged = applyToneDelta(base, delta);
  for (const v of [nudged.b, nudged.c, nudged.s]) {
    assert.ok(v >= 0.7 && v <= 1.3, `${v} inside [0.7, 1.3]`);
  }

  console.log("portfolio coherence contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
