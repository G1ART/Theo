/**
 * Scroll restore for list surfaces other than the feed and the profile.
 *
 * The feed keeps its own cache (`src/lib/feed/scrollRestore.ts`).
 * The profile keeps its own (`src/lib/profile/scrollRestore.ts`) and its
 * sticky name/tab bar. This module does not read or write those keys
 * and does not move a sticky element.
 *
 * A list remembers `window.scrollY` when the visitor leaves it. Browser
 * Back and the in-app back link return to that entry. Logo, feed tabs,
 * refresh, and opening the list from navigation start at the top.
 */

export const LIST_SCROLL_PREFIX = "list:scroll:v1:";
export const LIST_SCROLL_ARM_KEY = "list:scroll:return";

export type ListScrollDecision = "restore" | "fresh" | "reload";
export type ListArmRelease = "keep" | "hold" | "disarm";

const RELOAD_NONE = "navigate";

type CapturedDocument = { type: string; path: string };

let captured: CapturedDocument | null = null;
let reloadConsumed = false;
let popped = false;
let popListenerInstalled = false;
let clickSaverInstalled = false;

const EXACT_LISTS = new Set([
  "/search",
  "/notifications",
  "/theo-board",
  "/my/exhibitions",
  "/my/library",
  "/my/shortlists",
  "/my/spaces",
]);

export function listPathname(key: string): string {
  return key.split("?")[0]?.split("#")[0] ?? "";
}

/** Lists whose return from a detail should land on the entry scroll. */
export function isListScrollPath(path: string): boolean {
  const pathname = listPathname(path);
  if (EXACT_LISTS.has(pathname)) return true;
  if (/^\/my\/exhibitions\/(?!new$)[^/]+$/.test(pathname)) return true;
  if (/^\/my\/shortlists\/[^/]+$/.test(pathname)) return true;
  return false;
}

/**
 * Detail screens that sit between a list and the way back.
 * Feed and profile are not here: they have their own scroll rules.
 */
export function keepsListScrollCorridor(pathname: string): boolean {
  const path = listPathname(pathname);
  if (path.startsWith("/artwork/")) return true;
  if (path.startsWith("/e/")) return true;
  if (path.startsWith("/u/")) return true;
  if (path.startsWith("/room/")) return true;
  if (/^\/theo-board\/[^/]+$/.test(path)) return true;
  if (path.startsWith("/my/spaces/")) return true;
  if (path.startsWith("/my/library/")) return true;
  if (path.startsWith("/my/exhibitions/") && !isListScrollPath(path)) return true;
  if (path.startsWith("/my/shortlists/") && !isListScrollPath(path)) return true;
  return false;
}

export function listArmRelease(pathname: string): ListArmRelease {
  if (isListScrollPath(pathname)) return "keep";
  if (keepsListScrollCorridor(pathname)) return "hold";
  return "disarm";
}

export function listScrollKeyFromHref(href: string): string | null {
  const raw = href.trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  const hashless = raw.split("#")[0] ?? raw;
  const queryAt = hashless.indexOf("?");
  const pathname = queryAt === -1 ? hashless : hashless.slice(0, queryAt);
  const search = queryAt === -1 ? "" : hashless.slice(queryAt);
  if (!isListScrollPath(pathname)) return null;
  return pathname + search;
}

export function decideListScroll(input: {
  currentKey: string;
  armedKey: string | null;
  popped: boolean;
  reload: boolean;
  hasSnapshot: boolean;
}): ListScrollDecision {
  if (!isListScrollPath(input.currentKey)) return "fresh";
  if (input.reload) return "reload";
  const armedHere = input.armedKey === input.currentKey;
  if (input.hasSnapshot && (armedHere || input.popped)) return "restore";
  return "fresh";
}

function safeSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function snapshotStorageKey(key: string): string {
  return `${LIST_SCROLL_PREFIX}${key}`;
}

export function readListScrollArm(): string | null {
  const storage = safeSessionStorage();
  if (!storage) return null;
  try {
    return storage.getItem(LIST_SCROLL_ARM_KEY);
  } catch {
    return null;
  }
}

export function armListScrollReturn(key: string): void {
  if (!isListScrollPath(key)) return;
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(LIST_SCROLL_ARM_KEY, key);
  } catch {
    // Privacy mode — the list opens at the top.
  }
}

export function disarmListScrollReturn(): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(LIST_SCROLL_ARM_KEY);
  } catch {
    // ignore
  }
}

type StoredScroll = { key: string; scrollY: number; savedAt: number };

export function readListScrollSnapshot(key: string): StoredScroll | null {
  const storage = safeSessionStorage();
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(snapshotStorageKey(key));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredScroll;
    if (!parsed || parsed.key !== key || typeof parsed.scrollY !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearListScrollSnapshot(key: string): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(snapshotStorageKey(key));
  } catch {
    // ignore
  }
}

export function rememberListScroll(scrollY: number, key: string): void {
  if (!isListScrollPath(key)) return;
  const storage = safeSessionStorage();
  if (!storage) return;
  const snap: StoredScroll = {
    key,
    scrollY: Math.max(0, Math.round(scrollY)),
    savedAt: Date.now(),
  };
  try {
    storage.setItem(snapshotStorageKey(key), JSON.stringify(snap));
    storage.setItem(LIST_SCROLL_ARM_KEY, key);
  } catch {
    // ignore
  }
}

export function rememberListScrollFromWindow(): void {
  if (typeof window === "undefined") return;
  rememberListScroll(window.scrollY, window.location.pathname + window.location.search);
}

/** In-app back link: don't let Next scroll the list to the top. */
export function listReturnLinkProps(href: string): { scroll?: false; onClick?: () => void } {
  const key = listScrollKeyFromHref(href);
  if (!key) return {};
  return {
    scroll: false,
    onClick: () => armListScrollReturn(key),
  };
}

function readNavigationType(): string {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return RELOAD_NONE;
  }
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry?.type ?? RELOAD_NONE;
}

export function captureListDocumentNavigation(): void {
  if (typeof window === "undefined" || captured) return;
  captured = { type: readNavigationType(), path: window.location.pathname };
}

export function installListScrollPopListener(): void {
  if (popListenerInstalled || typeof window === "undefined") return;
  popListenerInstalled = true;
  window.addEventListener("popstate", () => {
    popped = true;
  });
}

function isPlainPrimaryClick(event: MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/** Save the list scroll when a primary click leaves the list. */
export function installListScrollClickSaver(): void {
  if (clickSaverInstalled || typeof window === "undefined") return;
  clickSaverInstalled = true;
  document.addEventListener(
    "click",
    (event) => {
      if (!isPlainPrimaryClick(event)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const current = window.location.pathname + window.location.search;
      if (!isListScrollPath(current)) return;
      let next: URL;
      try {
        next = new URL(href, window.location.origin);
      } catch {
        return;
      }
      if (next.origin !== window.location.origin) return;
      const nextKey = next.pathname + next.search;
      if (nextKey === current) return;
      rememberListScroll(window.scrollY, current);
    },
    true,
  );
}

export function consumeListPop(): boolean {
  const value = popped;
  popped = false;
  return value;
}

export function consumeListReload(currentKey: string): boolean {
  if (reloadConsumed || !captured || captured.type !== "reload") return false;
  if (captured.path !== listPathname(currentKey)) return false;
  reloadConsumed = true;
  return true;
}

export type ListScrollPlan = { action: ListScrollDecision; scrollY: number };

export function takeListScrollPlan(currentKey: string): ListScrollPlan {
  const poppedNow = consumeListPop();
  const reload = consumeListReload(currentKey);
  const armedKey = readListScrollArm();
  const snapshot = readListScrollSnapshot(currentKey);
  const action = decideListScroll({
    currentKey,
    armedKey,
    popped: poppedNow,
    reload,
    hasSnapshot: snapshot != null,
  });
  if (action === "restore" && snapshot) {
    return { action, scrollY: snapshot.scrollY };
  }
  clearListScrollSnapshot(currentKey);
  if (armedKey === currentKey) disarmListScrollReturn();
  return { action, scrollY: 0 };
}

export function commitListScrollReturn(): void {
  disarmListScrollReturn();
}

export function releaseListScrollOutsideCorridor(pathname: string): void {
  const release = listArmRelease(pathname);
  if (release === "keep") return;
  consumeListPop();
  if (release === "disarm") disarmListScrollReturn();
}

let pendingScrollY: number | null = null;

export function pendingListScrollY(): number | null {
  return pendingScrollY;
}

/** Re-apply the saved scroll after a list finishes loading its rows. */
export function replayPendingListScroll(): void {
  if (pendingScrollY == null || typeof window === "undefined") return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (pendingScrollY > 0 && max + 2 < pendingScrollY) return;
  if (Math.abs(window.scrollY - pendingScrollY) > 2) window.scrollTo(0, pendingScrollY);
}

/**
 * Keep putting the window back on `scrollY` until Next's scroll-to-top
 * has had a chance to run, and until a client-fetched list is tall enough.
 * A wheel, touch, or click stops the correction.
 */
export function pinListScroll(scrollY: number, onDone: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  pendingScrollY = scrollY;
  let stopped = false;
  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    pendingScrollY = null;
    onDone();
  };
  const apply = () => {
    if (stopped) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollY > 0 && max + 2 < scrollY) return;
    if (Math.abs(window.scrollY - scrollY) > 2) window.scrollTo(0, scrollY);
  };
  const userStop = () => {
    if (stopped) return;
    stopped = true;
    commit();
  };
  apply();
  let frames = 0;
  let raf = 0;
  const tick = () => {
    if (stopped) return;
    apply();
    frames += 1;
    if (frames >= 32) return;
    raf = window.requestAnimationFrame(tick);
  };
  raf = window.requestAnimationFrame(tick);
  const delays = [60, 180, 420, 900, 1600, 2500, 4000];
  const timers = delays.map((ms, index) =>
    window.setTimeout(() => {
      apply();
      if (index === delays.length - 1) commit();
    }, ms),
  );
  const observer = new ResizeObserver(() => apply());
  observer.observe(document.documentElement);
  if (document.body) observer.observe(document.body);
  window.addEventListener("wheel", userStop, { passive: true });
  window.addEventListener("touchmove", userStop, { passive: true });
  window.addEventListener("pointerdown", userStop, true);
  return () => {
    stopped = true;
    pendingScrollY = null;
    window.cancelAnimationFrame(raf);
    for (const timer of timers) window.clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener("wheel", userStop);
    window.removeEventListener("touchmove", userStop);
    window.removeEventListener("pointerdown", userStop, true);
  };
}

/**
 * Reload of a list starts at the top before paint. Feed keys are not touched.
 * The path check mirrors {@link isListScrollPath}.
 */
export const LIST_RELOAD_BOOT_SCRIPT = `try{var e=performance.getEntriesByType("navigation")[0];if(e&&e.type==="reload"){var p=location.pathname;var list=p==="/search"||p==="/notifications"||p==="/theo-board"||p==="/my/exhibitions"||p==="/my/library"||p==="/my/shortlists"||p==="/my/spaces"||/^\\/my\\/exhibitions\\/(?!new$)[^/]+$/.test(p)||/^\\/my\\/shortlists\\/[^/]+$/.test(p);if(list){history.scrollRestoration="manual";scrollTo(0,0);}}}catch(err){}`;

if (typeof window !== "undefined") {
  captureListDocumentNavigation();
  installListScrollPopListener();
  installListScrollClickSaver();
}
