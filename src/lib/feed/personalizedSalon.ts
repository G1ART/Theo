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
  viewer: ViewerSignals
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

  const seed = seedFromViewer({
    userId: viewer.userId,
    tab: viewer.tab,
    sort: viewer.sort ?? null,
  });

  // Scoring requires the original RPC position so the base term (which
  // dominates everything else) preserves the underlying `latest` /
  // `popular` order. We collect artwork entries first to know
  // `listLength`, then score them in place.
  const artworkSlots: Array<{
    originalIndex: number;
    artwork: ArtworkWithLikes;
    score: number;
    reasons: ScoreReason[];
  }> = [];
  let artworkCounter = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.type !== "artwork") continue;
    artworkSlots.push({
      originalIndex: i,
      artwork: e.artwork,
      score: 0,
      reasons: [],
    });
    artworkCounter += 1;
  }

  const listLength = artworkCounter;
  for (let i = 0; i < artworkSlots.length; i++) {
    const slot = artworkSlots[i];
    const itemKey = `art-${slot.artwork.id}`;
    const jitter = jitterForItem(seed, itemKey);
    const result = scoreArtworkEntry(
      slot.artwork,
      i, // position in the source list (artwork-only ordering)
      listLength,
      viewer,
      likedArtistIds,
      jitter
    );
    slot.score = result.score;
    slot.reasons = result.reasons;
  }

  // Stable sort by score desc, with original index as tie-break so two
  // tiles with identical score never swap places between renders. The
  // ECMAScript spec guarantees `Array.prototype.sort` is stable since
  // ES2019, so the explicit tie-break is belt-and-suspenders.
  artworkSlots.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.originalIndex - b.originalIndex;
  });

  // Re-emit the entries array: walk the original `entries` in order,
  // and whenever we hit an artwork slot, pull the *next* slot from the
  // sorted list. This preserves the *positions* of non-artwork entries
  // (so the builder still sees exhibitions in their original order)
  // while replacing artwork entries with the personalized order.
  const out: FeedEntry[] = new Array(entries.length);
  let sortedCursor = 0;
  for (let i = 0; i < entries.length; i++) {
    const orig = entries[i];
    if (orig.type === "artwork") {
      const slot = artworkSlots[sortedCursor++];
      const matching = entries[slot.originalIndex];
      // Sanity guard — should always hold by construction, but cheap.
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
  const topDebug = artworkSlots.slice(0, TOP_DEBUG_LIMIT).map((s) => ({
    artwork_id: s.artwork.id,
    score: Math.round(s.score),
    reasons: s.reasons,
  }));

  return { entries: out, reasonsByArtworkId, topDebug };
}
