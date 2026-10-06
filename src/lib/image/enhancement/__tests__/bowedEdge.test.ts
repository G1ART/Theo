// A flat painting must not gain a wave from the rectangle crop.
// The crop is the four corners and one homography. A lens bow on the
// silhouette is not a reason to resample the interior.

import assert from "node:assert/strict";
import { applyHomography } from "../homography";
import {
  fullFrame,
  mapUnitToSource,
  planArtworkRectification,
  renderRectified,
} from "../rectifyArtwork";

type RGB = [number, number, number];

const wall: RGB = [252, 252, 250];
const studio: RGB = [243, 243, 243];

function put(
  data: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  rgb: RGB,
) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  if (i < 0 || i + 3 >= data.length) return;
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = 255;
}

function rgbAt(data: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

function bowY(t: number, amp: number): number {
  const u = Math.min(1, Math.max(0, t));
  return Math.sin(Math.PI * u) * amp;
}

function lineResidual(samples: Array<{ t: number; p: number }>): number {
  if (samples.length < 3) return 0;
  let n = 0;
  let st = 0;
  let sp = 0;
  let stt = 0;
  let stp = 0;
  for (const s of samples) {
    n += 1;
    st += s.t;
    sp += s.p;
    stt += s.t * s.t;
    stp += s.t * s.p;
  }
  const den = n * stt - st * st;
  const b = Math.abs(den) < 1e-9 ? 0 : (n * stp - st * sp) / den;
  const a = (sp - b * st) / n;
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s.p - (a + b * s.t)));
  return max;
}

function markerSamples(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  match: (px: [number, number, number, number]) => boolean,
  axis: "vertical" | "horizontal",
): Array<{ t: number; p: number }> {
  const samples: Array<{ t: number; p: number }> = [];
  if (axis === "vertical") {
    for (let y = 0; y < h; y += 1) {
      let sum = 0;
      let n = 0;
      for (let x = 0; x < w; x += 1) {
        if (!match(rgbAt(data, w, x, y))) continue;
        sum += x;
        n += 1;
      }
      if (n > 0) samples.push({ t: y, p: sum / n });
    }
  } else {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let n = 0;
      for (let y = 0; y < h; y += 1) {
        if (!match(rgbAt(data, w, x, y))) continue;
        sum += y;
        n += 1;
      }
      if (n > 0) samples.push({ t: x, p: sum / n });
    }
  }
  return samples;
}

function assertNoPeriodicWave(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  label: string,
) {
  const vertical = markerSamples(data, w, h, isVertical, "vertical");
  const horizontal = markerSamples(data, w, h, isHorizontal, "horizontal");
  assert.ok(vertical.length > h * 0.4, `${label} vertical marker missing (${vertical.length}/${h})`);
  assert.ok(horizontal.length > w * 0.4, `${label} horizontal marker missing (${horizontal.length}/${w})`);
  const v = lineResidual(vertical);
  const hz = lineResidual(horizontal);
  assert.ok(v <= 1.25, `${label} vertical wave ${v.toFixed(2)}px`);
  assert.ok(hz <= 1.25, `${label} horizontal wave ${hz.toFixed(2)}px`);
}

const isVertical = (px: [number, number, number, number]) => px[0] < 12 && px[1] > 200 && px[2] < 12;
const isHorizontal = (px: [number, number, number, number]) => px[0] > 200 && px[1] < 12 && px[2] > 200;

// Flat rectangle. Each interior column has a constant red, each row a
// constant green, plus one vertical and one horizontal mark. A full-image
// displacement would move those marks into a wave.
{
  const w = 220;
  const h = 180;
  const x0 = 40;
  const y0 = 32;
  const x1 = 184;
  const y1 = 148;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
      const color: RGB = !inside
        ? wall
        : x === x0 + 28
          ? [0, 220, 0]
          : y === y0 + 36
            ? [220, 0, 220]
            : [x, y, 90];
      put(data, w, x, y, color);
    }
  }
  const corners: [[number, number], [number, number], [number, number], [number, number]] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const raster = { data, width: w, height: h };
  const frame = fullFrame(w, h);
  const plan = planArtworkRectification({
    raster,
    corners,
    frame,
    mode: "auto",
    aspectSource: "estimated",
    longEdge: x1 - x0,
  });
  assert.equal(plan.recipe.method, "identity");
  assert.equal(plan.radial, null);
  assert.equal(plan.sampleCurves, null);
  assert.equal(plan.knots, null);
  const out = renderRectified(raster, plan, frame);
  const originX = plan.copyRect?.x ?? 0;
  const originY = plan.copyRect?.y ?? 0;
  for (let row = 0; row < out.height; row += 1) {
    for (let col = 0; col < out.width; col += 1) {
      const src = rgbAt(data, w, originX + col, originY + row);
      const dst = rgbAt(out.data, out.width, col, row);
      assert.deepEqual(dst, src, `flat crop moved ${col},${row}`);
    }
  }
  assertNoPeriodicWave(data, w, h, "source");
  assertNoPeriodicWave(out.data, out.width, out.height, "crop");
  let studioWhite = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i] === studio[0] && out.data[i + 1] === studio[1] && out.data[i + 2] === studio[2]) {
      studioWhite += 1;
    }
  }
  assert.equal(studioWhite, 0, "#f3f3f3 inside the artwork");

  const tuned = planArtworkRectification({
    raster,
    corners,
    frame,
    mode: "adjust",
    manualK1: 0.6,
    nudges: { top: 6, right: 6, bottom: 8, left: 6 },
    aspectSource: "estimated",
    longEdge: x1 - x0,
  });
  const tunedOut = renderRectified(raster, tuned, frame);
  assert.equal(tuned.radial, null);
  assert.equal(tuned.sampleCurves, null);
  assert.equal(tunedOut.data.length, out.data.length);
  for (let i = 0; i < out.data.length; i += 1) {
    assert.equal(tunedOut.data[i], out.data[i], "adjust bow resampled the painting");
  }
}

// The silhouette is bowed. The interior is still a flat field. Following
// that bow used to ripple the whole canvas. The crop keeps the corner box.
{
  const w = 220;
  const h = 180;
  const x0 = 40;
  const y0 = 32;
  const x1 = 184;
  const y1 = 148;
  const amp = 4;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const tx = (x - x0) / (x1 - x0);
      const ty = (y - y0) / (y1 - y0);
      const left = x0 + bowY(ty, amp);
      const right = x1 - bowY(ty, amp);
      const top = y0 + bowY(tx, amp);
      const bottom = y1 - bowY(tx, amp);
      const inside = x >= left && x < right && y >= top && y < bottom;
      const color: RGB = !inside
        ? wall
        : x === x0 + 36
          ? [0, 220, 0]
          : y === y0 + 40
            ? [220, 0, 220]
            : [x, y, 90];
      put(data, w, x, y, color);
    }
  }
  const corners: [[number, number], [number, number], [number, number], [number, number]] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const raster = { data, width: w, height: h };
  const frame = fullFrame(w, h);
  const plan = planArtworkRectification({
    raster,
    corners,
    frame,
    mode: "auto",
    aspectSource: "estimated",
    longEdge: x1 - x0,
  });
  assert.notEqual(plan.recipe.method, "radial");
  assert.notEqual(plan.recipe.method, "boundary_traced");
  assert.notEqual(plan.recipe.method, "boundary_manual");
  assert.equal(plan.radial, null);
  assert.equal(plan.sampleCurves, null);
  assert.equal(plan.knots, null);
  const out = renderRectified(raster, plan, frame);
  const originX = plan.copyRect?.x ?? 0;
  const originY = plan.copyRect?.y ?? 0;
  const inset = amp + 3;
  let checked = 0;
  for (let row = inset; row < out.height - inset; row += 1) {
    for (let col = inset; col < out.width - inset; col += 1) {
      const src = rgbAt(data, w, originX + col, originY + row);
      const dst = rgbAt(out.data, out.width, col, row);
      assert.deepEqual(dst, src, `bow crop rippled ${col},${row}`);
      checked += 1;
    }
  }
  assert.ok(checked > 1000, "interior was not compared");
  assertNoPeriodicWave(out.data, out.width, out.height, "bowed silhouette");
  let holes = 0;
  let studioWhite = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] < 16) holes += 1;
    if (out.data[i] === studio[0] && out.data[i + 1] === studio[1] && out.data[i + 2] === studio[2]) {
      studioWhite += 1;
    }
  }
  assert.equal(holes, 0, "crop has no empty pixels");
  assert.equal(studioWhite, 0, "#f3f3f3 inside the artwork");
}

// A keystoned flat painting. The homography may slant a mark. It must
// not add a periodic wave that the source does not have.
{
  const w = 240;
  const h = 200;
  const corners: [[number, number], [number, number], [number, number], [number, number]] = [
    [36, 28],
    [196, 44],
    [208, 168],
    [28, 156],
  ];
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) put(data, w, x, y, wall);
  }
  const markX = 110;
  const markY = 96;
  for (let y = 40; y < 160; y += 1) {
    for (let x = markX - 1; x <= markX + 1; x += 1) put(data, w, x, y, [0, 220, 0]);
  }
  for (let x = 40; x < 190; x += 1) {
    for (let y = markY - 1; y <= markY + 1; y += 1) put(data, w, x, y, [220, 0, 220]);
  }
  const raster = { data, width: w, height: h };
  const frame = fullFrame(w, h);
  assertNoPeriodicWave(data, w, h, "keystone source");
  const plan = planArtworkRectification({
    raster,
    corners,
    frame,
    mode: "auto",
    aspectSource: "estimated",
    longEdge: 180,
  });
  assert.equal(plan.recipe.method, "perspective");
  assert.equal(plan.radial, null);
  assert.equal(plan.sampleCurves, null);
  assert.equal(plan.knots, null);
  assert.ok(plan.unitToUndistorted, "homography");
  for (const u of [0.2, 0.5, 0.8]) {
    for (const v of [0.2, 0.5, 0.8]) {
      const mapped = mapUnitToSource(plan, u, v);
      const expected = applyHomography(plan.unitToUndistorted!, [u, v]);
      assert.ok(mapped && expected, "sample");
      assert.ok(
        Math.hypot(mapped![0] - expected![0], mapped![1] - expected![1]) < 1e-6,
        `interior ${u},${v} left the homography`,
      );
    }
  }
  const out = renderRectified(raster, plan, frame);
  assertNoPeriodicWave(out.data, out.width, out.height, "keystone crop");
  let studioWhite = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i] === studio[0] && out.data[i + 1] === studio[1] && out.data[i + 2] === studio[2]) {
      studioWhite += 1;
    }
  }
  assert.equal(studioWhite, 0, "#f3f3f3 inside the artwork");
}

console.log("bowedEdge.test.ts: ok");
