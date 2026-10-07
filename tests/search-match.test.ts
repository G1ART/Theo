import assert from "node:assert/strict";
import {
  artworkInPickerScope,
  artworkMatchesSearch,
  buildIlikeClauses,
  recordMatchesQuery,
} from "../src/lib/search/matchText";

const cheerry = {
  title: "Cheerry Blossom 0910",
  title_ko: "Cheerry Blossom 0910",
  profiles: {
    username: "heimyunghyun",
    display_name: "현혜명",
    display_name_ko: "현혜명",
    display_name_en: "Hei Myung Hyun",
  },
};

assert.equal(artworkMatchesSearch("현혜명", cheerry), true);
assert.equal(artworkMatchesSearch("Hei Myung Hyun", cheerry), true);
assert.equal(artworkMatchesSearch("@heimyunghyun", cheerry), true);
assert.equal(artworkMatchesSearch("Cheery Blossom", cheerry), true);
assert.equal(artworkMatchesSearch("cheerry blossom", cheerry), true);
assert.equal(artworkMatchesSearch("현혜명 벚꽃", cheerry), true);
assert.equal(
  artworkMatchesSearch("the green", {
    title: "Untitled",
    profiles: {
      username: "thegreen_oc",
      display_name: "The GREEN",
      display_name_en: "The GREEN",
    },
  }),
  true,
);

assert.equal(
  artworkMatchesSearch("현혜명 벚꽃", {
    title: "Cheerry Blossom 0910",
    profiles: { display_name: "다른 작가", username: "someone" },
  }),
  false,
);
assert.equal(recordMatchesQuery("cheery", ["Ocean Wave"]), false);

assert.equal(
  artworkInPickerScope(
    { visibility: "draft", artistId: "other", createdBy: "other" },
    "me",
  ),
  false,
);
assert.equal(
  artworkInPickerScope(
    { visibility: "draft", artistId: "me", createdBy: "gallery" },
    "me",
  ),
  true,
);
assert.equal(
  artworkInPickerScope(
    { visibility: "draft", artistId: "artist", createdBy: "me" },
    "me",
  ),
  true,
);
assert.equal(
  artworkInPickerScope(
    { visibility: "public", artistId: "other", createdBy: "other" },
    "me",
  ),
  true,
);
assert.equal(
  artworkInPickerScope(
    { visibility: "draft", artistId: "other", createdBy: "other" },
    null,
  ),
  false,
);

const clauses = buildIlikeClauses("현혜명", [
  "username",
  "display_name",
  "display_name_ko",
  "display_name_en",
]);
assert.equal(clauses?.length, 1);
assert.ok(clauses?.[0]?.includes('display_name_ko.ilike."%현혜명%"'));
assert.equal(buildIlikeClauses("%,()", ["username"]), null);

console.log("search-match.test.ts ok");
