// 2026-08-06 — Contract test for the HEIC GPS scrubber (ISO-BMFF).
//
// We synthesize a minimal HEIC-like file:
//   - `ftyp` box with major_brand = "heic".
//   - `meta` box containing:
//       * `iinf` with a single infe (version 2) declaring item_ID=1
//         with item_type="Exif".
//       * `iloc` (version 0) mapping item_ID=1 to an offset in the
//         `mdat` box, with a length equal to the payload size.
//   - `mdat` box carrying: 4 zero prelude bytes + TIFF header + IFD0
//     with Orientation (0x0112) and GPSInfo (0x8825).
//
// Assertions:
//   * scrubHeicGps returns scrubbed=true.
//   * The GPS tag id inside the mdat region has been zeroed.
//   * The Orientation tag survives unchanged.
//   * Non-HEIC inputs pass through as `not_heic`.

import assert from "node:assert/strict";

function u8(...b: number[]): Uint8Array {
  return Uint8Array.from(b);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let c = 0;
  for (const p of parts) {
    out.set(p, c);
    c += p.length;
  }
  return out;
}
function u32(v: number): Uint8Array {
  return u8(
    (v >>> 24) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 8) & 0xff,
    v & 0xff,
  );
}
function u16(v: number): Uint8Array {
  return u8((v >> 8) & 0xff, v & 0xff);
}
function ascii(s: string): Uint8Array {
  return Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
}
function box(type: string, body: Uint8Array): Uint8Array {
  const size = 8 + body.length;
  return concat(u32(size), ascii(type), body);
}
function fullBox(type: string, version: number, flags: number, body: Uint8Array): Uint8Array {
  const header = u8(version & 0xff, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff);
  return box(type, concat(header, body));
}

// TIFF little-endian IFD entry.
function ifdEntry(tag: number, type: number, count: number, value: number): Uint8Array {
  return u8(
    tag & 0xff,
    (tag >> 8) & 0xff,
    type & 0xff,
    (type >> 8) & 0xff,
    count & 0xff,
    (count >> 8) & 0xff,
    (count >> 16) & 0xff,
    (count >> 24) & 0xff,
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  );
}

function buildTiffWithGps(): Uint8Array {
  const header = u8(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00);
  const numEntries = u16(2);
  const orientation = ifdEntry(0x0112, 3, 1, 6);
  const gps = ifdEntry(0x8825, 4, 1, 0);
  const nextIfd = u32(0);
  return concat(header, numEntries, orientation, gps, nextIfd);
}

function buildHeicFixture(): { bytes: Uint8Array; tiffOffset: number } {
  // ftyp
  const ftyp = box(
    "ftyp",
    concat(ascii("heic"), u32(0), ascii("mif1"), ascii("heic")),
  );

  // Compose the Exif item payload — 4-byte prelude + TIFF.
  const tiff = buildTiffWithGps();
  const itemPayload = concat(u32(0), tiff);

  // meta = FullBox(v0) then children (hdlr optional, iinf, iloc).
  const iinf = fullBox(
    "iinf",
    0,
    0,
    concat(
      u16(1), // entry_count
      fullBox(
        "infe",
        2,
        0,
        concat(
          u16(1), // item_ID
          u16(0), // item_protection_index
          ascii("\0"), // item_name (empty null-terminated)
          ascii("Exif"),
        ),
      ),
    ),
  );

  // We don't yet know the mdat body offset until we assemble the top-
  // level boxes. Compute it two passes: build meta with a placeholder,
  // measure length, place mdat, then patch iloc.
  const iloc = fullBox(
    "iloc",
    0,
    0,
    concat(
      // packed byte: offset_size(4) << 4 | length_size(4)
      u8((4 << 4) | 4),
      // packed byte: base_offset_size(0) << 4 | reserved
      u8(0),
      u16(1), // item_count
      u16(1), // item_ID
      u16(0), // data_reference_index
      // no base_offset (size 0)
      u16(1), // extent_count
      u32(0x00000000), // extent_offset placeholder — patch below
      u32(itemPayload.length),
    ),
  );
  const meta = fullBox("meta", 0, 0, concat(iinf, iloc));

  // ftyp + meta + mdat
  const prefixLen = ftyp.length + meta.length;
  const mdat = box("mdat", itemPayload);
  const bytes = concat(ftyp, meta, mdat);

  // The mdat body starts at prefixLen + 8 (header).
  const mdatBodyOffset = prefixLen + 8;

  // Patch the iloc extent_offset. The extent_offset u32 lives at:
  //   ftyp.length + [meta header 8] + [meta full-header 4] + iinf.length
  //   + [iloc header 8] + [iloc full-header 4] + [packed 2 bytes]
  //   + [item_count 2] + [item_id 2] + [data_ref 2] + [extent_count 2]
  const metaHeader = 8 + 4;
  const ilocHeader = 8 + 4;
  const ilocOffsetInsideIloc = 2 + 2 + 2 + 2 + 2; // packed + item_count + item_id + data_ref + extent_count
  const patchOffset =
    ftyp.length + metaHeader + iinf.length + ilocHeader + ilocOffsetInsideIloc;

  bytes[patchOffset] = (mdatBodyOffset >>> 24) & 0xff;
  bytes[patchOffset + 1] = (mdatBodyOffset >>> 16) & 0xff;
  bytes[patchOffset + 2] = (mdatBodyOffset >>> 8) & 0xff;
  bytes[patchOffset + 3] = mdatBodyOffset & 0xff;

  const tiffOffset = mdatBodyOffset + 4; // skip the 4-byte prelude
  return { bytes, tiffOffset };
}

(async () => {
  const { scrubHeicGps } = await import("../../heicExifScrub");
  const fixture = buildHeicFixture();
  const file = new File([fixture.bytes as BlobPart], "photo.heic", {
    type: "image/heic",
  });
  const result = await scrubHeicGps(file);
  assert.ok(result.scrubbed, `heic gps scrubbed (reason=${result.skippedReason ?? "-"})`);

  const outBytes = new Uint8Array(await result.file.arrayBuffer());
  const ifd0Base = fixture.tiffOffset + 8;
  const orientationTag =
    outBytes[ifd0Base + 2] | (outBytes[ifd0Base + 2 + 1] << 8);
  assert.equal(orientationTag, 0x0112, "Orientation preserved");
  const gpsTag =
    outBytes[ifd0Base + 2 + 12] | (outBytes[ifd0Base + 2 + 12 + 1] << 8);
  assert.equal(gpsTag, 0x0000, "GPS tag zeroed inside mdat");

  // Non-HEIC input passes through.
  const png = new File(
    [u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) as BlobPart],
    "x.png",
    { type: "image/png" },
  );
  const pngRes = await scrubHeicGps(png);
  assert.equal(pngRes.scrubbed, false);
  assert.equal(pngRes.skippedReason, "not_heic");

  console.log("heic scrubber contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
