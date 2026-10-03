import assert from "node:assert/strict";
import { boxAroundEllipse, prefersRoundCutout } from "../shapeRoute";
import type { EllipseFit } from "@/lib/image/enhancement/ellipse";

const round: EllipseFit = {
  center: [0.5, 0.28],
  major: 0.18,
  minor: 0.17,
  angle: 0.1,
  aspect: 0.18 / 0.17,
  confidence: 0.8,
};

assert.equal(prefersRoundCutout({ ellipse: round }), true);
assert.equal(prefersRoundCutout({ ellipse: { ...round, confidence: 0.4 } }), false);
assert.equal(prefersRoundCutout({ ellipse: { ...round, aspect: 2.2 } }), false);
assert.equal(prefersRoundCutout({ ellipse: null }), false);

const box = boxAroundEllipse(round);
assert.ok(box.x < round.center[0] && box.x + box.w > round.center[0]);
assert.ok(box.y < round.center[1] && box.y + box.h > round.center[1]);
assert.ok(box.w < 0.7);

console.log("shapeRoute.test.ts: ok");
