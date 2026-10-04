import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyUserFineTuneToImageData } from "../src/lib/image/enhancement/applyToneDelta";
import {
  compositeStudioPresentation,
  prepareCutoutForColor,
  resolveStudioPadPx,
  studioShadowParams,
  STUDIO_BEZEL_FRACTION,
  STUDIO_WALL_RGB,
} from "../src/lib/image/enhancement/studioPresentation";

function fill(
  w: number,
  h: number,
  rgb: [number, number, number],
  alpha = 255,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = alpha;
  }
  return data;
}

function at(data: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number] {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

function isWall(rgb: [number, number, number]): boolean {
  return rgb[0] === STUDIO_WALL_RGB && rgb[1] === STUDIO_WALL_RGB && rgb[2] === STUDIO_WALL_RGB;
}

const bezelPx = 24;
const shadow = studioShadowParams(bezelPx);
assert.deepEqual(shadow, {
  shadowBlur: Math.max(8, Math.round(bezelPx * 0.4)),
  shadowOffsetX: 0,
  shadowOffsetY: Math.max(4, Math.round(bezelPx * 0.18)),
  shadowColor: "rgba(0,0,0,0.22)",
  shadowAlpha: 0.22,
});
assert.equal(shadow.shadowBlur, 10);
assert.equal(shadow.shadowOffsetY, 4);

const subject: [number, number, number] = [20, 80, 200];
const rectW = 32;
const rectH = 24;
const rect = fill(rectW, rectH, subject);
const rectOut = compositeStudioPresentation(rect, rectW, rectH, bezelPx);
assert.equal(rectOut.width, rectW + bezelPx * 2);
assert.equal(rectOut.height, rectH + bezelPx * 2);
assert.ok(isWall(at(rectOut.data, rectOut.width, 0, 0)), "rectangle corner is the studio wall");
assert.ok(
  isWall(at(rectOut.data, rectOut.width, rectOut.width - 1, 0)),
  "rectangle top edge is the studio wall",
);
const rectCenter = at(
  rectOut.data,
  rectOut.width,
  bezelPx + Math.floor(rectW / 2),
  bezelPx + Math.floor(rectH / 2),
);
assert.deepEqual(rectCenter, subject, "rectangle subject stays");

const above = at(rectOut.data, rectOut.width, bezelPx + Math.floor(rectW / 2), bezelPx - 8);
const below = at(
  rectOut.data,
  rectOut.width,
  bezelPx + Math.floor(rectW / 2),
  bezelPx + rectH + shadow.shadowOffsetY,
);
assert.ok(below[0] < STUDIO_WALL_RGB, "rectangle shadow is darker than the wall");
assert.ok(below[0] < above[0], "rectangle shadow falls downward");
assert.ok(Math.max(...below) - Math.min(...below) <= 2, "rectangle shadow is neutral");

// Circle cutout. Corners of the bounding box stay wall; the disc stays.
const silW = 40;
const silH = 40;
const sil = fill(silW, silH, subject, 0);
const cx = 20;
const cy = 20;
const radius = 12;
for (let y = 0; y < silH; y += 1) {
  for (let x = 0; x < silW; x += 1) {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= radius * radius) {
      const i = (y * silW + x) * 4;
      sil[i] = subject[0];
      sil[i + 1] = subject[1];
      sil[i + 2] = subject[2];
      sil[i + 3] = 255;
    }
  }
}
const silOut = compositeStudioPresentation(sil, silW, silH, bezelPx);
assert.ok(isWall(at(silOut.data, silOut.width, 0, 0)), "silhouette corner is the studio wall");
assert.deepEqual(
  at(silOut.data, silOut.width, bezelPx + cx, bezelPx + cy),
  subject,
  "silhouette center stays the subject",
);
assert.ok(
  isWall(at(silOut.data, silOut.width, bezelPx, bezelPx)),
  "transparent corner of the cutout is wall, not a hard rectangle",
);
const silBelow = at(
  silOut.data,
  silOut.width,
  bezelPx + cx,
  bezelPx + cy + radius + shadow.shadowOffsetY,
);
const silAbove = at(
  silOut.data,
  silOut.width,
  bezelPx + cx,
  bezelPx + cy - radius - 8,
);
assert.ok(silBelow[0] < STUDIO_WALL_RGB, "silhouette shadow is darker than the wall");
assert.ok(silBelow[0] < silAbove[0], "silhouette shadow falls downward");
assert.ok(Math.max(...silBelow) - Math.min(...silBelow) <= 2, "silhouette shadow is neutral");
assert.equal(shadow.shadowBlur, studioShadowParams(bezelPx).shadowBlur);
assert.equal(shadow.shadowOffsetY, studioShadowParams(bezelPx).shadowOffsetY);
assert.equal(shadow.shadowAlpha, studioShadowParams(bezelPx).shadowAlpha);

// Opaque weave is not a cutout, and a clear pixel is not painted into the subject.
const opaque = fill(20, 20, [210, 208, 200]);
assert.equal(prepareCutoutForColor(opaque), false);
assert.equal(opaque[0], 210);
const cut = fill(40, 40, subject, 0);
cut[4] = 12;
cut[5] = 12;
cut[6] = 12;
const mid = (20 * 40 + 20) * 4;
cut[mid] = subject[0];
cut[mid + 1] = subject[1];
cut[mid + 2] = subject[2];
cut[mid + 3] = 255;
assert.equal(prepareCutoutForColor(cut), true);
assert.equal(cut[0], STUDIO_WALL_RGB);
assert.equal(cut[3], 0, "clear alpha stays clear");
assert.equal(cut[mid], subject[0], "opaque subject is not inward-filled");

// Same parameters still shadow a large bezel (downsample path).
const wide = compositeStudioPresentation(fill(16, 16, subject), 16, 16, 80);
assert.ok(isWall(at(wide.data, wide.width, 0, 0)));
const wideShadow = at(wide.data, wide.width, 80 + 8, 80 + 16 + studioShadowParams(80).shadowOffsetY);
assert.ok(wideShadow[0] < STUDIO_WALL_RGB, "downsampled shadow is still painted");

// Tight crop: no pre-existing bezel. The wall and shadow are staged,
// not copied from the photograph. A black bar along the source edge
// (a photographed shadow) must stay inside the artwork.
const tightW = 400;
const tightH = 300;
const tightRgb: [number, number, number] = [180, 40, 40];
const tight = fill(tightW, tightH, tightRgb);
for (let x = 0; x < tightW; x += 1) {
  const i = ((tightH - 1) * tightW + x) * 4;
  tight[i] = 5;
  tight[i + 1] = 5;
  tight[i + 2] = 5;
}
const tightPad = resolveStudioPadPx(tightW, tightH, 0);
assert.equal(tightPad, Math.round(STUDIO_BEZEL_FRACTION * tightH));
assert.ok(tightPad > 0, "tight crop still gets studio margin");
const tightShadow = studioShadowParams(tightPad);
const tightOut = compositeStudioPresentation(tight, tightW, tightH, 0);
assert.equal(tightOut.width, tightW + tightPad * 2);
assert.equal(tightOut.height, tightH + tightPad * 2);
assert.ok(isWall(at(tightOut.data, tightOut.width, 0, 0)), "tight rectangle corner is the studio wall");
assert.deepEqual(
  at(tightOut.data, tightOut.width, tightPad + Math.floor(tightW / 2), tightPad + 8),
  tightRgb,
  "tight rectangle subject is not recolored",
);
assert.deepEqual(
  at(tightOut.data, tightOut.width, tightPad + 4, tightPad + tightH - 1),
  [5, 5, 5],
  "photographed dark edge stays inside the crop",
);
const tightBelow = at(
  tightOut.data,
  tightOut.width,
  tightPad + Math.floor(tightW / 2),
  tightPad + tightH + tightShadow.shadowOffsetY,
);
assert.ok(tightBelow[0] < STUDIO_WALL_RGB, "tight rectangle shadow is darker than the wall");
assert.ok(
  Math.max(...tightBelow) - Math.min(...tightBelow) <= 2,
  "tight rectangle shadow is neutral",
);
assert.notDeepEqual(tightBelow, [5, 5, 5], "staged shadow is not the source's dark pixels");
assert.ok(tightBelow[0] > 40, "staged shadow is not a smear of the red paint");
const tightAbove = at(
  tightOut.data,
  tightOut.width,
  tightPad + Math.floor(tightW / 2),
  Math.max(0, tightPad - tightShadow.shadowBlur),
);
assert.ok(tightBelow[0] <= tightAbove[0], "tight rectangle shadow falls downward");

const shadowBefore = [...tightBelow];
applyUserFineTuneToImageData(
  tightOut.data,
  { b: 1.2, c: 1.1, s: 1.15 },
  { width: tightOut.width, height: tightOut.height, insetPx: tightPad },
);
assert.deepEqual(
  at(
    tightOut.data,
    tightOut.width,
    tightPad + Math.floor(tightW / 2),
    tightPad + tightH + tightShadow.shadowOffsetY,
  ),
  shadowBefore,
  "brightness does not move the staged shadow",
);
assert.notDeepEqual(
  at(tightOut.data, tightOut.width, tightPad + Math.floor(tightW / 2), tightPad + 8),
  tightRgb,
  "brightness still reaches the artwork",
);

// Tight silhouette. Transparent corners stay wall. The shadow is staged
// under the disc, not copied from a dark pixel in the cutout.
const tightSilW = 240;
const tightSilH = 240;
const tightSil = fill(tightSilW, tightSilH, tightRgb, 0);
const tsx = 120;
const tsy = 120;
const tsr = 48;
for (let y = 0; y < tightSilH; y += 1) {
  for (let x = 0; x < tightSilW; x += 1) {
    const dx = x - tsx;
    const dy = y - tsy;
    const i = (y * tightSilW + x) * 4;
    if (dx * dx + dy * dy <= tsr * tsr) {
      tightSil[i] = tightRgb[0];
      tightSil[i + 1] = tightRgb[1];
      tightSil[i + 2] = tightRgb[2];
      tightSil[i + 3] = 255;
    } else if (y === tightSilH - 1) {
      tightSil[i] = 8;
      tightSil[i + 1] = 8;
      tightSil[i + 2] = 8;
      tightSil[i + 3] = 255;
    }
  }
}
const silPad = resolveStudioPadPx(tightSilW, tightSilH, 0);
const silShadow = studioShadowParams(silPad);
const tightSilOut = compositeStudioPresentation(tightSil, tightSilW, tightSilH, 0);
assert.equal(tightSilOut.width, tightSilW + silPad * 2);
assert.ok(
  isWall(at(tightSilOut.data, tightSilOut.width, 0, 0)),
  "tight silhouette corner is the studio wall",
);
assert.deepEqual(
  at(tightSilOut.data, tightSilOut.width, silPad + tsx, silPad + tsy),
  tightRgb,
  "tight silhouette center stays the subject",
);
assert.ok(
  isWall(at(tightSilOut.data, tightSilOut.width, silPad, silPad)),
  "tight silhouette transparent corner is wall",
);
const tightSilBelow = at(
  tightSilOut.data,
  tightSilOut.width,
  silPad + tsx,
  silPad + tsy + tsr + silShadow.shadowOffsetY,
);
assert.ok(tightSilBelow[0] < STUDIO_WALL_RGB, "tight silhouette shadow is darker than the wall");
assert.ok(
  Math.max(...tightSilBelow) - Math.min(...tightSilBelow) <= 2,
  "tight silhouette shadow is neutral",
);
assert.notDeepEqual(tightSilBelow, [8, 8, 8], "silhouette shadow is not copied from source pixels");

const root = join(__dirname, "..");
const editor = readFileSync(join(root, "src/components/upload/ImageStandardizeEditor.tsx"), "utf8");
const engine = readFileSync(join(root, "src/lib/image/enhancement/localFlatEngine.ts"), "utf8");
const silhouette = readFileSync(join(root, "src/app/api/image-enhance/silhouette/route.ts"), "utf8");
const objectRoute = readFileSync(join(root, "src/app/api/image-enhance/object/route.ts"), "utf8");
assert.doesNotMatch(editor, /bezel:\s*useSilhouette\s*\?\s*0/);
assert.match(editor, /sourceCorners:\s*useSilhouette\s*\?\s*null/);
assert.match(editor, /presentCutoutOnStudioWall/);
assert.match(engine, /compositeStudioPresentation\(subject\.data, workW, workH, bezelPx\)/);
assert.match(
  engine,
  /input\.bezel > 0[\s\S]{0,120}STANDARD_STUDIO_BEZEL/,
  "a tight crop still gets the studio margin",
);
assert.doesNotMatch(silhouette, /background:/);
assert.match(objectRoute, /compositeStudioPresentation/);
assert.doesNotMatch(objectRoute, /bg_color/);
assert.doesNotMatch(objectRoute, /r:\s*255,\s*g:\s*255,\s*b:\s*255/);

console.log("studio-presentation.test.ts: ok");
