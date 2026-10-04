import { ASPECT_PRESETS, type AspectMode } from "./aspectResolve";

export type EnhanceSessionPreset = {
  /**
   * Color-handling mode. 2026-10-02 redesign collapsed the old
   * capture-oriented trio (auto / studio / scanner) into an honest
   * two-way fidelity selector. `parseEnhanceSessionPreset` migrates
   * legacy blobs: `scanner → original` (same faithful color behavior),
   * `auto`/`studio → enhance` (closest to the old corrective look).
   */
  inputType: "original" | "enhance";
  intensity: "light" | "normal" | "strong";
  b: number;
  c: number;
  s: number;
  /**
   * 2026-10-02 — output ratio selector. Carries the user's aspect
   * choice through bulk enhancement so the second/third image in a
   * batch starts with the same preset the first one landed on.
   * Omitted on legacy session blobs — treated as `"auto"` at read
   * time by every caller.
   */
  aspectMode?: AspectMode;
  /** Custom W×H when `aspectMode === "custom"`. */
  customAspect?: { w: number; h: number } | null;
  /**
   * Edge-straightening preference only. Coefficients, corners, and
   * contours stay on the photo that produced them.
   */
  edgeCurvature?: "auto" | "off" | "adjust";
};

const KEY = "theo.enhance.sharedRecipe";

function tone(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1.3, Math.max(0.7, value))
    : 1;
}

function parseAspectMode(value: unknown): AspectMode | undefined {
  if (typeof value !== "string") return undefined;
  return (ASPECT_PRESETS as string[]).includes(value) ||
    value === "artwork_cm" ||
    value === "photo_sensor" ||
    value === "custom"
    ? (value as AspectMode)
    : undefined;
}

function parseCustomAspect(
  value: unknown,
): { w: number; h: number } | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const w = row.w;
  const h = row.h;
  if (
    typeof w === "number" &&
    typeof h === "number" &&
    Number.isFinite(w) &&
    Number.isFinite(h) &&
    w > 0 &&
    h > 0
  ) {
    return { w, h };
  }
  return undefined;
}

/**
 * Normalize a stored `inputType` to the current two-way union, migrating
 * legacy capture-mode values. Returns null for anything unrecognized so
 * the caller can reject the whole blob.
 */
function parseInputType(value: unknown): EnhanceSessionPreset["inputType"] | null {
  if (value === "original" || value === "enhance") return value;
  // Legacy (pre-2026-10-02) capture modes.
  if (value === "scanner") return "original";
  if (value === "auto" || value === "studio") return "enhance";
  return null;
}

export function parseEnhanceSessionPreset(raw: unknown): EnhanceSessionPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const inputType = parseInputType(row.inputType);
  const intensity = row.intensity;
  if (inputType === null) return null;
  if (intensity !== "light" && intensity !== "normal" && intensity !== "strong") return null;
  const aspectMode = parseAspectMode(row.aspectMode);
  const customAspect = parseCustomAspect(row.customAspect);
  const edgeCurvature =
    row.edgeCurvature === "auto" || row.edgeCurvature === "off" || row.edgeCurvature === "adjust"
      ? row.edgeCurvature
      : undefined;
  return {
    inputType,
    intensity,
    b: tone(row.b),
    c: tone(row.c),
    s: tone(row.s),
    ...(aspectMode ? { aspectMode } : {}),
    ...(customAspect !== undefined ? { customAspect } : {}),
    ...(edgeCurvature ? { edgeCurvature } : {}),
  };
}

export function readEnhanceSessionPreset(): EnhanceSessionPreset | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return parseEnhanceSessionPreset(JSON.parse(sessionStorage.getItem(KEY) || "null"));
  } catch {
    return null;
  }
}

export function writeEnhanceSessionPreset(preset: EnhanceSessionPreset): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(preset));
  } catch {
    // Private mode can reject the write. The current image still saves.
  }
}
