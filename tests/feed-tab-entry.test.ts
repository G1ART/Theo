// Feed tabs and the ways into the feed.
// Signed in: logo and Explore open For you; "all" is the whole public
// feed, not a second For you. A visitor's feed home is all.
// Login links keep the page they came from as `next`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { feedWalkLane, normalizeFeedTab } from "../src/lib/feed/feedTab";
import { PRIMARY_NAV, navItemHref } from "../src/lib/shell/navConfig";
import { DEFAULT_DESTINATION, PUBLIC_FEED_DESTINATION } from "../src/lib/identity/routing";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// Signed in.
assert.equal(normalizeFeedTab("all", true, true), "all");
assert.equal(normalizeFeedTab("foryou", true, true), "foryou");
assert.equal(normalizeFeedTab(null, true, true), "foryou");
assert.equal(normalizeFeedTab("following", true, true), "foryou");
assert.equal(normalizeFeedTab("artworks", true, true), "artworks");
assert.equal(normalizeFeedTab("bogus", true, true), "foryou");
assert.equal(feedWalkLane("all", "all", true), "public");
assert.equal(feedWalkLane("foryou", "foryou", true), "personalized");
assert.equal(feedWalkLane("foryou", "following", true), "following");

// Visitor.
assert.equal(normalizeFeedTab("all", false, true), "all");
assert.equal(normalizeFeedTab(null, false, true), "all");
assert.equal(normalizeFeedTab("foryou", false, true), "all");
assert.equal(normalizeFeedTab("following", false, true), "all");
assert.equal(feedWalkLane("all", "all", false), "public");

// Before the session is known the For you link is trusted (no "all" flash).
assert.equal(normalizeFeedTab("foryou", false, false), "foryou");

const explore = PRIMARY_NAV.find((item) => item.key === "explore");
assert.ok(explore);
assert.equal(navItemHref(explore, true), DEFAULT_DESTINATION);
assert.equal(navItemHref(explore, false), PUBLIC_FEED_DESTINATION);
const messages = PRIMARY_NAV.find((item) => item.key === "messages");
assert.ok(messages);
assert.equal(navItemHref(messages, true), "/my/messages");
assert.match(navItemHref(messages, false), /\?next=%2Fmy%2Fmessages$/);

const header = read("src/components/Header.tsx");
const sidebar = read("src/components/shell/AppSidebar.tsx");
for (const [name, src] of [
  ["Header", header],
  ["AppSidebar", sidebar],
] as const) {
  assert.match(src, /href=\{feedHomeHref\(loggedIn\)\}/, `${name} logo opens the feed home for the session`);
  assert.equal(src.includes('href="/feed?tab=all&sort=latest"'), false, `${name} logo must not hard-code all`);
  assert.equal(src.includes('href="/login"'), false, `${name} login link must keep the page as next`);
  assert.match(src, /loginUrlWithNext\(\{ nextPath: pathname \|\| null \}\)/);
}

const feedClient = read("src/app/feed/FeedClient.tsx");
assert.match(feedClient, /normalizeFeedTab\(rawTab, !!userId, sessionReady\)/);
assert.match(feedClient, /lane=\{feedWalkLane\(tab, rawTab, !!userId\)\}/);

const gate = read("src/components/AuthGate.tsx");
assert.match(gate, /router\.replace\(loginUrlWithNext\(\{ nextPath: currentPathWithQuery\(\) \}\)\)/);
const identity = read("src/app/onboarding/identity/page.tsx");
assert.equal(identity.includes("router.replace(LOGIN_PATH)"), false);
assert.match(identity, /router\.replace\(loginUrlWithNext\(\{ nextPath \}\)\)/);
for (const rel of [
  "src/app/onboarding/identity/page.tsx",
  "src/app/set-password/page.tsx",
  "src/app/auth/reset/page.tsx",
]) {
  assert.equal(read(rel).includes('"/feed?tab=all&sort=latest"'), false, `${rel} lands signed-in users on For you`);
}

console.log("feed-tab-entry.test.ts: ok");
