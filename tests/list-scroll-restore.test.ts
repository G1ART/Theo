// List pages return to the scroll where a detail was opened.
// Feed logo / tabs / refresh stay on the feed rules. A new open starts at the top.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { feedScrollDecision } from "../src/lib/feed/scrollRestore";
import {
  LIST_RELOAD_BOOT_SCRIPT,
  decideListScroll,
  isListScrollPath,
  keepsListScrollCorridor,
  listArmRelease,
  listReturnLinkProps,
  listScrollKeyFromHref,
} from "../src/lib/list/scrollRestore";
import { entryReturnLinkProps } from "../src/lib/nav/entryReturn";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

assert.equal(isListScrollPath("/search?q=hado"), true);
assert.equal(isListScrollPath("/notifications"), true);
assert.equal(isListScrollPath("/theo-board"), true);
assert.equal(isListScrollPath("/my/exhibitions"), true);
assert.equal(isListScrollPath("/my/exhibitions/show-1"), true);
assert.equal(isListScrollPath("/my/library"), true);
assert.equal(isListScrollPath("/my/library?visibility=draft"), true);
assert.equal(isListScrollPath("/my/shortlists"), true);
assert.equal(isListScrollPath("/my/shortlists/board-1"), true);
assert.equal(isListScrollPath("/my/spaces"), true);

assert.equal(isListScrollPath("/feed"), false);
assert.equal(isListScrollPath("/feed?tab=all&sort=latest"), false);
assert.equal(isListScrollPath("/u/heimyunghyun"), false);
assert.equal(isListScrollPath("/artwork/abc"), false);
assert.equal(isListScrollPath("/e/show"), false);
assert.equal(isListScrollPath("/my/exhibitions/new"), false);
assert.equal(isListScrollPath("/my/exhibitions/show-1/edit"), false);
assert.equal(isListScrollPath("/my/spaces/room-1"), false);
assert.equal(isListScrollPath("/theo-board/post-1"), false);

assert.equal(listScrollKeyFromHref("/search?q=hado#x"), "/search?q=hado");
assert.equal(listScrollKeyFromHref("/my/library?visibility=public"), "/my/library?visibility=public");
assert.equal(listScrollKeyFromHref("/feed"), null);
assert.equal(listScrollKeyFromHref("/u/heimyunghyun"), null);
assert.equal(listScrollKeyFromHref("https://example.com/search"), null);

assert.equal(listArmRelease("/search"), "keep");
assert.equal(listArmRelease("/my/exhibitions/show-1"), "keep");
assert.equal(listArmRelease("/artwork/abc"), "hold");
assert.equal(listArmRelease("/e/show"), "hold");
assert.equal(listArmRelease("/u/heimyunghyun"), "hold");
assert.equal(listArmRelease("/theo-board/post-1"), "hold");
assert.equal(listArmRelease("/my/spaces/room-1"), "hold");
assert.equal(listArmRelease("/my/library/import"), "hold");
assert.equal(listArmRelease("/feed"), "disarm");
assert.equal(listArmRelease("/feed?tab=foryou"), "disarm");
assert.equal(keepsListScrollCorridor("/feed"), false);

const searchKey = "/search?q=hado";

assert.equal(
  decideListScroll({
    currentKey: searchKey,
    armedKey: searchKey,
    popped: false,
    reload: false,
    hasSnapshot: true,
  }),
  "restore",
  "the in-app back link restores the search scroll",
);

assert.equal(
  decideListScroll({
    currentKey: searchKey,
    armedKey: null,
    popped: true,
    reload: false,
    hasSnapshot: true,
  }),
  "restore",
  "browser Back restores when a snapshot exists",
);

assert.equal(
  decideListScroll({
    currentKey: searchKey,
    armedKey: null,
    popped: false,
    reload: false,
    hasSnapshot: true,
  }),
  "fresh",
  "opening search from navigation starts at the top",
);

assert.equal(
  decideListScroll({
    currentKey: searchKey,
    armedKey: searchKey,
    popped: true,
    reload: true,
    hasSnapshot: true,
  }),
  "reload",
);

assert.equal(
  decideListScroll({
    currentKey: "/notifications",
    armedKey: "/search?q=hado",
    popped: false,
    reload: false,
    hasSnapshot: true,
  }),
  "fresh",
  "another list's arm does not move this page",
);

assert.equal(
  decideListScroll({
    currentKey: "/feed?tab=all",
    armedKey: searchKey,
    popped: true,
    reload: false,
    hasSnapshot: true,
  }),
  "fresh",
);

assert.equal(feedScrollDecision("detail-back"), "restore");
assert.equal(feedScrollDecision("logo"), "reset");
assert.equal(feedScrollDecision("feed-tab"), "reset");
assert.equal(feedScrollDecision("reload"), "reset");
assert.equal(feedScrollDecision("open-feed"), "reset");

const searchReturn = listReturnLinkProps("/search?q=hado");
assert.equal(searchReturn.scroll, false);
assert.equal(typeof searchReturn.onClick, "function");
assert.deepEqual(listReturnLinkProps("/feed"), {});
assert.deepEqual(listReturnLinkProps("/u/heimyunghyun"), {});

const entryFromSearch = entryReturnLinkProps("/search?q=hado");
assert.equal(entryFromSearch.scroll, false);
assert.equal(typeof entryFromSearch.onClick, "function");
const entryFromProfile = entryReturnLinkProps("/u/heimyunghyun");
assert.equal(entryFromProfile.scroll, false);
assert.deepEqual(entryReturnLinkProps("/feed?tab=all"), {});

const header = read("src/components/artwork/ArtworkPassportHeader.tsx");
assert.match(header, /entryReturnLinkProps\(backPath\)/);
const searchPage = read("src/app/search/SearchClient.tsx");
assert.match(searchPage, /replayPendingListScroll/);
const shell = read("src/components/shell/ShellNavLink.tsx");
assert.match(shell, /disarmListScrollReturn\(\)/);
assert.match(shell, /discardFeedSessionForHref/);

function bootScrollsToTop(pathname: string, type: string): boolean {
  let scrolled = false;
  const performance = { getEntriesByType: () => [{ type }] };
  const location = { pathname };
  const history = { scrollRestoration: "auto" };
  const scrollTo = () => {
    scrolled = true;
  };
  eval(LIST_RELOAD_BOOT_SCRIPT);
  return scrolled;
}

assert.equal(bootScrollsToTop("/search", "reload"), true);
assert.equal(bootScrollsToTop("/my/exhibitions/show-1", "reload"), true);
assert.equal(bootScrollsToTop("/my/shortlists/board-1", "reload"), true);
assert.equal(bootScrollsToTop("/my/exhibitions/new", "reload"), false);
assert.equal(bootScrollsToTop("/feed", "reload"), false);
assert.equal(bootScrollsToTop("/u/heimyunghyun", "reload"), false);
assert.equal(bootScrollsToTop("/search", "navigate"), false);
assert.equal(LIST_RELOAD_BOOT_SCRIPT.includes("feed:snapshot"), false);

console.log("list-scroll-restore.test.ts: ok");
