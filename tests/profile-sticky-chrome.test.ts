// The profile name and artwork tabs are one opaque sticky bar.
// Two sticky tops, and a scroll listener that retargets them, shake and
// let thumbnails show through the gap.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/components/UserProfileContent.tsx"), "utf8");

const stickyOpens = src.match(/className=\{`sticky /g) ?? [];
assert.equal(stickyOpens.length, 1, "name and tabs share one sticky bar");

assert.match(src, /data-profile-freeze="chrome"/);
assert.match(src, /data-profile-freeze="name"/);
assert.match(src, /data-profile-freeze="tabs"/);
assert.match(src, /backgroundColor: "var\(--background\)"/);

const chromeAt = src.indexOf('data-profile-freeze="chrome"');
const nameAt = src.indexOf('data-profile-freeze="name"');
const tabsAt = src.indexOf('data-profile-freeze="tabs"');
const listAt = src.indexOf('data-profile-list-top=""');
assert.ok(chromeAt !== -1 && nameAt > chromeAt && tabsAt > nameAt, "name and tabs sit inside the bar");
assert.ok(listAt > tabsAt, "the artwork list starts after the bar");

assert.equal(src.includes("namePinned"), false, "scroll no longer toggles a border on the bar");
assert.equal(src.includes("headerOffset + nameRowHeight"), false, "the tab row does not get its own sticky top");
assert.equal(src.includes('addEventListener("scroll"'), false, "the bar is not moved from a scroll listener");
assert.match(
  src,
  /profileTabStickOffset\(\s*measureProfileHeaderOffset\(\),\s*chromeRef\.current\?\.offsetHeight/,
  "clicking the name or a tab measures the one bar",
);

console.log("profile-sticky-chrome.test.ts: ok");
