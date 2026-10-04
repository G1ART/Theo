import assert from "node:assert/strict";
import { aspectSourceForMode } from "../aspectResolve";
import { parseGeometryRecipe } from "../geometryPlan";
import { fullFrame, planArtworkRectification } from "../rectifyArtwork";
import { parseEnhanceSessionPreset } from "../sharedPreset";
import { normalizeEnhancementMeta } from "../types";

assert.equal(aspectSourceForMode("auto", undefined), "estimated");
assert.equal(aspectSourceForMode("artwork_cm", 1.2), "artwork_dimensions");
assert.equal(aspectSourceForMode("square", 1), "user");

const w = 48;
const h = 40;
const data = new Uint8ClampedArray(w * h * 4);
for (let i = 0; i < data.length; i += 4) {
  data[i + 3] = 255;
  data[i] = 40;
}
const corners: [[number, number], [number, number], [number, number], [number, number]] = [
  [4, 4],
  [44, 4],
  [44, 36],
  [4, 36],
];
const plan = planArtworkRectification({
  raster: { data, width: w, height: h },
  corners,
  frame: fullFrame(w, h),
  mode: "auto",
  aspectSource: "user",
  targetAspect: 1.25,
  longEdge: w,
});
const again = parseGeometryRecipe(JSON.parse(JSON.stringify(plan.recipe)));
assert.ok(again && typeof again === "object");
assert.equal(again.method, plan.recipe.method);
assert.equal(again.status, plan.recipe.status);
assert.equal(again.target.aspectSource, "user");
assert.equal(again.target.aspect, plan.recipe.target.aspect);
assert.equal(again.engineVersion, plan.recipe.engineVersion);

const meta = normalizeEnhancementMeta({
  provider: "local_opencv",
  mode: "flat",
  recipe: { kind: "flat", params: { ...plan.recipe, sourceCorners: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]], tone: { b: 1, c: 1, s: 1 }, sharpen: 0, bezel: 0.08, geometry: plan.recipe } },
  confidence: 1,
  sourceHashSha256: "a".repeat(64),
  processedAtIso: "2026-10-03T00:00:00.000Z",
  latencyMs: 1,
  versions: { schema: 2, engine: plan.recipe.engineVersion },
});
assert.ok(meta && meta.recipe.kind === "flat" && meta.recipe.params.geometry);
assert.equal(meta!.recipe.kind === "flat" && meta!.recipe.params.geometry?.method, plan.recipe.method);
const round = normalizeEnhancementMeta(JSON.parse(JSON.stringify(meta)));
assert.equal(
  round && round.recipe.kind === "flat" && round.recipe.params.geometry?.status,
  plan.recipe.status,
);

const broken = normalizeEnhancementMeta({
  provider: "local_opencv",
  mode: "flat",
  recipe: {
    kind: "flat",
    params: {
      sourceCorners: null,
      tone: { b: 1, c: 1, s: 1 },
      sharpen: 0,
      bezel: 0.08,
      geometry: { ...plan.recipe, radial: { ...(plan.recipe.radial ?? { cx: 1, cy: 1, scale: 1, k1: 0, k2: 0, model: "residual-polynomial-v1" }), k1: Number.NaN } },
    },
  },
  confidence: 1,
  sourceHashSha256: "b".repeat(64),
  processedAtIso: "2026-10-03T00:00:00.000Z",
  latencyMs: 1,
  versions: { schema: 2, engine: "geometry-radial-v1" },
});
assert.equal(broken, null);

const preset = parseEnhanceSessionPreset({
  inputType: "enhance",
  intensity: "normal",
  edgeCurvature: "off",
  k1: 0.4,
  corners: [[0, 0]],
});
assert.equal(preset?.edgeCurvature, "off");
assert.equal((preset as { k1?: number } | null)?.k1, undefined);

const other = planArtworkRectification({
  raster: { data, width: w, height: h },
  corners,
  frame: fullFrame(w, h),
  mode: "auto",
  aspectSource: "estimated",
  longEdge: w,
});
assert.notEqual(other.recipe.radial?.k1, 0.4);

console.log("geometryReplay.test.ts: ok");
