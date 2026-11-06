/**
 * Theo Bulletin unread dot. Device memory of the newest post the
 * reader has opened. No server column. A missing post list means no dot.
 */

export const BULLETIN_SEEN_KEY = "theo.bulletinSeenAt";

export function readBulletinSeenAt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(BULLETIN_SEEN_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function markBulletinSeen(publishedAt: string | null | undefined): void {
  if (!publishedAt || typeof window === "undefined") return;
  try {
    const prev = window.localStorage.getItem(BULLETIN_SEEN_KEY);
    if (prev && prev >= publishedAt) return;
    window.localStorage.setItem(BULLETIN_SEEN_KEY, publishedAt);
  } catch {
    // Private mode — the dot can return next time.
  }
}

/** True only when a post exists and it is newer than what was opened. */
export function bulletinHasUnread(
  latestPublishedAt: string | null | undefined,
  seenAt: string | null | undefined,
): boolean {
  if (!latestPublishedAt) return false;
  if (!seenAt) return true;
  return latestPublishedAt > seenAt;
}
