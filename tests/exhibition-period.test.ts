// A linked exhibition's status is the work's period. No exhibition means no period.

import assert from "node:assert/strict";
import {
  claimPeriodFromExhibitionStatus,
  claimPeriodFromKnownExhibition,
} from "../src/lib/upload/exhibitionPeriod";

assert.equal(claimPeriodFromExhibitionStatus("ended"), "past");
assert.equal(claimPeriodFromExhibitionStatus("live"), "current");
assert.equal(claimPeriodFromExhibitionStatus("planned"), "future");
assert.equal(claimPeriodFromExhibitionStatus(null), null);
assert.equal(claimPeriodFromExhibitionStatus("draft"), null);
assert.equal(claimPeriodFromExhibitionStatus(""), null);

const known = [
  { id: "show-live", status: "live" },
  { id: "show-ended", status: "ended" },
];
assert.equal(claimPeriodFromKnownExhibition("", known), null);
assert.equal(claimPeriodFromKnownExhibition("missing", known), null);
assert.equal(claimPeriodFromKnownExhibition("show-live", known), "current");
assert.equal(claimPeriodFromKnownExhibition("show-ended", known), "past");

console.log("exhibition-period.test.ts: ok");
