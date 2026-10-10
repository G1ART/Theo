/**
 * When the feed may reuse its session cache (scroll Y + loaded pages + cursor).
 *
 * Restore only when the visitor returns from an artwork or exhibition:
 * browser Back, or the in-app Back to Feed link. Logo, feed tabs, refresh,
 * and any control that opens the feed itself start at the top.
 *
 * The cache still lives in `sessionStorage` (`feed:snapshot:v1:*`). A reload
 * of `/feed` deletes it before paint (see {@link FEED_RELOAD_BOOT_SCRIPT})
 * and the mount read refuses it. Logo and feed-tab clicks delete it in the
 * click handler, before the next feed paint. Back leaves it in place.
 */

import { FEED_RELOAD_BOOT_SCRIPT, RESTORE_ARMED_KEY } from "@/lib/feed/feedSessionKeys";
import {
  clearAllFeedSnapshots,
  readFeedSnapshot,
  type FeedSnapshot,
} from "@/lib/feed/scrollSnapshot";

export { FEED_RELOAD_BOOT_SCRIPT, RESTORE_ARMED_KEY };

export type FeedScrollArrival =
  | "detail-back"
  | "reload"
  | "logo"
  | "feed-tab"
  | "open-feed";

export type FeedNavigationType = "navigate" | "reload" | "back_forward" | "prerender";

export type FeedAnchorKind = "detail" | "open-feed" | "leave" | "ignore";

const RESET_EVENT = "theo:feed-reset";

export type FeedMountContext = {
  navigationType: FeedNavigationType | null;
  /** Pathname of the document that loaded, not a later client-side route. */
  documentPath: string;
  reloadAlreadyConsumed: boolean;
  restoreArmed: boolean;
};

/**
 * Pure restore-vs-reset table.
 * Back from a detail restores. Reload, logo, feed tabs, and opening the
 * feed itself all reset.
 */
export function feedScrollDecision(arrival: FeedScrollArrival): "restore" | "reset" {
  return arrival === "detail-back" ? "restore" : "reset";
}

/** Map a feed mount onto that table. Logo and tabs disarm the cache first, so they arrive as `open-feed`. */
export function arrivalForFeedMount(input: FeedMountContext): FeedScrollArrival {
  if (
    input.navigationType === "reload" &&
    isFeedDocumentPath(input.documentPath) &&
    !input.reloadAlreadyConsumed
  ) {
    return "reload";
  }
  if (input.restoreArmed) return "detail-back";
  return "open-feed";
}

/** True only when this mount may hydrate scroll Y, pages, and cursor from sessionStorage. */
export function shouldReadFeedSessionCache(input: FeedMountContext): boolean {
  return feedScrollDecision(arrivalForFeedMount(input)) === "restore";
}

export function isFeedDocumentPath(path: string): boolean {
  return path === "/feed" || path.startsWith("/feed/");
}

function anchorPathname(href: string): string | null {
  const raw = href.trim();
  if (
    !raw ||
    raw.startsWith("#") ||
    raw.startsWith("mailto:") ||
    raw.startsWith("tel:") ||
    raw.startsWith("javascript:") ||
    raw.startsWith("//") ||
    raw.startsWith("http://") ||
    raw.startsWith("https://")
  ) {
    return null;
  }
  const path = raw.split("?")[0]?.split("#")[0] ?? "";
  if (!path.startsWith("/")) return null;
  return path;
}

export function classifyFeedAnchor(href: string): FeedAnchorKind {
  const path = anchorPathname(href);
  if (!path) return "ignore";
  if (path.startsWith("/artwork/") || path.startsWith("/e/")) return "detail";
  if (path === "/feed" || path === "/feed/") return "open-feed";
  if (path.startsWith("/")) return "leave";
  return "ignore";
}

export function isPlainPrimaryClick(event: {
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
}): boolean {
  return (
    !event.defaultPrevented &&
    (event.button ?? 0) === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

type CapturedDocument = { type: FeedNavigationType; path: string };

let captured: CapturedDocument | null = null;
let reloadConsumed = false;
let blockPersist = false;
let resetRefetch = true;

function safeSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readNavigationType(): FeedNavigationType {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return "navigate";
  }
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const raw = entry?.type;
  if (raw === "reload" || raw === "back_forward" || raw === "prerender") return raw;
  return "navigate";
}

/** Remember the real document load. Call once from the root client shell, before any feed read. */
export function captureFeedDocumentNavigation(): void {
  if (typeof window === "undefined" || captured) return;
  captured = { type: readNavigationType(), path: window.location.pathname };
  if (captured.type === "reload" && isFeedDocumentPath(captured.path)) {
    pinFeedScrollTop();
    forgetFeedSessionCache();
  }
}

export function isFeedRestoreArmed(): boolean {
  return safeSessionStorage()?.getItem(RESTORE_ARMED_KEY) === "1";
}

/** Allow the next feed mount to read the session cache. Detail exits only. */
export function armFeedRestore(): void {
  blockPersist = false;
  try {
    safeSessionStorage()?.setItem(RESTORE_ARMED_KEY, "1");
  } catch {
    // Privacy mode — back falls through to a fresh feed.
  }
}

export function disarmFeedRestore(): void {
  try {
    safeSessionStorage()?.removeItem(RESTORE_ARMED_KEY);
  } catch {
    // ignore
  }
}

/** Drop scroll Y, pages, and cursor. Does not move the viewport. */
export function forgetFeedSessionCache(): void {
  disarmFeedRestore();
  clearAllFeedSnapshots();
}

export function canWriteFeedSnapshot(): boolean {
  return !blockPersist && isFeedRestoreArmed();
}

function pinFeedScrollTop(): void {
  if (typeof window === "undefined") return;
  try {
    window.history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
  } catch {
    // ignore
  }
}

function isSameDocumentUrl(href: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const next = new URL(href, window.location.origin);
    return next.pathname === window.location.pathname && next.search === window.location.search;
  } catch {
    return false;
  }
}

/**
 * Clear the session cache before the next feed paint.
 * `refetch` reloads the feed that is already on screen (same URL).
 * A different URL mounts fresh and must not reuse the cache.
 */
export function discardFeedSession(options?: { refetch?: boolean }): void {
  resetRefetch = options?.refetch !== false;
  blockPersist = true;
  forgetFeedSessionCache();
  if (typeof window === "undefined") return;
  if (!isFeedDocumentPath(window.location.pathname)) return;
  pinFeedScrollTop();
  window.dispatchEvent(new Event(RESET_EVENT));
}

export function discardFeedSessionForHref(href: string): void {
  discardFeedSession({ refetch: isSameDocumentUrl(href) });
}

export function feedResetRefetches(): boolean {
  return resetRefetch;
}

export function subscribeFeedReset(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(RESET_EVENT, listener);
  return () => window.removeEventListener(RESET_EVENT, listener);
}

/** Artist, profile, and other non-detail exits must not restore on the way back. */
export function leaveFeedWithoutRestore(): void {
  blockPersist = false;
  forgetFeedSessionCache();
}

export function handleFeedSnapshotClick(event: MouseEvent, persist: () => void): void {
  if (!isPlainPrimaryClick(event)) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  if (anchor.target === "_blank") return;
  const href = anchor.getAttribute("href") ?? "";
  const kind = classifyFeedAnchor(href);
  if (kind === "detail") {
    armFeedRestore();
    persist();
    return;
  }
  if (kind === "open-feed") {
    discardFeedSessionForHref(href);
    return;
  }
  if (kind === "leave") leaveFeedWithoutRestore();
}

/**
 * Mount read. A reloaded `/feed` document never receives the cache.
 * Later mounts in that same document (back from a detail) still can.
 */
export function readFeedSnapshotForMount<T>(key: string): FeedSnapshot<T> | null {
  captureFeedDocumentNavigation();
  const navigationType = captured?.type ?? null;
  const documentPath = captured?.path ?? "";
  const feedReload =
    navigationType === "reload" && isFeedDocumentPath(documentPath) && !reloadConsumed;
  if (feedReload) {
    reloadConsumed = true;
    pinFeedScrollTop();
    forgetFeedSessionCache();
    return null;
  }
  if (
    !shouldReadFeedSessionCache({
      navigationType,
      documentPath,
      reloadAlreadyConsumed: reloadConsumed,
      restoreArmed: isFeedRestoreArmed(),
    })
  ) {
    return null;
  }
  return readFeedSnapshot<T>(key);
}
