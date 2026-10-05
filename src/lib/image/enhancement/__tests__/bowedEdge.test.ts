// A slight lens bow is eased onto the straight side of the rectangle.
// The edge sample is the canvas side of that curve: not the wall, and
// not a thick inset that deletes a crescent. A straight edge stays a
// straight copy. Handles that sit on the wall still must not leave
// white triangles.

import assert from "node:assert/strict";
import { coonsFromCurves } from "../interiorEdge";
import {
  fullFrame,
  mapUnitToSource,
  planArtworkRectification,
  renderRectified,
} from "../rectifyArtwork";

type RGB = [number, number, number];

const wall: RGB = [252, 252, 250];
const canvas: RGB = [176, 48, 42];
const bottomPaint: RGB = [28, 92, 58];
const cornerPaint: RGB = [214, 168, 36];

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

function dist(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function rgbAt(data: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

// Inward bow. The bottom is the severe edge: deeper than the other three,
// which is the stripe painting's ragged bottom.
function bowY(t: number, amp: number): number {
  const u = Math.min(1, Math.max(0, t));
  return Math.sin(Math.PI * u) * amp;
}

function plannedSource(
  plan: ReturnType<typeof planArtworkRectification>,
  u: number,
  v: number,
): [number, number] | null {
  if (plan.sampleCurves) return coonsFromCurves(u, v, plan.sampleCurves);
  return mapUnitToSource(plan, u, v);
}

// Slight lens bow. Corners are the sol points. The warp that straightens
// the bow is about as large as the bow, and the border is the paint just
// inside the curve.
function assertGentleBow(direction: 1 | -1, amp: number) {
  const w = 220;
  const h = 180;
  const x0 = 40;
  const y0 = 32;
  const x1 = 184;
  const y1 = 148;
  const studio: RGB = [243, 243, 243];
  const rim: RGB = [168, 54, 36];
  const field: RGB = [24, 86, 150];
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const tx = (x - x0) / (x1 - x0);
      const ty = (y - y0) / (y1 - y0);
      const left = x0 + direction * bowY(ty, amp);
      const right = x1 - direction * bowY(ty, amp);
      const top = y0 + direction * bowY(tx, amp);
      const bottom = y1 - direction * bowY(tx, amp);
      const inside = x >= left && x < right && y >= top && y < bottom;
      let color = studio;
      if (inside) {
        const depth = Math.min(x - left, right - x, y - top, bottom - y);
        color = depth < 5 ? rim : field;
      }
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
  assert.notEqual(plan.recipe.method, "identity", "a few pixels of bow is not left as a box");
  assert.equal(plan.recipe.status, "applied");
  const out = renderRectified(raster, plan, frame);
  let wallPixels = 0;
  let holes = 0;
  let studioWhite = 0;
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const px = rgbAt(out.data, out.width, x, y);
      if (px[3] < 16) holes += 1;
      if (dist([px[0], px[1], px[2]], studio) < 28) wallPixels += 1;
      if (px[0] === 243 && px[1] === 243 && px[2] === 243) studioWhite += 1;
    }
  }
  assert.equal(holes, 0, "straightened rectangle has no empty pixels");
  assert.equal(wallPixels, 0, `wall inside the rectangle: ${wallPixels}`);
  assert.equal(studioWhite, 0, "#f3f3f3 inside the artwork");

  const stations = [0.22, 0.5, 0.78];
  const edges: Array<{
    name: string;
    u: (t: number) => number;
    v: (t: number) => number;
    fromChord: (p: [number, number]) => number;
    pixel: (t: number) => [number, number];
  }> = [
    {
      name: "top",
      u: (t) => t,
      v: () => 0,
      fromChord: (p) => p[1] - y0,
      pixel: (t) => [Math.min(out.width - 1, Math.round(t * out.width - 0.5)), 0],
    },
    {
      name: "bottom",
      u: (t) => t,
      v: () => 1,
      fromChord: (p) => y1 - p[1],
      pixel: (t) => [Math.min(out.width - 1, Math.round(t * out.width - 0.5)), out.height - 1],
    },
    {
      name: "left",
      u: () => 0,
      v: (t) => t,
      fromChord: (p) => p[0] - x0,
      pixel: (t) => [0, Math.min(out.height - 1, Math.round(t * out.height - 0.5))],
    },
    {
      name: "right",
      u: () => 1,
      v: (t) => t,
      fromChord: (p) => x1 - p[0],
      pixel: (t) => [out.width - 1, Math.min(out.height - 1, Math.round(t * out.height - 0.5))],
    },
  ];
  for (const edge of edges) {
    for (const t of stations) {
      const src = plannedSource(plan, edge.u(t), edge.v(t));
      assert.ok(src, `${edge.name} sample`);
      const expect = direction * bowY(t, amp);
      const moved = edge.fromChord(src as [number, number]);
      assert.ok(
        Math.abs(moved - expect) < 2,
        `${direction > 0 ? "inward" : "outward"} ${edge.name} t=${t} moved ${moved.toFixed(2)}px, bow ${expect.toFixed(2)}px`,
      );
      const [px, py] = edge.pixel(t);
      const rgb = rgbAt(out.data, out.width, px, py);
      const here: RGB = [rgb[0], rgb[1], rgb[2]];
      assert.ok(dist(here, studio) > 40, `${edge.name} border is wall`);
      assert.ok(
        dist(here, rim) + 12 < dist(here, field),
        `${edge.name} t=${t} lost the canvas edge (${here.join(",")})`,
      );
    }
  }
  const center = plannedSource(plan, 0.5, 0.5);
  assert.ok(center, "center sample");
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  assert.ok(
    Math.hypot(center[0] - cx, center[1] - cy) < amp + 1.5,
    `center moved ${Math.hypot(center[0] - cx, center[1] - cy).toFixed(2)}px`,
  );
  const mid = rgbAt(out.data, out.width, Math.floor(out.width / 2), Math.floor(out.height / 2));
  assert.ok(dist([mid[0], mid[1], mid[2]], field) < 20, "interior stays the painting");
}

assertGentleBow(1, 4);
assertGentleBow(-1, 4);

{
  const w = 240;
  const h = 200;
  const x0 = 48;
  const y0 = 40;
  const x1 = 196;
  const y1 = 164;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const tx = (x - x0) / (x1 - x0);
      const ty = (y - y0) / (y1 - y0);
      const left = x0 + bowY(ty, 5);
      const right = x1 - bowY(ty, 5);
      const top = y0 + bowY(tx, 6);
      const bottom = y1 - bowY(tx, 12);
      const inside = x >= left && x < right && y >= top && y < bottom;
      let color = wall;
      if (inside) {
        const fromBottom = bottom - y;
        const fromCorner =
          Math.min(x - left, right - x, y - top, bottom - y) < 8 &&
          (x - left < 14 || right - x < 14) &&
          (y - top < 14 || bottom - y < 14);
        if (fromCorner) color = cornerPaint;
        else if (fromBottom < 10) color = bottomPaint;
        else color = canvas;
      }
      put(data, w, x, y, color);
    }
  }
  // Handles sit on the wall, just outside the canvas, the way sol's
  // TL/TR do on a white wall.
  const corners: [[number, number], [number, number], [number, number], [number, number]] = [
    [x0 - 6, y0 - 6],
    [x1 + 6, y0 - 6],
    [x1 + 6, y1 + 6],
    [x0 - 6, y1 + 6],
  ];
  const raster = { data, width: w, height: h };
  const frame = fullFrame(w, h);
  const plan = planArtworkRectification({
    raster,
    corners,
    frame,
    mode: "auto",
    aspectSource: "estimated",
    longEdge: w,
  });
  assert.notEqual(plan.recipe.method, "identity", "a bowed quad is not copied as a box");
  assert.equal(plan.recipe.status, "applied");
  const out = renderRectified(raster, plan, frame);
  let wallPixels = 0;
  let holes = 0;
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const px = rgbAt(out.data, out.width, x, y);
      if (px[3] < 16) holes += 1;
      if (dist([px[0], px[1], px[2]], wall) < 28) wallPixels += 1;
    }
  }
  assert.equal(holes, 0, "destination rectangle has no uncovered pixels");
  assert.equal(wallPixels, 0, `wall color inside the rectangle: ${wallPixels}`);

  const cornerBlock = (x0b: number, y0b: number, label: string) => {
    for (let y = y0b; y < y0b + 6; y += 1) {
      for (let x = x0b; x < x0b + 6; x += 1) {
        const px = rgbAt(out.data, out.width, x, y);
        assert.ok(px[3] === 255, `${label} alpha`);
        assert.ok(
          dist([px[0], px[1], px[2]], wall) >= 28,
          `${label} at ${x},${y} is wall ${px[0]},${px[1]},${px[2]}`,
        );
        assert.ok(
          !(px[0] >= 240 && px[1] >= 240 && px[2] >= 240),
          `${label} white triangle ${px[0]},${px[1]},${px[2]}`,
        );
      }
    }
  };
  cornerBlock(0, 0, "top-left");
  cornerBlock(out.width - 6, 0, "top-right");
  cornerBlock(0, out.height - 6, "bottom-left");
  cornerBlock(out.width - 6, out.height - 6, "bottom-right");

  // The severe bottom edge: the middle of the output bottom is the
  // canvas just inside the bow, not a ragged wall bite.
  let bottomCanvas = 0;
  const yb = out.height - 2;
  for (let x = Math.floor(out.width * 0.3); x < Math.floor(out.width * 0.7); x += 1) {
    const px = rgbAt(out.data, out.width, x, yb);
    if (dist([px[0], px[1], px[2]], bottomPaint) < 30 || dist([px[0], px[1], px[2]], canvas) < 30) {
      bottomCanvas += 1;
    }
  }
  assert.ok(bottomCanvas > 20, `bottom edge samples the canvas (${bottomCanvas})`);
}

// Straight edges stay straight. Corners sit on the canvas. The copy is
// the rectangle, and a marker stripe down the left edge does not wave.
{
  const w = 180;
  const h = 140;
  const x0 = 30;
  const y0 = 24;
  const x1 = 150;
  const y1 = 116;
  const marker: RGB = [16, 170, 96];
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
      const color = !inside ? wall : x < x0 + 2 ? marker : canvas;
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
    longEdge: w,
  });
  const out = renderRectified(raster, plan, frame);
  if (plan.recipe.method === "identity") {
    assert.equal(plan.recipe.status, "already_straight");
    assert.equal(out.width, x1 - x0);
    assert.equal(out.height, y1 - y0);
  }
  let straightWall = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    if (dist([out.data[i], out.data[i + 1], out.data[i + 2]], wall) < 28) straightWall += 1;
  }
  assert.equal(straightWall, 0, "straight crop does not take the wall");
  const markerXs: number[] = [];
  for (let y = Math.floor(out.height * 0.15); y < Math.floor(out.height * 0.85); y += 1) {
    let found = -1;
    for (let x = 0; x < 4; x += 1) {
      const px = rgbAt(out.data, out.width, x, y);
      if (dist([px[0], px[1], px[2]], marker) < 8) {
        found = x;
        break;
      }
    }
    assert.ok(found >= 0, `marker missing at y ${y}`);
    markerXs.push(found);
    const px = rgbAt(out.data, out.width, 0, y);
    assert.ok(dist([px[0], px[1], px[2]], wall) > 40, "straight left edge is not wall");
  }
  const minX = Math.min(...markerXs);
  const maxX = Math.max(...markerXs);
  assert.ok(maxX - minX <= 1, `straight edge waved (${minX}..${maxX})`);
  const mid = rgbAt(out.data, out.width, Math.floor(out.width / 2), Math.floor(out.height / 2));
  assert.ok(dist([mid[0], mid[1], mid[2]], canvas) < 8, "interior stays the canvas");
}

console.log("bowedEdge.test.ts: ok");
