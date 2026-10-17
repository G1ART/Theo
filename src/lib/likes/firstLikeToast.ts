/** The "saved to your liked works" hint shows on the first two likes only. */

export const FIRST_LIKE_TOAST_KEY = "theo.likes.firstToast.v1";
export const FIRST_LIKE_TOAST_LIMIT = 2;

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

function defaultStore(): KeyValueStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True when this like should show the hint. Counts the showing. */
export function claimFirstLikeToast(store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    const shown = Number(store.getItem(FIRST_LIKE_TOAST_KEY) ?? "0");
    if (!Number.isFinite(shown) || shown >= FIRST_LIKE_TOAST_LIMIT) return false;
    store.setItem(FIRST_LIKE_TOAST_KEY, String(shown + 1));
    return true;
  } catch {
    return false;
  }
}
