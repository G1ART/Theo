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

  const [quad, setQuad] = useState<Quad>(seedQuad);
  const [activeCorner, setActiveCorner] = useState<CornerIndex>(0);
  const dragCornerRef = useRef<CornerIndex | null>(null);
  const dragOriginRef = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);
  // Local reset counter — bumped when the user clicks "reset". Combined
  // with `resetToken` (parent-driven) drives the re-seed effect below.
  const [localResetTick, setLocalResetTick] = useState(0);

  // Re-seed ONLY on mount and on explicit reset (parent bump of
  // `resetToken` or local reset button). Never on unrelated parent
  // re-renders — that used to wipe an in-flight drag. See release
  // 2026-08-09 corner-stick fix.
  useEffect(() => {
    if (dragCornerRef.current != null) return;
    setQuad(seedQuadRef.current);
  }, [resetToken, localResetTick]);

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
    [rectBounds],
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
    [imageWidth, imageHeight],
  );

  const handleReset = useCallback(() => {
    const target = autoDetectedCorners && hasValidArea(autoDetectedCorners)
      ? autoDetectedCorners
      : defaultInsetQuad(0.1);
    setQuad(target);
    setLocalResetTick((n) => n + 1);
  }, [autoDetectedCorners]);

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
              onFocus={() => setActiveCorner(cornerIdx)}
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
            </div>
          );
        })}
        {/* Data hint used by callers to confirm the polygon renders. */}
        <span className="sr-only" data-testid="perspective-quad">
          {points}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
        <span className="mr-auto text-[11px] text-zinc-500">
          {t("upload.imageEnhance.perspective.hint")}
        </span>
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
    </div>
  );
}
