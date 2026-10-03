import assert from "node:assert/strict";
import { uploadGaps } from "../src/lib/upload/readiness";

const ready = {
  title: "Untitled",
  year: 2024,
  medium: "oil",
  size: "30 × 40",
  pricingMode: "inquire" as const,
  imageCount: 1,
};

assert.deepEqual(uploadGaps(ready), []);
assert.deepEqual(
  uploadGaps({ ...ready, pricingMode: null }),
  [],
  "blank pricing uses the inquire default",
);
assert.deepEqual(uploadGaps({ ...ready, title: "  " }), ["title"]);
assert.deepEqual(uploadGaps({ ...ready, year: "" }), ["year"]);
assert.deepEqual(uploadGaps({ ...ready, medium: "" }), ["medium"]);
assert.deepEqual(uploadGaps({ ...ready, size: "" }), ["size"]);
assert.deepEqual(
  uploadGaps({ ...ready, size: "", sizeNotApplicable: true }),
  [],
  "not applicable clears the size gap without a new column",
);
assert.deepEqual(uploadGaps({ ...ready, imageCount: 0 }), ["image"]);
assert.deepEqual(
  uploadGaps({ ...ready, pricingMode: "fixed", priceAmount: "" }),
  ["price"],
);
assert.deepEqual(
  uploadGaps({ ...ready, pricingMode: "fixed", priceAmount: 12 }),
  [],
);

console.log("upload-readiness.test.ts: ok");
