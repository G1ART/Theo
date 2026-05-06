"use client";

/**
 * Viewer signals consumed by the Personalized Salon Mixer.
 *
 * Sprint 2 deliberately keeps the signal surface tiny and explainable:
 *
 *   - `userId`              — null for anonymous; routes ranking into the
 *                             "default salon" branch so we never light up
 *                             personalization on someone we cannot
 *                             stably bucket.
 *   - `tab` / `sort`        — already in feed URL state. Part of the seed
 *                             so toggling tabs or sorts produces a fresh
 *                             stable shuffle, not a per-refresh shuffle.
 *   - `followingIds`        — set of profile ids the viewer follows. Drives
 *                             the followed-artist boost.
 *   - `likedArtworkIds`     — set of artwork ids the viewer has liked.
 *                             Drives the artist-affinity boost (other works
 *                             from the same artist).
 *   - `viewerRole`          — viewer's `main_role` if known. Drives a
 *                             very mild role-affinity nudge — never strong
 *                             enough to lock the feed into a single mode.
 *   - `seenItemKeys`        — Living-Salon item keys (`art-<id>`,
 *                             `exh-<id>`, `pc-<persona>-…`) the viewer
 *                             impressed in the *current session*. Drives
 *                             a small already-seen penalty so load-more
 *                             feels less repetitive.
 *
 * All signals are *cheap to compute* (Sets / strings) and arrive
 * pre-fetched on the FeedContent shell — the mixer never queries Supabase
 * at score time.
 *
 * NOTE: do NOT add long-lived analytics history here. The sprint
 * non-negotiables forbid querying analytics on every feed load.
 */

const IMPRESSION_DEDUP_KEY = "ab_feed_impressions_v1";

export type ViewerRole =
  | "artist"
  | "curator"
  | "gallerist"
  | "collector"
  | string
  | null;

export type ViewerSignals = {
  userId: string | null;
  tab: "all" | "following";
  sort?: "latest" | "popular";
  followingIds: ReadonlySet<string>;
  likedArtworkIds: ReadonlySet<string>;
  viewerRole?: ViewerRole;
  seenItemKeys?: ReadonlySet<string>;
};

/**
 * Read the per-session impression dedup set written by
 * `createImpressionTracker` (see `telemetry.ts`). Returns the bare *item
 * keys* (e.g. `art-<artwork.id>`), not the dedup tuples — so personalization
 * can match against `LivingSalonItem.key` without re-encoding.
 *
 * Storage shape (telemetry side): `JSON.stringify(["all:latest:art-x", …])`.
 * We strip the `${tab}:${sort}:` prefix on read so seen-state is
 * tab/sort-agnostic for the personalization layer — a viewer who saw a
 * work in `all` should still get a tiny seen penalty when they switch
 * to `following`. Strict tab/sort scoping for impression *fire* dedupe
 * stays intact, only the personalization read is broader.
 *
 * Returns an empty set on SSR or when storage is unreachable.
 */
export function readSeenItemKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(IMPRESSION_DEDUP_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      // Tuples are `${tab}:${sort}:${itemKey}` — split on the *first two*
      // colons only so item keys containing colons survive intact.
      const firstColon = entry.indexOf(":");
      if (firstColon === -1) continue;
      const secondColon = entry.indexOf(":", firstColon + 1);
      if (secondColon === -1) continue;
      out.add(entry.slice(secondColon + 1));
    }
    return out;
  } catch {
    return new Set();
  }
}

/**
 * Convenience: derive the set of artist ids the viewer has expressed
 * affinity for. Today this is just the set of artists for whom the viewer
 * has liked at least one artwork. We accept the artwork→artist map at
 * call time so callers (FeedContent) can pass the already-fetched feed
 * entries without extra IO.
 */
export function deriveLikedArtistIds(
  likedArtworkIds: ReadonlySet<string>,
  artworkIdToArtistId: ReadonlyMap<string, string | null>
): Set<string> {
  const out = new Set<string>();
  for (const id of likedArtworkIds) {
    const artistId = artworkIdToArtistId.get(id);
    if (artistId) out.add(artistId);
  }
  return out;
}
