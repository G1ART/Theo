import assert from "node:assert/strict";
import {
  artworkInPickerScope,
  artworkMatchesSearch,
  buildIlikeClauses,
  recordMatchesQuery,
} from "../src/lib/search/matchText";
import {
  latinToHangul,
  looseFold,
  reconstructedHangulName,
  romanizeRevised,
  romanizedSearchForms,
} from "../src/lib/search/romanize";

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

assert.equal(romanizeRevised("김현민"), "gimhyeonmin");
assert.equal(looseFold("hyeonmin"), looseFold("hyunmin"));
assert.equal(looseFold("jeong"), looseFold("jung"));
assert.equal(latinToHangul("hyeonmin"), "현민");
assert.equal(latinToHangul("hyunmin"), "현민");
assert.equal(latinToHangul("bom"), "봄");
assert.equal(reconstructedHangulName("Hyunmin Kim"), "김현민");
assert.equal(reconstructedHangulName("hyeonmin kim"), "김현민");
assert.equal(reconstructedHangulName("h kim"), null);
assert.ok(romanizedSearchForms("김현민").some((form) => form.includes("hyunmin")));

const onlyKorean = {
  profiles: {
    display_name: "김현민",
    display_name_ko: "김현민",
    display_name_en: null,
  },
};

assert.equal(artworkMatchesSearch("김현민", onlyKorean), true);
assert.equal(artworkMatchesSearch("Hyunmin Kim", onlyKorean), true);
assert.equal(artworkMatchesSearch("hyeonmin kim", onlyKorean), true);
assert.equal(artworkMatchesSearch("h kim", onlyKorean), true);
assert.equal(
  artworkMatchesSearch("h kim", { profiles: { display_name_en: "Hyunmin Kim" } }),
  true,
);
assert.equal(artworkMatchesSearch("h kim", { profiles: { display_name: "Hakim" } }), false);
assert.equal(artworkMatchesSearch("Kim Hyunmin", onlyKorean), true);
assert.equal(artworkMatchesSearch("Hyunmin Park", onlyKorean), false);
assert.equal(artworkMatchesSearch("h park", onlyKorean), false);
assert.equal(artworkMatchesSearch("hyunmin lee", onlyKorean), false);
assert.equal(
  artworkMatchesSearch("Hyunmin Kim", {
    profiles: { display_name: "김민수", display_name_ko: "김민수" },
  }),
  false,
);
assert.equal(
  artworkMatchesSearch("h kim", {
    profiles: { display_name: "김민수", display_name_ko: "김민수" },
  }),
  false,
);
assert.equal(
  artworkMatchesSearch("h kim", {
    profiles: { display_name: "박현민", display_name_ko: "박현민" },
  }),
  false,
);
assert.equal(
  artworkMatchesSearch("h park", {
    profiles: { display_name: "박현민", display_name_ko: "박현민" },
  }),
  true,
);
assert.equal(
  artworkMatchesSearch("김현민", {
    profiles: { display_name_en: "Hyunmin Kim", display_name: "Hyunmin Kim" },
  }),
  true,
);
assert.equal(artworkMatchesSearch("bom", { title: "봄" }), true);
assert.equal(artworkMatchesSearch("봄", { title_en: "Bom" }), true);

const hyunminClauses = buildIlikeClauses("Hyunmin Kim", [
  "display_name",
  "display_name_ko",
  "display_name_en",
]);
assert.ok(hyunminClauses && hyunminClauses.length >= 2);
assert.ok(hyunminClauses?.some((clause) => clause.includes("현민") || clause.includes("김현민")));
assert.ok(hyunminClauses?.some((clause) => clause.includes("김")));

const initialClauses = buildIlikeClauses("h kim", [
  "username",
  "display_name",
  "display_name_ko",
  "display_name_en",
]);
assert.equal(initialClauses?.length, 1);
assert.ok(initialClauses?.[0]?.includes("김현"));
assert.ok(initialClauses?.[0]?.includes("h%kim"));
assert.equal(initialClauses?.[0]?.includes('username.ilike."%h%"'), false);

console.log("search-match.test.ts ok");
