// Context-aware "back" target for the public exhibition page (/e/[id]).
//
// Mirrors src/lib/artworkBack.ts: the surfaces that link INTO an exhibition
// (feed strip, profile exhibition list, room, shortlist) stamp their own path
// into sessionStorage right before navigating, and the exhibition page reads it
// to send the visitor back where they actually came from — instead of always
// dumping them on the feed regardless of entry point (QA 2026-06-30).

const KEY = "theo_exhibition_back";

/**
 * Stamp the caller's current location as the "return to" target for the
 * next exhibition detail page open.
 *
 * Pass `explicitPath` only when you have a smarter default than the raw
 * URL (rare). When called with no args (recommended), we snapshot both
 * pathname AND search string via `window.location` — which is critical:
 * `usePathname()` alone drops the query string, so callers that passed
 * `usePathname()` were silently sending users back to `/feed` root even
 * when they came from `/feed?tab=exhibitions`. Sourcing from
 * `window.location` inside the click handler is always correct and
 * dodges that class of bug entirely.
 */
export function setExhibitionBack(explicitPath?: string): void {
  if (typeof window === "undefined") return;
  try {
    const fromLocation = window.location.pathname + window.location.search;
    const target = explicitPath || fromLocation || "/feed";
    window.sessionStorage.setItem(KEY, target);
  } catch {
    // ignore (private mode / disabled storage)
  }
}

export function getExhibitionBack(): { path: string; labelKey: string } {
  const fallback = { path: "/feed", labelKey: "nav.feed" };
  if (typeof window === "undefined") return fallback;
  try {
    const path = window.sessionStorage.getItem(KEY);
    if (!path) return fallback;
    if (path.startsWith("/feed")) return { path, labelKey: "nav.feed" };
    if (path === "/me" || path.startsWith("/me?")) return { path: "/me", labelKey: "nav.myProfile" };
    if (path.startsWith("/u/")) return { path, labelKey: "nav.profile" };
    if (path.startsWith("/my/shortlists")) return { path, labelKey: "boards.title" };
    if (path.startsWith("/my/exhibitions")) return { path, labelKey: "exhibition.myExhibitions" };
    if (path.startsWith("/people")) return { path, labelKey: "nav.people" };
    if (path.startsWith("/room/")) return { path, labelKey: "common.back" };
    if (path.startsWith("/artwork/")) return { path, labelKey: "artwork.backLabel" };
    if (path.startsWith("/notifications")) return { path, labelKey: "nav.notifications" };
    if (path.startsWith("/my")) return { path, labelKey: "nav.workspace" };
    if (path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/e/")) {
      return { path, labelKey: "common.back" };
    }
    return fallback;
  } catch {
    return fallback;
  }
}
