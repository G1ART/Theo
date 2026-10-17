/**
 * Where each screen was opened from, for back links and for leaving a
 * form or a deleted record.
 *
 * Every route change stores the previous URL as the entry of the new
 * pathname (sessionStorage, this tab). Coming back to the screen that
 * opened the previous one (a back link, browser Back) keeps the older
 * entry, so a list does not start pointing at the detail it just closed.
 * Query-only changes stay on the same screen. Redirect-only and sign-in
 * screens pass their own entry on instead of becoming one.
 *
 * A plain link click also remembers the scroll of the screen it leaves,
 * under its own key. Profile and list restore read it only when a return
 * path here arms them, so a fresh open still starts at the top.
 */

import type { MessageKey } from "@/lib/i18n/messages";
import { armFeedRestore, isFeedDocumentPath } from "@/lib/feed/scrollRestore";
import {
  armListScrollReturn,
  isListScrollPath,
  rememberListScroll,
} from "@/lib/list/scrollRestore";
import {
  armProfileScrollReturn,
  isProfileScrollPath,
  readProfileScrollSnapshot,
  rememberProfileGridScroll,
} from "@/lib/profile/scrollRestore";

export const ENTRY_TRAIL_PREFIX = "nav:entry:v1:";
export const ENTRY_LEAVE_PREFIX = "nav:leave:v1:";
export const ENTRY_TRAIL_EVENT = "theo:entry-trail";

export function entryPathname(url: string): string {
  return url.split("?")[0]?.split("#")[0] ?? "";
}

export function isSafeAppPath(path: string | null | undefined): path is string {
  return !!path && path.startsWith("/") && !path.startsWith("//") && !path.includes("://");
}

const PASS_THROUGH = [
  /^\/$/,
  /^\/me$/,
  /^\/login(\/|$)/,
  /^\/signup(\/|$)/,
  /^\/onboarding(\/|$)/,
  /^\/auth\//,
  /^\/set-password$/,
  /^\/username-fix$/,
  /^\/ir$/,
  /^\/artists$/,
  /^\/my\/(followers|following|relationships|access-requests)$/,
];

/** Redirect-only and sign-in screens: never a back target themselves. */
export function isPassThroughPath(path: string): boolean {
  const pathname = entryPathname(path);
  return PASS_THROUGH.some((re) => re.test(pathname));
}

type EntryRead = (pathname: string) => string | null;

function safeSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readEntry(pathname: string): string | null {
  const storage = safeSessionStorage();
  if (!storage) return null;
  try {
    const value = storage.getItem(ENTRY_TRAIL_PREFIX + entryPathname(pathname));
    return isSafeAppPath(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The URL to store as the entry of `to`, or null to keep what is stored.
 * Pure so the trail rules can be tested without storage.
 */
export function entryForRouteChange(from: string | null, to: string, read: EntryRead): string | null {
  if (!isSafeAppPath(from) || !isSafeAppPath(to)) return null;
  const fromPath = entryPathname(from);
  const toPath = entryPathname(to);
  if (fromPath === toPath) return null;
  const passThrough = isPassThroughPath(fromPath);
  const source = passThrough ? read(fromPath) : from;
  if (!source || entryPathname(source) === toPath || isPassThroughPath(source)) return null;
  if (!passThrough) {
    const opener = read(fromPath);
    if (opener && entryPathname(opener) === toPath) return null;
  }
  return source;
}

export function recordRouteChange(from: string | null, to: string): void {
  const entry = entryForRouteChange(from, to, readEntry);
  if (!entry) return;
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(ENTRY_TRAIL_PREFIX + entryPathname(to), entry);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(ENTRY_TRAIL_EVENT));
}

/**
 * The back target of a screen: the screen it was opened from. `skip`
 * walks further up past entries that must not be offered (the record
 * being deleted, its own sub-screens). Null means use the fallback.
 */
export function resolveEntryPath(input: {
  pathname: string;
  skip?: (path: string) => boolean;
  read?: EntryRead;
}): string | null {
  const read = input.read ?? readEntry;
  const seen = new Set<string>([entryPathname(input.pathname)]);
  let entry = read(input.pathname);
  while (entry) {
    const pathname = entryPathname(entry);
    if (seen.has(pathname) || isPassThroughPath(pathname)) return null;
    if (!input.skip?.(entry)) return entry;
    seen.add(pathname);
    entry = read(pathname);
  }
  return null;
}

/**
 * Screens of one exhibition: its management pages, the creation form
 * that made it, and uploads into it. `withPublic` adds its public page
 * (for a delete, when that page is gone too).
 */
export function isExhibitionScreen(path: string, exhibitionId: string, withPublic = false): boolean {
  const p = entryPathname(path);
  if (p === `/my/exhibitions/${exhibitionId}` || p.startsWith(`/my/exhibitions/${exhibitionId}/`)) {
    return true;
  }
  if (p === "/my/exhibitions/new") return true;
  if (withPublic && p === `/e/${exhibitionId}`) return true;
  if (p === "/upload" || p.startsWith("/upload/")) {
    const query = (path.split("?")[1] ?? "").split("#")[0] ?? "";
    return new URLSearchParams(query).get("addToExhibition") === exhibitionId;
  }
  return false;
}

/** One label per destination for every back link. The label names the screen it opens. */
export function backLabelKeyForPath(path: string): MessageKey {
  const p = entryPathname(path);
  if (p === "/feed" || p.startsWith("/feed/")) return "nav.feed";
  if (p.startsWith("/u/")) return "nav.profile";
  if (p.startsWith("/e/")) return "exhibition.backLabel";
  if (p.startsWith("/artwork/")) return "artwork.backLabel";
  if (p === "/my") return "nav.workspace";
  if (p === "/my/exhibitions") return "exhibition.myExhibitions";
  if (/^\/my\/exhibitions\/(?!new$)[^/]+/.test(p)) return "exhibition.manageExhibition";
  if (p === "/my/library/import") return "library.import.title";
  if (p.startsWith("/my/library")) return "library.title";
  if (p.startsWith("/my/shortlists")) return "boards.title";
  if (p.startsWith("/my/messages")) return "connection.inbox.title";
  if (p === "/my/inquiries/sent") return "inquiriesSent.title";
  if (p === "/my/inquiries") return "priceInquiry.title";
  if (p === "/my/network") return "network.title";
  if (p === "/my/delegations") return "nav.delegations";
  if (p === "/my/alerts") return "alerts.title";
  if (p === "/my/claims") return "my.kpi.claimRequests";
  if (p === "/my/artists") return "myArtists.title";
  if (p === "/my/orphan-invites") return "orphanInvites.title";
  if (p === "/my/visibility") return "visibility.page.title";
  if (p.startsWith("/my/spaces")) return "simulation.list.title";
  if (p.startsWith("/my/ops")) return "workspace.ops.title";
  if (p === "/my/profile/cv") return "cv.editor.title";
  if (p.startsWith("/notifications")) return "notifications.title";
  if (p.startsWith("/people")) return "nav.people";
  if (p.startsWith("/upload")) return "nav.upload";
  if (p.startsWith("/theo-board")) return "theoBoard.title";
  if (p === "/settings") return "settings.title";
  if (p.startsWith("/search")) return "search.title";
  return "common.back";
}

type LeaveRecord = { url: string; scrollY: number };

/** Scroll of the screen a plain link click is leaving. */
export function rememberLeave(url: string, scrollY: number): void {
  const storage = safeSessionStorage();
  if (!storage || !isSafeAppPath(url)) return;
  const record: LeaveRecord = { url, scrollY: Math.max(0, Math.round(scrollY)) };
  try {
    storage.setItem(ENTRY_LEAVE_PREFIX + entryPathname(url), JSON.stringify(record));
  } catch {
    // Privacy mode — the return opens at the top.
  }
}

function readLeave(url: string): LeaveRecord | null {
  const storage = safeSessionStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ENTRY_LEAVE_PREFIX + entryPathname(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LeaveRecord;
    if (parsed?.url !== url || typeof parsed.scrollY !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True when returning to `url` will put the reader back where they were. */
export function entryReturnRestores(url: string): boolean {
  if (isListScrollPath(url)) return true;
  if (isProfileScrollPath(url)) return readLeave(url) != null || readProfileScrollSnapshot(url) != null;
  return false;
}

/** Arm the scroll restore of `url` right before going back to it. */
export function armEntryReturn(url: string): void {
  const leave = readLeave(url);
  if (isProfileScrollPath(url)) {
    if (leave) rememberProfileGridScroll(leave.scrollY, url);
    else armProfileScrollReturn(url);
  } else if (isListScrollPath(url)) {
    if (leave) rememberListScroll(leave.scrollY, url);
    else armListScrollReturn(url);
  } else if (isFeedDocumentPath(entryPathname(url))) {
    armFeedRestore();
  }
}

type ReturnRouter = {
  back: () => void;
  replace: (href: string, options?: { scroll?: boolean }) => void;
};

/**
 * Go back to the screen this one was opened from (or `fallback`) and
 * take this screen out of history. For a save that ends a form, or a
 * delete whose record no longer exists.
 */
export function replaceWithEntry(input: {
  router: ReturnRouter;
  pathname: string;
  fallback: string;
  skip?: (path: string) => boolean;
}): string {
  const target = resolveEntryPath({ pathname: input.pathname, skip: input.skip }) ?? input.fallback;
  const restores = entryReturnRestores(target);
  armEntryReturn(target);
  input.router.replace(target, restores ? { scroll: false } : undefined);
  return target;
}

/** True when the form was opened from `target` and Back would land there. */
export function formOpenedFrom(pathname: string, target: string): boolean {
  if (typeof window === "undefined" || window.history.length < 2) return false;
  const entry = readEntry(pathname);
  return !!entry && entryPathname(entry) === entryPathname(target);
}

type ExitClick = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault: () => void;
};

/** Props for a form's back or cancel `<Link href={target}>`, same rule as `leaveFormTo`. */
export function formExitLinkProps(input: { back: () => void; pathname: string; target: string }): {
  replace: true;
  onClick: (event: ExitClick) => void;
} {
  return {
    replace: true,
    onClick: (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!formOpenedFrom(input.pathname, input.target)) return;
      event.preventDefault();
      input.back();
    },
  };
}

/**
 * Leave a form (save or cancel) for `target` without leaving the form in
 * history: Back when the form was opened from `target`, else replace.
 */
export function leaveFormTo(input: { router: ReturnRouter; pathname: string; target: string }): void {
  if (formOpenedFrom(input.pathname, input.target)) {
    input.router.back();
    return;
  }
  input.router.replace(input.target);
}
