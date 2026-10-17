// Back links return to the screen that opened them; the workspace only
// when there is none. Pins the trail rules, the labels, and the screens
// that use them (workspace sub-pages, exhibitions, CV).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  backLabelKeyForPath,
  entryForRouteChange,
  isExhibitionScreen,
  isPassThroughPath,
  resolveEntryPath,
} from "../src/lib/nav/entryTrail";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function trail(entries: Record<string, string>) {
  return (pathname: string) => entries[pathname] ?? null;
}

// Recording.
assert.equal(entryForRouteChange("/feed?tab=foryou&sort=latest", "/my/messages", trail({})), "/feed?tab=foryou&sort=latest");
assert.equal(entryForRouteChange("/my/network?tab=followers", "/my/network?tab=following", trail({})), null, "same screen");
assert.equal(
  entryForRouteChange("/my/messages/ada", "/my/messages", trail({ "/my/messages/ada": "/my/messages" })),
  null,
  "coming back to the opener keeps its older entry",
);
assert.equal(
  entryForRouteChange("/my/followers", "/my/network", trail({ "/my/followers": "/u/ada" })),
  "/u/ada",
  "a redirect-only screen passes its own entry on",
);
assert.equal(entryForRouteChange("/auth/callback", "/my/messages", trail({})), null);
assert.equal(entryForRouteChange("/login", "/feed", trail({ "/login": "/feed" })), null, "never the screen itself");
assert.equal(entryForRouteChange(null, "/my", trail({})), null);
assert.equal(entryForRouteChange("https://evil.example/x", "/my", trail({})), null);
assert.equal(isPassThroughPath("/me"), true);
assert.equal(isPassThroughPath("/my/messages"), false);

// Resolving, with the deleted exhibition skipped.
const chain = trail({
  "/my/exhibitions/ex1/edit": "/my/exhibitions/ex1",
  "/my/exhibitions/ex1": "/e/ex1",
  "/e/ex1": "/u/ada?tab=exhibitions",
});
assert.equal(resolveEntryPath({ pathname: "/my/exhibitions/ex1/edit", read: chain }), "/my/exhibitions/ex1");
assert.equal(
  resolveEntryPath({
    pathname: "/my/exhibitions/ex1/edit",
    read: chain,
    skip: (p) => isExhibitionScreen(p, "ex1", true),
  }),
  "/u/ada?tab=exhibitions",
);
assert.equal(
  resolveEntryPath({ pathname: "/my/exhibitions/ex1", read: chain, skip: (p) => isExhibitionScreen(p, "ex1") }),
  "/e/ex1",
  "the management page goes back to the public exhibition it was opened from",
);
assert.equal(
  resolveEntryPath({
    pathname: "/my/exhibitions/ex2",
    read: trail({ "/my/exhibitions/ex2": "/my/exhibitions/ex2/add", "/my/exhibitions/ex2/add": "/my/exhibitions/new", "/my/exhibitions/new": "/u/ada" }),
    skip: (p) => isExhibitionScreen(p, "ex2"),
  }),
  "/u/ada",
  "a new exhibition goes back past its creation form",
);
assert.equal(
  resolveEntryPath({ pathname: "/a", read: trail({ "/a": "/b", "/b": "/a" }), skip: () => true }),
  null,
  "a loop falls back",
);
assert.equal(resolveEntryPath({ pathname: "/my/messages", read: trail({ "/my/messages": "/login" }) }), null);
assert.equal(isExhibitionScreen("/upload/single?addToExhibition=ex1", "ex1"), true);
assert.equal(isExhibitionScreen("/upload/single?addToExhibition=ex9", "ex1"), false);
assert.equal(isExhibitionScreen("/e/ex1", "ex1"), false);

// Labels name the destination.
assert.equal(backLabelKeyForPath("/feed?tab=foryou"), "nav.feed");
assert.equal(backLabelKeyForPath("/u/ada?tab=CREATED"), "nav.profile");
assert.equal(backLabelKeyForPath("/my"), "nav.workspace");
assert.equal(backLabelKeyForPath("/my/exhibitions"), "exhibition.myExhibitions");
assert.equal(backLabelKeyForPath("/my/exhibitions/ex1"), "exhibition.manageExhibition");
assert.equal(backLabelKeyForPath("/notifications"), "notifications.title");
assert.equal(backLabelKeyForPath("/settings#cv"), "settings.title");
assert.equal(backLabelKeyForPath("/room/abc"), "common.back");
assert.equal(backLabelKeyForPath("/my/unknown-screen"), "common.back", "an unnamed screen is just 'back'");

// Workspace sub-pages: back to the entry, the workspace only without one.
for (const rel of [
  "library/page.tsx",
  "shortlists/page.tsx",
  "network/page.tsx",
  "messages/page.tsx",
  "inquiries/page.tsx",
  "inquiries/sent/page.tsx",
  "alerts/page.tsx",
  "artists/page.tsx",
  "orphan-invites/page.tsx",
  "claims/page.tsx",
  "exhibitions/page.tsx",
  "delegations/page.tsx",
  "ops/page.tsx",
]) {
  const src = read(`src/app/my/${rel}`);
  assert.match(src, /<EntryBackLink\s+fallback="\/my"/, `${rel} back goes to the entry`);
  assert.equal(src.includes('href="/my"'), false, `${rel} has no fixed workspace back link`);
}

assert.match(read("src/app/layout.tsx"), /<EntryTrailTracker \/>/);

const detail = read("src/app/my/exhibitions/[id]/page.tsx");
assert.match(detail, /fallback="\/my\/exhibitions"[\s\S]*?skip=\{\(path\) => isExhibitionScreen\(path, id\)\}/);
const edit = read("src/app/my/exhibitions/[id]/edit/page.tsx");
assert.match(edit, /replaceWithEntry\(\{[\s\S]*?fallback: "\/my\/exhibitions",[\s\S]*?isExhibitionScreen\(path, id, true\)/);
assert.equal(edit.includes('router.push("/my/exhibitions")'), false, "delete no longer lands on the list from anywhere");
assert.match(edit, /leaveFormTo\(\{ router, pathname, target: detailHref \}\)/);
assert.match(edit, /\{\.\.\.exitProps\}/);
assert.match(read("src/app/my/exhibitions/[id]/add/page.tsx"), /formExitLinkProps\(/);
assert.match(read("src/app/my/exhibitions/new/page.tsx"), /useEntryBack\(\{ fallback: fromUpload \? "\/upload" : "\/my\/exhibitions" \}\)/);
assert.match(read("src/components/exhibitions/NewExhibitionFormShell.tsx"), /router\.replace\(nextPath\)/);
const cv = read("src/app/my/profile/cv/page.tsx");
assert.match(cv, /useEntryBack\(\{ fallback \}\)/);
assert.match(cv, /actingAsProfileId \? getProfileById\(actingAsProfileId\) : getMyProfile\(\)/);

console.log("entry-trail.test.ts: ok");
