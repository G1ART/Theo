// Context-aware "back" target for the public exhibition page (/e/[id]).
//
// Mirrors src/lib/artworkBack.ts: the surfaces that link INTO an exhibition
// (feed strip, profile exhibition list, room, shortlist) stamp their own path
// into sessionStorage right before navigating, and the exhibition page reads it
// to send the visitor back where they actually came from — instead of always
// dumping them on the feed regardless of entry point (QA 2026-06-30).

const KEY = "theo_exhibition_back";

export function setExhibitionBack(pathname: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, pathname || "/feed");
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
    return fallback;
  } catch {
    return fallback;
  }
}
