// Finishing an upload keeps its destination, but the upload screen leaves
// history: Back from the profile (or artwork, or exhibition) is the screen
// the upload started from, not the finished wizard.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const single = read("src/app/upload/single/page.tsx");
const bulk = read("src/app/upload/bulk/page.tsx");
const layout = read("src/app/upload/layout.tsx");

for (const [name, src] of [
  ["single", single],
  ["bulk", bulk],
] as const) {
  assert.equal(src.includes("router.push("), false, `${name} upload must not push its destination`);
  assert.match(src, /leaveFormTo\(\{\s*router,\s*pathname: window\.location\.pathname,/, `${name} returns to the exhibition it came from`);
}
assert.match(single, /router\.replace\(\s*filedToTab \? profileReturnPath\(username, returnTab\) : `\/u\/\$\{username\}`/);
assert.match(single, /router\.replace\(artistPath\)/);
assert.match(single, /router\.replace\(`\/artwork\/\$\{artworkId\}`\)/);
assert.match(bulk, /router\.replace\(\s*filedToTab \? profileReturnPath\(username, searchParams\.get\("tab"\)\) : `\/u\/\$\{username\}`/);
assert.match(bulk, /router\.replace\(artistPath\)/);

// Upload tabs are modes of one screen.
assert.equal((layout.match(/\breplace\b\s*\n?\s*(data-tour|className)/g) ?? []).length >= 4, true);
assert.match(layout, /router\.replace\("\/upload#upload-drafts"\)/);

console.log("upload-finish-history.test.ts: ok");
