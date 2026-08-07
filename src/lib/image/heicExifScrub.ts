/**
 * Theo Image Enhance (Beta) — HEIC / HEIF GPS scrubber (2026-08-06).
 *
 * HEIC files wrap image data in the ISO-BMFF container. EXIF metadata,
 * when present, lives inside an `Exif` item under `meta > iinf > infe`,
 * with the actual payload referenced by `iloc` (item location). Unlike
 * JPEG's linear APP1 segment we have to walk boxes to find the payload,
 * but once found the payload is a plain TIFF header + IFD — identical
 * shape to a JPEG's EXIF, so we reuse the JPEG scrubber's neutralize
 * strategy (zero the tag id + offset in-place) once we locate it.
 *
 * Contract:
 *   - `scrubHeicGps(file)` returns a new `File` with the GPS IFD entry
 *     zeroed inside the embedded EXIF payload.
 *   - Non-HEIC/HEIF inputs pass through unchanged with `skippedReason`.
 *   - Preserves all other EXIF (orientation, DateTimeOriginal, etc.).
 *   - Never throws — parse failures return the input `file` unchanged.
 *
 * Detection is dual: MIME `image/heic` / `image/heif`, OR the `ftyp`
 * box's major brand being one of `heic`, `heix`, `mif1`, `msf1`,
 * `heim`, `heis`, `hevc`, `hevx`.
 *
 * Size: kept under 400 LOC per the audit requirement. Pure JS.
 */

const HEIC_BRANDS = new Set(["heic", "heix", "mif1", "msf1", "heim", "heis", "hevc", "hevx", "avif"]);
const GPS_INFO_TAG = 0x8825;

export type HeicScrubResult = {
  file: File;
  scrubbed: boolean;
  skippedReason?:
    | "not_heic"
    | "no_ftyp"
    | "no_meta"
    | "no_exif_item"
    | "no_gps_tag"
    | "parse_error";
};

function readU32(b: Uint8Array, o: number): number {
  return (
    ((b[o] << 24) >>> 0) |
    ((b[o + 1] << 16) >>> 0) |
    ((b[o + 2] << 8) >>> 0) |
    b[o + 3]
  );
}

function readU16(b: Uint8Array, o: number): number {
  return ((b[o] << 8) >>> 0) | b[o + 1];
}

function readU64(b: Uint8Array, o: number): number {
  // We only ever compare / index with these — clamp to safe integer.
  const hi = readU32(b, o);
  const lo = readU32(b, o + 4);
  return hi * 0x1_0000_0000 + lo;
}

function readAscii4(b: Uint8Array, o: number): string {
  return (
    String.fromCharCode(b[o]) +
    String.fromCharCode(b[o + 1]) +
    String.fromCharCode(b[o + 2]) +
    String.fromCharCode(b[o + 3])
  );
}

type Box = {
  start: number;
  size: number;
  bodyStart: number;
  bodyEnd: number;
  type: string;
};

function readBox(b: Uint8Array, offset: number): Box | null {
  if (offset + 8 > b.length) return null;
  let size = readU32(b, offset);
  const type = readAscii4(b, offset + 4);
  let bodyStart = offset + 8;
  if (size === 1) {
    if (offset + 16 > b.length) return null;
    size = readU64(b, offset + 8);
    bodyStart = offset + 16;
  } else if (size === 0) {
    size = b.length - offset;
  }
  const end = offset + size;
  if (end > b.length || size < 8) return null;
  return { start: offset, size, bodyStart, bodyEnd: end, type };
}

function walkChildren(b: Uint8Array, start: number, end: number, out: Box[]): void {
  let cursor = start;
  while (cursor + 8 <= end) {
    const box = readBox(b, cursor);
    if (!box || box.bodyEnd > end) return;
    out.push(box);
    cursor = box.bodyEnd;
  }
}

function isHeicByBrand(b: Uint8Array): boolean {
  // First box must be ftyp. Read major brand (4 bytes at offset 8).
  const first = readBox(b, 0);
  if (!first || first.type !== "ftyp") return false;
  const bodyEnd = first.bodyEnd;
  if (first.bodyStart + 4 > bodyEnd) return false;
  const major = readAscii4(b, first.bodyStart);
  if (HEIC_BRANDS.has(major)) return true;
  // Compatible brands follow (starting at bodyStart + 8, 4 bytes each).
  let o = first.bodyStart + 8;
  while (o + 4 <= bodyEnd) {
    if (HEIC_BRANDS.has(readAscii4(b, o))) return true;
    o += 4;
  }
  return false;
}

/**
 * Locate the "Exif" item inside `meta > iinf > infe*`. Returns the
 * `item_ID` when found. HEIC packs multiple items (color profile,
 * thumbnails, tiles) under iinf; only the one whose `item_type`
 * (Exif ASCII) matches ours is interesting.
 */
function findExifItemId(meta: Box, bytes: Uint8Array): number | null {
  const children: Box[] = [];
  walkChildren(bytes, meta.bodyStart + 4, meta.bodyEnd, children); // +4 skips FullBox version/flags
  const iinf = children.find((b) => b.type === "iinf");
  if (!iinf) return null;
  // iinf: FullBox (4) + count (u16 if version 0, else u32) + infe boxes.
  const version = bytes[iinf.bodyStart];
  const countOff = iinf.bodyStart + 4;
  let cursor = countOff;
  if (version === 0) cursor += 2;
  else cursor += 4;
  // Walk infe children.
  while (cursor + 8 <= iinf.bodyEnd) {
    const box = readBox(bytes, cursor);
    if (!box || box.bodyEnd > iinf.bodyEnd) return null;
    if (box.type === "infe") {
      // infe: FullBox (4) + item_ID (u16 v0-v1 / u32 v2+) + item_protection_index (u16) + item_name(NUL)...
      const infeVersion = bytes[box.bodyStart];
      let o = box.bodyStart + 4;
      let itemId = 0;
      // Per ISO/IEC 14496-12: infe v0-v2 use u16 item_ID, v3+ use u32.
      // v2 introduced item_type but kept the u16 item_ID width.
      if (infeVersion < 3) {
        itemId = readU16(bytes, o);
        o += 2;
      } else {
        itemId = readU32(bytes, o);
        o += 4;
      }
      o += 2; // item_protection_index
      // item_name is a null-terminated string; skip.
      while (o < box.bodyEnd && bytes[o] !== 0) o += 1;
      o += 1; // NUL
      // item_type (4 chars) — infe version >= 2 only.
      if (infeVersion >= 2 && o + 4 <= box.bodyEnd) {
        const itemType = readAscii4(bytes, o);
        if (itemType === "Exif") return itemId;
      }
    }
    cursor = box.bodyEnd;
  }
  return null;
}

type ItemLocation = { offset: number; length: number };

/**
 * Parse `iloc` to find where the Exif item's payload lives inside the
 * top-level file. Handles version 0/1/2 with variable offset/length
 * sizes (per ISO/IEC 14496-12).
 */
function findItemLocation(
  meta: Box,
  bytes: Uint8Array,
  targetItemId: number,
): ItemLocation | null {
  const children: Box[] = [];
  walkChildren(bytes, meta.bodyStart + 4, meta.bodyEnd, children);
  const iloc = children.find((b) => b.type === "iloc");
  if (!iloc) return null;
  const version = bytes[iloc.bodyStart];
  // Skip FullBox (4 bytes: 1 version + 3 flags).
  let o = iloc.bodyStart + 4;
  const packed = bytes[o];
  const offsetSize = (packed >> 4) & 0x0f;
  const lengthSize = packed & 0x0f;
  const packed2 = bytes[o + 1];
  const baseOffsetSize = (packed2 >> 4) & 0x0f;
  const indexSize = version >= 1 ? packed2 & 0x0f : 0;
  o += 2;

  const readVar = (size: number): number => {
    if (size === 4) {
      const v = readU32(bytes, o);
      o += 4;
      return v;
    }
    if (size === 8) {
      const v = readU64(bytes, o);
      o += 8;
      return v;
    }
    if (size === 2) {
      const v = readU16(bytes, o);
      o += 2;
      return v;
    }
    return 0;
  };

  // item_count
  let itemCount: number;
  if (version < 2) {
    itemCount = readU16(bytes, o);
    o += 2;
  } else {
    itemCount = readU32(bytes, o);
    o += 4;
  }

  for (let i = 0; i < itemCount; i += 1) {
    let itemId: number;
    if (version < 2) {
      itemId = readU16(bytes, o);
      o += 2;
    } else {
      itemId = readU32(bytes, o);
      o += 4;
    }
    if (version === 1 || version === 2) {
      o += 2; // construction_method + reserved
    }
    o += 2; // data_reference_index
    const baseOffset = baseOffsetSize > 0 ? readVar(baseOffsetSize) : 0;
    const extentCount = readU16(bytes, o);
    o += 2;
    let firstExtent: { offset: number; length: number } | null = null;
    for (let j = 0; j < extentCount; j += 1) {
      if (indexSize > 0) o += indexSize;
      const extentOffset = offsetSize > 0 ? readVar(offsetSize) : 0;
      const extentLength = lengthSize > 0 ? readVar(lengthSize) : 0;
      if (j === 0) firstExtent = { offset: extentOffset, length: extentLength };
    }
    if (itemId === targetItemId && firstExtent) {
      return {
        offset: baseOffset + firstExtent.offset,
        length: firstExtent.length,
      };
    }
  }
  return null;
}

/**
 * Zero the GPS tag inside a raw TIFF payload (as embedded in a HEIC
 * Exif item). Same strategy as `scrubJpegGps` — flip the tag id + count
 * + offset to zero so no compliant reader can chase the sub-IFD.
 * Returns true when a GPS entry was found and neutralized.
 *
 * The HEIC Exif item body starts with a 4-byte offset-to-TIFF field
 * (usually zero) followed by the TIFF header ("II"/"MM"/magic 42/IFD0
 * offset). See ISO/IEC 23008-12 § A.2.
 */
function scrubTiffGpsInPlace(
  bytes: Uint8Array,
  tiffBase: number,
  tiffEnd: number,
): boolean {
  if (tiffBase + 8 > tiffEnd) return false;
  const b0 = bytes[tiffBase];
  const b1 = bytes[tiffBase + 1];
  let littleEndian: boolean;
  if (b0 === 0x49 && b1 === 0x49) littleEndian = true;
  else if (b0 === 0x4d && b1 === 0x4d) littleEndian = false;
  else return false;
  const readU16LE = (o: number): number =>
    littleEndian ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1];
  const readU32LE = (o: number): number => {
    const a = bytes[o];
    const b = bytes[o + 1];
    const c = bytes[o + 2];
    const d = bytes[o + 3];
    return littleEndian
      ? ((d << 24) >>> 0) | (c << 16) | (b << 8) | a
      : ((a << 24) >>> 0) | (b << 16) | (c << 8) | d;
  };
  const writeU16 = (o: number, v: number) => {
    if (littleEndian) {
      bytes[o] = v & 0xff;
      bytes[o + 1] = (v >> 8) & 0xff;
    } else {
      bytes[o] = (v >> 8) & 0xff;
      bytes[o + 1] = v & 0xff;
    }
  };
  const writeU32 = (o: number, v: number) => {
    if (littleEndian) {
      bytes[o] = v & 0xff;
      bytes[o + 1] = (v >> 8) & 0xff;
      bytes[o + 2] = (v >> 16) & 0xff;
      bytes[o + 3] = (v >> 24) & 0xff;
    } else {
      bytes[o] = (v >> 24) & 0xff;
      bytes[o + 1] = (v >> 16) & 0xff;
      bytes[o + 2] = (v >> 8) & 0xff;
      bytes[o + 3] = v & 0xff;
    }
  };

  if (readU16LE(tiffBase + 2) !== 0x002a) return false;
  const ifd0Off = readU32LE(tiffBase + 4);
  const ifd0Base = tiffBase + ifd0Off;
  if (ifd0Base + 2 > tiffEnd) return false;
  const n = readU16LE(ifd0Base);
  if (n > 512) return false;
  for (let i = 0; i < n; i += 1) {
    const entry = ifd0Base + 2 + i * 12;
    if (entry + 12 > tiffEnd) return false;
    const tag = readU16LE(entry);
    if (tag === GPS_INFO_TAG) {
      writeU16(entry, 0x0000);
      writeU32(entry + 4, 0);
      writeU32(entry + 8, 0);
      return true;
    }
  }
  return false;
}

function looksHeicByMime(file: File | Blob): boolean {
  const t = (file as File).type?.toLowerCase() ?? "";
  return t === "image/heic" || t === "image/heif";
}

export async function scrubHeicGps(file: File): Promise<HeicScrubResult> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const byMime = looksHeicByMime(file);
  if (bytes.length < 12) {
    return { file, scrubbed: false, skippedReason: "not_heic" };
  }
  const isHeic = byMime || isHeicByBrand(bytes);
  if (!isHeic) {
    return { file, scrubbed: false, skippedReason: "not_heic" };
  }
  try {
    // Walk top-level boxes to find `meta`.
    const top: Box[] = [];
    walkChildren(bytes, 0, bytes.length, top);
    if (top.length === 0 || top[0].type !== "ftyp") {
      return { file, scrubbed: false, skippedReason: "no_ftyp" };
    }
    const meta = top.find((b) => b.type === "meta");
    if (!meta) {
      return { file, scrubbed: false, skippedReason: "no_meta" };
    }
    const exifItemId = findExifItemId(meta, bytes);
    if (exifItemId == null) {
      return { file, scrubbed: false, skippedReason: "no_exif_item" };
    }
    const loc = findItemLocation(meta, bytes, exifItemId);
    if (!loc) {
      return { file, scrubbed: false, skippedReason: "no_exif_item" };
    }
    // Exif item body starts with a 4-byte "offset to TIFF" then TIFF.
    if (loc.offset + 4 >= bytes.length) {
      return { file, scrubbed: false, skippedReason: "parse_error" };
    }
    const preludeLen = readU32(bytes, loc.offset);
    const tiffBase = loc.offset + 4 + preludeLen;
    const tiffEnd = Math.min(bytes.length, loc.offset + loc.length);
    if (tiffBase + 8 > tiffEnd) {
      return { file, scrubbed: false, skippedReason: "parse_error" };
    }
    const scrubbed = scrubTiffGpsInPlace(bytes, tiffBase, tiffEnd);
    if (!scrubbed) {
      return { file, scrubbed: false, skippedReason: "no_gps_tag" };
    }
    const outFile = new File([bytes as BlobPart], file.name, {
      type: file.type || "image/heic",
      lastModified: file.lastModified,
    });
    return { file: outFile, scrubbed: true };
  } catch {
    return { file, scrubbed: false, skippedReason: "parse_error" };
  }
}
