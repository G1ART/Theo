/**
 * Guided tour types.
 *
 * The tour framework is intentionally config-driven: new tours or copy
 * changes live in `tourRegistry.ts`, not in page-level files. Any change
 * that meaningfully alters steps/copy should bump `version` so returning
 * users see the refreshed tour once.
 */

export type TourPlacement = "top" | "bottom" | "left" | "right" | "auto";

export type TourStep = {
  /** Stable id within the tour (used for analytics + persistence). */
  id: string;
  /** `data-tour` attribute value of the element to spotlight. */
  target: string;
  /** i18n key for the step title. Keep crisp (≤ 6 words). */
  titleKey: string;
  /** i18n key for the body. 1–2 short sentences. */
  bodyKey: string;
  /** Preferred popover placement; framework falls back if clipped. */
  placement?: TourPlacement;
  /** Optional i18n key for a primary CTA label override. */
  ctaKey?: string;
  /**
   * If this step must be skipped conditionally (e.g. feature-flagged UI),
   * return `false` and the framework will silently skip it.
   */
  guard?: () => boolean;
};

export type TourDefinition = {
  /** Globally unique id, e.g. `studio.main`. */
  id: string;
  /**
   * Bump when the tour's steps or copy change meaningfully. Persistence is
   * keyed by (userId, tourId, version); users re-see only bumped tours.
   */
  version: number;
  /** i18n key for the tour's display name (used in the reopen menu). */
  titleKey: string;
  /**
   * Optional i18n key for a short tour subtitle shown on step 1 (intro).
   */
  introKey?: string;
  /**
   * List of steps, evaluated in order. Missing anchors are skipped.
   */
  steps: TourStep[];
  /**
   * At least one of these anchors must be present on the page for the
   * tour to auto-start. Prevents ghost tours on empty/conditional states.
   */
  requiredAnchors?: string[];
  /**
   * Pathnames this tour may remain active on. Leaving them skips/clears
   * the overlay so it cannot follow the user around the app.
   *
   * Rules (see `pathnameInTourScope`):
   *   - `"/my"` matches only `/my`
   *   - `"/upload/*"` matches `/upload` and `/upload/bulk`, etc.
   */
  routeScope: readonly string[];
};

export type TourStatus = "not_seen" | "in_progress" | "completed" | "skipped";

export type TourState = {
  tourId: string;
  version: number;
  status: TourStatus;
  lastStep: number;
  updatedAt: string;
};
