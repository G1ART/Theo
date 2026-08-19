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
 * Numerically convert a size string to `toUnit` via a cm pivot.
 * Hosu strings stay cm-anchored (unchanged). Free-form notes are
 * returned as-is. Used by upload / edit unit toggles.
 */
export function convertSizeString(size: string, toUnit: SizeUnit): string {
  const raw = size.trim();
  if (!raw) return raw;
  if (/^\s*\d+\s*[FPMS]\b/.test(raw)) return raw;
  const parsed = parseSizeWithUnit(raw);
  if (!parsed) return raw;
  const { widthCm, heightCm } = parsed.parsed;
  let wCm = widthCm;
  let hCm = heightCm;
  // Unitless numbers are treated as the unit we are leaving (the opposite
  // of `toUnit`) so EN "30 × 40" + toggle-to-cm becomes 76.2 × 101.6 cm.
  if (parsed.unit == null && toUnit === "cm") {
    wCm = inToCm(widthCm);
    hCm = inToCm(heightCm);
  }
  if (toUnit === "in") {
    return `${round1(cmToIn(wCm))} × ${round1(cmToIn(hCm))} in`;
  }
  return `${round1(wCm)} × ${round1(hCm)} cm`;
}

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

// ─────────────────────────────────────────────────────────────────────
// 2026-08-19 (P1) — Structured-dimension helper for the simulation
// backfill and client fallback.
//
// The simulator (Chunk C) reads `artworks.width_cm/height_cm/depth_cm`
// directly. Legacy rows have only the free-form `size` column filled —
// 348 public artworks with `width_cm IS NULL` at the time of writing.
// Rather than a fresh parser we lean on `parseSizeWithUnit` above, which
// already covers hosu (F/P/M/S), inch/cm markers, `x/×/*` separators,
// and bare numbers. This wrapper collapses the parser output into just
// the three canonical cm dimensions the DB and the SpaceEditor speak.
//
// Rules:
//   • storedUnit (from `size_unit` column) wins over any marker in text.
//   • When neither storedUnit nor text unit is available we return null:
//     saving bare "91×72.2" as cm-guess would sometimes be wrong, and
//     the wrong number in a to-scale renderer is worse than a fallback.
//   • Hosu-typed strings ("30F …") stay cm; depth is not extracted for
//     hosu because the third number (if any) is dimensions from parens.
//   • Depth is only pulled from a WxHxD pattern in the raw string when
//     no hosu was matched.
//   • Smart quotes (") are normalized to straight (") so patterns like
//     "36" x 36"" resolve to inches instead of degrading to bare.
// ─────────────────────────────────────────────────────────────────────

const DEPTH_RE =
  /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i;

/** Normalize typography that our existing regexes miss so the shared
 *  `parseSizeWithUnit` can still classify. Idempotent. */
function normalizeSizeText(raw: string): string {
  return raw.replace(/[\u201C\u201D]/g, '"');
}

export type ArtworkDimensionsCm = {
  widthCm: number;
  heightCm: number;
  depthCm?: number;
};

/**
 * Extract structured `width/height/depth_cm` from a free-form size
 * string. Returns `null` when the numbers are present but the unit is
 * ambiguous (bare numbers + no `size_unit`), or when no numeric
 * dimensions can be recovered (e.g. "Variable size", "30호" without F).
 *
 * @param size       Free-form user string (the `size` column).
 * @param storedUnit `size_unit` column value ("cm" | "in" | null).
 */
export function parseSizeToDimensionsCm(
  size: string | null | undefined,
  storedUnit?: SizeUnit | null
): ArtworkDimensionsCm | null {
  if (!size) return null;
  const raw = normalizeSizeText(size.trim());
  if (!raw) return null;

  const parsed = parseSizeWithUnit(raw);
  if (!parsed) return null;

  const { widthCm: pw, heightCm: ph, hosuNumber } = parsed.parsed;
  const detectedUnit = parsed.unit;
  const effectiveUnit: SizeUnit | null = storedUnit ?? detectedUnit;

  // Hosu-typed strings are cm-anchored regardless of storedUnit — the
  // hosu table itself is a cm standard. Skip depth: the third number
  // inside "30F (92 x 73 cm)" is width/height, not depth.
  if (hosuNumber != null) {
    return { widthCm: pw, heightCm: ph };
  }

  // Bare numbers + no storedUnit → ambiguous; do not guess. The
  // to-scale renderer's confidence is worth more than the row count.
  if (effectiveUnit == null) return null;

  // If the parser already inch-normalized the numbers (text had ", inch,
  // etc.) they are already cm. Otherwise apply the effective unit.
  let widthCm: number;
  let heightCm: number;
  if (detectedUnit === "in") {
    widthCm = pw;
    heightCm = ph;
  } else if (detectedUnit === "cm") {
    widthCm = pw;
    heightCm = ph;
  } else {
    // detectedUnit == null → pw/ph are raw numbers.
    widthCm = effectiveUnit === "in" ? pw * 2.54 : pw;
    heightCm = effectiveUnit === "in" ? ph * 2.54 : ph;
  }

  if (!Number.isFinite(widthCm) || !Number.isFinite(heightCm)) return null;
  if (widthCm <= 0 || heightCm <= 0) return null;

  // Depth is a bonus for the (rare) WxHxD strings — e.g. "10 x 3 x 2.5"
  // (inches, from the DB audit). Skipped for hosu (handled above).
  const depthMatch = raw.match(DEPTH_RE);
  let depthCm: number | undefined;
  if (depthMatch) {
    const d = parseFloat(depthMatch[3]);
    if (Number.isFinite(d) && d > 0) {
      depthCm = effectiveUnit === "in" ? d * 2.54 : d;
    }
  }

  return depthCm != null
    ? { widthCm, heightCm, depthCm }
    : { widthCm, heightCm };
}
