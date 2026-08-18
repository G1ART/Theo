/**
 * P1 Display / Hang Simulation — renderer-agnostic geometry helpers.
 *
 * These functions are the math bridge between the persisted scene model
 * (centimetres, normalized photo corners, degrees) and both renderers:
 *
 *   • 2D room-photo (Chunk C) — consumes `placementCanvasCssTransform`
 *     to place a DOM overlay per placement.
 *   • Future 3D parametric — reads the same placement rows directly
 *     from `SceneSpace.placements` without going through this module.
 *
 * The perspective projection reuses `@/lib/image/enhancement/homography`
 * (the same 4-point solver that powers `PerspectiveCornerPicker`). The
 * only new math here is:
 *
 *   1. Building the *surface-local → image* homography from the
 *      surface's four normalized photo corners.
 *   2. Rotating a placement's local rectangle around its own centre
 *      by `rot_z_deg` before projecting.
 *   3. Encoding the resulting 2D projective transform as a 4×4
 *      `matrix3d` that CSS accepts.
 *
 * All functions are PURE — no DOM access, no async, no globals — so they
 * are trivially unit-testable and safe to call inside React render.
 *
 * Conventions
 * -----------
 *   • **Placement origin** = the CENTRE of the placement rectangle in
 *     surface coordinates. `rot_z_deg` therefore rotates the rectangle
 *     about its own centre, matching how a picture pivots on its
 *     hanging point.
 *   • **Surface origin** = the top-left corner (`photo_corners.tl`)
 *     with the x-axis running to the top-right corner (`tr`) and the
 *     y-axis running to the bottom-left corner (`bl`).
 *   • **Photo corner order** = TL, TR, BR, BL — same as
 *     `homographyForCorners` and the corner picker.
 */

import {
  applyHomography,
  solveHomography,
  type Homography,
  type Point2,
} from "@/lib/image/enhancement/homography";
import type { PhotoCorners, ScenePlacement, SceneSurface } from "./scene";

// ─── Small pure math helpers ────────────────────────────────────────

/** Convert centimetres to pixels using a given `pxPerCm` scale. */
export function cmToPx(cm: number, pxPerCm: number): number {
  if (!Number.isFinite(cm) || !Number.isFinite(pxPerCm)) return 0;
  return cm * pxPerCm;
}

/** Convert pixels back to centimetres. Safe when `pxPerCm` is 0. */
export function pxToCm(px: number, pxPerCm: number): number {
  if (!Number.isFinite(px) || !Number.isFinite(pxPerCm) || pxPerCm === 0) return 0;
  return px / pxPerCm;
}

/** Photo pixel dimensions. */
export type ImagePxSize = { w: number; h: number };

/** Denormalize a `PhotoCorners` set into absolute image pixel points. */
export function photoCornersToPx(
  corners: PhotoCorners,
  imagePxSize: ImagePxSize,
): { tl: Point2; tr: Point2; br: Point2; bl: Point2 } {
  const w = Math.max(0, imagePxSize.w);
  const h = Math.max(0, imagePxSize.h);
  return {
    tl: [corners.tl.x * w, corners.tl.y * h],
    tr: [corners.tr.x * w, corners.tr.y * h],
    br: [corners.br.x * w, corners.br.y * h],
    bl: [corners.bl.x * w, corners.bl.y * h],
  };
}

/** Euclidean distance between two pixel points. */
function distance(a: Point2, b: Point2): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── pxPerCm from the surface's projected top edge ──────────────────

/**
 * Derive a `pxPerCm` scale from the surface's projected top edge.
 *
 * Rationale: the top edge is closest to the camera in a typical
 * eye-level room photo, so measuring `topEdgePx / surface.widthCm`
 * gives us the tightest cm↔px mapping at the placement's baseline.
 * The perspective foreshortening down the wall is then re-introduced
 * by the homography step, so the actual placement never ends up
 * "wrongly stretched" — this scale is just what we need to size the
 * placement's local surface-pixel rectangle before projection.
 *
 * Returns `1` (a defensive fallback) when the surface has no
 * `widthCm` or `photoCorners` yet — that keeps the pipeline running
 * during the calibration UX in Chunk C, and every downstream
 * consumer produces a sensible (albeit uncalibrated) rectangle.
 */
export function computeSurfacePxScale(
  surface: SceneSurface,
  imagePxSize: ImagePxSize,
): number {
  if (
    !surface.photoCorners ||
    surface.widthCm == null ||
    !Number.isFinite(surface.widthCm) ||
    surface.widthCm <= 0 ||
    imagePxSize.w <= 0 ||
    imagePxSize.h <= 0
  ) {
    return 1;
  }
  const { tl, tr } = photoCornersToPx(surface.photoCorners, imagePxSize);
  const topEdgePx = distance(tl, tr);
  if (!Number.isFinite(topEdgePx) || topEdgePx <= 0) return 1;
  const pxPerCm = topEdgePx / surface.widthCm;
  return Number.isFinite(pxPerCm) && pxPerCm > 0 ? pxPerCm : 1;
}

/**
 * Surface-local pixel dimensions computed from the surface's cm
 * extent and the derived `pxPerCm` scale. When `heightCm` is missing
 * we derive a proportional height from the average side-edge ratio so
 * the projection stays consistent. `pxPerCm` is exposed for callers
 * that need the same scale for placements.
 */
export function computeSurfaceLocalPx(
  surface: SceneSurface,
  imagePxSize: ImagePxSize,
): { widthPx: number; heightPx: number; pxPerCm: number } {
  const pxPerCm = computeSurfacePxScale(surface, imagePxSize);
  const widthCm = surface.widthCm ?? 0;
  const widthPx = widthCm > 0 ? widthCm * pxPerCm : imagePxSize.w;
  let heightPx: number;
  if (surface.heightCm != null && surface.heightCm > 0) {
    heightPx = surface.heightCm * pxPerCm;
  } else if (surface.photoCorners && imagePxSize.w > 0 && imagePxSize.h > 0) {
    // No calibrated height yet — fall back to the average projected
    // side length so the local rectangle roughly matches the photo
    // quad's aspect. This is only ever used until the user calibrates.
    const { tl, tr, br, bl } = photoCornersToPx(surface.photoCorners, imagePxSize);
    const leftH = distance(tl, bl);
    const rightH = distance(tr, br);
    const topW = distance(tl, tr);
    const bottomW = distance(bl, br);
    const avgH = (leftH + rightH) / 2;
    const avgW = (topW + bottomW) / 2;
    heightPx = avgW > 0 ? widthPx * (avgH / avgW) : widthPx;
  } else {
    heightPx = widthPx;
  }
  return { widthPx, heightPx, pxPerCm };
}

// ─── Surface-local ↔ image homography ───────────────────────────────

/**
 * Build the homography that maps a point in surface-local pixel space
 * (origin at top-left, x → right, y → down, extent
 * `surfaceWidthPx × surfaceHeightPx`) to image pixel space.
 *
 * Returns `null` when the surface has no `photoCorners` or the local
 * dimensions are degenerate. Callers should fall back to an
 * axis-aligned placement in that case.
 */
export function surfaceLocalToImageHomography(
  surface: SceneSurface,
  imagePxSize: ImagePxSize,
): Homography | null {
  if (!surface.photoCorners || imagePxSize.w <= 0 || imagePxSize.h <= 0) {
    return null;
  }
  const local = computeSurfaceLocalPx(surface, imagePxSize);
  if (local.widthPx <= 0 || local.heightPx <= 0) return null;
  const src: [Point2, Point2, Point2, Point2] = [
    [0, 0],
    [local.widthPx, 0],
    [local.widthPx, local.heightPx],
    [0, local.heightPx],
  ];
  const { tl, tr, br, bl } = photoCornersToPx(surface.photoCorners, imagePxSize);
  return solveHomography(src, [tl, tr, br, bl]);
}

// ─── Placement rectangles ───────────────────────────────────────────

/**
 * The four surface-local pixel corners of a placement, rotated in
 * plane by `rot_z_deg` around its own centre. Order matches
 * `PhotoCorners`: TL, TR, BR, BL.
 */
export function placementLocalCorners(
  placement: ScenePlacement,
  surface: SceneSurface,
  pxPerCm: number,
): [Point2, Point2, Point2, Point2] {
  const wCm = placement.widthCm ?? 0;
  const hCm = placement.heightCm ?? 0;
  const halfWpx = (wCm * pxPerCm) / 2;
  const halfHpx = (hCm * pxPerCm) / 2;
  const cx = placement.xCm * pxPerCm;
  const cy = placement.yCm * pxPerCm;
  const theta = (placement.rotZDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Suppress "surface unused" TypeScript warning while still keeping
  // the argument (call sites read cleaner and future 3D-aware
  // consumers may need it).
  void surface;

  function rot(dx: number, dy: number): Point2 {
    return [cx + cos * dx - sin * dy, cy + sin * dx + cos * dy];
  }
  return [
    rot(-halfWpx, -halfHpx),
    rot(+halfWpx, -halfHpx),
    rot(+halfWpx, +halfHpx),
    rot(-halfWpx, +halfHpx),
  ];
}

/**
 * The four image-space pixel corners of a placement — surface-local
 * corners projected through the surface homography. Returns `null`
 * when the surface has no `photoCorners` or the placement/photo
 * dimensions are degenerate. Order: TL, TR, BR, BL.
 */
export function placementRectInPhotoPx(
  placement: ScenePlacement,
  surface: SceneSurface,
  imagePxSize: ImagePxSize,
): [Point2, Point2, Point2, Point2] | null {
  const h = surfaceLocalToImageHomography(surface, imagePxSize);
  if (!h) return null;
  const { pxPerCm } = computeSurfaceLocalPx(surface, imagePxSize);
  const local = placementLocalCorners(placement, surface, pxPerCm);
  const projected = local.map((p) => applyHomography(h, p));
  if (projected.some((p) => p == null)) return null;
  return projected as [Point2, Point2, Point2, Point2];
}

// ─── matrix3d encoding for DOM overlays ─────────────────────────────

/**
 * The DOM overlay produced by `placementCanvasCssTransform`.
 *
 * Chunk C's 2D editor renders a `<div>` with the returned
 * `widthPx × heightPx` extent at position (0, 0) and applies
 * `transform: matrix3d(...)` + `transform-origin: 0 0` to warp it
 * onto the corresponding projected quad on the room photo. The div
 * SHOULD sit inside a wrapper positioned to (0, 0) in image pixel
 * space and sized to the photo's rendered pixel dimensions.
 */
export type PlacementCssTransform = {
  matrix3d: string;
  widthPx: number;
  heightPx: number;
};

/**
 * Encode a 2D homography as a CSS `matrix3d(...)` string.
 *
 * CSS `matrix3d` is a 4×4 column-major matrix acting on
 * `[x, y, z, 1]`. Given a 2D homography
 *
 *     H = [ a b c ]
 *         [ d e f ]
 *         [ g h i ]
 *
 * that produces `[X_num, Y_num, W] = H · [x, y, 1]` with a
 * perspective divide by `W`, the equivalent 4×4 is
 *
 *     [ a b 0 c ]
 *     [ d e 0 f ]
 *     [ 0 0 1 0 ]
 *     [ g h 0 i ]
 *
 * CSS applies the divide automatically when the transformed `w`
 * component is not 1, so the encoded matrix reproduces the same
 * projective mapping on any DOM element.
 */
export function homographyToCssMatrix3d(h: Homography): string {
  // Destructure into H rows: [h00 h01 h02; h10 h11 h12; h20 h21 h22].
  const [h00, h01, h02, h10, h11, h12, h20, h21, h22] = h;
  // Column-major flattening — see the JSDoc above for the source
  // rows. `matrix3d(m11..m14, m21..m24, m31..m34, m41..m44)`.
  const cols = [
    h00, h10, 0, h20, // col 1
    h01, h11, 0, h21, // col 2
    0,   0,   1, 0,   // col 3
    h02, h12, 0, h22, // col 4
  ];
  return `matrix3d(${cols.map((n) => (Number.isFinite(n) ? n : 0)).join(",")})`;
}

/**
 * Build the DOM overlay transform for a placement.
 *
 * Strategy:
 *   1. Compute the placement's `widthPx × heightPx` in surface-local
 *      pixel space (from `pxPerCm` × placement width/height cm).
 *   2. Solve a homography that maps the unit rectangle
 *      `(0, 0) → (widthPx, heightPx)` to the placement's four
 *      **image-space** corners (i.e. surface-local corners already
 *      projected through the surface homography, including the
 *      in-plane `rot_z_deg` rotation).
 *   3. Encode as `matrix3d`.
 *
 * When any of the inputs are degenerate (missing corners, zero
 * dimensions, singular solve) we return an identity transform sized
 * to a 1 × 1 px rectangle so the caller can render a placeholder
 * without special-casing null.
 */
export function placementCanvasCssTransform(
  placement: ScenePlacement,
  surface: SceneSurface,
  imagePxSize: ImagePxSize,
): PlacementCssTransform {
  const IDENTITY: PlacementCssTransform = {
    matrix3d: "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)",
    widthPx: 1,
    heightPx: 1,
  };
  if (imagePxSize.w <= 0 || imagePxSize.h <= 0) return IDENTITY;

  const { pxPerCm } = computeSurfaceLocalPx(surface, imagePxSize);
  const wPx = (placement.widthCm ?? 0) * pxPerCm;
  const hPx = (placement.heightCm ?? 0) * pxPerCm;
  if (wPx <= 0 || hPx <= 0) return IDENTITY;

  const projected = placementRectInPhotoPx(placement, surface, imagePxSize);
  if (!projected) {
    // No surface calibration yet — return an axis-aligned identity
    // overlay at (0, 0). Chunk C's editor treats missing corners as
    // "needs calibration" and hides these overlays anyway.
    return { matrix3d: IDENTITY.matrix3d, widthPx: wPx, heightPx: hPx };
  }
  const unitCorners: [Point2, Point2, Point2, Point2] = [
    [0, 0],
    [wPx, 0],
    [wPx, hPx],
    [0, hPx],
  ];
  const overlayHomography = solveHomography(unitCorners, projected);
  if (!overlayHomography) {
    return { matrix3d: IDENTITY.matrix3d, widthPx: wPx, heightPx: hPx };
  }
  return {
    matrix3d: homographyToCssMatrix3d(overlayHomography),
    widthPx: wPx,
    heightPx: hPx,
  };
}
