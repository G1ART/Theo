/**
 * Non-destructive per-image display adjustments (feed image standardization,
 * 2026-07-20).
 *
 * Applied on grid/feed surfaces ONLY. Detail / lightbox render the original
 * pixels unchanged — see `ArtworkImageStage`.
 *
 * The values live on `artwork_images.display_adjust` as JSON. Original
 * storage files are never modified.
 */

/** Serialized shape saved to `artwork_images.display_adjust`. */
export type DisplayAdjust = {
  /** Schema version. Currently always 1. Missing = 1. */
  v?: number;
  /** Brightness multiplier for CSS filter brightness(). 1 = neutral. */
  b?: number;
  /** Contrast multiplier for CSS filter contrast(). 1 = neutral. */
  c?: number;
  /** Saturation multiplier for CSS filter saturate(). 1 = neutral. */
  s?: number;
  /** Optional crop rectangle in normalized [0,1] coords on the ORIGINAL image. */
  crop?: DisplayCrop;
};

export type DisplayCrop = {
  /** Top-left X in [0,1]. */
  x: number;
  /** Top-left Y in [0,1]. */
  y: number;
  /** Width in [0,1]. */
  w: number;
  /** Height in [0,1]. */
  h: number;
};

/**
 * Gentle clamp so a bad write (client bug, corrupted preset) can never
 * produce an unreadable thumbnail. Aligned with the auto-analyzer's
 * caps in `analyze.ts` (±15%) plus a small manual slider headroom.
 */
export const TONE_MIN = 0.7;
export const TONE_MAX = 1.3;
export const NEUTRAL: Required<Pick<DisplayAdjust, "b" | "c" | "s">> = {
  b: 1.0,
  c: 1.0,
  s: 1.0,
};

/** Round to 3 decimals — DB payload stays compact and drift-free. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function clampTone(n: number | undefined): number {
  if (n == null || !Number.isFinite(n)) return 1;
  return Math.min(TONE_MAX, Math.max(TONE_MIN, n));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** True when the adjustment is at (or effectively at) neutral values. */
export function isNeutral(adj: DisplayAdjust | null | undefined): boolean {
  if (!adj) return true;
  const b = adj.b ?? 1;
  const c = adj.c ?? 1;
  const s = adj.s ?? 1;
  const toneNeutral =
    Math.abs(b - 1) < 0.005 &&
    Math.abs(c - 1) < 0.005 &&
    Math.abs(s - 1) < 0.005;
  const crop = adj.crop;
  const cropNeutral =
    !crop ||
    (Math.abs(crop.x) < 0.005 &&
      Math.abs(crop.y) < 0.005 &&
      Math.abs(crop.w - 1) < 0.005 &&
      Math.abs(crop.h - 1) < 0.005);
  return toneNeutral && cropNeutral;
}

/**
 * CSS `filter` string. Returns empty string when neutral so we don't
 * force compositing on every thumbnail.
 */
export function toFilterCss(adj: DisplayAdjust | null | undefined): string {
  if (!adj) return "";
  const b = clampTone(adj.b);
  const c = clampTone(adj.c);
  const s = clampTone(adj.s);
  const parts: string[] = [];
  if (Math.abs(b - 1) >= 0.005) parts.push(`brightness(${round3(b)})`);
  if (Math.abs(c - 1) >= 0.005) parts.push(`contrast(${round3(c)})`);
  if (Math.abs(s - 1) >= 0.005) parts.push(`saturate(${round3(s)})`);
  return parts.join(" ");
}

/**
 * Return inline style props to render only the crop rectangle of the
 * original image inside a positioned wrapper. The wrapper MUST be
 * `overflow-hidden position:relative` and the `<img>`/next/image must
 * be absolutely positioned (via next/image `fill`).
 *
 * Implementation: the image is scaled up by 1/w × 1/h and translated
 * so that (crop.x, crop.y) lands at the wrapper origin. When there is
 * no crop we return an empty object.
 */
export function toCropStyle(
  adj: DisplayAdjust | null | undefined
): React.CSSProperties {
  const crop = adj?.crop;
  if (!crop) return {};
  const x = clamp01(crop.x);
  const y = clamp01(crop.y);
  const w = clamp01(crop.w);
  const h = clamp01(crop.h);
  if (w <= 0 || h <= 0) return {};
  if (
    Math.abs(x) < 0.005 &&
    Math.abs(y) < 0.005 &&
    Math.abs(w - 1) < 0.005 &&
    Math.abs(h - 1) < 0.005
  ) {
    return {};
  }
  const scaleX = 1 / w;
  const scaleY = 1 / h;
  // Percent translations are relative to the element itself, so a scaled
  // element still uses its own dimensions as the reference — meaning a
  // 100% translate moves the image by one full unscaled image width.
  const translateX = -x * scaleX * 100;
  const translateY = -y * scaleY * 100;
  return {
    // Anchoring at top-left keeps the maths simple.
    transformOrigin: "0 0",
    transform: `translate(${round3(translateX)}%, ${round3(translateY)}%) scale(${round3(scaleX)}, ${round3(scaleY)})`,
    // Preserve smooth thumbnails after upscaling by the crop factor.
    willChange: "transform",
  };
}

/**
 * Normalize a caller-provided payload into the canonical shape written
 * to the DB. Values are clamped, missing keys default to neutral, and
 * a neutral result returns `null` so we don't store no-op JSON.
 */
export function normalizeDisplayAdjust(
  input: DisplayAdjust | null | undefined
): DisplayAdjust | null {
  if (!input) return null;
  const b = round3(clampTone(input.b));
  const c = round3(clampTone(input.c));
  const s = round3(clampTone(input.s));
  const cropIn = input.crop;
  let crop: DisplayCrop | undefined;
  if (cropIn) {
    const x = clamp01(cropIn.x);
    const y = clamp01(cropIn.y);
    const w = clamp01(cropIn.w);
    const h = clamp01(cropIn.h);
    // Snap tiny crops to full frame so we never render a magnified
    // sliver by accident.
    const looksFull =
      Math.abs(x) < 0.005 &&
      Math.abs(y) < 0.005 &&
      Math.abs(w - 1) < 0.005 &&
      Math.abs(h - 1) < 0.005;
    if (!looksFull && w > 0.05 && h > 0.05 && x + w <= 1.001 && y + h <= 1.001) {
      crop = { x: round3(x), y: round3(y), w: round3(w), h: round3(h) };
    }
  }
  const out: DisplayAdjust = { v: 1, b, c, s };
  if (crop) out.crop = crop;
  return isNeutral(out) ? null : out;
}

/**
 * Safe reader: DB values arrive as `unknown` (jsonb). This filters out
 * malformed rows and returns a well-typed `DisplayAdjust` or `null`.
 */
export function readDisplayAdjust(
  raw: unknown
): DisplayAdjust | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const num = (k: string): number | undefined => {
    const v = o[k];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const b = num("b");
  const c = num("c");
  const s = num("s");
  const cropRaw = o.crop;
  let crop: DisplayCrop | undefined;
  if (cropRaw && typeof cropRaw === "object") {
    const cr = cropRaw as Record<string, unknown>;
    const cx = typeof cr.x === "number" ? cr.x : NaN;
    const cy = typeof cr.y === "number" ? cr.y : NaN;
    const cw = typeof cr.w === "number" ? cr.w : NaN;
    const ch = typeof cr.h === "number" ? cr.h : NaN;
    if (
      Number.isFinite(cx) &&
      Number.isFinite(cy) &&
      Number.isFinite(cw) &&
      Number.isFinite(ch) &&
      cw > 0 &&
      ch > 0
    ) {
      crop = { x: cx, y: cy, w: cw, h: ch };
    }
  }
  const out: DisplayAdjust = { v: 1 };
  if (b !== undefined) out.b = b;
  if (c !== undefined) out.c = c;
  if (s !== undefined) out.s = s;
  if (crop) out.crop = crop;
  return isNeutral(out) ? null : out;
}
