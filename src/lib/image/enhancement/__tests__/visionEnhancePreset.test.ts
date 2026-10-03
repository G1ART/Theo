import assert from "node:assert/strict";
import type { Quad } from "../cornerPickerGeometry";
import { flatPresetFromVision } from "../visionEnhancePreset";

const corners: Quad = [
  [0.1, 0.12],
  [0.88, 0.1],
  [0.9, 0.86],
  [0.11, 0.9],
];

const original = flatPresetFromVision({
  corners,
  look: { colorMode: "original", intensity: "light", noteKo: "a", noteEn: "b" },
});
assert.equal(original.sourceCorners, corners);
assert.equal(original.proLook, undefined);
assert.equal(original.awb, undefined);
assert.ok(original.tone && original.tone.b > 1 && original.tone.b < 1.03);
assert.ok(original.tone.s > 1 && original.tone.s < 1.04);

const enhance = flatPresetFromVision({
  corners: null,
  look: { colorMode: "enhance", intensity: "normal", noteKo: "", noteEn: "" },
});
assert.equal(enhance.sourceCorners, undefined);
assert.equal(enhance.awb?.enabled, true);
assert.equal(enhance.awb?.strength, 0.5);
assert.equal(enhance.proLook?.enabled, true);

const strong = flatPresetFromVision({
  corners: null,
  look: { colorMode: "enhance", intensity: "strong", noteKo: "", noteEn: "" },
});
assert.equal(strong.awb?.strength, 0.7);

assert.deepEqual(flatPresetFromVision(null), {});

console.log("visionEnhancePreset.test.ts: ok");
