/**
 * Personalized Salon Mixer (Sprint 2).
 *
 * Sits *between* the raw FeedEntry list (RPC order) and the deterministic
 * Living Salon presentation builder (`buildLivingSalonItems`). Its only
 * job is to reorder *artwork* entries according to viewer signals.
 *
 *   raw RPC entries
 *      │
 *      ▼
 *   personalizeFeedEntries(entries, viewer)   ← THIS MODULE
 *      │  (artwork order reshuffled by signals;
 *      │   exhibition order untouched)
 *      ▼
 *   buildLivingSalonItems(entries, …)
 *      │  (rhythm / cadence / anchor / persona-cluster / soften runs)
 *      ▼
 *   LivingSalonItem[]   →   <LivingSalonGrid />
 *
 * Why this split?
 *
 *   1. Builder stays *pure & deterministic on its inputs* — no viewer
 *      branching inside `livingSalon.ts`, so existing builder tests keep
 *      pinning the rhythm contract.
 *   2. The mixer is itself pure on `(entries, viewer)`, so it can be
 *      unit-tested with no DOM, no Supabase, no clock — see
 *      `tests/feed-personalization.test.ts`.
 *   3. Exhibition / people cadence stays exactly where it always lived
 *      (the builder), so we cannot accidentally break "no back-to-back
 *      context module" / "anchor at idx 3 or 4" by personalizing the
 *      rhythm pipeline.
 *
 * Anonymous viewers (null userId) skip personalization entirely and get
 * the raw RPC order, matching the work order's "degrade gracefully" rule.
 */

import type { FeedEntry } from "./types";
import type { ArtworkWithLikes } from "@/lib/supabase/artworks";
import { jitterForItem, seedFromViewer } from "./feedSeed";
import { deriveLikedArtistIds, type ViewerSignals } from "./feedSignals";
import { scoreArtworkEntry, type ScoreReason } from "./feedScoring";

export type PersonalizationResult = {
  /**
   * The same `entries` array with artwork entries reordered by score.
   * Exhibition entries keep their input order — the builder owns
   * exhibition cadence.
   */
  entries: FeedEntry[];
  /**
   * Per-artwork-id reason bag. Surface-side code (e.g. card hint UI) can
   * look this up to decide whether to render a quiet "From artists you
   * follow" line. Empty reasons array means "no clean reason" — never
   * hallucinate a hint.
   */
  reasonsByArtworkId: Map<string, ScoreReason[]>;
  /**
   * Diagnostic: the first few artwork ids in their final order, with
   * their score and reason tags. Surfaced in `/my/diagnostics` so we can
   * eyeball whether personalization is doing anything for the viewer.
   * Capped at 12 entries to keep payload small.
   */
  topDebug: Array<{
    artwork_id: string;
    score: number;
    reasons: ScoreReason[];
  }>;
};

const TOP_DEBUG_LIMIT = 12;

export type PersonalizeOptions = {
  /**
   * Sprint 3 hardening (audit §2.1). When set, the *first* `frozenHeadCount`
   * entries are emitted in their input order and never re-scored. Only
   * the remaining tail is personalized.
   *
   * Use this on infinite-scroll / load-more renders so already-painted
   * tiles cannot visibly jump when the new viewer signals (e.g. a freshly
   * impressed `seenItemKeys` entry, or a like that just landed) shift
   * scores. The work-order pins this as a non-negotiable acceptance
   * criterion: "Existing rendered items must not visibly jump on
   * load-more."
   *
   * The caller (FeedContent) increments this value to
   * `entries.length` after every successful paint, so each subsequent
   * paint freezes everything that was already on screen and only the
   * fresh tail moves.
   */
  frozenHeadCount?: number;
};

/**
 * Reorder a FeedEntry list using viewer signals. Pure function: same
 * inputs always produce the same outputs.
 *
 * Performance: O(n log n) on the artwork count from the single sort; one
 * additional O(m) pass derives `likedArtistIds` from the first artwork
 * scan. Both bounded by `FEED_PAGE_SIZE` (24 today), so ranking is
 * essentially free even on a low-end phone.
 */
export function personalizeFeedEntries(
  entries: FeedEntry[],
  viewer: ViewerSignals,
  opts: PersonalizeOptions = {}
): PersonalizationResult {
  // Build the artwork-id → artist-id map from the candidate set itself,
  // so we never need an extra fetch to derive liked-artist affinity.
  const artworkIdToArtistId = new Map<string, string | null>();
  for (const entry of entries) {
    if (entry.type === "artwork") {
      artworkIdToArtistId.set(entry.artwork.id, entry.artwork.artist_id ?? null);
    }
  }
  const likedArtistIds = deriveLikedArtistIds(
    viewer.likedArtworkIds,
    artworkIdToArtistId
  );

  // Anonymous viewers never get personalization. Returning the raw entry
  // order keeps the "degrade to default salon" branch trivially correct
  // — and dodges the case where seed jitter could re-shuffle a feed for
  // a logged-out user with no signals to differentiate by.
  if (viewer.userId == null) {
    return {
      entries: entries.slice(),
      reasonsByArtworkId: new Map(),
      topDebug: [],
    };
  }

  // Bound the freeze so callers cannot accidentally pass a stale value
  // larger than the current candidate set (e.g. after a tab switch the
  // ref might still hold the previous tab's larger length).
  const requestedFreeze = Math.max(0, opts.frozenHeadCount ?? 0);
  const frozenHeadCount = Math.min(requestedFreeze, entries.length);

  const seed = seedFromViewer({
    userId: viewer.userId,
    tab: viewer.tab,
    sort: viewer.sort ?? null,
  });

  // Scoring requires the original RPC position so the base term (which
  // dominates everything else) preserves the underlying `latest` /
  // `popular` order. We collect artwork entries first to know
  // `listLength`, then score them in place.
  //
  // The `frozenHeadCount` audit-§2.1 guard works at the *artwork-slot*
  // level: any artwork whose original entry index is within the frozen
  // head is skipped from re-ranking. We still accumulate it as a "pinned"
  // slot so its contribution to `listLength` (and therefore everyone
  // else's base score normalization) stays stable.
  const artworkSlots: Array<{
    originalIndex: number;
    artwork: ArtworkWithLikes;
    score: number;
    reasons: ScoreReason[];
    /** When true, this artwork must stay at its original position. */
    pinned: boolean;
  }> = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.type !== "artwork") continue;
    artworkSlots.push({
      originalIndex: i,
      artwork: e.artwork,
      score: 0,
      reasons: [],
      pinned: i < frozenHeadCount,
    });
  }

  const listLength = artworkSlots.length;
  for (let i = 0; i < artworkSlots.length; i++) {
    const slot = artworkSlots[i];
    if (slot.pinned) continue;
    const itemKey = `art-${slot.artwork.id}`;
    const jitter = jitterForItem(seed, itemKey);
    const result = scoreArtworkEntry(
      slot.artwork,
      i,
      listLength,
      viewer,
      likedArtistIds,
      jitter
    );
    slot.score = result.score;
    slot.reasons = result.reasons;
  }

  // Sort only the unpinned tail. Pinned slots stay in their input order;
  // we splice the sorted tail back into the artwork slot stream so the
  // re-emit pass below can keep using a single linear cursor.
  const pinnedSlots = artworkSlots.filter((s) => s.pinned);
  const tailSlots = artworkSlots
    .filter((s) => !s.pinned)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.originalIndex - b.originalIndex;
    });
  const orderedSlots = pinnedSlots.concat(tailSlots);

  // Re-emit the entries array: walk the original `entries` in order,
  // and whenever we hit an artwork slot, pull the *next* slot from the
  // ordered list. This preserves the *positions* of non-artwork entries
  // (so the builder still sees exhibitions in their original order)
  // while replacing artwork entries with the personalized order.
  const out: FeedEntry[] = new Array(entries.length);
  let cursor = 0;
  for (let i = 0; i < entries.length; i++) {
    const orig = entries[i];
    if (orig.type === "artwork") {
      const slot = orderedSlots[cursor++];
      const matching = entries[slot.originalIndex];
      if (matching && matching.type === "artwork") {
        out[i] = matching;
      } else {
        out[i] = orig;
      }
    } else {
      out[i] = orig;
    }
  }

  const reasonsByArtworkId = new Map<string, ScoreReason[]>();
  for (const slot of artworkSlots) {
    if (slot.reasons.length > 0) {
      reasonsByArtworkId.set(slot.artwork.id, slot.reasons);
    }
  }
  // For the diagnostic, use the post-sort tail (most informative) capped
  // to the limit. Pinned head contributions are by definition stable so
  // they're less useful for "did the mixer do anything" inspection.
  const topDebug = tailSlots.slice(0, TOP_DEBUG_LIMIT).map((s) => ({
    artwork_id: s.artwork.id,
    score: Math.round(s.score),
    reasons: s.reasons,
  }));

  return { entries: out, reasonsByArtworkId, topDebug };
}
