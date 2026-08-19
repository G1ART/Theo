/**
 * P1 Display / Hang Simulation — 2D renderer convenience layer.
 *
 * `renderScene2D` folds `transforms.ts` output with the caller-supplied
 * artwork thumbnail bag into a single list of DOM-ready draw records.
 * Chunk C's `/my/simulation/[id]` editor and `/space/[token]` public
 * view both call this and iterate straight into JSX — no more math on
 * the render path.
 *
 * The function is intentionally synchronous and pure: it does not fetch,
 * does not read the DOM, and does not depend on `window`. All I/O (space
 * fetch, artwork thumb fetch, storage URL resolution) belongs in
 * `spaces.ts`.
 */

import { placementCanvasCssTransform, type ImagePxSize } from "./transforms";
import type {
  ArtworkThumbForScene,
  ScenePlacement,
  SceneSpace,
  SceneSurface,
} from "./scene";

/**
 * P1 (2026-08-19) — Fallback placement dimensions used when NEITHER
 * the placement override NOR the artwork's canonical `width_cm` /
 * `height_cm` is populated. Legacy artworks (uploaded before the
 * dimensions gate landed) still have `width_cm = null` in the DB, and
 * every placement of such an artwork previously fell into the
 * `continue` branch below → invisible on canvas, unclickable, but
 * still persisted as a DB row. The symptom the P1 bug report calls
 * out ("배치 후 0.1초 flash → 사라짐") is this filter kicking in.
 *
 * 50 × 70 cm ≈ A2 portrait, a conservative "typical wall art" size
 * a collector will recognise as a reasonable placeholder. The
 * inspector's dimension inputs remain the source of truth — a user
 * who edits width/height on the placement immediately overrides the
 * fallback (and that override persists back to `space_placements`
 * so the next render is exact).
 */
export const PLACEMENT_FALLBACK_WIDTH_CM = 50;
export const PLACEMENT_FALLBACK_HEIGHT_CM = 70;

/**
 * Per-placement draw record. `css.zIndex` mirrors `placement.zOrder` so
 * DOM overlays stack in the same order the DB row list is drawn.
 */
export type RenderedPlacement = {
  placement: ScenePlacement;
  artwork: ArtworkThumbForScene;
  surface: SceneSurface | null;
  css: {
    matrix3d: string;
    widthPx: number;
    heightPx: number;
    zIndex: number;
  };
};

/** Thumbnail bag keyed by `artwork_id`. Loaders in `spaces.ts` populate it. */
export type ArtworkThumbMap = ReadonlyMap<string, ArtworkThumbForScene>;

/**
 * Fold a `SceneSpace` into an ordered list of DOM-ready placements.
 *
 * `imagePxSize` is the pixel size at which the room photo is being
 * displayed on the page. Callers should re-invoke this function on
 * container resize so the DOM overlays keep matching the underlying
 * `<img>`. All perspective math is projective, so the same pipeline
 * produces correct output at any display resolution.
 *
 * Placements whose `artwork_id` is not present in `artworks` are
 * silently dropped — this keeps the renderer resilient to a share
 * view where a public artwork was later unpublished (the placement
 * row is still there, but the artist has removed the work). The
 * upstream loader is responsible for surfacing that state to the
 * owner-side UI if desired.
 */
export function renderScene2D(
  space: SceneSpace,
  imagePxSize: ImagePxSize,
  artworks: ArtworkThumbMap,
): RenderedPlacement[] {
  const surfacesById = new Map<string, SceneSurface>();
  for (const s of space.surfaces) surfacesById.set(s.id, s);
  const primarySurface = space.surfaces[0] ?? null;

  const out: RenderedPlacement[] = [];
  for (const placement of space.placements) {
    const artwork = artworks.get(placement.artworkId);
    if (!artwork) continue;
    // Prefer the placement's explicit surface anchor; fall back to
    // the first surface on the space so freestanding placements
    // (surface_id = null) still render on the seeded wall in P1.
    const surface = placement.surfaceId
      ? surfacesById.get(placement.surfaceId) ?? primarySurface
      : primarySurface;
    if (!surface) continue;
    // Placement width/height override → artwork's canonical cm →
    // fallback. Legacy artworks (uploaded before the dimensions gate)
    // still have null width_cm/height_cm; without the fallback every
    // placement of such an artwork silently vanished from the canvas
    // (the "0.1초 flash → 사라짐" P1 bug). Substituting a sensible
    // default keeps the placement visible + editable so the user can
    // dial in the real size in the inspector.
    const resolvedWidth = placement.widthCm ?? artwork.widthCm ?? null;
    const resolvedHeight = placement.heightCm ?? artwork.heightCm ?? null;
    const widthCm =
      resolvedWidth != null && resolvedWidth > 0
        ? resolvedWidth
        : PLACEMENT_FALLBACK_WIDTH_CM;
    const heightCm =
      resolvedHeight != null && resolvedHeight > 0
        ? resolvedHeight
        : PLACEMENT_FALLBACK_HEIGHT_CM;
    const effectivePlacement: ScenePlacement = {
      ...placement,
      widthCm,
      heightCm,
    };
    const css = placementCanvasCssTransform(
      effectivePlacement,
      surface,
      imagePxSize,
    );
    out.push({
      placement: effectivePlacement,
      artwork,
      surface,
      css: {
        matrix3d: css.matrix3d,
        widthPx: css.widthPx,
        heightPx: css.heightPx,
        zIndex: placement.zOrder,
      },
    });
  }
  // `space.placements` is already sorted by z_order in `rowToSceneSpace`,
  // but explicit sort here keeps the contract obvious for direct
  // callers who bypass the mapper.
  out.sort((a, b) => a.css.zIndex - b.css.zIndex);
  return out;
}
