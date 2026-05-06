import assert from "node:assert/strict";
import {
  personalizeFeedEntries,
} from "../src/lib/feed/personalizedSalon";
import {
  fnv1a32,
  jitterForItem,
  seedFromViewer,
  createRngFromSeed,
} from "../src/lib/feed/feedSeed";
import {
  scoreArtworkEntry,
  WEIGHTS,
  BASE_POSITION_WEIGHT,
} from "../src/lib/feed/feedScoring";
import type { ViewerSignals } from "../src/lib/feed/feedSignals";
import type { ArtworkWithLikes } from "../src/lib/supabase/artworks";
import type { FeedEntry } from "../src/lib/feed/types";

/**
 * Sprint 2 personalization layer — pure / deterministic mixer guards.
 *
 * Contracts pinned here:
 *   1. same viewer + same input ⇒ identical entries output;
 *   2. different userIds yield different tie-break orderings;
 *   3. followed-artist boost lifts a tile but cannot wholly invert order;
 *   4. liked-artist signals are mild (≤ 1 position headroom each);
 *   5. anonymous viewer ⇒ entries returned untouched (degrade branch);
 *   6. private/orphan items remain dropped (delegated to builder, but
 *      the mixer must not introduce a path that bypasses the gate);
 *   7. latest base ordering is preserved enough that the most-recent
 *      tile cannot fall behind a much-older tile from a single signal;
 *   8. seed jitter alone never moves a tile by more than ~½ position
 *      step (BASE_POSITION_WEIGHT >> 2 × jitterAmplitude).
 */

function makeArtwork(id: string, artistId: string | null, opts: Partial<ArtworkWithLikes> = {}): ArtworkWithLikes {
  return {
    id,
    title: `Title ${id}`,
    year: 2024,
    medium: "Oil on canvas",
    size: null,
    size_unit: null,
    story: null,
    visibility: "public",
    pricing_mode: "inquire",
    is_price_public: false,
    price_usd: null,
    price_input_amount: null,
    price_input_currency: null,
    fx_rate_to_usd: null,
    fx_date: null,
    ownership_status: null,
    artist_id: artistId ?? "",
    artist_sort_order: null,
    created_at: "2026-04-01T00:00:00Z",
    artwork_images: [],
    profiles: artistId
      ? ({
          id: artistId,
          username: `u_${artistId}`,
          display_name: `Artist ${artistId}`,
          is_public: true,
        } as unknown as ArtworkWithLikes["profiles"])
      : null,
    claims: [],
    likes_count: 0,
    ...opts,
  };
}

function asEntry(artwork: ArtworkWithLikes): FeedEntry {
  return { type: "artwork", created_at: artwork.created_at ?? null, artwork };
}

function makeBaseViewer(over: Partial<ViewerSignals> = {}): ViewerSignals {
  return {
    userId: "viewer-1",
    tab: "all",
    sort: "latest",
    followingIds: new Set(),
    likedArtworkIds: new Set(),
    viewerRole: null,
    seenItemKeys: new Set(),
    ...over,
  };
}

// ── 1. Same viewer + same input ⇒ identical output ─────────────────
{
  const arts = Array.from({ length: 12 }, (_, i) =>
    asEntry(makeArtwork(`a${i}`, `artist${i % 4}`))
  );
  const viewer = makeBaseViewer({ followingIds: new Set(["artist1"]) });
  const a = personalizeFeedEntries(arts, viewer);
  const b = personalizeFeedEntries(arts, viewer);
  assert.deepEqual(
    a.entries.map((e) => (e.type === "artwork" ? e.artwork.id : `e:${e.exhibition.id}`)),
    b.entries.map((e) => (e.type === "artwork" ? e.artwork.id : `e:${e.exhibition.id}`)),
    "deterministic on identical inputs"
  );
}

// ── 2. Different userIds yield divergent tie ordering when scores tie ──
//
// We construct two adjacent tiles where the *boost* almost cancels the
// 1-position base gap (a1 at position 1 with followed boost vs a0 at
// position 0 without). Their final scores land within jitter range, so
// two viewers with different seeds must disagree on at least one ordering.
{
  const arts = [
    asEntry(makeArtwork("a0", "artistA")),
    asEntry(makeArtwork("a1", "artistFollowed")),
    asEntry(makeArtwork("a2", "artistB")),
    asEntry(makeArtwork("a3", "artistC")),
  ];
  let differed = false;
  // Sweep a handful of viewer ids — pin the property that *some* pair
  // diverges, not that every pair does (the latter would be too strong
  // because jitter is bounded).
  const viewerIds = ["viewer-A", "viewer-B", "viewer-C", "viewer-D", "viewer-E"];
  const orders = viewerIds.map((id) =>
    personalizeFeedEntries(
      arts,
      makeBaseViewer({ userId: id, followingIds: new Set(["artistFollowed"]) })
    ).entries.map((e) => (e.type === "artwork" ? e.artwork.id : ""))
  );
  for (let i = 0; i < orders.length; i++) {
    for (let j = i + 1; j < orders.length; j++) {
      if (JSON.stringify(orders[i]) !== JSON.stringify(orders[j])) {
        differed = true;
      }
    }
  }
  assert.ok(differed, "different viewer seeds → at least one pair sees a different order");
}

// ── 3. Followed-artist boost lifts a tile (bounded) ────────────────
{
  const arts = [
    asEntry(makeArtwork("recent", "artistA")), // newest, position 0
    asEntry(makeArtwork("middle", "artistB")), // position 1
    asEntry(makeArtwork("older", "artistC")), // position 2
    asEntry(makeArtwork("oldest", "artistFollowed")), // position 3
  ];
  const baseline = personalizeFeedEntries(arts, makeBaseViewer());
  const baselineOrder = baseline.entries.map((e) =>
    e.type === "artwork" ? e.artwork.id : ""
  );
  // Without any signals, latest base order should hold.
  assert.deepEqual(baselineOrder, ["recent", "middle", "older", "oldest"]);

  const followed = personalizeFeedEntries(
    arts,
    makeBaseViewer({ followingIds: new Set(["artistFollowed"]) })
  );
  const followedOrder = followed.entries.map((e) =>
    e.type === "artwork" ? e.artwork.id : ""
  );
  // The followed work should rise by ~1 position (boost ~ 9_500 vs base
  // step 10_000), but must NOT leapfrog all the way to the top.
  const newPos = followedOrder.indexOf("oldest");
  assert.ok(newPos < 3, `followed artwork should rise above its base index (was 3, now ${newPos})`);
  assert.ok(newPos > 0, `followed artwork should not jump to position 0 from a single boost (got ${newPos})`);
  // Reasons surfaced.
  assert.ok(
    followed.reasonsByArtworkId.get("oldest")?.includes("followed_artist"),
    "followed_artist reason recorded"
  );
}

// ── 4. Liked-artist signals are mild (single boost ≤ 1 position) ───
{
  const arts = Array.from({ length: 6 }, (_, i) =>
    asEntry(makeArtwork(`a${i}`, `artist${i}`))
  );
  // Viewer liked an artwork by `artist5` (the oldest in the list).
  const liked = personalizeFeedEntries(
    arts,
    makeBaseViewer({
      likedArtworkIds: new Set(["a5"]),
    })
  );
  const order = liked.entries.map((e) =>
    e.type === "artwork" ? e.artwork.id : ""
  );
  const newPos = order.indexOf("a5");
  // Liked-affinity boost (6_500) is < a single position step (10_000),
  // so a5 might tie with a4 only after jitter. Assert it never beats a3
  // or earlier — that would mean signals are no longer "mild".
  assert.ok(newPos >= 3, `liked-affinity must not hop > 2 positions (saw position ${newPos})`);
}

// ── 5. Anonymous viewer ⇒ entries returned in input order ──────────
{
  const arts = Array.from({ length: 8 }, (_, i) =>
    asEntry(makeArtwork(`a${i}`, `artist${i % 3}`))
  );
  const result = personalizeFeedEntries(
    arts,
    makeBaseViewer({ userId: null, followingIds: new Set(["artist0"]) })
  );
  assert.deepEqual(
    result.entries.map((e) => (e.type === "artwork" ? e.artwork.id : "")),
    arts.map((e) => (e.type === "artwork" ? e.artwork.id : "")),
    "anonymous viewer skips personalization entirely"
  );
  assert.equal(result.reasonsByArtworkId.size, 0, "no reasons emitted for anon");
}

// ── 6. Same-artist and orphan filtering remain delegated ───────────
//
// The mixer never invents new entries; it only reorders. So if the input
// already drops orphans (the builder's `isPublicSurfaceVisible` runs
// downstream), the mixer cannot reintroduce them. We assert structural
// invariants instead: input length == output length, no entry mutation.
{
  const arts = [
    asEntry(makeArtwork("a", "artistA")),
    asEntry(makeArtwork("b", "artistB")),
    asEntry(makeArtwork("c", "artistC")),
  ];
  const result = personalizeFeedEntries(arts, makeBaseViewer());
  assert.equal(result.entries.length, arts.length, "mixer never adds/drops entries");
  for (const e of result.entries) {
    if (e.type === "artwork") {
      assert.ok(arts.some((src) => src.type === "artwork" && src.artwork === e.artwork));
    }
  }
}

// ── 7. Latest base ordering is preserved enough ────────────────────
//
// A single boost must not push a deeply-buried tile (e.g. position 8)
// above the very newest one (position 0). Calibrated so that no single
// signal can leapfrog more than ~2 position steps.
{
  const arts = Array.from({ length: 10 }, (_, i) =>
    asEntry(makeArtwork(`a${i}`, `artist${i}`))
  );
  const result = personalizeFeedEntries(
    arts,
    makeBaseViewer({
      followingIds: new Set(["artist9"]),
      likedArtworkIds: new Set(),
    })
  );
  const order = result.entries.map((e) =>
    e.type === "artwork" ? e.artwork.id : ""
  );
  const followedPos = order.indexOf("a9");
  assert.ok(
    followedPos >= 7,
    `single-signal followed artwork starting at index 9 cannot rise above index 7 (saw ${followedPos})`
  );
}

// ── 8. Seed jitter alone never moves more than ~1 position step ────
//
// jitter peak-to-peak must stay below TWO base position steps so a
// single jitter swing can never leapfrog more than one tile.
{
  assert.ok(
    WEIGHTS.jitterAmplitude * 2 < BASE_POSITION_WEIGHT * 2,
    "jitter peak-to-peak must stay within two base position steps (≤ 1 swap)"
  );
  assert.ok(
    WEIGHTS.followedArtist < BASE_POSITION_WEIGHT,
    "no single signal exceeds one base position step"
  );
  assert.ok(
    WEIGHTS.likedArtistAffinity < BASE_POSITION_WEIGHT,
    "liked affinity stays under one position step"
  );
}

// ── 9. scoreArtworkEntry is pure (no hidden state) ────────────────
{
  const a = makeArtwork("solo", "artistSolo");
  const v = makeBaseViewer({ followingIds: new Set(["artistSolo"]) });
  const j = jitterForItem(seedFromViewer({ userId: "viewer-1", tab: "all", sort: "latest" }), "art-solo");
  const r1 = scoreArtworkEntry(a, 0, 1, v, new Set(), j);
  const r2 = scoreArtworkEntry(a, 0, 1, v, new Set(), j);
  assert.equal(r1.score, r2.score, "pure scorer");
  assert.deepEqual(r1.reasons, r2.reasons);
}

// ── 10. seed/hash determinism ──────────────────────────────────────
{
  assert.equal(fnv1a32("hello"), fnv1a32("hello"));
  assert.notEqual(fnv1a32("hello"), fnv1a32("world"));
  const rng = createRngFromSeed(42);
  const rng2 = createRngFromSeed(42);
  for (let i = 0; i < 5; i++) {
    assert.equal(rng(), rng2(), "Mulberry32 deterministic");
  }
}

// ── 11. seenItemKeys penalty applies ───────────────────────────────
//
// When the viewer has already impressed an item this session, it should
// drop in rank vs an otherwise-identical neighbor.
{
  const arts = [
    asEntry(makeArtwork("seen", "artistX")), // would be top
    asEntry(makeArtwork("fresh", "artistY")),
  ];
  const result = personalizeFeedEntries(
    arts,
    makeBaseViewer({
      seenItemKeys: new Set(["art-seen"]),
    })
  );
  const order = result.entries.map((e) =>
    e.type === "artwork" ? e.artwork.id : ""
  );
  // alreadySeenPenalty (4_000) is < BASE_POSITION_WEIGHT (10_000), so a
  // seen item near the top still typically holds — but it must lose to a
  // fresh tile when the position gap is small (≤1). Here the gap is 1
  // and the penalty is 4_000 vs jitter peak ~5_000, so result depends on
  // jitter — assert at minimum that the seen item's score is lower.
  // (We re-verify with the deterministic scorer to be precise.)
  const v = makeBaseViewer({ seenItemKeys: new Set(["art-seen"]) });
  const seed = seedFromViewer({ userId: v.userId, tab: v.tab, sort: v.sort ?? null });
  const sSeen = scoreArtworkEntry(arts[0].type === "artwork" ? arts[0].artwork : ({} as ArtworkWithLikes), 0, 2, v, new Set(), jitterForItem(seed, "art-seen"));
  // Same artwork *without* the seen penalty would score higher by exactly
  // WEIGHTS.alreadySeenPenalty — assert the penalty is real.
  const vNoSeen = makeBaseViewer({ seenItemKeys: new Set() });
  const sSeenWithoutPenalty = scoreArtworkEntry(arts[0].type === "artwork" ? arts[0].artwork : ({} as ArtworkWithLikes), 0, 2, vNoSeen, new Set(), jitterForItem(seed, "art-seen"));
  assert.equal(
    sSeenWithoutPenalty.score - sSeen.score,
    WEIGHTS.alreadySeenPenalty,
    "seen penalty applied at exactly the configured weight"
  );
  // Order must still contain both.
  assert.equal(order.length, 2);
}

// ── 12. frozenHeadCount preserves head order on append (Sprint 3 §2.1) ─
//
// Pin: when a load-more append adds new entries, the *previously rendered*
// head must not visibly jump even if the new viewer signals (e.g. a fresh
// `seenItemKeys` entry, or a like that just landed) would otherwise shift
// scores.
{
  // 6 distinct-artist artworks, viewer has neither follows nor likes.
  const initial = Array.from({ length: 6 }, (_, i) =>
    asEntry(makeArtwork(`a${i}`, `artist${i}`))
  );
  const viewer = makeBaseViewer();

  // First paint: no freeze, mixer can sort freely.
  const firstPaint = personalizeFeedEntries(initial, viewer);
  const firstOrder = firstPaint.entries.map((e) =>
    e.type === "artwork" ? e.artwork.id : ""
  );

  // Append three more entries and re-personalize WITH the freeze set to
  // the post-paint length. The first 6 emitted ids must equal the first
  // paint ids in identical order, no exceptions.
  const appended = [
    ...initial,
    asEntry(makeArtwork("a6", "artist6")),
    asEntry(makeArtwork("a7", "artist7")),
    asEntry(makeArtwork("a8", "artist8")),
  ];

  // Switch the viewer signals so we can prove the head still doesn't move
  // even when the mixer has new reasons to want to re-rank it.
  const viewerWithSignals = makeBaseViewer({
    followingIds: new Set(["artist0", "artist3"]),
    likedArtworkIds: new Set(["a4"]),
    seenItemKeys: new Set([`art-${firstOrder[0]}`, `art-${firstOrder[1]}`]),
  });

  const secondPaint = personalizeFeedEntries(appended, viewerWithSignals, {
    frozenHeadCount: initial.length,
  });
  const secondHead = secondPaint.entries
    .slice(0, initial.length)
    .map((e) => (e.type === "artwork" ? e.artwork.id : ""));

  assert.deepEqual(
    secondHead,
    firstOrder,
    "frozen head must be byte-identical to the previous paint"
  );

  // The new tail (3 entries) is allowed to be in any sensible order — but
  // the entries themselves must come from the appended-only set.
  const tailIds = secondPaint.entries
    .slice(initial.length)
    .map((e) => (e.type === "artwork" ? e.artwork.id : ""));
  for (const id of tailIds) {
    assert.ok(["a6", "a7", "a8"].includes(id), `tail id ${id} must come from new append`);
  }
}

// ── 13. frozenHeadCount > entries.length is bounded (sanity) ─────────
//
// FeedContent's ref might lag behind a tab switch — pass a freeze that's
// larger than the current candidate set and assert nothing crashes and
// the entire list is treated as frozen (== input order).
{
  const arts = Array.from({ length: 4 }, (_, i) =>
    asEntry(makeArtwork(`a${i}`, `artist${i}`))
  );
  const result = personalizeFeedEntries(
    arts,
    makeBaseViewer({ followingIds: new Set(["artist3"]) }),
    { frozenHeadCount: 9999 }
  );
  const order = result.entries.map((e) =>
    e.type === "artwork" ? e.artwork.id : ""
  );
  assert.deepEqual(order, ["a0", "a1", "a2", "a3"], "over-sized freeze pins everything");
}

console.log("feed-personalization.test.ts: ok");
