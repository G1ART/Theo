// After delete, return to the screen that opened the artwork.
// In-app history goes back. Otherwise replace with that screen.
// Never the workspace, and never the deleted artwork URL.

import assert from "node:assert/strict";
import {
  ARTWORK_DELETE_FALLBACK,
  artworkDeleteNavigation,
} from "../src/lib/artworkBack";

assert.deepEqual(
  artworkDeleteNavigation({ historyIdx: 3, stampedPath: "/u/siennamko" }),
  { action: "back", path: "/u/siennamko" }
);

assert.deepEqual(
  artworkDeleteNavigation({ historyIdx: 2, stampedPath: "/feed?tab=foryou&sort=latest" }),
  { action: "back", path: "/feed?tab=foryou&sort=latest" }
);

assert.deepEqual(
  artworkDeleteNavigation({ historyIdx: 1, stampedPath: "/e/show" }),
  { action: "back", path: "/e/show" }
);

assert.deepEqual(
  artworkDeleteNavigation({ historyIdx: 0, stampedPath: "/u/jejeunji" }),
  { action: "replace", path: "/u/jejeunji" }
);

assert.deepEqual(
  artworkDeleteNavigation({ historyIdx: null, stampedPath: "/my/shortlists/1" }),
  { action: "replace", path: "/my/shortlists/1" }
);

assert.equal(
  artworkDeleteNavigation({ historyIdx: null, stampedPath: "/artwork/deleted" }).path,
  ARTWORK_DELETE_FALLBACK
);
assert.equal(
  artworkDeleteNavigation({ historyIdx: 4, stampedPath: "/artwork/other" }).path.startsWith("/artwork/"),
  false
);
assert.equal(
  artworkDeleteNavigation({ historyIdx: null, stampedPath: null }).path,
  ARTWORK_DELETE_FALLBACK
);
assert.equal(
  artworkDeleteNavigation({ historyIdx: null, stampedPath: "https://evil.example/feed" }).path,
  ARTWORK_DELETE_FALLBACK
);
assert.notEqual(
  artworkDeleteNavigation({ historyIdx: null, stampedPath: null }).path,
  "/my"
);
assert.notEqual(
  artworkDeleteNavigation({ historyIdx: null, stampedPath: null }).path,
  "/workspace"
);
// Signed-in feed home is For you; "all" is the whole public feed now.
assert.equal(ARTWORK_DELETE_FALLBACK, "/feed?tab=foryou&sort=latest");

console.log("artwork-delete-navigation.test.ts: ok");
