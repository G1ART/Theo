// Context-aware "back" target for the public artwork page (/artwork/[id]).
//
// Same mechanic as src/lib/exhibitionBack.ts. Callers that link INTO an
// artwork stamp their current location right before navigating, and the
// artwork page reads it to return the visitor to that exact URL —
// preserving the feed tab, exhibition id, scroll target, etc.

import { DEFAULT_DESTINATION } from "@/lib/identity/routing";
import { rememberListScrollFromWindow } from "@/lib/list/scrollRestore";
import { backLabelKeyForPath, isSafeAppPath } from "@/lib/nav/entryTrail";
import { setExhibitionBack } from "./exhibitionBack";

const KEY = "ab_artwork_back";

/** Back target of an artwork with no entry (opened by a link): the feed home. */
export const ARTWORK_BACK_FALLBACK = DEFAULT_DESTINATION;

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
  rememberListScrollFromWindow();
  try {
    const fromLocation = window.location.pathname + window.location.search;
    const target = explicitPath || fromLocation || ARTWORK_BACK_FALLBACK;
    window.sessionStorage.setItem(KEY, target);
  } catch {
    // ignore (private mode / disabled storage)
  }
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

/** Stamp the matching back target before a Link to /artwork or /e/. */
export function stampBackFromHref(href: string): void {
  if (href.startsWith("/artwork/")) setArtworkBack();
  else if (href.startsWith("/e/")) setExhibitionBack();
}

/** Where a deleted artwork returns when it has no entry. */
export const ARTWORK_DELETE_FALLBACK = ARTWORK_BACK_FALLBACK;

/**
 * Next 16's app router keeps no `idx` in history state, so this is null
 * there and a delete takes the replace path (the held scroll arm still
 * restores a profile or list).
 */
export function readHistoryIdx(): number | null {
  if (typeof window === "undefined") return null;
  const state = window.history.state as { idx?: unknown } | null;
  return typeof state?.idx === "number" ? state.idx : null;
}

function returnPath(stampedPath: string | null): string {
  if (!stampedPath || !isSafeAppPath(stampedPath) || stampedPath.startsWith("/artwork/")) {
    return ARTWORK_DELETE_FALLBACK;
  }
  return stampedPath;
}

/**
 * Delete should leave the screen the visitor came from.
 * In-app history uses back so that page keeps its scroll.
 * Otherwise replace with the stamped path (profile, feed, exhibition, …).
 * Never the workspace, and never the deleted artwork URL.
 */
export function artworkDeleteNavigation(input: {
  historyIdx: number | null;
  stampedPath: string | null;
}): { action: "back" | "replace"; path: string } {
  const path = returnPath(input.stampedPath);
  if (input.historyIdx != null && input.historyIdx > 0) {
    return { action: "back", path };
  }
  return { action: "replace", path };
}

export function getArtworkBack(): { path: string; labelKey: string } {
  const fallback = { path: ARTWORK_BACK_FALLBACK, labelKey: "nav.feed" };
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.sessionStorage.getItem(KEY);
    const path = stored || referrerAppPath();
    if (!path || !isSafeAppPath(path)) return fallback;
    // Another artwork record is not a useful "back" target.
    if (path.startsWith("/artwork/")) return fallback;
    return { path, labelKey: backLabelKeyForPath(path) };
  } catch {
    return fallback;
  }
}
