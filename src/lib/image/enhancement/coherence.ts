/**
 * Theo Image Enhance (Beta) — batch uniformity + artist portfolio
 * coherence appliers (2026-08-06).
 *
 * These functions turn a target statistic + the current image's own
 * statistics into a small corrective delta on `display_adjust` /
 * `tone` (b, c, s). The clamps are the whole point: batch uniformity
 * is capped at ±5 %, portfolio coherence at ±4 %. Together they keep
 * the artist's creative intent intact.
 *
 * The math is intentionally simple — this is a "nudge toward the
 * mean" step, not a full re-render. Consumers apply the returned
 * deltas by multiplying/adding into their existing tone triple.
 */

import type {
  BatchNormalizationMeta,
  PortfolioCoherenceMeta,
} from "./types";

export type ToneSignature = {
  meanLuma: number;
  meanChroma: number;
  meanSat: number;
  meanContrast: number;
};

export type ToneDelta = { b: number; c: number; s: number };

/** ±5 % envelope for batch uniformity. */
export const BATCH_ENVELOPE = 0.05;

/** ±4 % envelope for portfolio coherence. */
export const PORTFOLIO_ENVELOPE = 0.04;

function clampAbs(n: number, cap: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(cap, Math.max(-cap, n));
}

/**
 * Compute corrective deltas that nudge this image's tone toward the
 * target signature, clamped to the given envelope.
 *
 * `current` is the image's own tone signature. Values are in the same
 * space as the target (b*128 for luma, c*s*60 for chroma, s / c raw).
 */
export function computeToneDelta(
  current: ToneSignature,
  target: ToneSignature,
  envelope: number,
): ToneDelta {
  const dLuma = target.meanLuma > 0 ? (target.meanLuma - current.meanLuma) / 128 : 0;
  const dSat = target.meanSat > 0 && current.meanSat > 0
    ? target.meanSat / current.meanSat - 1
    : 0;
  const dContrast = target.meanContrast > 0 && current.meanContrast > 0
    ? target.meanContrast / current.meanContrast - 1
    : 0;
  return {
    b: clampAbs(dLuma, envelope),
    c: clampAbs(dContrast, envelope),
    s: clampAbs(dSat, envelope),
  };
}

/**
 * Apply a corrective delta to the base tone triple. Delta values are
 * additive/multiplicative-ish — `b + delta.b`, etc. — so the caller
 * doesn't need to know the current tone's absolute space.
 */
export function applyToneDelta(
  base: { b: number; c: number; s: number },
  delta: ToneDelta,
): { b: number; c: number; s: number } {
  return {
    b: Math.max(0.7, Math.min(1.3, base.b + delta.b)),
    c: Math.max(0.7, Math.min(1.3, base.c * (1 + delta.c))),
    s: Math.max(0.7, Math.min(1.3, base.s * (1 + delta.s))),
  };
}

/**
 * Compute a per-image tone signature from its b/c/s triple in the
 * same space the SQL RPC uses (b*128, c*s*60, s, c). Keeps client and
 * server in sync.
 */
export function toneSignature(triple: {
  b: number;
  c: number;
  s: number;
}): ToneSignature {
  return {
    meanLuma: triple.b * 128,
    meanChroma: triple.c * triple.s * 60,
    meanSat: triple.s,
    meanContrast: triple.c,
  };
}

/**
 * Build the `EnhancementMeta.batchNormalization` provenance payload
 * from a target + applied delta. Only include when the chip was ON.
 */
export function buildBatchNormalizationMeta(
  target: ToneSignature,
  delta: ToneDelta,
): BatchNormalizationMeta {
  return {
    targetLuma: target.meanLuma,
    targetChroma: target.meanChroma,
    targetSat: target.meanSat,
    appliedDeltas: {
      b: clampAbs(delta.b, BATCH_ENVELOPE),
      c: clampAbs(delta.c, BATCH_ENVELOPE),
      s: clampAbs(delta.s, BATCH_ENVELOPE),
    },
  };
}

/**
 * Build the `EnhancementMeta.portfolioCoherence` provenance payload
 * from a target + applied delta + sampleCount. Only include when the
 * chip was ON and sampleCount >= 3 (else caller should skip entirely).
 */
export function buildPortfolioCoherenceMeta(
  target: ToneSignature,
  delta: ToneDelta,
  sampleCount: number,
): PortfolioCoherenceMeta {
  return {
    targetStats: {
      meanLuma: target.meanLuma,
      meanChroma: target.meanChroma,
      meanSat: target.meanSat,
      meanContrast: target.meanContrast,
    },
    appliedDeltas: {
      b: clampAbs(delta.b, PORTFOLIO_ENVELOPE),
      c: clampAbs(delta.c, PORTFOLIO_ENVELOPE),
      s: clampAbs(delta.s, PORTFOLIO_ENVELOPE),
    },
    sampleCount,
  };
}
