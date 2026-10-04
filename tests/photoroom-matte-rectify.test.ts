/**
 * A rectangular artwork shot at an angle comes back from Photoroom as
 * a trapezoid alpha matte. That matte must become a frontal rectangle
 * with straight edges, then sit on #f3f3f3 with a staged shadow.
 * A round matte stays a silhouette.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Point2 } from "../src/lib/image/enhancement/homography";
import { estimateRectifiedAspect } from "../src/lib/image/enhancement/homography";
import {
  fitMatteQuad,
  rectifyRectangularMatte,
  RECTANGLE_MATTE_MIN_CONFIDENCE,
} from "../src/lib/image/enhancement/matteRectify";
import { PHOTOROOM_SEGMENT_QUALITY_FIELDS } from "../src/lib/image/enhancement/photoroomSegment";
import {
  compositeStudioPresentation,
  STUDIO_WALL_RGB,
  studioShadowParams,
} from "../src/lib/image/enhancement/studioPresentation";

type Quad = [Point2, Point2, Point2, Point2];

const paint: [number, number, number] = [210, 48, 72];

function setPixel(
  data: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  rgb: [number, number, number],
  alpha = 255,
) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  if (i < 0 || i + 3 >= data.length) return;
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = alpha;
}

function inTri(px: number, py: number, a: Point2, b: Point2, c: Point2): boolean {
  const sign = (p: Point2, q: Point2, r: Point2) =>
    (px - r[0]) * (p[1] - r[1]) - (p[0] - r[0]) * (py - r[1]);
  const d1 = sign(a, b, c);
  const d2 = sign(b, c, a);
  const d3 = sign(c, a, b);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function fillQuad(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  quad: Quad,
  rgb: [number, number, number],
) {
  const [tl, tr, br, bl] = quad;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (inTri(x, y, tl, tr, br) || inTri(x, y, tl, br, bl)) {
        setPixel(data, w, x, y, rgb);
      }
    }
  }
}

function fillTri(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  a: Point2,
  b: Point2,
  c: Point2,
  rgb: [number, number, number],
) {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (inTri(x, y, a, b, c)) setPixel(data, w, x, y, rgb);
    }
  }
}

function isPaint(data: Uint8ClampedArray, w: number, x: number, y: number): boolean {
  const i = (y * w + x) * 4;
  return (
    data[i + 3] >= 200 &&
    Math.abs(data[i] - paint[0]) <= 12 &&
    Math.abs(data[i + 1] - paint[1]) <= 12 &&
    Math.abs(data[i + 2] - paint[2]) <= 12
  );
}

function at(data: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number] {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

function isWall(rgb: [number, number, number]): boolean {
  return rgb[0] === STUDIO_WALL_RGB && rgb[1] === STUDIO_WALL_RGB && rgb[2] === STUDIO_WALL_RGB;
}

function paintSpans(data: Uint8ClampedArray, w: number, h: number) {
  const rows: { y: number; left: number; right: number }[] = [];
  for (let y = 0; y < h; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < w; x += 1) {
      if (!isPaint(data, w, x, y)) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left >= 0) rows.push({ y, left, right });
  }
  return rows;
}

const sourceW = 240;
const sourceH = 200;
const trueCorners: Quad = [
  [62, 34],
  [176, 22],
  [208, 176],
  [28, 168],
];
const src = new Uint8ClampedArray(sourceW * sourceH * 4);
fillQuad(src, sourceW, sourceH, trueCorners, paint);
const topMid: Point2 = [
  (trueCorners[0][0] + trueCorners[1][0]) / 2,
  (trueCorners[0][1] + trueCorners[1][1]) / 2,
];
const bumpTip: Point2 = [topMid[0], topMid[1] - 16];
fillTri(src, sourceW, sourceH, trueCorners[0], bumpTip, trueCorners[1], paint);

const fit = fitMatteQuad(src, sourceW, sourceH);
assert.ok(fit, "trapezoid matte fits a quadrilateral");
if (!fit) process.exit(1);
assert.ok(
  fit.confidence >= RECTANGLE_MATTE_MIN_CONFIDENCE,
  `rectangle confidence ${fit.confidence.toFixed(3)}`,
);
for (const truth of trueCorners) {
  const nearest = Math.min(
    ...fit.corners.map((c) => Math.hypot(c[0] - truth[0], c[1] - truth[1])),
  );
  assert.ok(nearest <= 8, `canvas corner within 8px, got ${nearest.toFixed(1)}`);
}
const bumpGap = Math.min(...fit.corners.map((c) => Math.hypot(c[0] - bumpTip[0], c[1] - bumpTip[1])));
assert.ok(bumpGap > 10, "paint bump is not used as a canvas corner");

const rectified = rectifyRectangularMatte(src, sourceW, sourceH);
assert.equal(rectified.unwarped, true, "trapezoid matte is unwarped");
const expectedAspect = estimateRectifiedAspect(trueCorners);
const gotAspect = rectified.width / rectified.height;
assert.ok(
  Math.abs(gotAspect - expectedAspect) / expectedAspect <= 0.04,
  `frontal aspect ${gotAspect.toFixed(3)} vs ${expectedAspect.toFixed(3)}`,
);

const spans = paintSpans(rectified.data, rectified.width, rectified.height);
assert.ok(spans.length > 20, "frontal rectangle has paint rows");
const midSpans = spans.slice(Math.floor(spans.length * 0.15), Math.ceil(spans.length * 0.85));
const lefts = midSpans.map((row) => row.left);
const rights = midSpans.map((row) => row.right);
assert.ok(Math.max(...lefts) - Math.min(...lefts) <= 1, "left edge is straight");
assert.ok(Math.max(...rights) - Math.min(...rights) <= 1, "right edge is straight");
const topWidth = spans[0].right - spans[0].left;
const bottomWidth = spans[spans.length - 1].right - spans[spans.length - 1].left;
assert.ok(
  Math.abs(topWidth - bottomWidth) <= 2,
  `top and bottom widths match (${topWidth} vs ${bottomWidth})`,
);

let neutralGray = 0;
for (let i = 0; i < rectified.data.length; i += 4) {
  if (rectified.data[i + 3] < 16) continue;
  const spread = Math.max(rectified.data[i], rectified.data[i + 1], rectified.data[i + 2]) -
    Math.min(rectified.data[i], rectified.data[i + 1], rectified.data[i + 2]);
  if (spread <= 2 && rectified.data[i] < 180) neutralGray += 1;
}
assert.equal(neutralGray, 0, "unwarped rectangle has no photo shadow");

const bezelPx = 32;
const presented = compositeStudioPresentation(rectified.data, rectified.width, rectified.height, bezelPx);
assert.ok(isWall(at(presented.data, presented.width, 0, 0)), "top-left corner is rgb(243,243,243)");
assert.ok(isWall(at(presented.data, presented.width, presented.width - 1, 0)), "top-right corner is the wall");
assert.ok(isWall(at(presented.data, presented.width, 0, presented.height - 1)), "bottom-left corner is the wall");
assert.ok(
  isWall(at(presented.data, presented.width, presented.width - 1, presented.height - 1)),
  "bottom-right corner is the wall",
);
const presentedSpans = paintSpans(presented.data, presented.width, presented.height);
const shadow = studioShadowParams(bezelPx);
const midX = Math.round((presentedSpans[0].left + presentedSpans[0].right) / 2);
const belowY = presentedSpans[presentedSpans.length - 1].y + shadow.shadowOffsetY + 2;
const below = at(presented.data, presented.width, midX, belowY);
const above = at(presented.data, presented.width, midX, 2);
assert.ok(isWall(above), "wall above the rectangle stays #f3f3f3");
assert.ok(below[0] < STUDIO_WALL_RGB, "staged shadow is darker than the wall");
assert.ok(Math.max(...below) - Math.min(...below) <= 2, "staged shadow is neutral, not copied from the photo");
assert.ok(below[0] !== paint[0], "shadow is not the paint color");

const circleW = 200;
const circleH = 200;
const circle = new Uint8ClampedArray(circleW * circleH * 4);
const cx = 100;
const cy = 100;
const radius = 72;
for (let y = 0; y < circleH; y += 1) {
  for (let x = 0; x < circleW; x += 1) {
    if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) setPixel(circle, circleW, x, y, paint);
  }
}
const roundFit = fitMatteQuad(circle, circleW, circleH);
assert.equal(roundFit, null, "a round matte is not a quadrilateral");
const round = rectifyRectangularMatte(circle, circleW, circleH);
assert.equal(round.unwarped, false, "a round matte stays a silhouette");
assert.equal(round.width, circleW);
assert.equal(round.height, circleH);
const roundPresented = compositeStudioPresentation(round.data, round.width, round.height, bezelPx);
const roundSpans = paintSpans(roundPresented.data, roundPresented.width, roundPresented.height);
const roundWidths = roundSpans.map((row) => row.right - row.left);
assert.ok(
  Math.max(...roundWidths) - Math.min(...roundWidths) > 20,
  "round matte is not flattened into a rectangle",
);

const fields = PHOTOROOM_SEGMENT_QUALITY_FIELDS.map(([key, value]) => `${key}=${value}`);
assert.deepEqual(fields, ["format=png", "channels=rgba", "size=full"]);
const route = readFileSync(
  join(__dirname, "../src/app/api/image-enhance/silhouette/route.ts"),
  "utf8",
);
assert.match(route, /appendPhotoroomQualityFields/);
assert.match(route, /rectifyRectangularMatte/);
assert.doesNotMatch(route, /bg_color/);
assert.doesNotMatch(route, /background:/);

console.log("photoroom-matte-rectify.test.ts: ok");
