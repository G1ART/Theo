/**
 * Display Simulation Phase 2 (2026-08-20) — mounting chrome helpers.
 *
 * The 2D renderer's "make it look like a real exhibition" pass
 * lives here as pure CSS-in-JS. Both the editor overlay and the
 * public `/space/[token]` view import these so the rendered
 * placement looks identical everywhere.
 *
 * Three axes combine:
 *
 *   1. `framePreset` — the mounting frame the user picked in the
 *      inspector. Five presets (`none` / `matte_white_thin` /
 *      `frame_black` / `frame_wood` / `canvas_edge`) map to a
 *      nested wrapper stack (outer frame → optional matte → image
 *      well). Frame thickness is expressed in physical cm and
 *      projected to px via `pxPerCm` so a 3 cm black frame looks
 *      3 cm thick regardless of the display resolution.
 *
 *   2. `lightDirection` — the wall-detect vision output persists a
 *      coarse direction hint (`top` / `top_left` / … / `diffuse` /
 *      `unknown`) into `space_surfaces.pose.lightDirection`. We
 *      translate it to a subtle CSS drop-shadow offset so the
 *      shadow reads as "cast by the ambient light in the room"
 *      instead of an unrelated arbitrary direction. Diffuse /
 *      unknown fall back to a soft "top" default.
 *
 *   3. `mountingDepth` — a fixed 2-4 mm lift illusion. A tighter
 *      secondary shadow under the outer frame gives the eye a
 *      "sits proud of the wall" cue without any 3D geometry.
 *
 * All helpers return plain React `CSSProperties` bags so callers
 * can spread them onto nested `<div>`s inline — no runtime CSS
 * classes, no dependency on Tailwind's `arbitrary values`.
 */

import type { CSSProperties } from "react";
import type { FramePreset } from "./scene";
import type { ResolvedImageSource } from "./renderer2d";

// ─── Frame preset physical dimensions ────────────────────────────────
//
// The preset name is the mounting style; the dimensions here are the
// physical thickness of the frame / matte / canvas edge in centimetres.
// Rendering translates cm → px via `pxPerCm` so a 3 cm black frame
// stays 3 cm thick at every display resolution.

type FrameGeometry = {
  /** Outer frame thickness (0 = no frame). */
  frameCm: number;
  /** Optional white matte inside the frame (0 = no matte). */
  matteCm: number;
  /** Whether the "canvas edge" side-illusion linear-gradient applies. */
  canvasEdge: boolean;
};

const FRAME_GEOMETRY: Record<FramePreset, FrameGeometry> = {
  none: { frameCm: 0, matteCm: 0, canvasEdge: false },
  matte_white_thin: { frameCm: 0, matteCm: 2, canvasEdge: false },
  frame_black: { frameCm: 3, matteCm: 0, canvasEdge: false },
  frame_wood: { frameCm: 5, matteCm: 0, canvasEdge: false },
  canvas_edge: { frameCm: 0, matteCm: 0, canvasEdge: true },
};

/** Resolves a nullable `framePreset` (DB stores null = "default") to
 *  a concrete preset. Currently defaults to `"none"` — a future
 *  workspace-level default can override this without changing call
 *  sites. */
export function resolveFramePreset(preset: FramePreset | null): FramePreset {
  return preset ?? "none";
}

export function framePresetGeometry(preset: FramePreset): FrameGeometry {
  return FRAME_GEOMETRY[preset];
}

// ─── Directional shadow ──────────────────────────────────────────────
//
// The wall-detect prompt reports the coarse light direction relative
// to the wall. We flip it to give the shadow direction (light from
// top-left → shadow cast to bottom-right, etc.). Values are pixel
// offsets tuned to read subtle at typical placement sizes (~200-600
// px on screen). Blur + alpha stay constant so shadows across
// multiple placements feel consistent.

export type LightDirection =
  | "top"
  | "top_left"
  | "left"
  | "bottom_left"
  | "bottom"
  | "bottom_right"
  | "right"
  | "top_right"
  | "diffuse"
  | "unknown";

const SHADOW_OFFSET_PX: Record<LightDirection, { dx: number; dy: number }> = {
  // Light from top → shadow directly below.
  top: { dx: 0, dy: 6 },
  top_left: { dx: 6, dy: 6 },
  left: { dx: 6, dy: 0 },
  bottom_left: { dx: 6, dy: -4 },
  bottom: { dx: 0, dy: -4 },
  bottom_right: { dx: -6, dy: -4 },
  right: { dx: -6, dy: 0 },
  top_right: { dx: -6, dy: 6 },
  // Diffuse / unknown → mirror the "top" default so unknown scenes
  // still get a natural cast rather than a hard-cornered stamp.
  diffuse: { dx: 0, dy: 6 },
  unknown: { dx: 0, dy: 6 },
};

const SHADOW_BLUR_PX = 14;
const SHADOW_ALPHA = 0.18;
/** Secondary tight shadow that produces the "sits proud of wall" cue. */
const LIFT_BLUR_PX = 3;
const LIFT_ALPHA = 0.24;
const LIFT_OFFSET_PX = 2;

/**
 * Compose the outer frame's drop-shadow filter. Two stacked
 * `drop-shadow`s — the wide directional cast + a tighter lift —
 * simulate mounting depth without any 3D geometry.
 */
export function frameOuterShadowFilter(light: LightDirection): string {
  const cast = SHADOW_OFFSET_PX[light];
  return [
    `drop-shadow(${cast.dx}px ${cast.dy}px ${SHADOW_BLUR_PX}px rgba(0,0,0,${SHADOW_ALPHA}))`,
    `drop-shadow(0 ${LIFT_OFFSET_PX}px ${LIFT_BLUR_PX}px rgba(0,0,0,${LIFT_ALPHA}))`,
  ].join(" ");
}

// ─── Frame preset visuals ────────────────────────────────────────────
//
// Each preset renders as OUTER_DIV → optional MATTE_DIV → IMAGE_DIV.
// `mountOuterStyle` decorates the outermost wrapper (with the drop-
// shadow filter), `mountMatteStyle` returns the inner matte styles
// (or null when the preset skips a matte), and `mountFrameBackground`
// returns the visual for the frame's border material (wood grain,
// black flat, etc.).

/**
 * Small, inline SVG data-URI reproducing subtle wood grain. Kept
 * inline so the browser needs no extra request and cache is trivial.
 */
const WOOD_GRAIN_SVG =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='0'%3E%3Cstop offset='0' stop-color='%23a26a3a'/%3E%3Cstop offset='0.5' stop-color='%23c8814a'/%3E%3Cstop offset='1' stop-color='%237a4a24'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='120' height='120' fill='url(%23g)'/%3E%3Cg stroke='rgba(51,25,10,0.10)' stroke-width='0.6' fill='none'%3E%3Cpath d='M0 10 Q60 4 120 12'/%3E%3Cpath d='M0 34 Q60 30 120 38'/%3E%3Cpath d='M0 58 Q60 52 120 64'/%3E%3Cpath d='M0 82 Q60 76 120 90'/%3E%3Cpath d='M0 106 Q60 100 120 114'/%3E%3C/g%3E%3C/svg%3E";

function frameBackground(preset: FramePreset): CSSProperties {
  switch (preset) {
    case "frame_black":
      return {
        background: "linear-gradient(180deg, #0a0a0a 0%, #1a1a1a 50%, #060606 100%)",
      };
    case "frame_wood":
      return {
        backgroundImage: `url("${WOOD_GRAIN_SVG}")`,
        backgroundSize: "60px 60px",
        backgroundRepeat: "repeat",
      };
    default:
      return {};
  }
}

// ─── Public API — one style bag per nested div ───────────────────────

export type MountLayers = {
  /** Outermost wrapper: absolute-positioned, sized to placement rect,
   *  carries the drop-shadow filter + selection ring + frame material. */
  outer: CSSProperties;
  /** Inner matte layer (`matte_white_thin`). `null` when the preset
   *  has no matte — caller should skip the wrapper entirely. */
  matte: CSSProperties | null;
  /** Innermost image well — background color for canvas_edge / matte,
   *  otherwise transparent to let the drop-shadow filter apply
   *  cleanly to the image itself. */
  imageWell: CSSProperties;
  /**
   * Padding on the outer frame in CSS pixels for the frame material,
   * used to shrink the inner matte / image well correctly. Returned
   * as a convenience so callers can also lay out overlay children.
   */
  framePx: number;
  /** Matte padding in CSS pixels (0 when the preset has no matte). */
  mattePx: number;
};

export type MountInputs = {
  preset: FramePreset;
  pxPerCm: number;
  lightDirection: LightDirection;
  /** Selection ring (editor only). Drawn as an outset outline that
   *  doesn't interact with the frame border thickness. */
  selected?: boolean;
  /**
   * When the resolved image source is `cutout_alpha`, we make the
   * image well transparent even when there is no matte — the alpha
   * cutout composites directly onto the wall photo behind, which
   * gives the strongest "real exhibition" look.
   */
  resolvedImageSource?: ResolvedImageSource;
};

export function buildMountLayers({
  preset,
  pxPerCm,
  lightDirection,
  selected = false,
  resolvedImageSource = "primary",
}: MountInputs): MountLayers {
  const geom = framePresetGeometry(preset);
  const framePx = Math.max(0, Math.round(geom.frameCm * pxPerCm));
  const mattePx = Math.max(0, Math.round(geom.matteCm * pxPerCm));
  const shadow = frameOuterShadowFilter(lightDirection);

  // Selection ring is a strong dark border via inset outline; the
  // frame material renders as background beneath it so both stay
  // visible even when the frame is thick.
  const selectionRing: CSSProperties = selected
    ? { outline: "2px solid rgba(15,23,42,0.95)", outlineOffset: 0 }
    : {};

  const outer: CSSProperties = {
    ...frameBackground(preset),
    // Padding on the outer wrapper controls how much of it shows
    // around the inner matte / image. `none` and `canvas_edge` have
    // no visible frame material, so padding is 0.
    padding: `${framePx}px`,
    boxSizing: "border-box",
    filter: shadow,
    ...selectionRing,
    // A tiny outer bevel highlight on the top edge — reads as
    // "light glances off top of frame" and works with every preset
    // including `none` (where framePx=0 collapses to a subtle
    // 1 px hairline that vanishes without a visible frame).
    ...(preset === "none"
      ? {}
      : {
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20)",
        }),
  };

  let matte: CSSProperties | null = null;
  if (mattePx > 0) {
    matte = {
      backgroundColor: "#fdfdfb",
      padding: `${mattePx}px`,
      boxSizing: "border-box",
      width: "100%",
      height: "100%",
      // Subtle inner shadow so the matte reads as a real physical
      // card rather than a flat colour swatch.
      boxShadow: "inset 0 0 10px rgba(0,0,0,0.10)",
    };
  }

  const imageWellBg: string = (() => {
    if (resolvedImageSource === "cutout_alpha") return "transparent";
    if (preset === "canvas_edge")
      // Thin side-edge illusion — subtle gradient at the borders so
      // the eye reads a shallow canvas depth.
      return "linear-gradient(90deg, rgba(0,0,0,0.06) 0%, transparent 4%, transparent 96%, rgba(0,0,0,0.06) 100%)";
    if (preset === "matte_white_thin") return "transparent";
    return "transparent";
  })();

  const imageWell: CSSProperties = {
    background: imageWellBg,
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };

  return { outer, matte, imageWell, framePx, mattePx };
}

/**
 * Best-effort extraction of the persisted light direction from a
 * surface's `pose` blob. `pose` is `Record<string, unknown> | null`
 * on the model side so we validate defensively.
 */
export function readLightDirection(
  pose: Record<string, unknown> | null | undefined,
): LightDirection {
  if (!pose) return "top";
  const v = pose.lightDirection;
  if (typeof v !== "string") return "top";
  const allowed: LightDirection[] = [
    "top",
    "top_left",
    "left",
    "bottom_left",
    "bottom",
    "bottom_right",
    "right",
    "top_right",
    "diffuse",
    "unknown",
  ];
  return (allowed as string[]).includes(v) ? (v as LightDirection) : "top";
}
