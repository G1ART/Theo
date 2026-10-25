import assert from "node:assert/strict";
import { classifySearchIntent, exactNameToken, orderArtworkIds } from "../src/lib/search/searchIntent";

const hye = {
  id: "hye",
  username: "heimyunghyun",
  display_name: "현혜명",
  display_name_ko: "현혜명",
  display_name_en: "Hyun Hye Myung",
};

assert.equal(exactNameToken("현혜명", hye), true);
assert.equal(exactNameToken("@heimyunghyun", hye), true);
assert.equal(exactNameToken("Hyun Hye Myung", hye), true);
assert.equal(exactNameToken("벚꽃", hye), false);

assert.deepEqual(classifySearchIntent("현혜명", [hye]), { intent: "person", personId: "hye" });
assert.deepEqual(classifySearchIntent("현혜명 벚꽃", [hye]), { intent: "person-work", personId: "hye" });
assert.deepEqual(classifySearchIntent("유화", [hye]), { intent: "work", personId: null });
assert.deepEqual(classifySearchIntent("Hope", []), { intent: "work", personId: null });

assert.deepEqual(
  orderArtworkIds(
    [
      { id: "other", artistId: "x" },
      { id: "hers", artistId: "hye" },
    ],
    "hye",
  ),
  ["hers", "other"],
);
assert.deepEqual(
  orderArtworkIds(
    [
      { id: "a", artistId: "x" },
      { id: "b", artistId: "y" },
    ],
    null,
  ),
  ["a", "b"],
);

console.log("search-intent.test.ts: ok");
