import assert from "node:assert/strict";
import { planCoverFileSwap, planDisplayReplacement } from "../src/lib/image/replaceDisplayPlan";
import { isCompressibleUpload } from "../src/lib/upload/compressibleFile";
import { getUploadCeilingBytes, UPLOAD_MAX_COMPRESSIBLE_BYTES, UPLOAD_MAX_IMAGE_BYTES } from "../src/lib/upload/limits";
import { imageSlotForEnhance, correctableArtworkImages } from "../src/lib/upload/enhanceFocus";
import { extraViewType, registrationViewLabelKey, registrationViewRole } from "../src/lib/upload/extraViewRoles";
import { registrationBilingualFields } from "../src/lib/upload/registrationCopy";

const phoneJpeg = { type: "", name: "IMG_2048.JPG", size: 18 * 1024 * 1024 } as File;

assert.equal(isCompressibleUpload(phoneJpeg), true);
assert.equal(getUploadCeilingBytes(phoneJpeg), UPLOAD_MAX_COMPRESSIBLE_BYTES);
assert.equal(
  getUploadCeilingBytes({ type: "image/heic", name: "photo.heic", size: 8 * 1024 * 1024 } as File),
  UPLOAD_MAX_IMAGE_BYTES,
);

assert.equal(extraViewType("wall_mounted"), "wall_mounted");
assert.equal(registrationViewRole("wall_mounted"), "full");
assert.equal(extraViewType("in_situ"), "in_situ");
assert.equal(registrationViewRole("in_situ"), "install");
assert.equal(extraViewType("detail"), "detail");
assert.equal(registrationViewRole("detail"), "detail");
assert.equal(extraViewType("angle"), "angle");
assert.equal(registrationViewRole("angle"), "other");
assert.equal(extraViewType("not-a-role"), "detail");
assert.equal(registrationViewLabelKey("wall_mounted"), "bulk.view.full");
assert.equal(registrationViewLabelKey("in_situ"), "bulk.view.inSitu");
assert.equal(registrationViewLabelKey("detail"), "bulk.view.detail");

const views = correctableArtworkImages([
  { storage_path: "cut.webp", view_type: "cutout", sort_order: 9 },
  { storage_path: "detail.webp", view_type: "detail", sort_order: 2 },
  { storage_path: "cover.webp", view_type: "wall_mounted", sort_order: 0 },
  { storage_path: "install.webp", view_type: "in_situ", sort_order: 1 },
]);
assert.deepEqual(
  views.map((img) => img.storage_path),
  ["cover.webp", "install.webp", "detail.webp"],
);
const child = imageSlotForEnhance(views, "detail.webp");
assert.equal(child.length, 1);
assert.equal(child[0]?.storage_path, "detail.webp");
assert.equal(imageSlotForEnhance(views, "cover.webp")[0]?.storage_path, "cover.webp");
assert.equal(imageSlotForEnhance(views, "other-work.webp").length, 0);
const childPlan = planDisplayReplacement(
  { storage_path: "detail.webp", original_storage_path: "detail-orig.jpg" },
  "detail-next.webp",
);
assert.equal(childPlan.original_storage_path, "detail-orig.jpg");
assert.equal(childPlan.retire_storage_path, "detail.webp");
assert.notEqual(childPlan.retire_storage_path, "cover.webp");

const saved = registrationBilingualFields({
  titleKo: "병풍",
  titleEn: "Folding screen",
  mediumKo: "한지에 먹",
  mediumEn: "ink on paper",
  storyKo: "전체와 디테일",
  storyEn: "The whole image and a detail",
});
assert.equal(saved.title, "병풍");
assert.equal(saved.title_ko, "병풍");
assert.equal(saved.title_en, "Folding screen");
assert.equal(saved.medium_ko, "한지에 먹");
assert.equal(saved.medium_en, "ink on paper");
assert.equal(saved.story_ko, "전체와 디테일");
assert.equal(saved.story_en, "The whole image and a detail");

const englishOnly = registrationBilingualFields({
  titleKo: "",
  titleEn: "Series",
  mediumKo: "",
  mediumEn: "oil",
  storyKo: "",
  storyEn: "A wide work",
});
assert.equal(englishOnly.title, "Series");
assert.equal(englishOnly.title_ko, null);
assert.equal(englishOnly.title_en, "Series");
assert.equal(englishOnly.story_ko, null);
assert.equal(englishOnly.story_en, "A wide work");

const swap = planCoverFileSwap({
  artworkId: "work-1",
  current: {
    storage_path: "user/cover.webp",
    original_storage_path: "user/original/cover.jpg",
  },
  nextStoragePath: "user/cover-2.webp",
});
assert.equal(swap.deleteArtwork, false);
assert.equal(swap.artworkId, "work-1");
assert.equal(swap.nextStoragePath, "user/cover-2.webp");
assert.equal(swap.original_storage_path, "user/original/cover.jpg");
assert.equal(swap.retire_storage_path, "user/cover.webp");

console.log("registration-artist-feedback: ok");
