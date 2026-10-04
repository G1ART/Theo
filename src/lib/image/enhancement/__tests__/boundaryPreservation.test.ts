import assert from "node:assert/strict";
import { paintBorderWall } from "../borderWall";
import { fullFrame, planArtworkRectification, renderRectified } from "../rectifyArtwork";
import { traceArtworkEdges } from "../traceArtworkEdges";

function put(
  data: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  rgb: [number, number, number],
) {
  const i = (y * w + x) * 4;
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = 255;
}

function fill(
  data: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) put(data, w, x, y, rgb);
  }
}

// Corners sit outside a straight painting. Wall inside the chord leaves
// the output. Black strokes on a white ground are not the frame.
{
  const w = 160;
  const h = 120;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 210;
    data[i + 1] = 206;
    data[i + 2] = 198;
    data[i + 3] = 255;
  }
  const art = { x0: 24, y0: 18, x1: 136, y1: 102 };
  fill(data, w, art.x0, art.y0, art.x1, art.y1, [30, 70, 160]);
  fill(data, w, 100, art.y0, art.x1, art.y1, [248, 248, 246]);
  for (let y = art.y0 + 4; y < art.y1 - 4; y += 3) {
    fill(data, w, 108, y, 118, y + 1, [8, 8, 8]);
  }
  const outside = 8;
  const corners: [[number, number], [number, number], [number, number], [number, number]] = [
    [art.x0 - outside, art.y0 - outside],
    [art.x1 + outside, art.y0 - outside],
    [art.x1 + outside, art.y1 + outside],
    [art.x0 - outside, art.y1 + outside],
  ];
  const trace = traceArtworkEdges(data, w, h, corners);
  const rightMid = trace.edges[1].points[32];
  assert.ok(rightMid.x > art.x1 - 4 && rightMid.x < art.x1 + 2, `right ${rightMid.x}`);
  const plan = planArtworkRectification({
    raster: { data, width: w, height: h },
    corners,
    frame: fullFrame(w, h),
    mode: "auto",
    aspectSource: "estimated",
    longEdge: Math.max(w, h),
  });
  assert.equal(plan.recipe.status, "applied");
  const out = renderRectified({ data, width: w, height: h }, plan, fullFrame(w, h));
  const left = (Math.floor(out.height / 2) * out.width + 2) * 4;
  assert.ok(out.data[left] < 80, "left edge is the painting");
  const right = (Math.floor(out.height / 2) * out.width + (out.width - 3)) * 4;
  assert.ok(out.data[right] > 200, "right edge keeps the white ground");
  let matte = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i] === 243 && out.data[i + 1] === 243 && out.data[i + 2] === 243) matte += 1;
  }
  assert.equal(matte, 0);
}

// The comb is this color walk: a white ground matches the wall, and each
// row stops at a different dark stroke. Geometry output above wrote no
// #f3f3f3 into the subject.
{
  const cw = 200;
  const ch = 180;
  const comb = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y += 1) {
    const stroke = y % 8 === 0 ? 3 + (y % 3) * 3 : -1;
    for (let x = 0; x < cw; x += 1) {
      const fromRight = cw - 1 - x;
      put(comb, cw, x, y, fromRight === stroke ? [12, 12, 12] : [250, 249, 247]);
    }
  }
  paintBorderWall(comb, cw, ch, { r: 246, g: 244, b: 240 });
  let teeth = 0;
  let prev = -1;
  for (let y = 0; y < ch; y += 1) {
    let run = 0;
    for (let x = cw - 1; x >= 0; x -= 1) {
      const i = (y * cw + x) * 4;
      if (comb[i] === 243 && comb[i + 1] === 243 && comb[i + 2] === 243) run += 1;
      else break;
    }
    if (prev >= 0 && Math.abs(run - prev) >= 2) teeth += 1;
    prev = run;
  }
  assert.ok(teeth > 4, `comb teeth ${teeth}`);
}

// Subject pixels whose RGB equals the wall stay subject pixels.
{
  const w = 80;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 180;
    data[i + 1] = 180;
    data[i + 2] = 180;
    data[i + 3] = 255;
  }
  fill(data, w, 12, 10, 68, 54, [20, 20, 20]);
  fill(data, w, 40, 24, 52, 36, [180, 180, 180]);
  const corners: [[number, number], [number, number], [number, number], [number, number]] = [
    [6, 4],
    [74, 4],
    [74, 60],
    [6, 60],
  ];
  const plan = planArtworkRectification({
    raster: { data, width: w, height: h },
    corners,
    frame: fullFrame(w, h),
    mode: "auto",
    aspectSource: "estimated",
    longEdge: w,
  });
  const out = renderRectified({ data, width: w, height: h }, plan, fullFrame(w, h));
  let kept = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i] === 180 && out.data[i + 1] === 180 && out.data[i + 2] === 180 && out.data[i + 3] > 0) {
      kept += 1;
    }
  }
  assert.ok(kept > 20, `same-RGB subject kept ${kept}`);
}

console.log("boundaryPreservation.test.ts: ok");
