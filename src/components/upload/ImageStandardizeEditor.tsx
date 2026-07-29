"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  type DisplayAdjust,
  type DisplayCrop,
  NEUTRAL,
  TONE_MIN,
  TONE_MAX,
  normalizeDisplayAdjust,
  toFilterCss,
} from "@/lib/image/displayAdjust";
import { analyzeImageFile, type ImageAnalysis } from "@/lib/image/analyze";
import { useT } from "@/lib/i18n/useT";

/**
 * Inline standardization editor for a single uploaded image.
 *
 * QA 2026-07-28 rewrite: the previous version silently auto-applied a
 * "Theo standard" tone + background crop on mount, which was surprising
 * (users saw their upload change under them) and buggy (the auto-crop
 * mis-fired on textured backgrounds). New contract:
 *
 * Contract
 * --------
 *   - MOUNT IS SILENT. The analyzer still runs so we can surface a
 *     one-click "suggested crop" chip and a "apply standard tone" chip,
 *     but the editor never calls `onChange` until the user drags a
 *     slider or commits a crop. Parent state stays `null` = original.
 *   - Tone sliders (brightness / contrast / saturation): every drag is
 *     immediately reflected in `onChange` (debounced).
 *   - Crop is fully opt-in and interactive. Clicking "Crop" enters an
 *     edit mode where a draggable rectangle with 8 handles (4 corners +
 *     4 edges) sits on top of the preview. "Apply" commits, "Cancel"
 *     reverts to the previous committed crop (or none). A "Suggested"
 *     chip pre-fills the interactive rect with the auto-detected border
 *     rectangle; the user is still expected to confirm before it takes
 *     effect.
 *   - "Standard tone" button applies ONLY tone. It never touches crop.
 *   - The editor never modifies the original `File`. All state lives
 *     upstream as a normalized `DisplayAdjust`.
 */
type Props = {
  /** The client-side File being uploaded (for pixel-analysis + preview). */
  file: File;
  /** Current adjustment; parent owns the state. */
  value: DisplayAdjust | null;
  /** Called with a normalized `DisplayAdjust` or `null` (= reset). */
  onChange: (next: DisplayAdjust | null) => void;
  /** Optional class on the outer wrapper. */
  className?: string;
  /** Compact layout drops the info banner and stacks tighter. Used in
   *  the bulk upload row expander. */
  compact?: boolean;
};

/** Debounce a value change so slider drag doesn't spam parent state. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function toSliderValue(x: number): number {
  const mid = 1;
  const halfRange = TONE_MAX - mid;
  const clamped = Math.min(TONE_MAX, Math.max(TONE_MIN, x));
  return Math.round(((clamped - mid) / halfRange) * 100);
}

function fromSliderValue(v: number): number {
  const mid = 1;
  const halfRange = TONE_MAX - mid;
  return mid + (v / 100) * halfRange;
}

/** Minimum crop side, normalized on the original image. Matches (and
 *  slightly clears) the 0.05 threshold in `normalizeDisplayAdjust` so
 *  we never commit a rect the persistence layer will silently drop. */
const MIN_CROP_SIDE = 0.1;

/** Handle definitions for the interactive crop rect. */
type CropHandle =
  | "move"
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

/** Clamp a value into [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Apply a pointer delta (normalized image space) to `rect` based on
 * which handle is being dragged. Enforces MIN_CROP_SIDE and keeps the
 * rect inside [0,1].
 */
function resizeCrop(
  base: DisplayCrop,
  handle: CropHandle,
  dx: number,
  dy: number,
): DisplayCrop {
  let { x, y, w, h } = base;
  if (handle === "move") {
    x = clamp(x + dx, 0, 1 - w);
    y = clamp(y + dy, 0, 1 - h);
    return { x, y, w, h };
  }
  const right = x + w;
  const bottom = y + h;
  if (handle.includes("w")) {
    const nx = clamp(x + dx, 0, right - MIN_CROP_SIDE);
    w = right - nx;
    x = nx;
  }
  if (handle.includes("e")) {
    const nr = clamp(right + dx, x + MIN_CROP_SIDE, 1);
    w = nr - x;
  }
  if (handle.includes("n")) {
    const ny = clamp(y + dy, 0, bottom - MIN_CROP_SIDE);
    h = bottom - ny;
    y = ny;
  }
  if (handle.includes("s")) {
    const nb = clamp(bottom + dy, y + MIN_CROP_SIDE, 1);
    h = nb - y;
  }
  return { x, y, w, h };
}

export function ImageStandardizeEditor({
  file,
  value,
  onChange,
  className = "",
  compact = false,
}: Props) {
  const { t } = useT();
  const previewUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Local slider state — mirrors `value` but stays smooth during drag.
  const [b, setB] = useState<number>(value?.b ?? NEUTRAL.b);
  const [c, setC] = useState<number>(value?.c ?? NEUTRAL.c);
  const [s, setS] = useState<number>(value?.s ?? NEUTRAL.s);
  const [crop, setCrop] = useState<DisplayCrop | null>(value?.crop ?? null);

  // Whether the user is currently interacting with the crop rect
  // (drawing / adjusting). While true, changes are LIVE-previewed but
  // not persisted until "Apply" is clicked. On "Cancel" the previous
  // committed crop is restored.
  const [cropEditing, setCropEditing] = useState(false);
  const cropBeforeEditRef = useRef<DisplayCrop | null>(null);
  const [draftCrop, setDraftCrop] = useState<DisplayCrop | null>(null);

  // A user must interact once before we start pushing state upstream.
  // Mount / analyze finishing does NOT count as interaction — parent
  // stays `null` (= original) until the user actually moves something.
  const userTouchedRef = useRef<boolean>(value != null);

  // Track whether any tone slider has been touched, so we can quietly
  // hint on the applied state without treating "just opened the panel"
  // as a change.
  const [toneTouched, setToneTouched] = useState<boolean>(
    value != null &&
      (Math.abs((value.b ?? 1) - 1) > 0.005 ||
        Math.abs((value.c ?? 1) - 1) > 0.005 ||
        Math.abs((value.s ?? 1) - 1) > 0.005),
  );

  // Reset local state whenever the parent value changes to something
  // structurally different (e.g. reset button clicked upstream). This
  // is a legitimate "sync external state" pattern — the parent is the
  // source of truth for saved adjustments, we mirror it locally so the
  // sliders stay smooth during drag.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setB(value?.b ?? NEUTRAL.b);
    setC(value?.c ?? NEUTRAL.c);
    setS(value?.s ?? NEUTRAL.s);
    setCrop(value?.crop ?? null);
    userTouchedRef.current =
      value?.b != null ||
      value?.c != null ||
      value?.s != null ||
      value?.crop != null;
    setToneTouched(
      (value?.b != null && Math.abs(value.b - 1) > 0.005) ||
        (value?.c != null && Math.abs(value.c - 1) > 0.005) ||
        (value?.s != null && Math.abs(value.s - 1) > 0.005),
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [value?.b, value?.c, value?.s, value?.crop]);

  // Object-URL lifecycle for the local preview.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviewUrl(url);
    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
      previewUrlRef.current = null;
    };
  }, [file]);

  // Run the analyzer once per file. Suggestions are surfaced as chips
  // ("standard tone", "suggested crop") but NEVER auto-applied. See the
  // top-of-file contract.
  useEffect(() => {
    let alive = true;
    /* eslint-disable react-hooks/set-state-in-effect */
    setAnalyzing(true);
    setAnalyzeError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    analyzeImageFile(file)
      .then((res) => {
        if (!alive) return;
        setAnalysis(res);
      })
      .catch((err) => {
        if (!alive) return;
        setAnalyzeError(
          err instanceof Error ? err.message : String(err),
        );
      })
      .finally(() => {
        if (alive) setAnalyzing(false);
      });
    return () => {
      alive = false;
    };
  }, [file]);

  // Push tone/crop changes upstream. Only after the user has actually
  // interacted — mount alone must never populate parent state.
  const debouncedState = useDebounced({ b, c, s, crop }, 120);
  const lastPushedRef = useRef<string>(JSON.stringify(value ?? null));
  useEffect(() => {
    if (!userTouchedRef.current) return;
    const next = normalizeDisplayAdjust({
      v: 1,
      b: debouncedState.b,
      c: debouncedState.c,
      s: debouncedState.s,
      crop: debouncedState.crop ?? undefined,
    });
    const key = JSON.stringify(next);
    if (key === lastPushedRef.current) return;
    lastPushedRef.current = key;
    onChange(next);
  }, [debouncedState, onChange]);

  // ------------------------------------------------------------------
  // Preview + crop overlay geometry
  // ------------------------------------------------------------------
  //
  // The preview container is a fixed aspect box (4:5) with the image
  // rendered `object-contain`. Because the image aspect rarely matches
  // 4:5, we compute the actual rendered image rect inside the container
  // and pin the crop overlay to THAT rect — otherwise the overlay
  // percentages (which are in ORIGINAL image space) would misalign with
  // the letterboxed image below.

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{
    w: number;
    h: number;
  }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [previewUrl]);

  const imageAspect =
    analysis && analysis.height > 0 ? analysis.width / analysis.height : null;

  // Rendered rect of the image within the container, in container px.
  const imageRect = useMemo(() => {
    if (!imageAspect || containerSize.w === 0 || containerSize.h === 0) {
      return { left: 0, top: 0, width: containerSize.w, height: containerSize.h };
    }
    const containerAspect = containerSize.w / containerSize.h;
    if (imageAspect > containerAspect) {
      const width = containerSize.w;
      const height = width / imageAspect;
      return {
        left: 0,
        top: (containerSize.h - height) / 2,
        width,
        height,
      };
    }
    const height = containerSize.h;
    const width = height * imageAspect;
    return {
      left: (containerSize.w - width) / 2,
      top: 0,
      width,
      height,
    };
  }, [imageAspect, containerSize]);

  const previewAdjust: DisplayAdjust = useMemo(
    () => ({
      v: 1,
      b,
      c,
      s,
      // While editing, the underlying `<img>` still renders full-frame
      // so the user sees what they are cropping. The mask + rect
      // overlay communicates the crop selection.
      ...(cropEditing ? {} : crop ? { crop } : {}),
    }),
    [b, c, s, crop, cropEditing],
  );
  const filterCss = toFilterCss(previewAdjust);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleReset = useCallback(() => {
    userTouchedRef.current = true;
    setToneTouched(false);
    setB(NEUTRAL.b);
    setC(NEUTRAL.c);
    setS(NEUTRAL.s);
    setCrop(null);
    setCropEditing(false);
    setDraftCrop(null);
    lastPushedRef.current = "null";
    onChange(null);
  }, [onChange]);

  const handleApplyStandardTone = useCallback(() => {
    if (!analysis?.suggested) return;
    const sug = analysis.suggested;
    userTouchedRef.current = true;
    setToneTouched(true);
    setB(sug.b ?? NEUTRAL.b);
    setC(sug.c ?? NEUTRAL.c);
    setS(sug.s ?? NEUTRAL.s);
  }, [analysis]);

  const enterCropEdit = useCallback(
    (initial: DisplayCrop | null) => {
      cropBeforeEditRef.current = crop;
      const seed: DisplayCrop =
        initial ?? crop ?? { x: 0, y: 0, w: 1, h: 1 };
      setDraftCrop(seed);
      setCropEditing(true);
    },
    [crop],
  );

  const handleStartCrop = useCallback(() => {
    // Seed with the previously-committed crop if any, else a slightly
    // inset rect so the handles are visible off the bat (a rect at
    // exactly the frame edge visually merges with the container border
    // and looks like nothing is there yet).
    if (crop) {
      enterCropEdit(crop);
    } else {
      enterCropEdit({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
    }
  }, [crop, enterCropEdit]);

  const handleUseSuggestedCrop = useCallback(() => {
    if (!analysis?.suggestedCrop) return;
    enterCropEdit(analysis.suggestedCrop);
  }, [analysis, enterCropEdit]);

  const handleCancelCrop = useCallback(() => {
    setDraftCrop(null);
    setCropEditing(false);
  }, []);

  const handleApplyCrop = useCallback(() => {
    if (!draftCrop) {
      setCropEditing(false);
      return;
    }
    // A near-full-frame rect is effectively "no crop"; normalize to
    // null so downstream code (and re-mounts) treat it that way.
    const isFullFrame =
      draftCrop.x < 0.005 &&
      draftCrop.y < 0.005 &&
      draftCrop.w > 0.995 &&
      draftCrop.h > 0.995;
    userTouchedRef.current = true;
    setCrop(isFullFrame ? null : draftCrop);
    setDraftCrop(null);
    setCropEditing(false);
  }, [draftCrop]);

  const handleClearCommittedCrop = useCallback(() => {
    userTouchedRef.current = true;
    setCrop(null);
  }, []);

  // ------------------------------------------------------------------
  // Pointer drag logic for the interactive crop rect
  // ------------------------------------------------------------------

  const dragStateRef = useRef<{
    handle: CropHandle;
    startClientX: number;
    startClientY: number;
    baseRect: DisplayCrop;
    pointerId: number;
    target: Element;
  } | null>(null);

  const beginDrag = useCallback(
    (handle: CropHandle) => (e: ReactPointerEvent<HTMLElement>) => {
      if (!draftCrop) return;
      if (imageRect.width <= 0 || imageRect.height <= 0) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {}
      dragStateRef.current = {
        handle,
        startClientX: e.clientX,
        startClientY: e.clientY,
        baseRect: draftCrop,
        pointerId: e.pointerId,
        target,
      };
    },
    [draftCrop, imageRect.width, imageRect.height],
  );

  const onDragMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const st = dragStateRef.current;
      if (!st) return;
      if (imageRect.width <= 0 || imageRect.height <= 0) return;
      const dxPx = e.clientX - st.startClientX;
      const dyPx = e.clientY - st.startClientY;
      const dx = dxPx / imageRect.width;
      const dy = dyPx / imageRect.height;
      const next = resizeCrop(st.baseRect, st.handle, dx, dy);
      setDraftCrop(next);
    },
    [imageRect.width, imageRect.height],
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const st = dragStateRef.current;
    if (!st) return;
    try {
      st.target.releasePointerCapture(st.pointerId);
    } catch {}
    dragStateRef.current = null;
    // Prevent the click from bubbling into overlaid controls.
    e.stopPropagation();
  }, []);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const overlayStyle = (rect: DisplayCrop): CSSProperties => ({
    left: `${imageRect.left + rect.x * imageRect.width}px`,
    top: `${imageRect.top + rect.y * imageRect.height}px`,
    width: `${rect.w * imageRect.width}px`,
    height: `${rect.h * imageRect.height}px`,
  });

  return (
    <div
      className={`space-y-3 rounded-xl border border-zinc-200 bg-white p-3 ${className}`}
    >
      {!compact && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900">
              {t("upload.imageStandardize.title")}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              {analyzing
                ? t("upload.imageStandardize.analyzing")
                : analyzeError
                  ? t("upload.imageStandardize.analyzeError")
                  : value
                    ? t("upload.imageStandardize.appliedHint")
                    : t("upload.imageStandardize.idleHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="shrink-0 rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            {t("upload.imageStandardize.reset")}
          </button>
        </div>
      )}

      {/* Preview + adjustment sliders */}
      <div className="flex gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div
            ref={containerRef}
            className="relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-zinc-100 select-none"
          >
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt=""
                className="h-full w-full object-contain"
                style={filterCss ? { filter: filterCss } : undefined}
                draggable={false}
              />
            )}

            {/* Non-editing preview of the committed crop. Just a subtle
                ring so the user knows a crop is in effect (and it applies
                to feed thumbnails, not the detail page). */}
            {!cropEditing && crop && (
              <div
                className="pointer-events-none absolute rounded-sm ring-1 ring-white/90 ring-offset-1 ring-offset-black/40"
                style={overlayStyle(crop)}
              />
            )}

            {/* Editing overlay — mask + draggable rect + 8 handles */}
            {cropEditing && draftCrop && (
              <>
                {/* Four dim rectangles around the crop rect. Cheaper +
                    accessibility-friendlier than clip-path masks. */}
                {(() => {
                  const r = draftCrop;
                  const left = imageRect.left;
                  const top = imageRect.top;
                  const w = imageRect.width;
                  const h = imageRect.height;
                  const rectLeft = left + r.x * w;
                  const rectTop = top + r.y * h;
                  const rectRight = rectLeft + r.w * w;
                  const rectBottom = rectTop + r.h * h;
                  const containerW = containerSize.w;
                  const containerH = containerSize.h;
                  const dim: CSSProperties = {
                    background: "rgba(0,0,0,0.45)",
                  };
                  return (
                    <>
                      <div
                        className="pointer-events-none absolute"
                        style={{
                          ...dim,
                          left: 0,
                          top: 0,
                          width: containerW,
                          height: rectTop,
                        }}
                      />
                      <div
                        className="pointer-events-none absolute"
                        style={{
                          ...dim,
                          left: 0,
                          top: rectBottom,
                          width: containerW,
                          height: Math.max(0, containerH - rectBottom),
                        }}
                      />
                      <div
                        className="pointer-events-none absolute"
                        style={{
                          ...dim,
                          left: 0,
                          top: rectTop,
                          width: rectLeft,
                          height: rectBottom - rectTop,
                        }}
                      />
                      <div
                        className="pointer-events-none absolute"
                        style={{
                          ...dim,
                          left: rectRight,
                          top: rectTop,
                          width: Math.max(0, containerW - rectRight),
                          height: rectBottom - rectTop,
                        }}
                      />
                    </>
                  );
                })()}

                {/* Draggable body (move handle) */}
                <div
                  role="button"
                  tabIndex={-1}
                  aria-label={t("upload.imageStandardize.cropMove")}
                  onPointerDown={beginDrag("move")}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  className="absolute cursor-move outline-none ring-1 ring-white/90 ring-offset-1 ring-offset-black/40"
                  style={{
                    ...overlayStyle(draftCrop),
                    touchAction: "none",
                  }}
                >
                  {/* Rule-of-thirds guide — quiet, but useful. */}
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
                    <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
                    <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
                    <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
                  </div>
                </div>

                {/* 8 handles (4 corners + 4 edges) positioned relative
                    to the container. They live OUTSIDE the move body so
                    their pointer-events don't collide with a body drag. */}
                {(
                  [
                    ["nw", "cursor-nwse-resize", { cx: 0, cy: 0 }],
                    ["n", "cursor-ns-resize", { cx: 0.5, cy: 0 }],
                    ["ne", "cursor-nesw-resize", { cx: 1, cy: 0 }],
                    ["e", "cursor-ew-resize", { cx: 1, cy: 0.5 }],
                    ["se", "cursor-nwse-resize", { cx: 1, cy: 1 }],
                    ["s", "cursor-ns-resize", { cx: 0.5, cy: 1 }],
                    ["sw", "cursor-nesw-resize", { cx: 0, cy: 1 }],
                    ["w", "cursor-ew-resize", { cx: 0, cy: 0.5 }],
                  ] as [
                    CropHandle,
                    string,
                    { cx: number; cy: number },
                  ][]
                ).map(([handle, cursor, { cx, cy }]) => {
                  const rectLeft = imageRect.left + draftCrop.x * imageRect.width;
                  const rectTop = imageRect.top + draftCrop.y * imageRect.height;
                  const rectW = draftCrop.w * imageRect.width;
                  const rectH = draftCrop.h * imageRect.height;
                  const handleSize = 14;
                  const hx = rectLeft + cx * rectW - handleSize / 2;
                  const hy = rectTop + cy * rectH - handleSize / 2;
                  return (
                    <div
                      key={handle}
                      role="button"
                      tabIndex={-1}
                      aria-label={`${t("upload.imageStandardize.cropHandle")} ${handle}`}
                      onPointerDown={beginDrag(handle)}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      className={`absolute rounded-sm border border-zinc-900 bg-white shadow ${cursor}`}
                      style={{
                        left: `${hx}px`,
                        top: `${hy}px`,
                        width: `${handleSize}px`,
                        height: `${handleSize}px`,
                        touchAction: "none",
                      }}
                    />
                  );
                })}
              </>
            )}
          </div>

          {/* Crop control strip — sits directly under the preview so
              the "editing" state and its actions are unmistakable. */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {cropEditing ? (
              <>
                <span className="text-zinc-600">
                  {t("upload.imageStandardize.cropEditingHint")}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCancelCrop}
                    className="rounded-full border border-zinc-300 px-2.5 py-1 text-zinc-700 hover:bg-zinc-50"
                  >
                    {t("upload.imageStandardize.cropCancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyCrop}
                    className="rounded-full bg-zinc-900 px-3 py-1 text-white hover:bg-zinc-800"
                  >
                    {t("upload.imageStandardize.cropApply")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleStartCrop}
                  className="rounded-full border border-zinc-300 px-2.5 py-1 text-zinc-700 hover:bg-zinc-50"
                >
                  {crop
                    ? t("upload.imageStandardize.cropEdit")
                    : t("upload.imageStandardize.cropStart")}
                </button>
                {crop && (
                  <button
                    type="button"
                    onClick={handleClearCommittedCrop}
                    className="rounded-full border border-zinc-300 px-2.5 py-1 text-zinc-700 hover:bg-zinc-50"
                  >
                    {t("upload.imageStandardize.cropClear")}
                  </button>
                )}
                {analysis?.suggestedCrop && (
                  <button
                    type="button"
                    onClick={handleUseSuggestedCrop}
                    className="rounded-full border border-zinc-300 px-2.5 py-1 text-zinc-700 hover:bg-zinc-50"
                    title={t("upload.imageStandardize.cropSuggestHint")}
                  >
                    {t("upload.imageStandardize.cropSuggest")}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Brightness — horizontal bar under the image */}
          <label className="flex items-center gap-2 text-[11px] text-zinc-600">
            <span className="w-14 shrink-0 tracking-tight">
              {t("upload.imageStandardize.brightness")}
            </span>
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              value={toSliderValue(b)}
              onChange={(e) => {
                userTouchedRef.current = true;
                setToneTouched(true);
                setB(fromSliderValue(Number(e.target.value)));
              }}
              aria-label={t("upload.imageStandardize.brightness")}
              className="h-1 flex-1 cursor-pointer accent-zinc-800"
            />
            <span className="w-10 shrink-0 text-right tabular-nums text-zinc-500">
              {Math.round((b - 1) * 100)}
            </span>
          </label>
        </div>

        {/* Contrast — vertical bar on the right */}
        <div className="flex w-8 shrink-0 flex-col items-center justify-between">
          <span className="text-[10px] tracking-tight text-zinc-500">
            {t("upload.imageStandardize.contrast")}
          </span>
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={toSliderValue(c)}
            onChange={(e) => {
              userTouchedRef.current = true;
              setToneTouched(true);
              setC(fromSliderValue(Number(e.target.value)));
            }}
            aria-label={t("upload.imageStandardize.contrast")}
            className="h-1 w-24 origin-center rotate-90 cursor-pointer accent-zinc-800"
            style={{ marginTop: 48, marginBottom: 48 }}
          />
          <span className="tabular-nums text-[10px] text-zinc-500">
            {Math.round((c - 1) * 100)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-1 items-center gap-2 text-[11px] text-zinc-600">
          <span className="w-14 shrink-0 tracking-tight">
            {t("upload.imageStandardize.saturation")}
          </span>
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={toSliderValue(s)}
            onChange={(e) => {
              userTouchedRef.current = true;
              setToneTouched(true);
              setS(fromSliderValue(Number(e.target.value)));
            }}
            aria-label={t("upload.imageStandardize.saturation")}
            className="h-1 flex-1 cursor-pointer accent-zinc-800"
          />
          <span className="w-10 shrink-0 text-right tabular-nums text-zinc-500">
            {Math.round((s - 1) * 100)}
          </span>
        </label>
        {analysis?.suggested && (
          <button
            type="button"
            onClick={handleApplyStandardTone}
            className="rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
            title={t("upload.imageStandardize.applyStandardToneHint")}
          >
            {t("upload.imageStandardize.applyStandardTone")}
          </button>
        )}
        {compact && (
          <button
            type="button"
            onClick={handleReset}
            className="rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
          >
            {t("upload.imageStandardize.reset")}
          </button>
        )}
      </div>

      {/* Applied summary line: quiet, appears only after the user has
          actually committed something. Silent success, tell them what
          will be saved. */}
      {value && !cropEditing && (
        <p className="text-[11px] text-zinc-500">
          {toneTouched && crop
            ? t("upload.imageStandardize.savedToneAndCrop")
            : crop
              ? t("upload.imageStandardize.savedCropOnly")
              : toneTouched
                ? t("upload.imageStandardize.savedToneOnly")
                : t("upload.imageStandardize.appliedHint")}
        </p>
      )}
    </div>
  );
}
