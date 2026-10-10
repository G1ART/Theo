import assert from "node:assert/strict";
import {
  pickLocalizedArtworkTitle,
  pickLocalizedDisplayName,
  pickLocalizedMedium,
  pickLocalizedTitle,
} from "../src/lib/i18n/pickLocalized";

const title = {
  title: "빛이 머문 자리",
  title_ko: "빛이 머문 자리",
  title_en: "Where the Light lingers",
};
const medium = {
  medium: "Conte, Ink and pigment on Korean Mulberry paper",
  medium_ko: "한지에 콩테, 먹, 안료",
  medium_en: "Conte, Ink and pigment on Korean Mulberry paper",
};
const name = {
  display_name: "정은지",
  display_name_ko: "정은지",
  display_name_en: "Eunji Jeong",
};

assert.equal(pickLocalizedTitle(title, "ko"), "빛이 머문 자리");
assert.equal(pickLocalizedArtworkTitle(title, "ko"), "빛이 머문 자리");
assert.equal(pickLocalizedTitle(title, "en"), "Where the Light lingers");
assert.equal(pickLocalizedArtworkTitle(title, "en"), "Where the Light lingers");
assert.equal(
  pickLocalizedTitle({ ...title, title_en: "  " }, "en"),
  "빛이 머문 자리",
);
assert.equal(
  pickLocalizedTitle({ title: "legacy", title_ko: null, title_en: null }, "en"),
  "legacy",
);

assert.equal(pickLocalizedMedium(medium, "ko"), "한지에 콩테, 먹, 안료");
assert.equal(
  pickLocalizedMedium(medium, "en"),
  "Conte, Ink and pigment on Korean Mulberry paper",
);
assert.equal(
  pickLocalizedMedium({ ...medium, medium_en: null }, "en"),
  "한지에 콩테, 먹, 안료",
);
assert.equal(
  pickLocalizedMedium({ medium: "legacy medium", medium_ko: "", medium_en: "" }, "ko"),
  "legacy medium",
);

assert.equal(pickLocalizedDisplayName(name, "ko"), "정은지");
assert.equal(pickLocalizedDisplayName(name, "en"), "Eunji Jeong");
assert.equal(
  pickLocalizedDisplayName({ ...name, display_name_en: null }, "en"),
  "정은지",
);
assert.equal(
  pickLocalizedDisplayName(
    { display_name: "legacy name", display_name_ko: null, display_name_en: null },
    "ko",
  ),
  "legacy name",
);

console.log("locale-field-pick.test.ts: ok");
