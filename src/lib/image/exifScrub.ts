/**
 * 2026-08-06 — Client-side EXIF GPS scrubber for JPEG original backups.
 *
 * Why
 * ---
 * The Theo Image Enhance (Beta) audit surfaced that phone-shot JPEGs
 * with baked-in GPS EXIF were being uploaded verbatim to
 * `{userId}/original/` as the untouched backup copy. The `display`
 * variant is always a canvas re-render (compression + optional enhance)
 * so it naturally sheds all EXIF, but the backup is byte-identical to
 * the source. That means a viewer with access to the raw backup could
 * read the artist's exact shooting location — obviously bad.
 *
 * Contract
 * --------
 * `scrubJpegGps(file)` returns a new `File` with:
 *   - GPS IFD reference zeroed out (all subsequent parsers treat the
 *     GPS sub-IFD as absent — see the tag zeroing note below).
 *   - Orientation, DateTimeOriginal, Make/Model, ColorSpace, ICC, and
 *     every other non-GPS EXIF tag preserved. Keeping orientation is
 *     crucial: downstream viewers otherwise render portrait shots
 *     sideways.
 *   - `.name` / `.type` / `.lastModified` preserved.
 *
 * On any parse ambiguity we return the input `file` unchanged. Never
 * throw — the caller (upload pipeline) treats scrubbing as best-effort.
 *
 * Non-JPEG (HEIC / PNG / WebP) inputs pass through untouched. We only
 * ship the JPEG path today because:
 *   - JPEG is by far the most common phone capture that carries GPS
 *     (99 % of iOS/Android natively).
 *   - HEIC EXIF sits inside an `Exif` box in `meta.iprp.ipco` and needs
 *     a full ISO-BMFF walker (~600 LOC); we defer with a TODO.
 *   - PNG stores GPS in ancillary `eXIf` chunks — trivial to strip if
 *     the artist actually ships PNGs from a phone, but that's rare.
 */

const GPS_INFO_TAG = 0x8825;

function readU16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  return littleEndian ? (b << 8) | a : (a << 8) | b;
}

function writeU16(bytes: Uint8Array, offset: number, value: number, littleEndian: boolean): void {
  const hi = (value >> 8) & 0xff;
  const lo = value & 0xff;
  if (littleEndian) {
    bytes[offset] = lo;
    bytes[offset + 1] = hi;
  } else {
    bytes[offset] = hi;
    bytes[offset + 1] = lo;
  }
}

function writeU32(bytes: Uint8Array, offset: number, value: number, littleEndian: boolean): void {
  const b0 = (value >>> 24) & 0xff;
  const b1 = (value >>> 16) & 0xff;
  const b2 = (value >>> 8) & 0xff;
  const b3 = value & 0xff;
  if (littleEndian) {
    bytes[offset] = b3;
    bytes[offset + 1] = b2;
    bytes[offset + 2] = b1;
    bytes[offset + 3] = b0;
  } else {
    bytes[offset] = b0;
    bytes[offset + 1] = b1;
    bytes[offset + 2] = b2;
    bytes[offset + 3] = b3;
  }
}

export type ScrubResult = {
  file: File;
  /** True when we actually rewrote bytes. Useful for telemetry. */
  scrubbed: boolean;
  /** Fine-grained reason for logging when scrubbed=false. */
  skippedReason?:
    | "not_jpeg"
    | "no_exif"
    | "parse_error"
    | "no_gps_tag"
    | "unsupported_endianness";
};

/**
 * Try to strip the GPS IFD reference from a JPEG's APP1 EXIF segment.
 *
 * Implementation note: to keep this bug-proof we do NOT rewrite offsets
 * or remove tag entries (which would require shifting every subsequent
 * data block). We instead overwrite the GPS tag ID with 0x0000, a
 * reserved / benign identifier. Standard readers (exifr, sharp,
 * ExifTool, Preview.app) all treat 0x0000 as unknown-in-IFD0 and skip
 * it, so the sub-IFD data becomes unreachable via the IFD0 index. This
 * leaves the GPS bytes physically present but semantically detached.
 * A follow-up pass could zero the actual sub-IFD bytes as belt-and-
 * suspenders — see TODO(image-enhance/exif-full-zeroize).
 */
export async function scrubJpegGps(file: File): Promise<ScrubResult> {
  // Fast bail-outs: only touch JPEGs. `.type` from a `<input type=file>`
  // is browser-derived, but a HEIC file sometimes lands with a lying
  // `image/jpeg` mime — we also check the two magic bytes to be safe.
  const looksJpegByMime = file.type === "image/jpeg" || file.type === "image/pjpeg";
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { file, scrubbed: false, skippedReason: "not_jpeg" };
  }
  if (!looksJpegByMime) {
    // Magic says JPEG but mime disagrees — pass through untouched to
    // avoid inadvertently rewriting something we don't understand.
    return { file, scrubbed: false, skippedReason: "not_jpeg" };
  }

  try {
    // Walk JPEG segments looking for APP1 EXIF (0xFFE1 with "Exif\0\0").
    let cursor = 2;
    while (cursor + 4 <= bytes.length) {
      if (bytes[cursor] !== 0xff) {
        // Malformed — bail cleanly.
        return { file, scrubbed: false, skippedReason: "parse_error" };
      }
      // Skip fill bytes (0xff...).
      let marker = bytes[cursor + 1];
      while (marker === 0xff && cursor + 2 < bytes.length) {
        cursor += 1;
        marker = bytes[cursor + 1];
      }
      // SOS = 0xDA marks the start of scan data — everything after is
      // compressed image bytes, no more metadata.
      if (marker === 0xda) {
        return { file, scrubbed: false, skippedReason: "no_exif" };
      }
      // Stand-alone markers (no length): 0xD0-0xD9. None should appear
      // before SOS in a well-formed file, but skip defensively.
      if (marker >= 0xd0 && marker <= 0xd9) {
        cursor += 2;
        continue;
      }
      const segLen = (bytes[cursor + 2] << 8) | bytes[cursor + 3];
      if (segLen < 2 || cursor + 2 + segLen > bytes.length) {
        return { file, scrubbed: false, skippedReason: "parse_error" };
      }

      if (marker === 0xe1) {
        // Candidate APP1. Check for "Exif\0\0" header (6 bytes at
        // offset cursor+4).
        const isExif =
          bytes[cursor + 4] === 0x45 &&
          bytes[cursor + 5] === 0x78 &&
          bytes[cursor + 6] === 0x69 &&
          bytes[cursor + 7] === 0x66 &&
          bytes[cursor + 8] === 0x00 &&
          bytes[cursor + 9] === 0x00;
        if (!isExif) {
          cursor += 2 + segLen;
          continue;
        }
        // Base of TIFF header inside the APP1 payload.
        const tiffBase = cursor + 10;
        if (tiffBase + 8 > bytes.length) {
          return { file, scrubbed: false, skippedReason: "parse_error" };
        }
        // Endianness: "II" = little-endian, "MM" = big-endian.
        const b0 = bytes[tiffBase];
        const b1 = bytes[tiffBase + 1];
        let littleEndian: boolean;
        if (b0 === 0x49 && b1 === 0x49) {
          littleEndian = true;
        } else if (b0 === 0x4d && b1 === 0x4d) {
          littleEndian = false;
        } else {
          return { file, scrubbed: false, skippedReason: "unsupported_endianness" };
        }
        // TIFF magic number 42.
        if (readU16(bytes, tiffBase + 2, littleEndian) !== 0x002a) {
          return { file, scrubbed: false, skippedReason: "parse_error" };
        }
        const readU32 = (o: number): number => {
          const a = bytes[o];
          const c = bytes[o + 1];
          const d = bytes[o + 2];
          const e = bytes[o + 3];
          return littleEndian
            ? ((e << 24) >>> 0) | (d << 16) | (c << 8) | a
            : ((a << 24) >>> 0) | (c << 16) | (d << 8) | e;
        };
        const ifd0Offset = readU32(tiffBase + 4);
        const ifd0Base = tiffBase + ifd0Offset;
        if (ifd0Base + 2 > bytes.length) {
          return { file, scrubbed: false, skippedReason: "parse_error" };
        }
        const numEntries = readU16(bytes, ifd0Base, littleEndian);
        // 12 bytes per entry; entries live at ifd0Base + 2 .. + 2 + 12*n.
        let gpsRewrote = false;
        for (let i = 0; i < numEntries; i += 1) {
          const entryBase = ifd0Base + 2 + i * 12;
          if (entryBase + 4 > bytes.length) break;
          const tagId = readU16(bytes, entryBase, littleEndian);
          if (tagId === GPS_INFO_TAG) {
            // Neutralize: zero the tag id AND the referenced offset so
            // no compliant reader can chase the GPS sub-IFD. This
            // preserves byte alignment for every other tag.
            writeU16(bytes, entryBase, 0x0000, littleEndian);
            // Type at entryBase+2 (2 bytes), count at entryBase+4 (4
            // bytes), value/offset at entryBase+8 (4 bytes). Zero
            // count and offset so a lenient parser that ignores tag
            // id also finds no data.
            writeU32(bytes, entryBase + 4, 0, littleEndian);
            writeU32(bytes, entryBase + 8, 0, littleEndian);
            gpsRewrote = true;
            break;
          }
        }
        if (!gpsRewrote) {
          return { file, scrubbed: false, skippedReason: "no_gps_tag" };
        }
        // Success — reassemble into a new File preserving name/mime.
        // Cast to BlobPart — TS 5's lib.dom.d.ts refuses to widen
        // `Uint8Array<ArrayBufferLike>` (which can back a
        // SharedArrayBuffer) to the strict `Uint8Array<ArrayBuffer>`
        // it wants for BlobPart. Runtime accepts either.
        const scrubbedFile = new File([bytes as BlobPart], file.name, {
          type: file.type,
          lastModified: file.lastModified,
        });
        return { file: scrubbedFile, scrubbed: true };
      }

      cursor += 2 + segLen;
    }
    return { file, scrubbed: false, skippedReason: "no_exif" };
  } catch {
    return { file, scrubbed: false, skippedReason: "parse_error" };
  }
}
