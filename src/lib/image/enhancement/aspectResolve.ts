// Theo Image Enhance — output aspect ratio selector.
//
// `aspectMode` captures the user's intent for the rectified output's
// width-to-height ratio. `resolveTargetAspect` collapses that intent
// (plus the available context) into a single numeric aspect, or
// `undefined` to signal "let the engine auto-estimate from the corner
// edge lengths" (preserving the pre-2026-10-02 default behavior).
//
// Keeping this helper pure + context-free lets the editor unit-test
// the resolution matrix without pulling in React.

export type AspectMode =
  | "auto"
  | "square"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "16:9"
  | "9:16"
  | "artwork_cm"
  | "photo_sensor"
  | "custom";

export const ASPECT_PRESETS: AspectMode[] = [
  "auto",
  "square",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "16:9",
  "9:16",
];

/** Numeric parsing for the "W:H" preset tokens. */
export function presetToRatio(mode: AspectMode): number | undefined {
  switch (mode) {
    case "square":
      return 1;
    case "2:3":
      return 2 / 3;
    case "3:2":
      return 3 / 2;
    case "3:4":
      return 3 / 4;
    case "4:3":
      return 4 / 3;
    case "4:5":
      return 4 / 5;
    case "5:4":
      return 5 / 4;
    case "16:9":
      return 16 / 9;
    case "9:16":
      return 9 / 16;
    default:
      return undefined;
  }
}

export type AspectContext = {
  /** Custom W/H chosen in the "직접" form. Pass through unchanged. */
  customAspect?: { w: number; h: number } | null;
  /** Artwork cm dimensions (from the DB row). */
  artworkCm?: { w: number | null | undefined; h: number | null | undefined };
  /** Source photo aspect = analysis.width / analysis.height. */
  sourceAspect?: number | undefined;
};

/**
 * Collapse an `AspectMode` + context into a single numeric target
 * aspect (= width/height). Returns `undefined` whenever the engine
 * should auto-estimate from the user-picked corners.
 *
 * Modes:
 *  - `auto`          → undefined (engine falls back to the Zhang/Cao
 *                      average-side heuristic).
 *  - preset tokens   → the exact ratio (e.g. `2:3` → 0.6667).
 *  - `square`        → 1.
 *  - `artwork_cm`    → cm width / cm height when both > 0; else undefined.
 *  - `photo_sensor`  → `sourceAspect` when defined; else undefined. This
 *                      is the direct replacement for the old
 *                      `keepOriginalAspect` checkbox.
 *  - `custom`        → `customAspect.w / customAspect.h` when both > 0;
 *                      else undefined.
 */
export function resolveTargetAspect(
  mode: AspectMode,
  ctx: AspectContext,
): number | undefined {
  if (mode === "auto") return undefined;
  if (mode === "artwork_cm") {
    const w = ctx.artworkCm?.w;
    const h = ctx.artworkCm?.h;
    if (
      typeof w === "number" &&
      typeof h === "number" &&
      Number.isFinite(w) &&
      Number.isFinite(h) &&
      w > 0 &&
      h > 0
    ) {
      return w / h;
    }
    return undefined;
  }
  if (mode === "photo_sensor") {
    if (
      typeof ctx.sourceAspect === "number" &&
      Number.isFinite(ctx.sourceAspect) &&
      ctx.sourceAspect > 0
    ) {
      return ctx.sourceAspect;
    }
    return undefined;
  }
  if (mode === "custom") {
    const w = ctx.customAspect?.w;
    const h = ctx.customAspect?.h;
    if (
      typeof w === "number" &&
      typeof h === "number" &&
      Number.isFinite(w) &&
      Number.isFinite(h) &&
      w > 0 &&
      h > 0
    ) {
      return w / h;
    }
    return undefined;
  }
  // Preset tokens.
  return presetToRatio(mode);
}

/**
 * Format a numeric aspect as a short human string:
 *  - Known common ratios within 1 % → `"1:1"`, `"2:3"`, `"16:9"`, …
 *  - Otherwise normalize the smaller side to 1 and round the other
 *    to 2 decimals → `"1 : 1.03"`.
 */
export function formatAspectLabel(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "—";
  const COMMON: Array<{ w: number; h: number }> = [
    { w: 1, h: 1 },
    { w: 2, h: 3 },
    { w: 3, h: 2 },
    { w: 3, h: 4 },
    { w: 4, h: 3 },
    { w: 4, h: 5 },
    { w: 5, h: 4 },
    { w: 16, h: 9 },
    { w: 9, h: 16 },
  ];
  for (const { w, h } of COMMON) {
    const r = w / h;
    if (Math.abs(ratio - r) / r <= 0.01) return `${w}:${h}`;
  }
  // Normalize the smaller side to 1 and round the larger to 2 decimals.
  // `ratio = width / height`. When ratio >= 1 the width is longer, so
  // we render `"<ratio> : 1"`; otherwise the height is longer and we
  // render `"1 : <1/ratio>"`.
  if (ratio >= 1) return `${ratio.toFixed(2)} : 1`;
  return `1 : ${(1 / ratio).toFixed(2)}`;
}
