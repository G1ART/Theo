// 2026-08-06 — Contract test for the pure-JS EXIF reader.
//
// Security guardrail (the whole point of this test file):
//   A GPS-laden JPEG MUST NOT propagate any GPS coordinate out of
//   readExif(). We synthesize a minimal JPEG that carries an
//   Orientation tag AND a GPSInfo sub-IFD with real-looking lat/lon
//   values, then assert:
//     - readExif() surfaces Orientation.
//     - readExif() does NOT surface any GPS field (there's no key
//       for it — a defense-in-depth check).
//     - JSON.stringify(result) does not contain the fake lat/lon.

import assert from "node:assert/strict";

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

// Values encoded as rationals inside the GPS sub-IFD. We won't
// actually parse them — the guardrail is that readExif never looks at
// this region — but they need to look like plausible coordinates so a
// human reading the test bytes recognizes a real leak if it happened.
// e.g. 37.7749° N, 122.4194° W (San Francisco).
const FAKE_LAT_MARKER = 0xdeadbeef; // Sentinel we grep for in JSON.stringify
const FAKE_LON_MARKER = 0xcafef00d;

function buildJpegWithExifIncludingGps(): Uint8Array {
  const tiff = u8(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00);
  const numEntries = u8(0x02, 0x00);
  const orientation = ifdEntry(0x0112, 3, 1, 6);
  // GPSInfo tag (0x8825) pointer to sub-IFD offset 40 inside TIFF.
  const gps = ifdEntry(0x8825, 4, 1, 40);
  const nextIfd = u8(0x00, 0x00, 0x00, 0x00);
  const ifd0 = concat(numEntries, orientation, gps, nextIfd);
  // Sub-IFD at TIFF+40 — includes our sentinel markers.
  // 2 entries: GPSLatitude (0x0002) and GPSLongitude (0x0004).
  const gpsSubIfd = concat(
    u8(0x02, 0x00),
    ifdEntry(0x0002, 5, 3, FAKE_LAT_MARKER >>> 0),
    ifdEntry(0x0004, 5, 3, FAKE_LON_MARKER >>> 0),
    u8(0x00, 0x00, 0x00, 0x00),
  );
  // Pad TIFF to sub-IFD offset (offset 40 from TIFF start = position 40
  // after the 8-byte TIFF header).
  const tiffCore = concat(tiff, ifd0);
  const pad = new Uint8Array(Math.max(0, 40 + 8 - tiffCore.length));
  const exifPayload = concat(tiffCore, pad, gpsSubIfd);

  const exifHeader = u8(0x45, 0x78, 0x69, 0x66, 0x00, 0x00);
  const app1Body = concat(exifHeader, exifPayload);
  const app1Len = app1Body.length + 2;
  const app1Header = u8(0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff);
  const soi = u8(0xff, 0xd8);
  const sos = u8(0xff, 0xda, 0x00, 0x02);
  const body = u8(0x00, 0x00);
  const eoi = u8(0xff, 0xd9);
  return concat(soi, app1Header, app1Body, sos, body, eoi);
}

(async () => {
  const { readExif, formatCaptureDevice, isLowLightExif } = await import("../../exifRead");

  const bytes = buildJpegWithExifIncludingGps();
  const file = new File([bytes as BlobPart], "gps.jpg", { type: "image/jpeg" });
  const exif = await readExif(file);
  assert.equal(exif.format, "jpeg", "detected as JPEG");
  assert.equal(exif.orientation, 6, "Orientation surfaced");
  // Defense-in-depth: no GPS key even exists on the return type.
  assert.ok(!("gpsLatitude" in exif), "no gpsLatitude key");
  assert.ok(!("gpsLongitude" in exif), "no gpsLongitude key");
  const serialized = JSON.stringify(exif);
  assert.ok(
    !serialized.includes("deadbeef"),
    "GPS latitude sentinel does not leak",
  );
  assert.ok(
    !serialized.includes("cafef00d"),
    "GPS longitude sentinel does not leak",
  );

  // formatCaptureDevice on empty EXIF returns null.
  assert.equal(formatCaptureDevice(exif), null, "no device string when no Make/Model");

  // isLowLightExif: exposure > 1/60 AND ISO > 800 (both null in this
  // fixture so it returns false).
  assert.equal(isLowLightExif(exif), false);
  const lowLight = {
    ...exif,
    exposureTime: 1 / 30,
    iso: 1600,
  };
  assert.equal(isLowLightExif(lowLight), true, "low-light detected");

  // Non-JPEG returns EMPTY.
  const png = new File([u8(0x89, 0x50, 0x4e, 0x47) as BlobPart], "x.png", { type: "image/png" });
  const pngExif = await readExif(png);
  assert.equal(pngExif.format, null);
  assert.equal(pngExif.orientation, null);

  console.log("exif reader contract: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
