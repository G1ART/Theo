/**
 * Bulk ingest creates one cover per photo. A detail child exists only
 * when the artist adds a file to that work. The bbox cutout must not
 * run on its own and show up as a Detail shot.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

const bulk = read("src/app/upload/bulk/page.tsx");
const card = read("src/components/upload/BulkDraftCard.tsx");

assert.equal(bulk.includes("runVisionBboxCrop"), false, "bulk ingest must not auto-crop a child image");
assert.equal(bulk.includes("cutoutClient"), false, "bulk ingest must not import the cutout client");
assert.equal(bulk.includes('viewType: "detail"'), false, "bulk ingest must not tag a generated detail");
assert.equal(bulk.includes("bulk.pendingFiles"), false, "no filename holding pen");
assert.equal(bulk.includes("bulk.startUpload"), false, "no upload-(n) button that only promotes files");
assert.match(bulk, /void startUploadRef\.current\(\)/, "dropped photos start the draft cards themselves");
assert.match(bulk, /appendArtworkDetailImages/, "user-added files are still the detail path");

const ingest = bulk.slice(bulk.indexOf("async function startUpload"), bulk.indexOf("function orderedImages"));
assert.equal(ingest.includes("detail"), false, "startUpload must not create a detail child");

assert.match(card, /view !== "cutout" && view !== "cutout_alpha"/);
assert.equal(card.includes('t("bulk.cardUpload")'), false);

console.log("bulk-no-auto-detail.test.ts: ok");
