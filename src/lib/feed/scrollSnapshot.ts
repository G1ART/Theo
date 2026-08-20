"use client";

/**
 * Feed scroll + state snapshots for back-navigation restore.
 *
 * ## Why this exists
 *
 * Next.js 15 with the App Router does NOT preserve client state across
 * an out-and-back navigation on client-component leaves — when the user
 * hits Back from `/artwork/[id]` the `/feed` layout re-mounts, so any
 * paginated `useState` (loaded pages, next cursors, personalization
 * ordering) is thrown away and the browser scroll position resets to
 * 0. The visible symptom: the user scrolled to page 5 of infinite
 * scroll, tapped a card, came back — and now they're at the top of
 * page 1 again. They give up and close the tab.
 *
 * We fix this with a session-scoped snapshot: right before the user
 * leaves the feed (route push, tab hide, page unload), we serialize
 * the paging state + `window.scrollY` into `sessionStorage`. On the
 * next mount we hydrate from the snapshot BEFORE issuing the initial
 * fetch, then `scrollTo(scrollY)` in a `useLayoutEffect` so the paint
 * lands at the same offset the user left from.
 *
 * ## Trade-offs
 *
 * - `sessionStorage` (this module) vs. router cache: the App Router
 *   cache is HTTP-fetch-scoped and doesn't cover imperative client
 *   fetches (`listPublicArtworks`, `getFollowingIds`, etc.) that the
 *   feed uses. Snapshotting the derived state is simpler and works
 *   with any fetch layer.
 * - `sessionStorage` vs. `localStorage`: session-scoped is intentional —
 *   coming back to a browser tab hours later should show a fresh feed,
 *   not stale state. Also avoids per-user quota leaks.
 * - Snapshot size: we cap serialized size at 500KB and clip callers'
 *   payloads down to their most recent items before writing when they
 *   overflow. Storing images/blobs is explicitly out of scope — only
 *   the JSON needed to re-render.
 * - TTL: 5 minutes. Fresh enough to keep the illusion of "the feed I
 *   just saw", stale enough that a longer detour (deep artwork read,
 *   phone call) sees fresh discovery data on return.
 */

const SNAPSHOT_PREFIX = "feed:snapshot:v1:";

/** 5 minutes. Beyond this the discovery layer is likely stale enough
 *  that showing a fresh feed reads more accurate to the platform. */
export const SNAPSHOT_TTL_MS = 5 * 60 * 1000;

/** Safety cap on the JSON payload we serialize into sessionStorage.
 *  QuotaExceededError is per-origin (~5MB in most browsers) so a
 *  runaway feed accumulating hundreds of pages would eventually push
 *  out unrelated writes. 500KB is comfortably below the browser cap
 *  and covers ~1500 artwork rows worth of paging metadata — well past
 *  what a normal session ever loads. */
export const SNAPSHOT_MAX_BYTES = 500 * 1024;

export type FeedSnapshot<TState = unknown> = {
  key: string;
  state: TState;
  scrollY: number;
  savedAt: number;
};

function storageKey(key: string): string {
  return `${SNAPSHOT_PREFIX}${key}`;
}

function safeSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    // Some privacy modes throw on the *first* access to `sessionStorage`.
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Persist a feed snapshot under `feed:snapshot:v1:<key>`.
 *
 * Silently no-ops in SSR, when sessionStorage is unavailable (privacy
 * mode, Safari iframes), or when serialization exceeds the size cap.
 * Callers should clip their state to the newest N items themselves
 * before calling if the natural size can grow unbounded.
 */
export function saveFeedSnapshot(
  key: string,
  state: unknown,
  scrollY: number
): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  const snap: FeedSnapshot = {
    key,
    state,
    scrollY: Math.max(0, Math.round(scrollY)),
    savedAt: Date.now(),
  };
  let serialized: string;
  try {
    serialized = JSON.stringify(snap);
  } catch {
    return;
  }
  if (serialized.length > SNAPSHOT_MAX_BYTES) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[scrollSnapshot] Skipping oversize snapshot for "${key}" ` +
          `(${serialized.length}b > ${SNAPSHOT_MAX_BYTES}b). ` +
          `Caller should clip state to the newest N items.`
      );
    }
    return;
  }
  try {
    storage.setItem(storageKey(key), serialized);
  } catch {
    // QuotaExceededError, security errors, disabled storage — the
    // snapshot is a UX enhancement, never a hard requirement.
  }
}

/**
 * Read a feed snapshot. Returns null when missing, unparseable, or
 * older than `maxAgeMs` (default {@link SNAPSHOT_TTL_MS}). Stale
 * entries are cleared as a side effect so the next `writeFeedSnapshot`
 * doesn't accumulate dead weight.
 */
export function readFeedSnapshot<TState = unknown>(
  key: string,
  maxAgeMs: number = SNAPSHOT_TTL_MS
): FeedSnapshot<TState> | null {
  const storage = safeSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(storageKey(key));
  if (!raw) return null;
  let parsed: FeedSnapshot<TState>;
  try {
    parsed = JSON.parse(raw) as FeedSnapshot<TState>;
  } catch {
    try {
      storage.removeItem(storageKey(key));
    } catch {
      // ignore
    }
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.savedAt !== "number" ||
    typeof parsed.scrollY !== "number" ||
    parsed.key !== key
  ) {
    return null;
  }
  const age = Date.now() - parsed.savedAt;
  if (age > maxAgeMs) {
    try {
      storage.removeItem(storageKey(key));
    } catch {
      // ignore
    }
    return null;
  }
  return parsed;
}

/** Remove a specific snapshot (e.g. on tab/sort change or explicit
 *  pull-to-refresh). Safe to call when no snapshot exists. */
export function clearFeedSnapshot(key: string): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}

/**
 * Remove every `feed:snapshot:v1:*` entry. Called from the auth
 * `signOut` path so a new sign-in on the same tab starts with a fresh
 * personalization surface.
 */
export function clearAllFeedSnapshots(): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(SNAPSHOT_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => {
      try {
        storage.removeItem(k);
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}
