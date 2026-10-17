// Context-aware "back" target for the public exhibition page (/e/[id]).
//
// Mirrors src/lib/artworkBack.ts: the surfaces that link INTO an exhibition
// (feed strip, profile exhibition list, room, shortlist) stamp their own path
// into sessionStorage right before navigating, and the exhibition page reads it
// to send the visitor back where they actually came from — instead of always
// dumping them on the feed regardless of entry point (QA 2026-06-30).

import { rememberListScrollFromWindow } from "@/lib/list/scrollRestore";
import { backLabelKeyForPath, isSafeAppPath } from "@/lib/nav/entryTrail";

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
  rememberListScrollFromWindow();
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
    // Another exhibition is not a useful "back" target.
    if (!isSafeAppPath(path) || path.startsWith("/e/")) return fallback;
    return { path, labelKey: backLabelKeyForPath(path) };
  } catch {
    return fallback;
  }
}
