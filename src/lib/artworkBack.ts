// Context-aware "back" target for the public artwork page (/artwork/[id]).
//
// Same mechanic as src/lib/exhibitionBack.ts. Callers that link INTO an
// artwork stamp their current location right before navigating, and the
// artwork page reads it to return the visitor to that exact URL —
// preserving the feed tab, scroll target, etc.

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

export function getArtworkBack(): { path: string; labelKey: string } {
  const fallback = { path: "/feed?tab=all&sort=latest", labelKey: "nav.feed" };
  if (typeof window === "undefined") return fallback;
  try {
    const path = window.sessionStorage.getItem(KEY);
    if (!path) return fallback;
    // Return the STORED path (with query) so ?tab=artworks / ?tab=exhibitions
    // / scroll anchors survive the round-trip. Previously we hardcoded
    // `?tab=all&sort=latest` here, which broke the back-to-same-tab UX.
    if (path.startsWith("/feed")) return { path, labelKey: "nav.feed" };
    if (path.startsWith("/my")) return { path: "/my", labelKey: "nav.myProfile" };
    if (path.startsWith("/people")) return { path, labelKey: "nav.people" };
    if (path.startsWith("/upload")) return { path, labelKey: "nav.upload" };
    if (path.startsWith("/u/")) return { path, labelKey: "nav.profile" };
    return fallback;
  } catch {
    return fallback;
  }
}
