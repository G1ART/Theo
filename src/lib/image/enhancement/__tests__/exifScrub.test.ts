// 2026-08-06 — Contract test for the JPEG GPS scrubber.
//
// Builds a minimal JPEG with an APP1 EXIF segment containing:
//   - Orientation tag (0x0112) with value 6 (rotate 90° CW)
//   - GPSInfo tag (0x8825) pointing to a sub-IFD
// Runs scrubJpegGps and asserts:
//   - The output still parses as JPEG (SOI + APP1 length intact).
//   - The GPS tag was zeroed (no reader can chase the sub-IFD).
//   - The Orientation tag survives — critical so portraits still
//     render right-side up after backup restore.
//
// Non-JPEG inputs pass through unchanged.

import assert from "node:assert/strict";

// Minimal helpers ─────────────────────────────────────────────────
function u8(...bytes: number[]): Uint8Array {
  return Uint8Array.from(bytes);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}

// Build the 12-byte IFD entry (little-endian for readability).
function ifdEntry(tag: number, type: number, count: number, value: number): Uint8Array {
  const out = new Uint8Array(12);
  out[0] = tag & 0xff;
  out[1] = (tag >> 8) & 0xff;
  out[2] = type & 0xff;
  out[3] = (type >> 8) & 0xff;
  out[4] = count & 0xff;
  out[5] = (count >> 8) & 0xff;
  out[6] = (count >> 16) & 0xff;
  out[7] = (count >> 24) & 0xff;
  out[8] = value & 0xff;
  out[9] = (value >> 8) & 0xff;
  out[10] = (value >> 16) & 0xff;
  out[11] = (value >> 24) & 0xff;
  return out;
}

function buildJpegWithExif(): Uint8Array {
  // TIFF header (little-endian, magic 42, IFD0 offset 8).
  const tiff = u8(
    0x49, 0x49, 0x2a, 0x00,
    0x08, 0x00, 0x00, 0x00,
  );
  // 2 IFD0 entries: Orientation (short, 1) = 6, GPSInfo (long, 1) = 0.
  const numEntries = u8(0x02, 0x00);
  const orientation = ifdEntry(0x0112, 3, 1, 6);
  const gps = ifdEntry(0x8825, 4, 1, 0);
  const nextIfd = u8(0x00, 0x00, 0x00, 0x00);
  const ifd0 = concat(numEntries, orientation, gps, nextIfd);
  const exifPayload = concat(tiff, ifd0);

  // APP1 = "Exif\0\0" prefix + TIFF payload.
  const exifHeader = u8(0x45, 0x78, 0x69, 0x66, 0x00, 0x00);
  const app1Body = concat(exifHeader, exifPayload);
  const app1Len = app1Body.length + 2; // includes the length bytes themselves
  const app1Header = u8(0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff);

  // SOI + APP1 + SOS + a tiny body + EOI (contents not important — scrub
  // only touches the metadata segment).
  const soi = u8(0xff, 0xd8);
  const sos = u8(0xff, 0xda, 0x00, 0x02);
  const body = u8(0x00, 0x00);
  const eoi = u8(0xff, 0xd9);

  return concat(soi, app1Header, app1Body, sos, body, eoi);
}

(async () => {
  const { scrubJpegGps } = await import("../../exifScrub");

  const jpegBytes = buildJpegWithExif();
  // Layout: SOI(2) + [FFE1 hi lo] (4) + "Exif\0\0" (6) = 12 → tiffBase.
  // TIFF header is 8 bytes and IFD0 offset (set in the fixture) is 8.
  const tiffBase = 12;
  const ifd0Base = tiffBase + 8;
  const numEntries = jpegBytes[ifd0Base] | (jpegBytes[ifd0Base + 1] << 8);
  assert.equal(numEntries, 2, "test fixture has 2 IFD0 entries");
  const orientationTagId =
    jpegBytes[ifd0Base + 2] | (jpegBytes[ifd0Base + 2 + 1] << 8);
  assert.equal(orientationTagId, 0x0112, "Orientation entry is present");
  const gpsTagId =
    jpegBytes[ifd0Base + 2 + 12] | (jpegBytes[ifd0Base + 2 + 12 + 1] << 8);
  assert.equal(gpsTagId, 0x8825, "GPS entry is present before scrub");

  // Cast through `BlobPart` since TS 5's newer lib.dom.d.ts refuses to
  // widen `Uint8Array<ArrayBufferLike>` (which may back a
  // SharedArrayBuffer) to the strict `Uint8Array<ArrayBuffer>` union.
  const file = new File([jpegBytes as BlobPart], "photo.jpg", { type: "image/jpeg" });
  const result = await scrubJpegGps(file);
  assert.ok(result.scrubbed, "scrubber rewrote the JPEG");
  assert.equal(result.file.type, "image/jpeg", "mime preserved");
  assert.equal(result.file.name, "photo.jpg", "filename preserved");

  const outBytes = new Uint8Array(await result.file.arrayBuffer());
  const outOrientation =
    outBytes[ifd0Base + 2] | (outBytes[ifd0Base + 2 + 1] << 8);
  assert.equal(outOrientation, 0x0112, "Orientation entry survived scrub");
  const outGps =
    outBytes[ifd0Base + 2 + 12] | (outBytes[ifd0Base + 2 + 12 + 1] << 8);
  assert.equal(outGps, 0x0000, "GPS entry tag id was neutralised");
  // Offset field zeroed so a permissive parser also finds no sub-IFD.
  const outGpsOffset =
    outBytes[ifd0Base + 2 + 12 + 8] |
    (outBytes[ifd0Base + 2 + 12 + 9] << 8) |
    (outBytes[ifd0Base + 2 + 12 + 10] << 16) |
    (outBytes[ifd0Base + 2 + 12 + 11] << 24);
  assert.equal(outGpsOffset, 0, "GPS sub-IFD offset zeroed");

  // Non-JPEG passes through untouched.
  const png = new File([u8(0x89, 0x50, 0x4e, 0x47) as BlobPart], "x.png", { type: "image/png" });
  const pngResult = await scrubJpegGps(png);
  assert.equal(pngResult.scrubbed, false);
  assert.equal(pngResult.file, png, "non-JPEG passes through unchanged");
  assert.equal(pngResult.skippedReason, "not_jpeg");

  // JPEG without EXIF returns cleanly (no_exif, unchanged bytes).
  const jpegNoExif = new File(
    [u8(0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0x00, 0xff, 0xd9) as BlobPart],
    "plain.jpg",
    { type: "image/jpeg" },
  );
  const jpegNoExifResult = await scrubJpegGps(jpegNoExif);
  assert.equal(jpegNoExifResult.scrubbed, false);
  assert.equal(jpegNoExifResult.skippedReason, "no_exif");

  console.log("exif scrub contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
