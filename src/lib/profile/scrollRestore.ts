/**
 * Profile grid scroll restore + freeze-pane math.
 *
 * The public profile (`/u/:handle`, own or someone else's) keeps the
 * window scroll of the artwork the visitor opened. Browser Back and the
 * artwork record's "프로필" link both return to that entry. A fresh open
 * of the profile (feed, search, avatar) starts at the top.
 *
 * This is not the feed cache. Logo, For you, and feed tabs do not read
 * or clear these keys.
 */

export const PROFILE_SCROLL_PREFIX = "profile:scroll:v1:";
export const PROFILE_SCROLL_ARM_KEY = "profile:scroll:return";

export type ProfileScrollDecision = "restore" | "fresh" | "reload";

export type ProfileChromeClick = "name" | "current-tab" | "other-tab";

export type ProfileArmRelease = "keep" | "hold" | "disarm";

const RELOAD_NONE = "navigate";

type CapturedDocument = { type: string; path: string };

let captured: CapturedDocument | null = null;
let reloadConsumed = false;
let popped = false;
let popListenerInstalled = false;

export function isProfileScrollPath(path: string): boolean {
  const pathname = path.split("?")[0]?.split("#")[0] ?? "";
  return /^\/u\/[^/]+/.test(pathname);
}

export function profilePathname(key: string): string {
  return key.split("?")[0]?.split("#")[0] ?? key;
}

/** Artwork and exhibition details sit between a profile and the way back. */
export function keepsProfileScrollCorridor(pathname: string): boolean {
  return pathname.startsWith("/artwork/") || pathname.startsWith("/e/");
}

/**
 * On a profile, leave the arm and the pop flag for the page to read.
 * On a detail, drop a stale pop but keep the arm. Anywhere else, disarm.
 */
export function profileArmRelease(pathname: string): ProfileArmRelease {
  if (isProfileScrollPath(pathname)) return "keep";
  if (keepsProfileScrollCorridor(pathname)) return "hold";
  return "disarm";
}

export function profileScrollKeyFromHref(href: string): string | null {
  const raw = href.trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  const hashless = raw.split("#")[0] ?? raw;
  const queryAt = hashless.indexOf("?");
  const pathname = queryAt === -1 ? hashless : hashless.slice(0, queryAt);
  const search = queryAt === -1 ? "" : hashless.slice(queryAt);
  if (!isProfileScrollPath(pathname)) return null;
  return pathname + search;
}

export function isProfileReturnHref(href: string): boolean {
  return profileScrollKeyFromHref(href) != null;
}

/**
 * Name, the current artwork tab, and a different artwork tab all scroll
 * to the top of that tab's list (just under the frozen name and tabs).
 */
export function profileChromeScrollTarget(_click: ProfileChromeClick): "tab-list-top" {
  switch (_click) {
    case "name":
    case "current-tab":
    case "other-tab":
      return "tab-list-top";
  }
}

/**
 * Distance from the viewport top down to the artwork list.
 * `headerHeight` is the mobile app header (0 on the desktop shell).
 * `barHeight` is the one frozen bar that holds the name and the tabs.
 */
export function profileTabStickOffset(headerHeight: number, barHeight: number): number {
  return Math.max(0, headerHeight) + Math.max(0, barHeight);
}

/** Window scrollY that puts the tab bar (or list anchor) on the stick line. */
export function profileListTopScrollY(input: {
  tabBarViewportTop: number;
  windowScrollY: number;
  stickOffset: number;
}): number {
  return Math.max(
    0,
    Math.round(input.tabBarViewportTop + input.windowScrollY - input.stickOffset)
  );
}

export function decideProfileScroll(input: {
  currentKey: string;
  armedKey: string | null;
  popped: boolean;
  reload: boolean;
  hasSnapshot: boolean;
}): ProfileScrollDecision {
  if (!isProfileScrollPath(input.currentKey)) return "fresh";
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
  return `${PROFILE_SCROLL_PREFIX}${key}`;
}

export function readProfileScrollArm(): string | null {
  const storage = safeSessionStorage();
  if (!storage) return null;
  try {
    return storage.getItem(PROFILE_SCROLL_ARM_KEY);
  } catch {
    return null;
  }
}

export function armProfileScrollReturn(key: string): void {
  if (!isProfileScrollPath(key)) return;
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(PROFILE_SCROLL_ARM_KEY, key);
  } catch {
    // Privacy mode — the profile opens at the top.
  }
}

export function disarmProfileScrollReturn(): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(PROFILE_SCROLL_ARM_KEY);
  } catch {
    // ignore
  }
}

type StoredScroll = { key: string; scrollY: number; savedAt: number };

export function readProfileScrollSnapshot(key: string): StoredScroll | null {
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

export function clearProfileScrollSnapshot(key: string): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(snapshotStorageKey(key));
  } catch {
    // ignore
  }
}

/** Call from the profile grid the moment a work or exhibition is opened. */
export function rememberProfileGridScroll(scrollY: number, key: string): void {
  if (!isProfileScrollPath(key)) return;
  const storage = safeSessionStorage();
  if (!storage) return;
  const snap: StoredScroll = {
    key,
    scrollY: Math.max(0, Math.round(scrollY)),
    savedAt: Date.now(),
  };
  try {
    storage.setItem(snapshotStorageKey(key), JSON.stringify(snap));
    storage.setItem(PROFILE_SCROLL_ARM_KEY, key);
  } catch {
    // ignore
  }
}

export function rememberProfileGridScrollFromWindow(): void {
  if (typeof window === "undefined") return;
  rememberProfileGridScroll(window.scrollY, window.location.pathname + window.location.search);
}

export function profileReturnLinkProps(href: string): { scroll?: false; onClick?: () => void } {
  const key = profileScrollKeyFromHref(href);
  if (!key) return {};
  return {
    scroll: false,
    onClick: () => armProfileScrollReturn(key),
  };
}

function readNavigationType(): string {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return RELOAD_NONE;
  }
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry?.type ?? RELOAD_NONE;
}

/** Remember the real document load. Call once from the root client shell. */
export function captureProfileDocumentNavigation(): void {
  if (typeof window === "undefined" || captured) return;
  captured = { type: readNavigationType(), path: window.location.pathname };
}

export function installProfileScrollPopListener(): void {
  if (popListenerInstalled || typeof window === "undefined") return;
  popListenerInstalled = true;
  window.addEventListener("popstate", () => {
    popped = true;
  });
}

export function consumeProfilePop(): boolean {
  const value = popped;
  popped = false;
  return value;
}

/** True only for the first read after a reload of this profile document. */
export function consumeProfileReload(currentKey: string): boolean {
  if (reloadConsumed || !captured || captured.type !== "reload") return false;
  if (captured.path !== profilePathname(currentKey)) return false;
  reloadConsumed = true;
  return true;
}

export type ProfileScrollPlan = { action: ProfileScrollDecision; scrollY: number };

/**
 * Read the arm, the pop flag, and this profile's snapshot once.
 * Restore keeps the snapshot so a later Back can use it.
 * A fresh open or a reload of this profile forgets it.
 */
export function takeProfileScrollPlan(currentKey: string): ProfileScrollPlan {
  const poppedNow = consumeProfilePop();
  const reload = consumeProfileReload(currentKey);
  const armedKey = readProfileScrollArm();
  const snapshot = readProfileScrollSnapshot(currentKey);
  const action = decideProfileScroll({
    currentKey,
    armedKey,
    popped: poppedNow,
    reload,
    hasSnapshot: snapshot != null,
  });
  if (action === "restore" && snapshot) {
    return { action, scrollY: snapshot.scrollY };
  }
  clearProfileScrollSnapshot(currentKey);
  if (armedKey === currentKey) disarmProfileScrollReturn();
  return { action, scrollY: 0 };
}

export function commitProfileScrollReturn(): void {
  disarmProfileScrollReturn();
}

export function releaseProfileScrollOutsideCorridor(pathname: string): void {
  const release = profileArmRelease(pathname);
  if (release === "keep") return;
  consumeProfilePop();
  if (release === "disarm") disarmProfileScrollReturn();
}

/** Height of the sticky mobile header. 0 when that bar is not showing. */
export function measureProfileHeaderOffset(): number {
  if (typeof document === "undefined") return 0;
  const nav = document.querySelector("[data-mobile-nav]");
  if (!(nav instanceof HTMLElement)) return 0;
  return nav.offsetHeight;
}

/**
 * Keep putting the window back on `scrollY` until Next's scroll-to-top
 * has had a chance to run. A wheel, touch, or click stops the correction
 * so we don't fight the visitor.
 */
export function pinProfileScroll(scrollY: number, onDone: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let stopped = false;
  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    onDone();
  };
  const apply = () => {
    if (stopped) return;
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
  const delays = [60, 180, 420, 900];
  const timers = delays.map((ms, index) =>
    window.setTimeout(() => {
      apply();
      if (index === delays.length - 1) commit();
    }, ms)
  );
  window.addEventListener("wheel", userStop, { passive: true });
  window.addEventListener("touchmove", userStop, { passive: true });
  window.addEventListener("pointerdown", userStop, true);
  return () => {
    stopped = true;
    window.cancelAnimationFrame(raf);
    for (const timer of timers) window.clearTimeout(timer);
    window.removeEventListener("wheel", userStop);
    window.removeEventListener("touchmove", userStop);
    window.removeEventListener("pointerdown", userStop, true);
  };
}
