// Context-aware "back" target for the public artwork page (/artwork/[id]).
//
// Same mechanic as src/lib/exhibitionBack.ts. Callers that link INTO an
// artwork stamp their current location right before navigating, and the
// artwork page reads it to return the visitor to that exact URL —
// preserving the feed tab, exhibition id, scroll target, etc.

import { setExhibitionBack } from "./exhibitionBack";

const KEY = "ab_artwork_back";

/**
 * Stamp the caller's current location as the "return to" target for the
 * next artwork detail page open.
 *
 * Pass `explicitPath` only when overriding the raw URL (e.g. the upload
 * flow pins `/upload` even though the click happened after the URL had
 * transitioned). Otherwise call with no args — we snapshot pathname AND
 * search string via `window.location`, which is critical because
 * `usePathname()` alone drops the query and would silently return users
 * to `/feed` root even when they came from `/feed?tab=artworks`.
 */
export function setArtworkBack(explicitPath?: string): void {
  if (typeof window === "undefined") return;
  try {
    const fromLocation = window.location.pathname + window.location.search;
    const target = explicitPath || fromLocation || "/feed?tab=all&sort=latest";
    window.sessionStorage.setItem(KEY, target);
  } catch {
    // ignore (private mode / disabled storage)
  }
}

function isSafeAppPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("://");
}

function referrerAppPath(): string | null {
  try {
    const ref = document.referrer;
    if (!ref) return null;
    const url = new URL(ref);
    if (url.origin !== window.location.origin) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

function labelKeyForArtworkBack(path: string): string {
  if (path.startsWith("/feed")) return "nav.feed";
  if (path.startsWith("/e/")) return "exhibition.backLabel";
  if (path.startsWith("/my/exhibitions")) return "exhibition.myExhibitions";
  if (path.startsWith("/my/library")) return "library.title";
  if (path.startsWith("/my/shortlists")) return "nav.saved";
  if (path.startsWith("/people")) return "nav.people";
  if (path.startsWith("/upload")) return "nav.upload";
  if (path.startsWith("/u/")) return "nav.profile";
  if (path.startsWith("/notifications")) return "nav.notifications";
  if (path.startsWith("/my/inquiries")) return "nav.messages";
  if (path.startsWith("/room/")) return "artwork.backToRoom";
  if (path.startsWith("/theo-board")) return "nav.theoBoard";
  if (path.startsWith("/explore")) return "nav.explore";
  if (path.startsWith("/my")) return "nav.workspace";
  return "common.back";
}

/** Stamp the matching back target before a Link to /artwork or /e/. */
export function stampBackFromHref(href: string): void {
  if (href.startsWith("/artwork/")) setArtworkBack();
  else if (href.startsWith("/e/")) setExhibitionBack();
}

export function getArtworkBack(): { path: string; labelKey: string } {
  const fallback = { path: "/feed?tab=all&sort=latest", labelKey: "nav.feed" };
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.sessionStorage.getItem(KEY);
    const path = stored || referrerAppPath();
    if (!path || !isSafeAppPath(path)) return fallback;
    // Another artwork record is not a useful "back" target.
    if (path.startsWith("/artwork/")) return fallback;
    return { path, labelKey: labelKeyForArtworkBack(path) };
  } catch {
    return fallback;
  }
}
