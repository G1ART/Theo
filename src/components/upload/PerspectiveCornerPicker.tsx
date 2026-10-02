"use client";

/**
 * Theo Image Enhance (Beta) — interactive 4-corner picker for the
 * flat-artwork perspective correction stage (2026-08-07).
 *
 * Contract
 * --------
 *  - Displayed as an overlay on the "before" preview inside
 *    `ImageStandardizeEditor` after the user opts in via the
 *    "원근 보정" toggle.
 *  - Seed corners come from `analyze.ts` when the rectangle
 *    confidence is >= 0.55; otherwise a 10 % inset quad.
 *  - Corners are always in normalized [0,1] coords, TL / TR / BR / BL.
 *  - Every mutation is filtered through `cornerPickerGeometry.ts`
 *    which enforces bounds + minimum quadrilateral area (10 %).
 *
 * Accessibility
 * -------------
 *  - Each handle is a real `role="slider"` DOM element with
 *    aria-valuemin/max/now on both axes so it renders as an XY-slider
 *    for screen readers.
 *  - Arrow keys nudge 1 px, Shift+Arrow nudges 10 px, Tab cycles.
 *  - Users can also drag with pointer/touch. Pointer capture keeps the
 *    drag alive when the pointer leaves the handle rect.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  computeKeyNudge,
  defaultInsetQuad,
  hasValidArea,
  nextCorner,
  tryMoveCorner,
  type CornerIndex,
  type Quad,
} from "@/lib/image/enhancement/cornerPickerGeometry";
import { useT } from "@/lib/i18n/useT";

type Props = {
  /** Image URL (blob:… or https:…) to display beneath the overlay. */
  imageUrl: string;
  /** Natural image dimensions — required so keyboard nudges stay
   *  pixel-accurate. */
  imageWidth: number;
  imageHeight: number;
  /** Seed corners. When absent (or degenerate) the picker falls back
   *  to a 10 % inset quad. */
  initialCorners: Quad | null;
  /** Corners the "Reset" button should snap back to. Typically the
   *  auto-detected corners from `analyze.ts`. */
  autoDetectedCorners: Quad | null;
  /**
   * Reset sentinel. Parent bumps this integer to explicitly re-seed the
   * picker (e.g. auto-detected corners re-computed after a new
   * analyzer run). Any change in this value snaps the internal quad
   * back to `seedQuad`. Without a change, parent re-renders never wipe
   * the user's in-flight drag. Optional — omit to only seed on mount.
   */
  resetToken?: number;
  /** Called with the final quad when the user confirms. */
  onConfirm: (quad: Quad) => void;
  /** Called when the user closes the picker without confirming. */
  onCancel: () => void;
  /**
   * F4 (2026-08-10) — streams the picker's current quad on every
   * mutation (drag / keyboard nudge / reset). Used by the wizard
   * shell so the parent-level "다음" button can snapshot the
   * picker state without going through the built-in Confirm button.
   * Optional; omit for the legacy popover invocation.
   */
  onChange?: (quad: Quad) => void;
  /**
   * F4 (2026-08-10) — hide the picker's internal action row
   * (Confirm / Cancel / Reset) so the wizard step can host its own
   * navigation. `onCancel` / `onConfirm` are still called via the
   * `onChange` stream + parent-driven advance. Reset is exposed
   * separately through the parent's chip.
   */
  hideActions?: boolean;
  /**
   * 2026-10-01 — when `true`, the quad polygon renders as a dashed
   * hint (not solid) so users understand the auto-detected corners
   * are a suggestion they should confirm. The parent sets this when
   * the seed came from the matte fallback or a low-confidence
   * rectangle detector (`rectangleConfidence < 0.55`).
   */
  autoHint?: boolean;
};

const HANDLE_LABELS = ["TL", "TR", "BR", "BL"] as const;

export function PerspectiveCornerPicker({
  imageUrl,
  imageWidth,
  imageHeight,
  initialCorners,
  autoDetectedCorners,
  resetToken,
  onConfirm,
  onCancel,
  onChange,
  hideActions = false,
  autoHint = false,
}: Props) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Seed derivation. Re-evaluates on every render but does NOT drive a
  // re-seed effect by itself — see the sentinel guards below.
  const seedQuad = useMemo<Quad>(() => {
    const seed = initialCorners && hasValidArea(initialCorners)
      ? initialCorners
      : autoDetectedCorners && hasValidArea(autoDetectedCorners)
        ? autoDetectedCorners
        : defaultInsetQuad(0.1);
    return seed;
  }, [initialCorners, autoDetectedCorners]);

  const seedQuadRef = useRef<Quad>(seedQuad);
  seedQuadRef.current = seedQuad;

  const [quad, setQuadRaw] = useState<Quad>(seedQuad);
  const [activeCorner, setActiveCorner] = useState<CornerIndex>(0);
  // 2026-10-01 — track the last quad we are confident is valid. Updated
  // every time `setQuad` is called with a quad that passes bounds +
  // area + convexity + TL/TR/BR/BL ordering. The Undo chip restores
  // from here when the user mashes a corner into an invalid region
  // repeatedly — `tryMoveCorner` already blocks the invalid moves, but
  // users sometimes still want to back out of a "last-known-good minus
  // one small drift" state.
  const lastValidQuadRef = useRef<Quad>(seedQuad);
  const dragCornerRef = useRef<CornerIndex | null>(null);
  const dragOriginRef = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);
  // Local reset counter — bumped when the user clicks "reset". Combined
  // with `resetToken` (parent-driven) drives the re-seed effect below.
  const [localResetTick, setLocalResetTick] = useState(0);
  // Keyboard focus tracker — a focused handle shows the magnifier even
  // without an active pointer drag.
  const [focusedCorner, setFocusedCorner] = useState<CornerIndex | null>(null);
  // State mirror of `dragCornerRef` so React re-renders when a drag
  // starts / ends. The ref remains the authoritative value for the
  // pointer handlers (they must not close over a stale state), but
  // the magnifier's visibility depends on this state.
  const [draggingCorner, setDraggingCorner] = useState<CornerIndex | null>(null);

  // Wrap setQuad so every state write is checked for validity and used
  // to update the `lastValidQuadRef` when it passes. The invalid state
  // path is normally unreachable (tryMoveCorner guards all mutations),
  // but we still snapshot the ref here so the Undo chip has a reliable
  // target even when parent-driven re-seeds come through.
  const setQuad = useCallback<Dispatch<SetStateAction<Quad>>>(
    (next) => {
      setQuadRaw((prev) => {
        const resolved: Quad =
          typeof next === "function"
            ? (next as (p: Quad) => Quad)(prev)
            : next;
        if (hasValidArea(resolved)) {
          lastValidQuadRef.current = resolved;
        }
        return resolved;
      });
    },
    [],
  );

  // Re-seed ONLY on mount and on explicit reset (parent bump of
  // `resetToken` or local reset button). Never on unrelated parent
  // re-renders — that used to wipe an in-flight drag. See release
  // 2026-08-09 corner-stick fix.
  useEffect(() => {
    if (dragCornerRef.current != null) return;
    lastValidQuadRef.current = seedQuadRef.current;
    setQuad(seedQuadRef.current);
  }, [resetToken, localResetTick, setQuad]);

  // F4 (2026-08-10) — stream quad changes to the wizard shell so a
  // parent-level "다음" button can commit without going through the
  // built-in Confirm control. Only fires when `onChange` is wired.
  useEffect(() => {
    if (typeof onChange !== "function") return;
    onChange(quad);
  }, [quad, onChange]);

  const rectBounds = useCallback(() => {
    // Prefer the actually-rendered image rect (object-contain letterbox)
    // over the raw container rect — otherwise handles land outside the
    // visible image when the container aspect ratio doesn't match the
    // image aspect ratio. Falls back to container rect on early mount
    // before the image has laid out.
    const el = imgRef.current;
    if (el && el.getBoundingClientRect().width > 0) {
      return el.getBoundingClientRect();
    }
    const c = containerRef.current;
    if (!c) return null;
    return c.getBoundingClientRect();
  }, []);

  const onPointerDown = useCallback(
    (corner: CornerIndex) =>
      (e: ReactPointerEvent<HTMLDivElement>) => {
        e.stopPropagation();
        e.preventDefault();
        const rect = rectBounds();
        if (!rect) return;
        dragCornerRef.current = corner;
        dragOriginRef.current = {
          px: e.clientX,
          py: e.clientY,
          cx: quad[corner][0],
          cy: quad[corner][1],
        };
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        setActiveCorner(corner);
        setDraggingCorner(corner);
      },
    [quad, rectBounds],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const active = dragCornerRef.current;
      const origin = dragOriginRef.current;
      const rect = rectBounds();
      if (active == null || !origin || !rect) return;
      const dx = (e.clientX - origin.px) / rect.width;
      const dy = (e.clientY - origin.py) / rect.height;
      setQuad((prev) =>
        tryMoveCorner(prev, active, [origin.cx + dx, origin.cy + dy]),
      );
    },
    [rectBounds, setQuad],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const active = dragCornerRef.current;
      if (active != null) {
        try {
          (e.currentTarget as Element).releasePointerCapture(e.pointerId);
        } catch {}
      }
      dragCornerRef.current = null;
      dragOriginRef.current = null;
      setDraggingCorner(null);
    },
    [],
  );

  const onHandleKeyDown = useCallback(
    (corner: CornerIndex) =>
      (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown"
        ) {
          e.preventDefault();
          const { dx, dy } = computeKeyNudge(
            e.key,
            e.shiftKey,
            imageWidth,
            imageHeight,
          );
          setQuad((prev) => {
            const next = tryMoveCorner(prev, corner, [
              prev[corner][0] + dx,
              prev[corner][1] + dy,
            ]);
            return next;
          });
          setActiveCorner(corner);
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          setActiveCorner(nextCorner(corner));
        }
      },
    [imageWidth, imageHeight, setQuad],
  );

  const handleReset = useCallback(() => {
    const target = autoDetectedCorners && hasValidArea(autoDetectedCorners)
      ? autoDetectedCorners
      : defaultInsetQuad(0.1);
    lastValidQuadRef.current = target;
    setQuad(target);
    setLocalResetTick((n) => n + 1);
  }, [autoDetectedCorners, setQuad]);

  // Undo chip — restores the last known-valid quad. In practice this
  // reverts whatever drift accumulated during an in-flight sequence of
  // small drags that each individually passed the geometry checks but
  // ended somewhere the user doesn't want. See 2026-10-01 bulk claim 2.
  const handleUndo = useCallback(() => {
    const target = lastValidQuadRef.current;
    if (!target || !hasValidArea(target)) return;
    setQuad(target);
  }, [setQuad]);

  const points = useMemo(
    () => quad.map(([x, y]) => `${x * 100}%,${y * 100}%`).join(" "),
    [quad],
  );

  // Track the object-contain rendered image rect relative to the outer
  // container so handles + SVG overlay align with the visible pixels.
  // Falls back to the container itself before the image lays out. See
  // ImageStandardizeEditor's Quick Adjust crop editor for the same
  // pattern (2026-08-09 corner-grab fix).
  const [imgRect, setImgRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>({ left: 0, top: 0, width: 0, height: 0 });
  useEffect(() => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container) return;
    const measure = () => {
      const cr = container.getBoundingClientRect();
      const target = img && img.getBoundingClientRect().width > 0 ? img : container;
      const r = target.getBoundingClientRect();
      setImgRect({
        left: r.left - cr.left,
        top: r.top - cr.top,
        width: r.width,
        height: r.height,
      });
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(container);
      if (img) ro.observe(img);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [imageUrl, imageWidth, imageHeight]);

  const HANDLE_DOT = 14;
  const HANDLE_HIT = 44;
  // Magnifier config (2026-10-01). Reads the backing image as a
  // CSS `background-image`, enlarged by `MAG_ZOOM`, scrolled so the
  // active corner falls at the magnifier center. We use the plain
  // image URL (no CORS canvas needed) so this works on blob: and
  // https: sources alike.
  const MAG_SIZE = 120;
  const MAG_ZOOM = 3;
  // The magnifier shows while the user is dragging OR while a handle
  // has keyboard focus — not when the picker is simply idle.
  const magCorner: CornerIndex | null =
    draggingCorner ?? focusedCorner;
  const showMagnifier =
    magCorner != null && imgRect.width > 0 && imgRect.height > 0;
  const magnifier = showMagnifier
    ? (() => {
        const [mx, my] = quad[magCorner];
        const cornerPxX = mx * imgRect.width;
        const cornerPxY = my * imgRect.height;
        // Flip the magnifier to the opposite side when the handle is
        // near a container edge so it stays fully inside the picker.
        const nearRight = cornerPxX > imgRect.width - MAG_SIZE - 24;
        const nearBottom = cornerPxY > imgRect.height - MAG_SIZE - 24;
        const left = imgRect.left + (nearRight ? cornerPxX - MAG_SIZE - 20 : cornerPxX + 20);
        const top = imgRect.top + (nearBottom ? cornerPxY - MAG_SIZE - 20 : cornerPxY + 20);
        // The visible image fits inside imgRect via `object-contain`,
        // so the backing image has the same displayed dimensions.
        // Multiply by MAG_ZOOM to make `background-size` and compute
        // the offset that pulls the corner to the magnifier center.
        const bgW = imgRect.width * MAG_ZOOM;
        const bgH = imgRect.height * MAG_ZOOM;
        const bgX = -(cornerPxX * MAG_ZOOM - MAG_SIZE / 2);
        const bgY = -(cornerPxY * MAG_ZOOM - MAG_SIZE / 2);
        return { left, top, bgW, bgH, bgX, bgY };
      })()
    : null;

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative w-full rounded-lg border border-zinc-300 bg-zinc-100"
        style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
      >
        {/* Image lives inside its own overflow-hidden wrapper so the
            outer container can host handles that sit right on the
            edges without being clipped. */}
        <div className="absolute inset-0 overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
        </div>
        {/* Quad outline sized to the actual rendered image rect so the
            polygon lines up with the letterboxed image, not the raw
            container. `preserveAspectRatio="none"` combined with an
            explicit width/height matching the image rect gives us a
            precise 1:1 mapping from normalized [0,1] to overlay px. */}
        {imgRect.width > 0 && imgRect.height > 0 && (
          <svg
            className="pointer-events-none absolute"
            style={{
              left: `${imgRect.left}px`,
              top: `${imgRect.top}px`,
              width: `${imgRect.width}px`,
              height: `${imgRect.height}px`,
            }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <polygon
              points={quad.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")}
              fill="rgba(16,185,129,0.08)"
              stroke="rgba(16,185,129,0.9)"
              strokeWidth={0.4}
              strokeDasharray={autoHint ? "2 2" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
        {/* Draggable corner handles. The visible dot stays small (~14px)
            but each handle wraps a transparent 44×44 hit target so it's
            easy to grab on touch and never bleeds off the container. */}
        {imgRect.width > 0 && imgRect.height > 0 && quad.map((pt, idx) => {
          const cornerIdx = idx as CornerIndex;
          const [x, y] = pt;
          const isActive = activeCorner === cornerIdx;
          const cx = imgRect.left + x * imgRect.width;
          const cy = imgRect.top + y * imgRect.height;
          const label = t(
            "upload.imageEnhance.perspective.cornerLabel",
          ).replace("{corner}", HANDLE_LABELS[cornerIdx]);
          const wrapperStyle: CSSProperties = {
            left: `${cx - HANDLE_HIT / 2}px`,
            top: `${cy - HANDLE_HIT / 2}px`,
            width: `${HANDLE_HIT}px`,
            height: `${HANDLE_HIT}px`,
            touchAction: "none",
          };
          // 2026-10-01 — visible on-image badge so users can tell
          // which corner is which without reading a screen reader. The
          // pill offsets diagonally from the dot so it never covers
          // the drag target itself; it also flips to the opposite
          // diagonal when the corner sits near a container edge so
          // all four pills stay inside the picker at any aspect.
          const badgeToken = HANDLE_LABELS[cornerIdx];
          const BADGE_OFFSET = 14;
          const badgeLeft = cornerIdx === 0 || cornerIdx === 3
            ? HANDLE_HIT - BADGE_OFFSET
            : -22;
          const badgeTop = cornerIdx === 0 || cornerIdx === 1
            ? HANDLE_HIT - BADGE_OFFSET
            : -22;
          return (
            <div
              key={cornerIdx}
              role="slider"
              tabIndex={0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(x * 100)}
              aria-orientation="horizontal"
              aria-label={label}
              onPointerDown={onPointerDown(cornerIdx)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onHandleKeyDown(cornerIdx)}
              onFocus={() => {
                setActiveCorner(cornerIdx);
                setFocusedCorner(cornerIdx);
              }}
              onBlur={() => {
                setFocusedCorner((cur) => (cur === cornerIdx ? null : cur));
              }}
              className="absolute flex cursor-move items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
              style={wrapperStyle}
            >
              <span
                aria-hidden
                className={`block rounded-full border-2 shadow ${
                  isActive
                    ? "border-emerald-600 bg-white ring-2 ring-emerald-400"
                    : "border-emerald-500 bg-white"
                }`}
                style={{ width: `${HANDLE_DOT}px`, height: `${HANDLE_DOT}px` }}
              />
              <span
                aria-hidden
                className={`pointer-events-none absolute select-none rounded-full border border-emerald-500 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 shadow ${
                  isActive ? "ring-1 ring-emerald-400" : ""
                }`}
                style={{
                  left: `${badgeLeft}px`,
                  top: `${badgeTop}px`,
                  lineHeight: 1,
                }}
              >
                {badgeToken}
              </span>
            </div>
          );
        })}
        {/* Magnifier (2026-10-01). Shows the pixels around the active
            corner at 3× zoom with a crosshair in the center so users
            can land right on the painted edge instead of the wall. */}
        {magnifier && (
          <div
            aria-hidden
            className="pointer-events-none absolute overflow-hidden rounded-lg border border-zinc-300 bg-zinc-50 shadow-lg"
            style={{
              left: `${magnifier.left}px`,
              top: `${magnifier.top}px`,
              width: `${MAG_SIZE}px`,
              height: `${MAG_SIZE}px`,
              backgroundImage: `url(${imageUrl})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${magnifier.bgW}px ${magnifier.bgH}px`,
              backgroundPosition: `${magnifier.bgX}px ${magnifier.bgY}px`,
            }}
          >
            {/* Center crosshair */}
            <span
              aria-hidden
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ width: `${MAG_SIZE}px`, height: `${MAG_SIZE}px` }}
            >
              <span
                className="absolute left-0 top-1/2 h-px w-full"
                style={{ background: "rgba(16,185,129,0.75)" }}
              />
              <span
                className="absolute left-1/2 top-0 h-full w-px"
                style={{ background: "rgba(16,185,129,0.75)" }}
              />
              <span
                className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-600 bg-white/80"
              />
            </span>
          </div>
        )}
        {/* Data hint used by callers to confirm the polygon renders. */}
        <span className="sr-only" data-testid="perspective-quad">
          {points}
        </span>
      </div>
      {!hideActions && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
          <span className="mr-auto text-[11px] text-zinc-500">
            {t("upload.imageEnhance.perspective.hint")}
          </span>
          <button
            type="button"
            onClick={handleUndo}
            className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
          >
            {t("upload.imageEnhance.perspective.undo")}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
          >
            {t("upload.imageEnhance.perspective.reset")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
          >
            {t("upload.imageEnhance.perspective.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(quad)}
            className="rounded-full bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-700"
          >
            {t("upload.imageEnhance.perspective.confirm")}
          </button>
        </div>
      )}
    </div>
  );
}
