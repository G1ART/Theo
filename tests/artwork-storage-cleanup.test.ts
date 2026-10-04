/**
 * Deleting a draft must remove the display file and the original backup.
 * A failed attach must remove the object just uploaded and the empty draft.
 * Storage is mocked. This test does not call Supabase.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cascadeDeleteStoragePaths,
  cleanupFailedAttach,
  isBulkDraftDeleteTarget,
  removeCascadeStorage,
} from "../src/lib/supabase/artworkStorageCleanup";

(async () => {
const images = [
  {
    storage_path: "user/cover.webp",
    original_storage_path: "user/original/cover.jpg",
  },
  {
    storage_path: "user/detail.webp",
    original_storage_path: "user/original/detail.jpg",
  },
];

const listed = cascadeDeleteStoragePaths(images);
assert.deepEqual(listed.displayPaths, ["user/cover.webp", "user/detail.webp"]);
assert.ok(listed.originalPaths.includes("user/original/cover.jpg"));
assert.ok(listed.originalPaths.includes("user/original/detail.jpg"));
assert.equal(listed.originalPaths.length, 2);

{
  const calls: string[][] = [];
  const result = await removeCascadeStorage(images, async (paths) => {
    calls.push([...paths]);
    if (calls.length === 1) return { error: new Error("display remove failed") };
    return { error: null };
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["user/cover.webp", "user/detail.webp"]);
  assert.deepEqual(calls[1], ["user/original/cover.jpg", "user/original/detail.jpg"]);
  assert.equal((result.error as Error).message, "display remove failed");
}

{
  const calls: string[][] = [];
  await removeCascadeStorage(
    [{ storage_path: "user/same.jpg", original_storage_path: "user/same.jpg" }],
    async (paths) => {
      calls.push([...paths]);
      throw new Error("display remove threw");
    },
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ["user/same.jpg"]);
}

{
  const removed: string[] = [];
  const deleted: string[] = [];
  const result = await cleanupFailedAttach({
    displayPath: "user/disp.webp",
    originalPath: "user/original/photo.jpg",
    draftId: "draft-9",
    deleteEmptyDraft: true,
    removeFile: async (path) => {
      if (path === "user/disp.webp") throw new Error("display remove failed");
      removed.push(path);
    },
    deleteDraft: async (id) => {
      deleted.push(id);
    },
  });
  assert.deepEqual(removed, ["user/original/photo.jpg"]);
  assert.deepEqual(deleted, ["draft-9"]);
  assert.equal((result.storageError as Error).message, "display remove failed");
}

{
  const removed: string[] = [];
  let deleted = false;
  await cleanupFailedAttach({
    displayPath: "user/disp.webp",
    originalPath: "user/original/photo.jpg",
    draftId: "live-draft",
    deleteEmptyDraft: false,
    removeFile: async (path) => {
      removed.push(path);
    },
    deleteDraft: async () => {
      deleted = true;
    },
  });
  assert.deepEqual(removed, ["user/disp.webp", "user/original/photo.jpg"]);
  assert.equal(deleted, false);
}

assert.equal(isBulkDraftDeleteTarget("draft"), true);
assert.equal(isBulkDraftDeleteTarget("public"), false);
assert.equal(isBulkDraftDeleteTarget(null), false);
assert.equal(isBulkDraftDeleteTarget(undefined), false);

const root = join(__dirname, "..");
const artworks = readFileSync(join(root, "src/lib/supabase/artworks.ts"), "utf8");
const cascade = artworks.slice(
  artworks.indexOf("export async function deleteArtworkCascade"),
  artworks.indexOf("const CONCURRENCY"),
);
assert.match(cascade, /original_storage_path/);
assert.match(cascade, /removeCascadeStorage/);

const draftDelete = artworks.slice(
  artworks.indexOf("export async function deleteDraftArtworks"),
  artworks.indexOf("export type DraftArtworkPayload"),
);
assert.match(draftDelete, /isBulkDraftDeleteTarget/);

const bulk = readFileSync(join(root, "src/app/upload/bulk/page.tsx"), "utf8");
const startUpload = bulk.slice(
  bulk.indexOf("async function startUpload"),
  bulk.indexOf("function orderedImages"),
);
assert.match(startUpload, /cleanupFailedAttach/);
assert.match(startUpload, /if \(!imageAttached\)/);
assert.equal(startUpload.includes("detail"), false);

const detailAppend = artworks.slice(
  artworks.indexOf("export async function appendArtworkDetailImages"),
  artworks.indexOf("export async function mergeDraftImagesInto"),
);
assert.match(detailAppend, /cleanupFailedAttach/);
assert.match(detailAppend, /deleteEmptyDraft: false/);

console.log("artwork-storage-cleanup.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
