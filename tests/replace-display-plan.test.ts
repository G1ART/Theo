import assert from "node:assert/strict";
import { planDisplayReplacement } from "../src/lib/image/replaceDisplayPlan";

const first = planDisplayReplacement(
  { storage_path: "user/photo.webp", original_storage_path: null },
  "user/enhanced.webp",
);
assert.equal(first.original_storage_path, "user/photo.webp");
assert.equal(first.retire_storage_path, null);

const second = planDisplayReplacement(
  {
    storage_path: "user/enhanced.webp",
    original_storage_path: "user/original/photo.jpg",
  },
  "user/enhanced-2.webp",
);
assert.equal(second.original_storage_path, "user/original/photo.jpg");
assert.equal(second.retire_storage_path, "user/enhanced.webp");

console.log("replace-display-plan.test.ts: ok");
