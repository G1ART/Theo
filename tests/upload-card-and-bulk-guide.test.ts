/**
 * Bulk card chrome and the several-works guide.
 * The ? next to 여러 점 explains the mode. The drop area explains files.
 * Those two texts do not repeat each other.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { messages } from "../src/lib/i18n/messages";
import { fittedPhotoBox } from "../src/lib/upload/fittedPhotoBox";
import { nextBulkSelection } from "../src/lib/upload/bulkSelection";
import {
  UPLOAD_MAX_COMPRESSIBLE_MB_LABEL,
  UPLOAD_MAX_IMAGE_MB_LABEL,
} from "../src/lib/upload/limits";
import { COMPRESS_DEFAULT_LONG_EDGE } from "../src/lib/image/compress";

const root = join(__dirname, "..");
function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

const portrait = fittedPhotoBox(400, 800, 144, 64);
assert.equal(portrait.height, 64);
assert.ok(portrait.width < 144);
assert.ok(Math.abs(portrait.width / portrait.height - 0.5) < 1e-9);

const landscape = fittedPhotoBox(800, 400, 144, 64);
assert.ok(landscape.width <= 144);
assert.ok(landscape.height <= 64);
assert.ok(landscape.width === 144 || landscape.height === 64);
assert.ok(Math.abs(landscape.width / landscape.height - 2) < 1e-9);

const wide = fittedPhotoBox(1600, 400, 144, 64);
assert.equal(wide.width, 144);
assert.ok(wide.height < 64);
assert.ok(Math.abs(wide.width / wide.height - 4) < 1e-9);

assert.deepEqual(fittedPhotoBox(0, 10, 10, 10), { width: 0, height: 0 });
assert.deepEqual(fittedPhotoBox(10, 10, 0, 10), { width: 0, height: 0 });

assert.deepEqual([...nextBulkSelection(["a", "b"], new Set())], ["a", "b"]);
assert.deepEqual([...nextBulkSelection(["a", "b"], new Set(["a"]))], ["a", "b"]);
assert.deepEqual([...nextBulkSelection(["a", "b"], new Set(["a", "b"]))], []);
assert.deepEqual([...nextBulkSelection(["a", "b"], new Set(["a", "b", "stale"]))], []);
assert.deepEqual([...nextBulkSelection([], new Set())], []);

const en = messages.en;
const ko = messages.ko;

assert.equal(en["upload.fieldRequired"], "This field is required");
assert.equal(ko["upload.fieldRequired"], "필수 항목입니다");
assert.equal(en["bulk.selectAll"], "Select All");
assert.equal(ko["bulk.selectAll"], "전체 선택");

const enHelp = en["upload.modeBulkHelp"];
const koHelp = ko["upload.modeBulkHelp"];
assert.match(koHelp, /한 점/);
assert.match(koHelp, /작품/);
assert.equal(koHelp.includes("Bulk"), false);
assert.equal(koHelp.includes("JPG"), false);
assert.equal(koHelp.includes("MB"), false);
assert.equal(koHelp.includes("게시"), false);
assert.equal(enHelp.includes("JPG"), false);
assert.equal(enHelp.includes("MB"), false);
assert.equal(/publish/i.test(enHelp), false);
assert.match(enHelp, /series/i);

for (const line of [
  en["bulk.dropLine1"],
  en["bulk.dropRules"],
  en["bulk.dropFit"],
  en["bulk.dropAfter"],
  en["bulk.publishWhere"],
  ko["bulk.dropLine1"],
  ko["bulk.dropRules"],
  ko["bulk.dropFit"],
  ko["bulk.dropAfter"],
  ko["bulk.publishWhere"],
]) {
  assert.notEqual(line, enHelp);
  assert.notEqual(line, koHelp);
}

assert.match(en["bulk.dropRules"], /\{jpgMb\}/);
assert.match(en["bulk.dropRules"], /\{gifMb\}/);
assert.match(ko["bulk.dropRules"], /\{jpgMb\}/);
assert.match(en["bulk.dropFit"], /\{edge\}/);
assert.match(en["bulk.dropFit"], /\{displayMb\}/);
assert.match(ko["bulk.dropAfter"], /공통 정보/);
assert.match(ko["bulk.dropAfter"], /작품/);
assert.equal(ko["bulk.publishWhere"], "게시 버튼은 각 작품 카드에 있습니다.");
assert.equal(en["bulk.publishWhere"], "Publish is on each work card.");
assert.equal(ko["bulk.publishWhere"].includes(koHelp), false);
assert.equal(UPLOAD_MAX_COMPRESSIBLE_MB_LABEL, 200);
assert.equal(UPLOAD_MAX_IMAGE_MB_LABEL, 50);
assert.equal(COMPRESS_DEFAULT_LONG_EDGE, 4096);

const layout = read("src/app/upload/layout.tsx");
const helpAt = layout.indexOf("upload.modeBulkHelp");
const helpBlock = layout.slice(helpAt, helpAt + 700);
assert.ok(helpAt > 0);
assert.match(helpBlock, /upload\.modeBulkHelp/);
assert.equal(helpBlock.includes("bulk.dropLine1"), false);
assert.equal(helpBlock.includes("bulk.dropLine2"), false);
assert.equal(helpBlock.includes("bulk.publishWhere"), false);

const bulk = read("src/app/upload/bulk/page.tsx");
const dropAt = bulk.indexOf('id="bulk-file-input"');
const drop = bulk.slice(dropAt, dropAt + 1800);
assert.match(drop, /bulk\.dropRules/);
assert.match(drop, /bulk\.dropFit/);
assert.match(drop, /bulk\.dropAfter/);
assert.match(drop, /bulk\.publishWhere/);
assert.match(drop, /UPLOAD_MAX_COMPRESSIBLE_MB_LABEL/);
assert.match(drop, /UPLOAD_MAX_IMAGE_MB_LABEL/);
assert.match(drop, /COMPRESS_DEFAULT_LONG_EDGE/);
assert.equal(drop.includes("bulk.dropLine2"), false);
assert.equal(drop.includes("upload.modeBulkHelp"), false);

const toolbar = bulk.slice(bulk.indexOf('id="upload-drafts"'), bulk.indexOf("sharedOpen &&"));
const selectAt = toolbar.indexOf('t("bulk.selectAll")');
const delSelAt = toolbar.indexOf('t("bulk.deleteSelected")');
const delAllAt = toolbar.indexOf('t("bulk.deleteAll")');
assert.ok(selectAt >= 0 && selectAt < delSelAt && delSelAt < delAllAt);
assert.match(bulk, /nextBulkSelection/);

const card = read("src/components/upload/BulkDraftCard.tsx");
const single = read("src/app/upload/single/page.tsx");
assert.equal(card.includes("bulk.statusBlocked"), false);
assert.equal(single.includes("bulk.statusBlocked"), false);
assert.match(card, /FieldRequiredNote/);
assert.match(single, /FieldRequiredNote/);
assert.match(card, /FittedDetailPhoto/);
assert.match(single, /FittedDetailPhoto/);
const frame = read("src/components/upload/FittedDetailPhoto.tsx");
assert.match(frame, /items-center justify-center/);
assert.match(frame, /fittedPhotoBox/);
assert.match(frame, /data-detail-readiness-bar/);
assert.equal(single.includes("upload.modeBulkHelp"), false);
assert.equal(single.includes("bulk.selectAll"), false);

const cover = card.slice(card.indexOf("w-28 shrink-0"), card.indexOf("min-w-0 flex-1"));
assert.equal(cover.includes("bulk.cardUpload"), false);
const singleCover = single.slice(single.indexOf("w-28 shrink-0"), single.indexOf("min-w-0 flex-1"));
assert.equal(singleCover.includes("bulk.cardUpload"), false);
assert.match(card, /t\("bulk\.cardUpload"\)/);
assert.match(single, /t\("bulk\.cardUpload"\)/);

console.log("upload-card-and-bulk-guide.test.ts: ok");
