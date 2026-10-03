/**
 * Upload must not call the artwork quality gate, and a new file must
 * still ask gpt-5.6-sol for rectangle corners without waiting on that
 * gate.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

const editor = read("src/components/upload/ImageStandardizeEditor.tsx");
const bulk = read("src/app/upload/bulk/page.tsx");
const single = read("src/app/upload/single/page.tsx");
const dialog = read("src/components/upload/BulkEnhanceDialog.tsx");

for (const [name, src] of [
  ["editor", editor],
  ["bulk", bulk],
  ["single", single],
  ["dialog", dialog],
] as const) {
  assert.equal(src.includes("artworkQualityGate"), false, `${name} must not call the quality gate`);
  assert.equal(src.includes("gateBlocked"), false, `${name} must not block on a quality verdict`);
}

assert.match(editor, /void detectArtworkQuad\(file\)/);
assert.match(editor, /setBoundaryMode\("quad"\)/);
assert.match(editor, /silhouetteFileRef\.current = null/);
assert.match(bulk, /await detectArtworkQuad\(file\)/);
assert.equal(bulk.includes("requestObjectEnhancement"), false);
assert.match(single, /key=\{`\$\{img\.id\}-\$\{img\.file\.name\}/);
assert.match(dialog, /file\.name\}-\$\{file\.size\}-\$\{file\.lastModified\}/);

const detect = editor.slice(
  editor.indexOf("Every file starts on rectangle corners"),
  editor.indexOf("const handleEnhanceApprove"),
);
assert.match(detect, /detectArtworkQuad\(file\)/);
assert.equal(detect.includes("qualityGate"), false);
assert.equal(detect.includes("gateBlocked"), false);

console.log("upload-no-quality-gate.test.ts: ok");
