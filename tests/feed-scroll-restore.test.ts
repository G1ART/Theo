// Restore the feed session cache only when coming back from a detail.
// Reload, the logo, a feed tab, and any other "open the feed" control reset.

import assert from "node:assert/strict";
import { SNAPSHOT_PREFIX } from "../src/lib/feed/scrollSnapshot";
import {
  FEED_RELOAD_BOOT_SCRIPT,
  RESTORE_ARMED_KEY,
  arrivalForFeedMount,
  classifyFeedAnchor,
  feedScrollDecision,
  shouldReadFeedSessionCache,
  type FeedScrollArrival,
} from "../src/lib/feed/scrollRestore";

const arrivals: FeedScrollArrival[] = [
  "detail-back",
  "reload",
  "logo",
  "feed-tab",
  "open-feed",
];

for (const arrival of arrivals) {
  const first = feedScrollDecision(arrival);
  const second = feedScrollDecision(arrival);
  assert.equal(first, second, `${arrival} is a pure decision`);
  assert.equal(first, arrival === "detail-back" ? "restore" : "reset");
}

assert.equal(classifyFeedAnchor("/artwork/abc"), "detail");
assert.equal(classifyFeedAnchor("/e/show?from=feed"), "detail");
assert.equal(classifyFeedAnchor("/feed"), "open-feed");
assert.equal(classifyFeedAnchor("/feed?tab=all&sort=latest"), "open-feed");
assert.equal(classifyFeedAnchor("/feed?tab=artworks"), "open-feed");
assert.equal(classifyFeedAnchor("/u/someone"), "leave");
assert.equal(classifyFeedAnchor("/explore"), "leave");
assert.equal(classifyFeedAnchor("https://example.com/feed"), "ignore");

assert.equal(
  shouldReadFeedSessionCache({
    navigationType: "reload",
    documentPath: "/feed",
    reloadAlreadyConsumed: false,
    restoreArmed: true,
  }),
  false,
  "reloading /feed must not read the session cache"
);

assert.equal(
  arrivalForFeedMount({
    navigationType: "reload",
    documentPath: "/feed",
    reloadAlreadyConsumed: true,
    restoreArmed: true,
  }),
  "detail-back",
  "a later back in the same document still restores"
);

assert.equal(
  shouldReadFeedSessionCache({
    navigationType: "reload",
    documentPath: "/artwork/1",
    reloadAlreadyConsumed: false,
    restoreArmed: true,
  }),
  true,
  "refreshing the artwork, then Back to Feed, still restores"
);

assert.equal(
  shouldReadFeedSessionCache({
    navigationType: "back_forward",
    documentPath: "/feed",
    reloadAlreadyConsumed: false,
    restoreArmed: true,
  }),
  true
);

assert.equal(
  shouldReadFeedSessionCache({
    navigationType: "navigate",
    documentPath: "/feed",
    reloadAlreadyConsumed: false,
    restoreArmed: false,
  }),
  false,
  "logo and feed tabs disarm the cache before paint"
);

assert.ok(FEED_RELOAD_BOOT_SCRIPT.includes('e.type==="reload"'));
assert.ok(FEED_RELOAD_BOOT_SCRIPT.includes(JSON.stringify(RESTORE_ARMED_KEY)));
assert.ok(FEED_RELOAD_BOOT_SCRIPT.includes(JSON.stringify(SNAPSHOT_PREFIX)));
assert.equal(SNAPSHOT_PREFIX, "feed:snapshot:v1:");

console.log("feed-scroll-restore.test.ts: ok");
