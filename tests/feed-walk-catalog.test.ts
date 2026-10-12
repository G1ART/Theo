import assert from "node:assert/strict";
import {
  CATALOG_BATCH,
  CATALOG_WANT,
  catalogPageFromBatches,
  MAIN_FEED_WORK_KINDS,
} from "../src/lib/feed/walk/catalog";

function rows(ids: string[]) {
  return ids.map((id) => ({ id }));
}

function testKindsStayOffGoodsAndCollected() {
  assert.deepEqual([...MAIN_FEED_WORK_KINDS], ["artwork", "print_edition"]);
  assert.equal(MAIN_FEED_WORK_KINDS.includes("art_goods" as "artwork"), false);
  assert.equal(MAIN_FEED_WORK_KINDS.includes("collected" as "artwork"), false);
}

function testOpenWhileUnseenWorksRemainPastThisPage() {
  const batch = rows(Array.from({ length: CATALOG_BATCH }, (_, index) => `w${index}`));
  const page = catalogPageFromBatches([batch], new Set(), CATALOG_WANT, CATALOG_BATCH);
  assert.equal(page.rows.length, CATALOG_WANT);
  assert.equal(page.open, true);
  assert.equal(page.rows[0]?.id, "w0");
  assert.equal(page.rows[CATALOG_WANT - 1]?.id, `w${CATALOG_WANT - 1}`);
}

function testSkipsShownIdsAndStopsWhenTheTableEnds() {
  const used = new Set(["w0", "w1", "w2"]);
  const page = catalogPageFromBatches([rows(["w0", "w1", "w2", "w3", "w4"])], used, CATALOG_WANT, CATALOG_BATCH);
  assert.deepEqual(
    page.rows.map((row) => row.id),
    ["w3", "w4"]
  );
  assert.equal(page.open, false);
}

function testClosedWhenEveryRemainingIdWasShown() {
  const used = new Set(["w0", "w1", "w2"]);
  const page = catalogPageFromBatches([rows(["w0", "w1", "w2"])], used, CATALOG_WANT, CATALOG_BATCH);
  assert.equal(page.rows.length, 0);
  assert.equal(page.open, false);
}

function testNextBatchIsOpenWhenThisBatchIsFullOfShownIds() {
  const shown = rows(Array.from({ length: CATALOG_BATCH }, (_, index) => `old${index}`));
  const more = rows(["new0"]);
  const used = new Set(shown.map((row) => row.id));
  const midway = catalogPageFromBatches([shown], used, CATALOG_WANT, CATALOG_BATCH);
  assert.equal(midway.rows.length, 0);
  assert.equal(midway.open, true);
  const done = catalogPageFromBatches([shown, more], used, CATALOG_WANT, CATALOG_BATCH);
  assert.deepEqual(
    done.rows.map((row) => row.id),
    ["new0"]
  );
  assert.equal(done.open, false);
}

testKindsStayOffGoodsAndCollected();
testOpenWhileUnseenWorksRemainPastThisPage();
testSkipsShownIdsAndStopsWhenTheTableEnds();
testClosedWhenEveryRemainingIdWasShown();
testNextBatchIsOpenWhenThisBatchIsFullOfShownIds();

console.log("feed-walk-catalog: ok");
