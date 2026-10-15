// Profile entry scroll, and the freeze pane's name/tab click target.
// Feed logo / For you / refresh rules are not part of this table.

import assert from "node:assert/strict";
import {
  decideProfileScroll,
  isProfileReturnHref,
  isProfileScrollPath,
  profileArmRelease,
  profileChromeScrollTarget,
  profileListTopScrollY,
  profilePathname,
  profileScrollKeyFromHref,
  profileTabStickOffset,
} from "../src/lib/profile/scrollRestore";

assert.equal(isProfileScrollPath("/u/heimyunghyun"), true);
assert.equal(isProfileScrollPath("/u/heimyunghyun?tab=all"), true);
assert.equal(isProfileScrollPath("/u/"), false);
assert.equal(isProfileScrollPath("/feed"), false);
assert.equal(isProfileScrollPath("/my"), false);
assert.equal(isProfileScrollPath("/artwork/abc"), false);

assert.equal(profileScrollKeyFromHref("/u/heimyunghyun?tab=CREATED"), "/u/heimyunghyun?tab=CREATED");
assert.equal(profileScrollKeyFromHref("/u/heimyunghyun?tab=all#works"), "/u/heimyunghyun?tab=all");
assert.equal(profileScrollKeyFromHref("/feed?tab=all"), null);
assert.equal(profileScrollKeyFromHref("https://example.com/u/heimyunghyun"), null);
assert.equal(isProfileReturnHref("/u/heimyunghyun"), true);
assert.equal(isProfileReturnHref("/feed"), false);

assert.equal(profilePathname("/u/heimyunghyun?tab=exhibitions"), "/u/heimyunghyun");

assert.equal(profileArmRelease("/u/heimyunghyun"), "keep");
assert.equal(profileArmRelease("/artwork/abc"), "hold");
assert.equal(profileArmRelease("/e/show"), "hold");
assert.equal(profileArmRelease("/feed"), "disarm");
assert.equal(profileArmRelease("/my"), "disarm");

const key = "/u/heimyunghyun?tab=all";

assert.equal(
  decideProfileScroll({
    currentKey: key,
    armedKey: key,
    popped: false,
    reload: false,
    hasSnapshot: true,
  }),
  "restore",
  "the profile link is a push, so the arm alone restores"
);

assert.equal(
  decideProfileScroll({
    currentKey: key,
    armedKey: null,
    popped: true,
    reload: false,
    hasSnapshot: true,
  }),
  "restore",
  "browser Back restores when a snapshot exists"
);

assert.equal(
  decideProfileScroll({
    currentKey: key,
    armedKey: null,
    popped: false,
    reload: false,
    hasSnapshot: true,
  }),
  "fresh",
  "opening the profile from the feed starts at the top"
);

assert.equal(
  decideProfileScroll({
    currentKey: key,
    armedKey: key,
    popped: true,
    reload: true,
    hasSnapshot: true,
  }),
  "reload"
);

assert.equal(
  decideProfileScroll({
    currentKey: key,
    armedKey: "/u/other",
    popped: false,
    reload: false,
    hasSnapshot: true,
  }),
  "fresh",
  "another profile's arm does not move this page"
);

assert.equal(
  decideProfileScroll({
    currentKey: "/feed",
    armedKey: key,
    popped: true,
    reload: false,
    hasSnapshot: true,
  }),
  "fresh"
);

assert.equal(profileChromeScrollTarget("name"), "tab-list-top");
assert.equal(profileChromeScrollTarget("current-tab"), "tab-list-top");
assert.equal(profileChromeScrollTarget("other-tab"), "tab-list-top");

assert.equal(profileTabStickOffset(56, 80), 136);
assert.equal(profileTabStickOffset(0, 80), 80, "desktop shell has no top header");
assert.equal(profileTabStickOffset(-4, -2), 0);

assert.equal(
  profileListTopScrollY({ tabBarViewportTop: 500, windowScrollY: 0, stickOffset: 136 }),
  364
);
assert.equal(
  profileListTopScrollY({ tabBarViewportTop: 136, windowScrollY: 364, stickOffset: 136 }),
  364,
  "already at the list top"
);
assert.equal(
  profileListTopScrollY({ tabBarViewportTop: -800, windowScrollY: 2000, stickOffset: 136 }),
  1064
);
assert.equal(
  profileListTopScrollY({ tabBarViewportTop: 10, windowScrollY: 0, stickOffset: 136 }),
  0
);

console.log("profile-scroll-restore.test.ts: ok");
