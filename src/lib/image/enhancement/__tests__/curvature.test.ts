import assert from "node:assert/strict";
import { distortPoint, radialModel, undistortPoint } from "../radialDistortion";
import {
  fullFrame,
  planArtworkRectification,
  renderRectified,
  sampleBilinear,
} from "../rectifyArtwork";

function localDistort(
  u: [number, number],
  cx: number,
  cy: number,
  scale: number,
  k1: number,
): [number, number] {
  const qx = (u[0] - cx) / scale;
  const qy = (u[1] - cy) / scale;
  const r2 = qx * qx + qy * qy;
  const f = 1 + k1 * r2;
  return [cx + scale * qx * f, cy + scale * qy * f];
}

function localUndistort(
  p: [number, number],
  cx: number,
  cy: number,
  scale: number,
  k1: number,
): [number, number] {
  const dx = p[0] - cx;
  const dy = p[1] - cy;
  const rd = Math.hypot(dx, dy) / scale;
  if (rd < 1e-8) return [cx, cy];
  let r = rd;
  for (let i = 0; i < 12; i += 1) {
    const r2 = r * r;
    r -= (k1 * r2 * r + r - rd) / (3 * k1 * r2 + 1);
  }
  return [cx + dx * (r / rd), cy + dy * (r / rd)];
}

// A negative continuous coordinate must not become pixel 0.
{
  const data = new Uint8ClampedArray(4 * 4 * 4);
  data[0] = 9;
  data[3] = 255;
  data[4] = 80;
  data[7] = 255;
  assert.equal(sampleBilinear({ data, width: 4, height: 4 }, -0.4, 0.5), null);
  const hit = sampleBilinear({ data, width: 4, height: 4 }, 0.5, 0.5);
  assert.equal(hit?.r, 9);
}

// Residual model inverts itself. Zero distortion is identity.
{
  const model = radialModel(200, 160, 0.22, 0);
  const u: [number, number] = [40, 30];
  const s = distortPoint(u, model);
  const back = s && undistortPoint(s, model);
  assert.ok(back && Math.hypot(back[0] - u[0], back[1] - u[1]) < 1e-3);
  const same = distortPoint(u, radialModel(200, 160, 0, 0));
  assert.ok(same && Math.hypot(same[0] - u[0], same[1] - u[1]) < 1e-9);
}

// A straight frontal rectangle is copied. Corners are not moved.
{
  const w = 80;
  const h = 60;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 20 + (i % 7);
    data[i + 3] = 255;
  }
  const corners: [[number, number], [number, number], [number, number], [number, number]] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const plan = planArtworkRectification({
    raster: { data, width: w, height: h },
    corners,
    frame: fullFrame(w, h),
    mode: "auto",
    aspectSource: "estimated",
    longEdge: w,
  });
  assert.equal(plan.recipe.method, "identity");
  assert.equal(plan.recipe.status, "already_straight");
  const out = renderRectified({ data, width: w, height: h }, plan, fullFrame(w, h));
  assert.equal(out.data[0], data[0]);
  assert.equal(out.data[(10 * w + 12) * 4], data[(10 * w + 12) * 4]);
}

// A radially bowed photo is still cropped by the four corners only.
// Recovering k1 and resampling the interior was the ripple.
{
  const w = 220;
  const h = 180;
  const cx = w / 2;
  const cy = h / 2;
  const scale = Math.max(w, h);
  const k1 = 0.85;
  const art = { x0: 46, y0: 34, x1: 174, y1: 146 };
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const u = localUndistort([x + 0.5, y + 0.5], cx, cy, scale, k1);
      const ix = Math.round(u[0] - 0.5);
      const iy = Math.round(u[1] - 0.5);
      const inside = ix >= art.x0 && ix < art.x1 && iy >= art.y0 && iy < art.y1;
      const i = (y * w + x) * 4;
      data[i] = inside ? 20 : 230;
      data[i + 1] = inside ? 90 : 226;
      data[i + 2] = inside ? 200 : 216;
      data[i + 3] = 255;
    }
  }
  const markX = 110;
  for (let y = 50; y < 130; y += 1) {
    for (let x = markX - 1; x <= markX + 1; x += 1) {
      const i = (y * w + x) * 4;
      data[i] = 0;
      data[i + 1] = 220;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  const uCorners: [[number, number], [number, number], [number, number], [number, number]] = [
    [art.x0, art.y0],
    [art.x1, art.y0],
    [art.x1, art.y1],
    [art.x0, art.y1],
  ];
  const corners = uCorners.map((p) => localDistort(p, cx, cy, scale, k1)) as typeof uCorners;
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
  assert.equal(plan.recipe.method, "identity");
  assert.notEqual(plan.recipe.method, "radial");
  assert.equal(plan.recipe.radial, null);
  assert.equal(plan.sampleCurves, null);
  assert.equal(plan.knots, null);
  const out = renderRectified(raster, plan, frame);
  const originX = plan.copyRect?.x ?? 0;
  const originY = plan.copyRect?.y ?? 0;
  for (let row = 0; row < out.height; row += 1) {
    for (let col = 0; col < out.width; col += 1) {
      const si = ((originY + row) * w + (originX + col)) * 4;
      const di = (row * out.width + col) * 4;
      assert.equal(out.data[di], data[si], `radial field moved ${col},${row}`);
    }
  }
  const samples: Array<{ t: number; p: number }> = [];
  for (let y = 0; y < out.height; y += 1) {
    let sum = 0;
    let n = 0;
    for (let x = 0; x < out.width; x += 1) {
      const i = (y * out.width + x) * 4;
      if (out.data[i] < 12 && out.data[i + 1] > 200 && out.data[i + 2] < 12) {
        sum += x;
        n += 1;
      }
    }
    if (n > 0) samples.push({ t: y, p: sum / n });
  }
  assert.ok(samples.length > out.height * 0.35, "straight mark was lost");
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
  let wave = 0;
  for (const s of samples) wave = Math.max(wave, Math.abs(s.p - (a + b * s.t)));
  assert.ok(wave <= 1.25, `radial resample waved the mark ${wave.toFixed(2)}px`);

  const off = planArtworkRectification({
    raster,
    corners,
    frame,
    mode: "off",
    aspectSource: "estimated",
    longEdge: w,
  });
  assert.equal(off.recipe.status, "disabled");
  assert.equal(off.recipe.radial, null);
  assert.notEqual(off.recipe.method, "radial");
}

console.log("curvature.test.ts: ok");
