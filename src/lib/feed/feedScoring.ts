/**
 * Personalized Salon Mixer — explainable, deterministic ranking.
 *
 * ## Calibration philosophy
 *
 * The single hardest constraint of this layer is the work-order's
 * "preserve `latest` and `popular` semantics" rule. A previous regression
 * silently flattened popular by re-sorting on `created_at`; we are not
 * about to repeat that.
 *
 * To stay faithful to the underlying RPC sort while still letting viewer
 * signals reorder a few tiles, we anchor every score on a *very large*
 * input-position term:
 *
 *   base = (LIST_LEN - position) * BASE_POSITION_WEIGHT
 *
 * `BASE_POSITION_WEIGHT` is set so that no single signal can leapfrog
 * a tile by more than ~1 position. In practice this means:
 *
 *   - a "followed artist" bonus can promote a work by ~1 position;
 *   - "liked-artist affinity" by less than that;
 *   - "already seen this session" penalty demotes by ~1/2 position;
 *   - per-viewer jitter peak-to-peak is *just over* one position step
 *     (5_500 × 2 = 11_000 vs base step 10_000), so two viewers can swap
 *     two adjacent tiles when the base scores differ by exactly one
 *     position step — but never more than one.
 *
 * → the resulting order *looks like* the RPC's `latest` or `popular`
 *   with a sprinkle of viewer-aware nudges, never a wholesale shuffle.
 *
 * Same-artist run softening lives in `livingSalon.ts`'s
 * `softenSameArtistRuns` (it runs *after* this layer in the builder),
 * so the same constraint isn't doubled up here where calibration could
 * silently drift.
 *
 * If you change `BASE_POSITION_WEIGHT`, re-derive the bonus/penalty
 * constants below to keep the same proportional headroom and re-run
 * `tests/feed-personalization.test.ts`.
 *
 * ## Pure / deterministic
 *
 * `scoreArtworkEntry` is a pure function of `(entry, viewer, position,
 * derived sets, jitter)`. No clock reads, no Math.random, no Supabase.
 * `tests/feed-personalization.test.ts` pins this contract.
 *
 * ## What we deliberately *do not* score
 *
 * - exhibition strips and people clusters: cadence is owned by
 *   `buildLivingSalonItems` (see livingSalon.ts §"Guarantees"). Mixing
 *   them in here would risk rebuilding the rhythm pipeline twice.
 * - inquiry-availability boost: the schema has `pricing_mode` /
 *   `is_price_public` — we add a tiny nudge for inquire-mode works
 *   (collector signal). Not a strong promoter.
 *
 * Every weight below is exported by name so dashboards / telemetry can
 * trace why a tile moved without code-reading.
 */

import type { ArtworkWithLikes } from "@/lib/supabase/artworks";
import type { ViewerRole, ViewerSignals } from "./feedSignals";

/**
 * Base weight per position in the source list. Picked at 10,000 so a
 * single position step dominates any single bonus/penalty below — no
 * one signal can leapfrog a tile by more than ~1–2 positions.
 */
export const BASE_POSITION_WEIGHT = 10_000;

/**
 * Bonus / penalty constants. Each value is a fraction of
 * `BASE_POSITION_WEIGHT` chosen so the *combined* signal never exceeds
 * roughly 2–3 position steps.
 *
 * The repeated-same-artist case is intentionally absent here: the
 * existing `softenSameArtistRuns` in `livingSalon.ts` runs *after* this
 * layer (the builder collects per-type artworks and applies the swap),
 * so we let one canonical place own that constraint instead of doubling
 * it up in two places where the calibrations could drift.
 */
export const WEIGHTS = {
  /** Viewer follows the artist of this work. Mild — promotes 1–2 tiles. */
  followedArtist: 9_500,
  /**
   * Viewer has liked another work by the same artist (taste affinity).
   * Slightly weaker than direct follow because likes drift faster than
   * intentional follows.
   */
  likedArtistAffinity: 6_500,
  /**
   * Tiny, role-aware nudge. Adds a small bias when the work-type matches
   * the viewer's persona (e.g. collector → inquire-mode work). Calibrated
   * to be smaller than a single position step so role can never override
   * the underlying sort.
   */
  viewerRoleAffinity: 2_500,
  /**
   * Tiny boost for works that signal "you can act on this here" (i.e.
   * `pricing_mode = "inquire"`). Helps collectors but never strong enough
   * to dominate; also applied with a fraction multiplier per role below.
   */
  inquiryAvailable: 2_000,
  /** Demotion when the viewer impressed this item in the current session. */
  alreadySeenPenalty: 4_000,
  /**
   * Random tie-break range. Multiplied by jitter ∈ (-1, 1) per tile so
   * different viewers shuffle near-tied items differently. Calibrated
   * so peak-to-peak (`2 × jitterAmplitude`) is *just* over one base
   * position step — that lets two viewers swap two adjacent tiles when
   * the base scores differ by exactly 1 position step, but never moves
   * a tile by more than ~1 position based on jitter alone. Combined
   * with a bonus of ≤ `BASE_POSITION_WEIGHT` per signal, the worst-case
   * leapfrog is ~2 positions — within the work order's spec.
   */
  jitterAmplitude: 5_500,
} as const;

/**
 * Role-specific multiplier on the inquiry-available boost. Collectors are
 * the only persona for whom "you can ask about this work" is a
 * distinguishing signal; for everyone else we keep it tiny so artist /
 * curator / gallerist feeds don't over-index on commerce-shaped work.
 */
const INQUIRY_BOOST_BY_ROLE: Record<string, number> = {
  collector: 1.0,
  gallerist: 0.5,
  curator: 0.25,
  artist: 0.0,
};

function inquiryRoleMultiplier(role: ViewerRole): number {
  if (!role) return 0.0;
  const key = String(role).trim().toLowerCase();
  return INQUIRY_BOOST_BY_ROLE[key] ?? 0.0;
}

/**
 * Reasons attached to a scored artwork. Used by the mixer to optionally
 * surface a *quiet* hint in the card UI. Empty array means "no clean
 * reason; do not show one" (work order §3.6).
 */
export type ScoreReason =
  | "followed_artist"
  | "liked_artist_affinity"
  | "inquiry_available"
  | "viewer_role_affinity";

export type ArtworkScoreResult = {
  /** Final score; higher = ranks earlier. */
  score: number;
  /** Set of named signals that contributed positively. */
  reasons: ScoreReason[];
};

/**
 * Compute a personalized score for one artwork in the feed list.
 *
 * @param artwork              the candidate work
 * @param positionFromTop      0-based index of the work in the *source*
 *                              list (i.e. RPC order). Lower index = higher
 *                              base score.
 * @param listLength           the source list length, used to normalize
 *                              the base term so it stays positive.
 * @param viewer               viewer signals; pass cheaply-derived sets.
 * @param likedArtistIds       set of artist ids the viewer has liked at
 *                              least one work from. Pre-derived once per
 *                              feed render to avoid N×M per-score work.
 * @param jitter               viewer-stable per-item jitter ∈ (-1, 1).
 *                              See `feedSeed.ts`.
 */
export function scoreArtworkEntry(
  artwork: ArtworkWithLikes,
  positionFromTop: number,
  listLength: number,
  viewer: ViewerSignals,
  likedArtistIds: ReadonlySet<string>,
  jitter: number
): ArtworkScoreResult {
  const reasons: ScoreReason[] = [];
  // Base term — guarantees that a 1-step position swap cannot be undone
  // by any single bonus below.
  let score = (listLength - positionFromTop) * BASE_POSITION_WEIGHT;

  const artistId = artwork.artist_id ?? null;

  if (artistId && viewer.followingIds.has(artistId)) {
    score += WEIGHTS.followedArtist;
    reasons.push("followed_artist");
  }

  if (artistId && likedArtistIds.has(artistId)) {
    score += WEIGHTS.likedArtistAffinity;
    reasons.push("liked_artist_affinity");
  }

  // Inquiry-available nudge, scaled by viewer role. `pricing_mode` lives on
  // every artwork row; missing values fall through with no boost.
  if (artwork.pricing_mode === "inquire") {
    const mult = inquiryRoleMultiplier(viewer.viewerRole ?? null);
    if (mult > 0) {
      score += WEIGHTS.inquiryAvailable * mult;
      reasons.push("inquiry_available");
    }
  }

  // Role affinity: tiny, role-shaped nudge for "this work fits your lane".
  // Today only the artist persona gets a small affinity for *other*
  // artists' new works (encourages discovery beyond their own circle);
  // collectors get a parallel nudge toward exhibition-linked works which
  // we approximate with the inquiry boost above. Kept deliberately
  // narrow to avoid silently re-shaping the feed by role.
  const role = viewer.viewerRole ? String(viewer.viewerRole).toLowerCase() : null;
  if (role === "artist" && artistId && viewer.userId && artistId !== viewer.userId) {
    score += WEIGHTS.viewerRoleAffinity;
    reasons.push("viewer_role_affinity");
  }

  if (
    viewer.seenItemKeys &&
    artwork.id &&
    viewer.seenItemKeys.has(`art-${artwork.id}`)
  ) {
    score -= WEIGHTS.alreadySeenPenalty;
  }

  // Final jitter — bounded by ±jitterAmplitude. Different viewers see
  // different tie-breaks; the same viewer sees the same jitter on
  // refresh because the seed is a function of (userId, tab, sort).
  score += jitter * WEIGHTS.jitterAmplitude;

  return { score, reasons };
}
