/**
 * Mobile header search is one magnifier below `lg`, and it opens the
 * same results as the desktop right-rail search. It does not add a
 * second search engine or a second field on the results page.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hitTarget } from "../src/components/ds/buttonStyles";
import { messages } from "../src/lib/i18n/messages";
import { shellSearchHref } from "../src/lib/search/shellSearchHref";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const header = read("src/components/Header.tsx");
const rail = read("src/components/shell/rail/MyConnectionRail.tsx");
const results = read("src/app/search/SearchClient.tsx");
const hrefSource = read("src/lib/search/shellSearchHref.ts");

assert.equal(shellSearchHref("  blue tree  "), "/search?q=blue%20tree");
assert.equal(shellSearchHref("이목"), `/search?q=${encodeURIComponent("이목")}`);
assert.equal(shellSearchHref("100%"), "/search?q=100%25");
assert.equal(shellSearchHref(""), "/people");
assert.equal(shellSearchHref("   "), "/people");
assert.equal(hrefSource.includes("searchDiscoverArtworks"), false);
assert.equal(header.includes("searchDiscoverArtworks"), false);

assert.equal(messages.en["shell.searchOpen"], "Search");
assert.equal(messages.ko["shell.searchOpen"], "검색");

assert.match(hitTarget, /\bmin-h-11\b/);
assert.match(hitTarget, /\bmin-w-11\b/);

assert.match(header, /const \[mobileSearchOpen, setMobileSearchOpen\] = useState\(false\)/);
assert.match(header, /shellRoute \? "flex lg:hidden" : "flex"/);
assert.match(header, /matchMedia\("\(min-width: 1024px\)"\)/);

const triggerAt = header.indexOf("data-mobile-search");
const trigger = header.slice(triggerAt, header.indexOf("</button>", triggerAt));
assert.ok(triggerAt > header.indexOf("<header"), "magnifier lives in the header");
assert.match(trigger, /lg:hidden/);
assert.match(trigger, /\$\{hitTarget\}/);
assert.match(trigger, /aria-label=\{t\("shell\.searchOpen"\)\}/);
assert.match(trigger, /<SearchGlyph \/>/);
assert.equal(/>\s*\{t\(/.test(trigger), false, "magnifier has no visible text label");
assert.equal(/lg:(inline-flex|flex|block|inline)\b/.test(trigger), false);

const avatarAt = header.indexOf("href={mobileProfileHref}");
const menuAt = header.indexOf("aria-controls={mobilePanelId}");
assert.ok(triggerAt < avatarAt, "magnifier is before the account icon");
assert.ok(triggerAt < menuAt, "magnifier is in the header actions, before the menu");

const bannerAt = header.indexOf('data-tour="acting-as-banner"');
assert.ok(bannerAt !== -1 && bannerAt < header.indexOf("<header"));
assert.equal(header.slice(bannerAt, header.indexOf("<header")).includes("data-mobile-search"), false);

assert.match(header, /\{mobileSearchOpen && \(/);
const formMarker = header.indexOf("data-mobile-search-form");
const formAt = header.lastIndexOf("<form", formMarker);
assert.ok(formAt > header.indexOf("{mobileSearchOpen && ("));
const form = header.slice(formAt, header.indexOf("</form>", formAt));
assert.match(form, /\blg:hidden\b/);
assert.equal(/\blg:flex\b/.test(form), false, "expanded search stays off the desktop header");
assert.match(form, /role="search"/);
assert.match(form, /aria-label=\{t\("common\.close"\)\}/);
assert.match(form, /aria-label=\{t\("shell\.searchPlaceholder"\)\}/);
assert.match(form, /aria-label=\{t\("shell\.searchSubmit"\)\}/);
assert.match(form, /ref=\{mobileSearchInputRef\}/);
assert.match(form, /\bautoFocus\b/);
assert.match(form, /enterKeyHint="search"/);
assert.match(form, /\btext-base\b/);
assert.match(form, /\$\{hitTarget\}/);
assert.equal((header.match(/<input/g) ?? []).length, 1, "header has one search field, and only while open");

const openFn = header.slice(
  header.indexOf("function openMobileSearch"),
  header.indexOf("function closeMobileSearch"),
);
assert.match(openFn, /flushSync/);
assert.match(openFn, /mobileSearchInputRef\.current\?\.focus\(\)/);

const closeFn = header.slice(
  header.indexOf("function closeMobileSearch"),
  header.indexOf("function submitMobileSearch"),
);
assert.match(closeFn, /setMobileSearchOpen\(false\)/);
assert.match(closeFn, /setMobileQuery\(""\)/);

const submitFn = header.slice(
  header.indexOf("function submitMobileSearch"),
  header.indexOf("if (authFrontDoor) return null"),
);
assert.match(submitFn, /shellSearchHref\(mobileQuery\)/);
assert.match(submitFn, /disarmListScrollReturn\(\)/);
assert.match(submitFn, /router\.push\(href\)/);
assert.match(submitFn, /setMobileQuery\(""\)/);

assert.match(rail, /shellSearchHref\(q\)/);
assert.match(rail, /disarmListScrollReturn\(\)/);
assert.match(rail, /type="search"/);
assert.equal(rail.includes("data-mobile-search"), false, "desktop rail keeps its own field");

assert.match(results, /searchParams\.get\("q"\)/);
assert.match(results, /\/search\?q=\$\{encodeURIComponent\(query\)\}/);
assert.equal((results.match(/<form/g) ?? []).length, 1, "results page keeps its one existing field");

console.log("mobile-header-search.test.ts: ok");
