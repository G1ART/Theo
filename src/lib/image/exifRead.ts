/**
 * Theo Image Enhance (Beta) — client-side EXIF reader (2026-08-06).
 *
 * Pure-JS TIFF/EXIF walker over JPEG APP1 segments. Returns ONLY the
 * fields the enhance UI needs:
 *   - Orientation
 *   - Make, Model, LensModel
 *   - FocalLength (mm, float)
 *   - ExposureTime (seconds, float — 1/60 = 0.01667)
 *   - ISO
 *   - WhiteBalance (0 = auto, 1 = manual)
 *   - ColorSpace (1 = sRGB, 2 = Adobe RGB, 65535 = uncalibrated)
 *   - DateTimeOriginal (ISO string when parseable, else null)
 *   - Software
 *
 * SECURITY: This module NEVER returns GPS fields. The GPS sub-IFD is
 * explicitly skipped during walk — a caller cannot accidentally
 * retrieve GPS coordinates via this reader. See the `exifRead.test.ts`
 * fixture for the assertion.
 *
 * Non-JPEG (HEIC/PNG/WebP/etc.) inputs return an empty payload with
 * `format: null`; the caller falls back to file.lastModified.
 *
 * Size: ~250 LOC target, no external deps. Handles both endiannesses.
 */

/** GPS sub-IFD pointer tag. We deliberately skip this during walk. */
const TAG_GPS_INFO = 0x8825;

/** IFD0 / SubIFD tags of interest. */
const TAG = {
  ORIENTATION: 0x0112,
  MAKE: 0x010f,
  MODEL: 0x0110,
  SOFTWARE: 0x0131,
  DATETIME: 0x0132,
  EXIF_SUB_IFD: 0x8769,
  EXPOSURE_TIME: 0x829a,
  ISO_SPEED: 0x8827,
  ISO_SPEED_RATINGS: 0x8833,
  DATETIME_ORIGINAL: 0x9003,
  FOCAL_LENGTH: 0x920a,
  WHITE_BALANCE: 0xa403,
  COLOR_SPACE: 0xa001,
  LENS_MODEL: 0xa434,
} as const;

/** IFD entry data types. */
const TYPE = {
  BYTE: 1,
  ASCII: 2,
  SHORT: 3,
  LONG: 4,
  RATIONAL: 5,
  SRATIONAL: 10,
} as const;

const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL (two LONGs)
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

export type ExifReadResult = {
  format: "jpeg" | null;
  orientation: number | null;
  make: string | null;
  model: string | null;
  lensModel: string | null;
  focalLength: number | null;
  exposureTime: number | null;
  iso: number | null;
  whiteBalance: number | null;
  colorSpace: number | null;
  dateTimeOriginal: string | null;
  software: string | null;
};

const EMPTY: ExifReadResult = Object.freeze({
  format: null,
  orientation: null,
  make: null,
  model: null,
  lensModel: null,
  focalLength: null,
  exposureTime: null,
  iso: null,
  whiteBalance: null,
  colorSpace: null,
  dateTimeOriginal: null,
  software: null,
}) as ExifReadResult;

function readU16(b: Uint8Array, off: number, le: boolean): number {
  const a = b[off];
  const c = b[off + 1];
  return le ? (c << 8) | a : (a << 8) | c;
}

function readU32(b: Uint8Array, off: number, le: boolean): number {
  const a = b[off];
  const c = b[off + 1];
  const d = b[off + 2];
  const e = b[off + 3];
  return le
    ? ((e << 24) >>> 0) | ((d << 16) >>> 0) | ((c << 8) >>> 0) | a
    : ((a << 24) >>> 0) | ((c << 16) >>> 0) | ((d << 8) >>> 0) | e;
}

function readAscii(b: Uint8Array, off: number, count: number): string {
  // ASCII strings in TIFF are NUL-terminated; strip trailing zeros.
  let end = off + count;
  while (end > off && b[end - 1] === 0) end -= 1;
  let out = "";
  for (let i = off; i < end; i += 1) {
    const c = b[i];
    // Keep it printable ASCII; skip non-printables so a malformed tag
    // doesn't leak binary noise into a rendered "Made with …" label.
    if (c >= 0x20 && c < 0x7f) out += String.fromCharCode(c);
  }
  return out;
}

function readRational(b: Uint8Array, off: number, le: boolean): number | null {
  const num = readU32(b, off, le);
  const den = readU32(b, off + 4, le);
  if (den === 0) return null;
  return num / den;
}

/**
 * Convert `YYYY:MM:DD HH:MM:SS` into an ISO string. Returns null if
 * the input is malformed.
 */
function parseExifDateTime(v: string): string | null {
  const m = v.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

type WalkContext = {
  bytes: Uint8Array;
  tiffBase: number;
  littleEndian: boolean;
};

function readEntryValue(
  ctx: WalkContext,
  entryOff: number,
  type: number,
  count: number,
): { asciiRaw?: string; short?: number; long?: number; rational?: number | null } {
  const size = (TYPE_SIZE[type] ?? 1) * count;
  const valueOff = size <= 4 ? entryOff + 8 : ctx.tiffBase + readU32(ctx.bytes, entryOff + 8, ctx.littleEndian);
  if (valueOff < 0 || valueOff + size > ctx.bytes.length) {
    return {};
  }
  if (type === TYPE.ASCII) {
    return { asciiRaw: readAscii(ctx.bytes, valueOff, count) };
  }
  if (type === TYPE.SHORT) {
    return { short: readU16(ctx.bytes, valueOff, ctx.littleEndian) };
  }
  if (type === TYPE.LONG) {
    return { long: readU32(ctx.bytes, valueOff, ctx.littleEndian) };
  }
  if (type === TYPE.RATIONAL || type === TYPE.SRATIONAL) {
    return { rational: readRational(ctx.bytes, valueOff, ctx.littleEndian) };
  }
  return {};
}

function walkIfd(
  ctx: WalkContext,
  ifdBase: number,
  out: Record<string, unknown>,
  subIfds: number[],
): void {
  if (ifdBase + 2 > ctx.bytes.length) return;
  const n = readU16(ctx.bytes, ifdBase, ctx.littleEndian);
  // Sanity — a corrupt file can claim thousands of entries.
  if (n > 512) return;
  for (let i = 0; i < n; i += 1) {
    const entryOff = ifdBase + 2 + i * 12;
    if (entryOff + 12 > ctx.bytes.length) return;
    const tag = readU16(ctx.bytes, entryOff, ctx.littleEndian);
    const type = readU16(ctx.bytes, entryOff + 2, ctx.littleEndian);
    const count = readU32(ctx.bytes, entryOff + 4, ctx.littleEndian);

    // SECURITY — never descend into the GPS IFD. See top-of-file note.
    if (tag === TAG_GPS_INFO) continue;

    if (tag === TAG.EXIF_SUB_IFD && type === TYPE.LONG) {
      const off = readU32(ctx.bytes, entryOff + 8, ctx.littleEndian);
      subIfds.push(ctx.tiffBase + off);
      continue;
    }

    const val = readEntryValue(ctx, entryOff, type, count);
    switch (tag) {
      case TAG.ORIENTATION:
        if (val.short != null) out.orientation = val.short;
        break;
      case TAG.MAKE:
        if (val.asciiRaw) out.make = val.asciiRaw.trim() || null;
        break;
      case TAG.MODEL:
        if (val.asciiRaw) out.model = val.asciiRaw.trim() || null;
        break;
      case TAG.SOFTWARE:
        if (val.asciiRaw) out.software = val.asciiRaw.trim() || null;
        break;
      case TAG.DATETIME_ORIGINAL:
        if (val.asciiRaw) out.dateTimeOriginal = parseExifDateTime(val.asciiRaw);
        break;
      case TAG.EXPOSURE_TIME:
        if (val.rational != null) out.exposureTime = val.rational;
        break;
      case TAG.ISO_SPEED_RATINGS:
      case TAG.ISO_SPEED:
        if (val.short != null) out.iso = val.short;
        else if (val.long != null) out.iso = val.long;
        break;
      case TAG.FOCAL_LENGTH:
        if (val.rational != null) out.focalLength = val.rational;
        break;
      case TAG.WHITE_BALANCE:
        if (val.short != null) out.whiteBalance = val.short;
        break;
      case TAG.COLOR_SPACE:
        if (val.short != null) out.colorSpace = val.short;
        break;
      case TAG.LENS_MODEL:
        if (val.asciiRaw) out.lensModel = val.asciiRaw.trim() || null;
        break;
      default:
        break;
    }
  }
}

/**
 * Read the JPEG APP1 EXIF segment and extract the whitelist of fields
 * above. Never returns GPS. Non-JPEG or malformed inputs return a
 * fully-null envelope.
 */
export async function readExif(file: File | Blob): Promise<ExifReadResult> {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return EMPTY;
    }
    // Walk JPEG segments.
    let cursor = 2;
    while (cursor + 4 <= bytes.length) {
      if (bytes[cursor] !== 0xff) break;
      let marker = bytes[cursor + 1];
      while (marker === 0xff && cursor + 2 < bytes.length) {
        cursor += 1;
        marker = bytes[cursor + 1];
      }
      if (marker === 0xda) break; // SOS — image data begins.
      if (marker >= 0xd0 && marker <= 0xd9) {
        cursor += 2;
        continue;
      }
      const segLen = (bytes[cursor + 2] << 8) | bytes[cursor + 3];
      if (segLen < 2 || cursor + 2 + segLen > bytes.length) break;
      if (marker === 0xe1) {
        const isExif =
          bytes[cursor + 4] === 0x45 &&
          bytes[cursor + 5] === 0x78 &&
          bytes[cursor + 6] === 0x69 &&
          bytes[cursor + 7] === 0x66 &&
          bytes[cursor + 8] === 0x00 &&
          bytes[cursor + 9] === 0x00;
        if (isExif) {
          const tiffBase = cursor + 10;
          if (tiffBase + 8 > bytes.length) break;
          const b0 = bytes[tiffBase];
          const b1 = bytes[tiffBase + 1];
          let littleEndian: boolean;
          if (b0 === 0x49 && b1 === 0x49) littleEndian = true;
          else if (b0 === 0x4d && b1 === 0x4d) littleEndian = false;
          else break;
          if (readU16(bytes, tiffBase + 2, littleEndian) !== 0x002a) break;
          const ifd0Off = readU32(bytes, tiffBase + 4, littleEndian);
          const ifd0Base = tiffBase + ifd0Off;
          const ctx: WalkContext = { bytes, tiffBase, littleEndian };
          const collected: Record<string, unknown> = {};
          const subIfds: number[] = [];
          walkIfd(ctx, ifd0Base, collected, subIfds);
          for (const base of subIfds) {
            walkIfd(ctx, base, collected, subIfds);
          }
          return {
            format: "jpeg",
            orientation: (collected.orientation as number | null) ?? null,
            make: (collected.make as string | null) ?? null,
            model: (collected.model as string | null) ?? null,
            lensModel: (collected.lensModel as string | null) ?? null,
            focalLength: (collected.focalLength as number | null) ?? null,
            exposureTime: (collected.exposureTime as number | null) ?? null,
            iso: (collected.iso as number | null) ?? null,
            whiteBalance: (collected.whiteBalance as number | null) ?? null,
            colorSpace: (collected.colorSpace as number | null) ?? null,
            dateTimeOriginal: (collected.dateTimeOriginal as string | null) ?? null,
            software: (collected.software as string | null) ?? null,
          };
        }
      }
      cursor += 2 + segLen;
    }
    return { ...EMPTY, format: "jpeg" };
  } catch {
    return EMPTY;
  }
}

/** Compact `Make Model (Lens)` for provenance display, or null. */
export function formatCaptureDevice(exif: ExifReadResult): string | null {
  const parts: string[] = [];
  if (exif.make) parts.push(exif.make);
  if (exif.model) parts.push(exif.model);
  let head = parts.join(" ").trim();
  if (!head) return null;
  if (exif.lensModel) head += ` (${exif.lensModel})`;
  return head.slice(0, 200);
}

/**
 * Heuristic — is this shot "low-light" per the requirements?
 *   ExposureTime > 1/60s (0.01667) AND ISO > 800.
 * Any missing value is treated as unknown → not-low-light.
 */
export function isLowLightExif(exif: ExifReadResult): boolean {
  if (exif.exposureTime == null || exif.iso == null) return false;
  return exif.exposureTime > 1 / 60 && exif.iso > 800;
}
