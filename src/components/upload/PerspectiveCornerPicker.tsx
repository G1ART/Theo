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
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const seedQuad = useMemo<Quad>(() => {
    const seed = initialCorners && hasValidArea(initialCorners)
      ? initialCorners
      : autoDetectedCorners && hasValidArea(autoDetectedCorners)
        ? autoDetectedCorners
        : defaultInsetQuad(0.1);
    return seed;
  }, [initialCorners, autoDetectedCorners]);

  const [quad, setQuad] = useState<Quad>(seedQuad);
  const [activeCorner, setActiveCorner] = useState<CornerIndex>(0);
  const dragCornerRef = useRef<CornerIndex | null>(null);
  const dragOriginRef = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);

  // If the parent re-seeds (e.g. Reset), snap back.
  useEffect(() => {
    setQuad(seedQuad);
  }, [seedQuad]);

  const rectBounds = useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    return el.getBoundingClientRect();
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
  }, [autoDetectedCorners]);

  const points = useMemo(
    () => quad.map(([x, y]) => `${x * 100}%,${y * 100}%`).join(" "),
    [quad],
  );

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg border border-zinc-300 bg-zinc-100"
        style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        {/* Quad outline as an SVG polygon */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
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
        {/* Draggable corner handles */}
        {quad.map((pt, idx) => {
          const cornerIdx = idx as CornerIndex;
          const [x, y] = pt;
          const isActive = activeCorner === cornerIdx;
          const style: CSSProperties = {
            left: `${x * 100}%`,
            top: `${y * 100}%`,
            transform: "translate(-50%, -50%)",
            touchAction: "none",
          };
          const label = t(
            "upload.imageEnhance.perspective.cornerLabel",
          ).replace("{corner}", HANDLE_LABELS[cornerIdx]);
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
              className={`absolute h-4 w-4 cursor-move rounded-full border-2 outline-none ${
                isActive
                  ? "border-emerald-600 bg-white ring-2 ring-emerald-400"
                  : "border-emerald-500 bg-white hover:ring-2 hover:ring-emerald-300"
              }`}
              style={style}
            />
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
