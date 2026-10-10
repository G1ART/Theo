/**
 * HH-26-106.jpg is a normal iPhone JPEG. Bulk upload must accept that
 * shape, and a draft-insert RLS failure must not be worded like every
 * other failure.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { messages } from "../src/lib/i18n/messages";
import { fileLooksLikeImage } from "../src/lib/supabase/bulkUpload";
import { isCompressibleUpload } from "../src/lib/upload/compressibleFile";
import {
  classifyUploadFailureMessage,
  formatBulkFileUploadFailure,
  formatSingleUploadFailure,
} from "../src/lib/upload/formatUploadError";
import { getUploadCeilingBytes } from "../src/lib/upload/limits";

const root = join(__dirname, "..");
const photo = {
  name: "HH-26-106.jpg",
  type: "image/jpeg",
  size: 753_266,
};

assert.equal(fileLooksLikeImage(photo), true);
assert.equal(fileLooksLikeImage({ name: "HH-26-106.jpg", type: "" }), true);
assert.equal(isCompressibleUpload(photo), true);
assert.ok(photo.size > 0);
assert.ok(photo.size < getUploadCeilingBytes(photo as File));

const compress = readFileSync(join(root, "src/lib/image/compress.ts"), "utf8");
assert.equal(compress.includes("display p3"), false);
assert.equal(compress.includes("color space"), false);
assert.equal(/min(?:Width|Height|LongEdge|Pixels)/i.test(compress), false);

const bulk = readFileSync(join(root, "src/app/upload/bulk/page.tsx"), "utf8");
const single = readFileSync(join(root, "src/app/upload/single/page.tsx"), "utf8");
assert.equal(bulk.includes("artworkQualityGate"), false);
assert.equal(single.includes("artworkQualityGate"), false);

const migration = readFileSync(
  join(root, "supabase/migrations/20261010205939_uploader_can_read_own_drafts.sql"),
  "utf8",
);
assert.match(migration, /artworks_select_created_by/);
assert.match(migration, /created_by = auth\.uid\(\)/);
assert.match(migration, /for select/);

const t = (key: string) => messages.en[key as keyof typeof messages.en] ?? key;
const rls = new Error('new row violates row-level security policy for table "artworks"');
const empty = new Error("empty file");
const other = new Error("attach failed: column view_type");

const rlsLine = formatBulkFileUploadFailure(photo.name, rls, t);
const emptyLine = formatBulkFileUploadFailure(photo.name, empty, t);
const otherLine = formatBulkFileUploadFailure(photo.name, other, t);
const blankLine = formatBulkFileUploadFailure(photo.name, new Error("   "), t);

assert.equal(classifyUploadFailureMessage(rls.message), "permission");
assert.equal(classifyUploadFailureMessage(empty.message), "empty");
assert.equal(classifyUploadFailureMessage("Failed to fetch"), "network");
assert.match(rlsLine, /can’t open a draft/);
assert.match(emptyLine, /empty/);
assert.match(otherLine, /column view_type/);
assert.notEqual(rlsLine, emptyLine);
assert.notEqual(rlsLine, otherLine);
assert.notEqual(emptyLine, otherLine);
assert.match(blankLine, /could not be uploaded/);
assert.doesNotMatch(blankLine, /\{reason\}/);

assert.match(formatSingleUploadFailure(rls, t), /can’t create that draft/);
assert.match(formatSingleUploadFailure(empty, t), /empty/);
assert.match(formatSingleUploadFailure(new Error("bearer eyJabc"), t), /Something went wrong/);

assert.ok(messages.ko["bulk.uploadFailedFilePermission"]);
assert.ok(messages.ko["bulk.uploadFailedFileEmpty"]);
assert.ok(messages.ko["bulk.uploadFailedFileDetail"]);
assert.notEqual(
  messages.ko["bulk.uploadFailedFilePermission"],
  messages.ko["bulk.uploadFailedFileGeneric"],
);

console.log("upload-failure-reason.test.ts: ok");
