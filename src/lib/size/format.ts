import type { HosuType } from "./hosu";
import { findHosuSize } from "./hosu";

export type ParsedSize = {
  widthCm: number;
  heightCm: number;
  hosuNumber?: number;
  hosuType?: HosuType;
};

export type SizeUnit = "cm" | "in";

/** Viewer display preference. `"auto"` follows the page locale
 *  (KO → cm, everything else → in). */
export type SizeUnitPref = SizeUnit | "auto";

export function cmToIn(cm: number): number {
  return cm / 2.54;
}

export function inToCm(inVal: number): number {
  return inVal * 2.54;
}

/** Round to the first decimal place and drop a trailing `.0`
 *  ("소수점 첫째자리에서 반올림"). 90.94 → "90.9", 100 → "100". */
function round1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Resolve the unit the viewer should SEE the dimensions in.
 * - explicit preference ("cm" | "in") wins,
 * - otherwise fall back to the page locale (KO → cm, else in).
 */
export function resolveViewUnit(
  pref: SizeUnitPref | null | undefined,
  locale: string
): SizeUnit {
  if (pref === "cm" || pref === "in") return pref;
  return locale.startsWith("ko") ? "cm" : "in";
}

/**
 * Rewrite the trailing unit of a size string so the upload form's
 * "cm / in" toggle is round-trippable with `parseSizeWithUnit`.
 *
 * Conservative & idempotent:
 *   - Hosu strings (e.g. "30F ...") are cm-anchored → left untouched.
 *   - "30 x 40 cm" → toggling to `in` yields "30 × 40 in" (declares
 *     intent; does NOT numerically convert the typed values).
 *   - Unit-less "30 x 40" gets the unit appended.
 *   - Anything that doesn't look like WxH dims is returned as-is so we
 *     never destroy free-form notes.
 */
export function setSizeUnitSuffix(size: string, unit: SizeUnit): string {
  const raw = size.trim();
  if (!raw) return raw;
  // Hosu values are cm-anchored and carry their own canonical format.
  // Anchor on the start and require an uppercase hosu letter so we do
  // not match the "c"/"m" of a trailing "cm".
  if (/^\s*\d+\s*[FPMS]\b/.test(raw)) return raw;
  return raw.replace(
    /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*(?:cm|in(?:ch(?:es)?)?|"))?\s*$/i,
    (_, w, h) => `${w} × ${h} ${unit}`
  );
}

/** Pick the default unit when opening the form on a saved size string.
 *  Prefers an explicit suffix, falls back to locale (KO → cm, else in). */
export function detectSizeUnit(
  size: string | null | undefined,
  locale: string
): SizeUnit {
  if (size) {
    if (/(?:in(?:ch(?:es)?)?|")\s*$/i.test(size)) return "in";
    if (/cm\s*$/i.test(size)) return "cm";
  }
  return locale.startsWith("ko") ? "cm" : "in";
}

export type ParsedSizeWithUnit = { parsed: ParsedSize; unit: SizeUnit | null };

const HOSU_TYPED_RE = /(\d+)\s*([FPMS])\b/;
const INCH_MARKER_RE = /(?:"|\binch(?:es)?\b|\bin\b)/i;
const CM_MARKER_RE = /cm\b/i;
const NUMBER_RE = /\d+(?:\.\d+)?/g;

/**
 * Parse a free-form size string into cm-normalized dimensions plus the
 * unit the numbers were declared in (or `null` when the unit can't be
 * determined). Handles the messy real-world formats in production:
 *   "91*72.2", "42x29.7(cm)", "9\" x 12\"", "53cm x 45.5cm",
 *   "24 x 24 inch", "50 X 50cm", "130 × 324", "30F (90.9 x 72.7 cm)".
 *
 * Unit resolution (in priority order):
 *   1. explicit hosu (F/P/M/S)  → cm (hosu is a cm standard)
 *   2. inch marker (", inch, in) → in  (numbers stored ×2.54 as cm)
 *   3. cm marker                 → cm
 *   4. bare numbers, no marker   → unit: null (unknown; caller decides)
 * Strings with no numeric dimensions ("Variable size", "N/A") → null.
 */
export function parseSizeWithUnit(size: string): ParsedSizeWithUnit | null {
  const raw = size.trim();
  if (!raw) return null;

  // 1) Explicit typed hosu (e.g. "30F", "30F (90.9 x 72.7 cm)").
  const hosuMatch = raw.match(HOSU_TYPED_RE);
  if (hosuMatch) {
    const num = parseInt(hosuMatch[1], 10);
    const type = hosuMatch[2].toUpperCase() as HosuType;
    const hosu = findHosuSize(num, type);
    if (hosu) {
      return {
        parsed: {
          widthCm: hosu.widthCm,
          heightCm: hosu.heightCm,
          hosuNumber: hosu.number,
          hosuType: hosu.type,
        },
        unit: "cm",
      };
    }
  }

  // 2) First two numbers anywhere in the string are the dimensions.
  const nums = raw.match(NUMBER_RE);
  if (!nums || nums.length < 2) return null;
  const a = parseFloat(nums[0]);
  const b = parseFloat(nums[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const hasInch = INCH_MARKER_RE.test(raw);
  const hasCm = CM_MARKER_RE.test(raw);

  if (hasInch && !hasCm) {
    return { parsed: { widthCm: a * 2.54, heightCm: b * 2.54 }, unit: "in" };
  }
  if (hasCm) {
    return { parsed: { widthCm: a, heightCm: b }, unit: "cm" };
  }
  // Bare numbers, no unit marker → unit unknown.
  return { parsed: { widthCm: a, heightCm: b }, unit: null };
}

/**
 * Format a stored size for display.
 * - `storedUnit` (the `size_unit` column) is the source of truth for the
 *   unit the numbers were entered in; when null we fall back to the unit
 *   embedded in the text, then to "unknown".
 * - `viewUnit` is the unit to render in (resolve via `resolveViewUnit`
 *   from the viewer preference + locale). Defaults to the locale rule.
 * - Conversion uses 1 in = 2.54 cm, rounded to one decimal place.
 * - An explicit hosu (only when the artist actually typed one) is kept as
 *   a leading label (e.g. "30F · 92 × 73 cm"). No hosu is ever guessed.
 * - Free-form values ("Variable size") are returned verbatim.
 * - When the true unit is unknown (bare numbers, no `size_unit`), the raw
 *   numbers are returned WITHOUT a unit so callers can gate on it.
 */
export function formatSizeForLocale(
  size: string | null | undefined,
  locale: string,
  storedUnit?: SizeUnit | null,
  prefUnit?: SizeUnitPref | null
): string | null {
  if (!size || !size.trim()) return null;
  const parsed = parseSizeWithUnit(size);
  if (!parsed) return size.trim(); // free-form note

  const { widthCm, heightCm, hosuNumber, hosuType } = parsed.parsed;
  const detected = parsed.unit; // unit inferred from the text (or null)
  const viewUnit = resolveViewUnit(prefUnit, locale);
  const hosuLabel =
    hosuNumber != null && hosuType ? `${hosuNumber}${hosuType}` : null;
  const withHosu = (base: string) => (hosuLabel ? `${hosuLabel} · ${base}` : base);

  // Recover the raw numbers the artist typed (parse pre-normalized inch
  // inputs to cm; undo that so the stored `size_unit` column — which is the
  // real source of truth — can reinterpret bare numbers correctly).
  const rawW = detected === "in" ? widthCm / 2.54 : widthCm;
  const rawH = detected === "in" ? heightCm / 2.54 : heightCm;

  // storedUnit (the size_unit column) wins over any unit embedded in text.
  const trueUnit: SizeUnit | null = storedUnit ?? detected;

  // Unknown unit → keep the raw numbers, no unit suffix, no conversion.
  if (trueUnit == null) {
    return withHosu(`${round1(rawW)} × ${round1(rawH)}`);
  }

  // Normalize to true cm, then render in the requested view unit.
  const trueWcm = trueUnit === "in" ? rawW * 2.54 : rawW;
  const trueHcm = trueUnit === "in" ? rawH * 2.54 : rawH;

  if (viewUnit === "in") {
    return withHosu(`${round1(cmToIn(trueWcm))} × ${round1(cmToIn(trueHcm))} in`);
  }
  return withHosu(`${round1(trueWcm)} × ${round1(trueHcm)} cm`);
}

/** Backwards-compatible dimension parser (cm-normalized). */
export function parseSize(size: string): ParsedSize | null {
  const parsed = parseSizeWithUnit(size);
  return parsed ? parsed.parsed : null;
}
