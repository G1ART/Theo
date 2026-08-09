/**
 * Theo Image Enhance (Beta) — G3 (2026-08-10) adaptive tunables.
 *
 * The `proLook` pipeline used fixed defaults for `unsharpAmount`,
 * `claheClipLimit`, `dehazeAmount`, `microContrast`, and `satBoost`.
 * That's fine for well-exposed studio shots but produces two failure
 * modes on real captures:
 *
 *   1. Blurry hand-held phone shots come out under-sharpened — the
 *      default 0.2 unsharp is designed to avoid haloing on crisp
 *      scans, so on a soft input it leaves the artwork feeling like
 *      it's still behind glass.
 *   2. Bright-window daylight shots come out over-boosted in the
 *      highlights, blowing out subtle textures on paper works and
 *      producing the "glossy plastic" look reported by QA.
 *
 * The fix is to make these values functions of the analyzer output.
 * This module extracts the tunables into a typed, testable module
 * so both the engine wiring and the unit tests can share a single
 * source of truth for the mapping.
 *
 * Related to G4: satBoost is capped at 0.03 for paintings (see the
 * `paintingMode` gate in `resolveAdaptiveProLook`) so the "no lurid
 * colors" quality target holds even on strong-intensity shots.
 */

import type { ProLookConfig } from "./proLook";
import { PRO_LOOK_DEFAULTS } from "./proLook";

/** Signals the adaptive tuner reads. All scalars in [0,1] except
 *  `intensityMultiplier` which is [0.4, 1.6] (Light/Normal/Strong). */
export type AdaptiveSignals = {
  /** From `analyze.ts` — higher = blurrier / softer. */
  blurScore: number;
  /** From `analyze.ts` — higher = more highlight blow-out. */
  glareScore: number;
  /** Basic-view intensity multiplier chosen by the user. Applied
   *  AFTER the adaptive base values, so clamps still hold. */
  intensityMultiplier: number;
  /**
   * When true, we assume the subject is a painting/work-on-paper
   * (either `analysis.mode === "flat"` OR the user picked 회화 as
   * input type). Painting mode caps `satBoost` at 0.03 (vs 0.06
   * default) so the paper doesn't neonize.
   */
  paintingMode: boolean;
};

/** Adaptive additions that layer on top of the base ProLookConfig.
 *  These extend the config with values the engine consumes AFTER the
 *  intensity multiplier has been applied. */
export type AdaptiveProLookConfig = ProLookConfig & {
  /**
   * G3 highlight compression. Fraction (0..1) by which to reduce
   * top-5 % pixels' linear luminance BEFORE the unsharp stage.
   * Values > 0 trigger the compression pass; 0 = no-op.
   */
  highlightCompress: number;
};

/**
 * Adaptive base values. Applied BEFORE the intensity multiplier so
 * the multiplier lands on top of a sensible starting point.
 *
 *   - `unsharpAmount = 0.15 + 0.35 * blurScore` clamped [0.15, 0.45]
 *   - `claheClipLimit = 1.0 + 0.6 * blurScore` clamped [1.0, 1.6]
 *   - `highlightCompress = 0.15 * glareScore` when `glareScore > 0.4`,
 *     else 0
 *
 * Rationale — see the header comment above.
 */
export function computeAdaptiveBases(signals: Pick<AdaptiveSignals, "blurScore" | "glareScore">): {
  unsharpAmount: number;
  claheClipLimit: number;
  highlightCompress: number;
} {
  const blur = clamp01(signals.blurScore);
  const glare = clamp01(signals.glareScore);
  const unsharpAmount = clamp(0.15 + 0.35 * blur, 0.15, 0.45);
  const claheClipLimit = clamp(1.0 + 0.6 * blur, 1.0, 1.6);
  const highlightCompress = glare > 0.4 ? 0.15 * glare : 0;
  return { unsharpAmount, claheClipLimit, highlightCompress };
}

/**
 * Resolve a full `AdaptiveProLookConfig` from the analyzer signals,
 * an intensity multiplier, and an optional base recipe. Applies:
 *   1. Base tunable formulas → `computeAdaptiveBases`.
 *   2. Intensity multiplier (respects clamps AFTER).
 *   3. Painting-mode satBoost cap (0.03 max) when applicable.
 *   4. Explicit clamps around every emitted value.
 */
export function resolveAdaptiveProLook(
  signals: AdaptiveSignals,
  base?: Partial<ProLookConfig>,
): AdaptiveProLookConfig {
  const mult = signals.intensityMultiplier;
  const bases = computeAdaptiveBases(signals);

  // Start with defaults, then user-supplied overrides.
  const merged: ProLookConfig = {
    ...PRO_LOOK_DEFAULTS,
    ...(base ?? {}),
  };

  // Apply adaptive bases + intensity multiplier + final clamps.
  const unsharpAmount = clamp(bases.unsharpAmount * mult, 0.1, 0.5);
  const claheClipLimit = clamp(bases.claheClipLimit * mult, 0.8, 2.0);
  const highlightCompress = clamp(bases.highlightCompress * mult, 0, 0.4);

  // satBoost — painting mode caps at 0.03, else at 0.06 (existing
  // default). Multiplier still applies but clamp holds the ceiling.
  const satBase = merged.satBoost ?? PRO_LOOK_DEFAULTS.satBoost;
  const satCap = signals.paintingMode ? 0.03 : 0.06;
  const satBoost = clamp(satBase * mult, 0, satCap);

  return {
    ...merged,
    unsharpAmount,
    claheClipLimit,
    satBoost,
    highlightCompress,
  };
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
