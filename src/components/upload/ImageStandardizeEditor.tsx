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
import type {
  EnhancementMeta,
  EnhancementMode,
  FlatRecipe,
  NormalizedPoint,
} from "@/lib/image/enhancement/types";
import { ENHANCEMENT_META_SCHEMA_VERSION } from "@/lib/image/enhancement/types";
import { runFlatEnhancement, flatBlobToFile } from "@/lib/image/enhancement/localFlatEngine";
import { computeFileSha256 } from "@/lib/image/prepareArtworkImageForUpload";
import BeforeAfterCompare from "@/components/upload/BeforeAfterCompare";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import {
  formatCaptureDevice,
  isLowLightExif,
  readExif,
  type ExifReadResult,
} from "@/lib/image/exifRead";
import { PerspectiveCornerPicker } from "@/components/upload/PerspectiveCornerPicker";
import {
  defaultInsetQuad,
  quadFromRect,
  type Quad,
} from "@/lib/image/enhancement/cornerPickerGeometry";
import {
  fetchArtistPortfolioToneStats,
  type PortfolioToneStats,
} from "@/lib/image/enhancement/portfolioToneStatsClient";
import {
  PORTFOLIO_ENVELOPE,
  applyToneDelta,
  buildPortfolioCoherenceMeta,
  computeToneDelta,
  toneSignature,
} from "@/lib/image/enhancement/coherence";
import { applyToneDeltaToFile } from "@/lib/image/enhancement/applyToneDelta";

/**
 * Capture-mode chip (2026-08-06). Pre-seeds the enhance pipeline so
 * scanner captures skip perspective correction, studio captures use a
 * lighter tone, and phone hand-held captures run the full pro-look
 * pipeline.
 */
type CaptureMode = "auto" | "studio" | "phone" | "scanner";

/**
 * 2026-08-09: user-facing "input type" selector consolidates the old
 * captureMode + enhanceMode into a single Advanced control. The
 * enhanceMode "object" branch is opt-in through the Advanced fold; the
 * common Basic path stays on auto + adjustable intensity.
 */
type InputType = "auto" | "studio" | "scanner";

/**
 * 2026-08-09: three-way strength selector for the Basic view. Maps to
 * multipliers around the Pro Look defaults so all three settings stay
 * within the standards envelope (FADGI/Metamorfoze) but let the user
 * dial back for delicate paintings or push harder for phone snapshots.
 */
type Intensity = "light" | "normal" | "strong";

function intensityMultiplier(i: Intensity): number {
  if (i === "light") return 0.6;
  if (i === "strong") return 1.4;
  return 1;
}

/**
 * Enhancement preview state — held by `ImageStandardizeEditor` while
 * the user reviews a local flat pass. Once approved it becomes the
 * `EnhancementDraft` handed back to the caller through `onEnhance`.
 */
export type EnhancementDraft = {
  displayFile: File;
  previewUrl: string;
  meta: EnhancementMeta;
};

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
  /**
   * Currently-approved Theo Enhance draft (if any) so the tab can
   * render the "approved" state on remount. Parent owns the state.
   */
  enhancement?: EnhancementDraft | null;
  /**
   * Called with a `EnhancementDraft` when the user approves a
   * preview, or `null` when they reset / reject. Presence of this
   * callback also toggles whether the "Theo Enhance" tab is shown at
   * all — callers that haven't wired the upload plumbing yet can
   * simply omit it and get the historical `QuickAdjustPanel` only.
   */
  onEnhance?: (next: EnhancementDraft | null) => void;
  /** Metering source label so lifecycle events carry the right
   *  provenance (single / bulk / exhibition_single / exhibition_bulk). */
  meteringSource?: "single" | "bulk" | "exhibition_single" | "exhibition_bulk";
  /**
   * Artist profile id, used to fetch portfolio-tone statistics for the
   * H — portfolio coherence pass (release brief 2026-08-07). The
   * parent page is expected to have fetched this once per session and
   * to pass the same id to every editor mount so the module-level
   * cache in `portfolioToneStatsClient.ts` dedupes across editors.
   * When null the coherence chip is hidden.
   */
  artistProfileId?: string | null;
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
  enhancement,
  onEnhance,
  meteringSource = "single",
  artistProfileId = null,
}: Props) {
  const { t } = useT();
  const enhancementEnabled = typeof onEnhance === "function";
  const [tab, setTab] = useState<"quick" | "enhance">(
    enhancementEnabled && enhancement ? "enhance" : "quick",
  );
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
  }, [value?.b, value?.c, value?.s, value?.crop]);

  // Object-URL lifecycle for the local preview.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
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
    setAnalyzing(true);
    setAnalyzeError(null);
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
  // Theo Enhance (Beta) — panel state
  // ------------------------------------------------------------------

  // 2026-08-09 Todo 7: Basic view no longer exposes a mode selector —
  // `enhanceMode` stays "auto" and the analyzer resolves flat vs object.
  // The setter is intentionally unused so we keep the pipeline API stable
  // and can re-expose the selector in Advanced without a state change.
  const [enhanceMode] = useState<EnhancementMode>("auto");
  const [enhancePreview, setEnhancePreview] = useState<EnhancementDraft | null>(
    enhancement ?? null,
  );
  const [enhanceRunning, setEnhanceRunning] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const enhancePreviewUrlRef = useRef<string | null>(null);
  // 2026-08-09: Basic-view intensity selector.
  const [intensity, setIntensity] = useState<Intensity>("normal");
  // 2026-08-09: consolidated input-type selector living inside Advanced.
  const [inputType, setInputType] = useState<InputType>("auto");
  // 2026-08-09: Advanced fold is collapsed by default. Uncontrolled
  // <details> would re-collapse on every parent re-render, so we own
  // the state.
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);
  // 2026-08-09: when an enhancement is already saved (parent supplied
  // `enhancement` OR the user just approved a preview), we render a
  // compact "saved" card. `editingAfterSave` opts the user back into
  // the full tools on demand.
  const [editingAfterSave, setEditingAfterSave] = useState<boolean>(false);
  // 2026-08-09: aria-live status text — assistive announcement for the
  // save flow. Cleared on tab change / rerun so screen readers don't
  // repeat stale announcements.
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const didAutoPreviewRef = useRef<boolean>(false);
  // 2026-08-06 — EXIF capture provenance + low-light warning. Reads
  // parse client-side once per file. NEVER returns GPS (see exifRead).
  const [exif, setExif] = useState<ExifReadResult | null>(null);
  useEffect(() => {
    let alive = true;
    readExif(file).then((res) => {
      if (alive) setExif(res);
    });
    return () => {
      alive = false;
    };
  }, [file]);
  const lowLight = exif ? isLowLightExif(exif) : false;
  const captureDeviceLabel = exif ? formatCaptureDevice(exif) : null;
  // Capture mode — derived from the consolidated `inputType` selector
  // (Advanced fold). The `phone` legacy value is folded into `auto`
  // since the analyzer already picks the right pipeline from EXIF.
  const captureMode: CaptureMode = inputType;
  // Pro-look is always on for the "auto" / "studio" path so the
  // simplified basic view is opinionated. Scanner input forces it off
  // (existing engine contract).
  const proLookOn = true;
  const proLookEnabled = captureMode === "scanner" ? false : proLookOn;

  // 2026-08-07 — Perspective correction. Opt-in only per file so the
  // "Preview" button never surprises the user with a warped output.
  // `perspectiveCorners` is the *committed* 4-corner picker result
  // (persisted into the recipe on next preview run).
  const [perspectiveOpen, setPerspectiveOpen] = useState<boolean>(false);
  const [perspectiveCorners, setPerspectiveCorners] = useState<
    [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] | null
  >(null);
  // Bump this integer to force PerspectiveCornerPicker to re-seed from
  // its auto-detected corners. Only bumped on explicit user actions
  // (analysis re-fires with a new rectangle, or the auto-detect chip
  // is tapped) — never as a side-effect of parent re-renders.
  const [perspectiveResetToken] = useState<number>(0);

  // 2026-08-07 — Glare heatmap toggle. Non-destructive overlay: never
  // touches the pipeline output, just draws red rectangles over the
  // saturated-highlight regions the analyzer surfaced.
  const [glareOverlayOn, setGlareOverlayOn] = useState<boolean>(false);

  // 2026-08-07 — H (portfolio coherence) on the single upload path.
  // Fetches the artist's portfolio tone signature once per session
  // per artist (see the module-level cache in
  // `portfolioToneStatsClient.ts`). Chip is hidden when the artist
  // has fewer than 3 public works.
  const [portfolioCoherenceOn, setPortfolioCoherenceOn] = useState<boolean>(false);
  const [portfolioStats, setPortfolioStats] = useState<PortfolioToneStats | null>(null);
  const portfolioToastRef = useRef<boolean>(false);
  useEffect(() => {
    let alive = true;
    if (!artistProfileId) {
      setPortfolioStats(null);
      return () => {
        alive = false;
      };
    }
    // NOTE: single fetch per artist per tab — see the module-level
    // dedupe map inside `fetchArtistPortfolioToneStats`. Multiple
    // editors mounting simultaneously will share ONE inflight promise.
    void fetchArtistPortfolioToneStats(artistProfileId).then((stats) => {
      if (!alive) return;
      setPortfolioStats(stats);
    });
    return () => {
      alive = false;
    };
  }, [artistProfileId]);
  const portfolioAvailable =
    !!portfolioStats && portfolioStats.sampleCount >= 3;

  useEffect(() => {
    return () => {
      const url = enhancePreviewUrlRef.current;
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }
    };
  }, []);

  useEffect(() => {
    // Reset preview when the underlying file swaps.
    if (enhancePreviewUrlRef.current) {
      try {
        URL.revokeObjectURL(enhancePreviewUrlRef.current);
      } catch {}
      enhancePreviewUrlRef.current = null;
    }
    setEnhancePreview(enhancement ?? null);
  }, [file, enhancement]);

  const resolvedAutoMode: EnhancementMode = useMemo(() => {
    if (enhanceMode !== "auto") return enhanceMode;
    if (analysis?.mode === "flat") return "flat";
    if (analysis?.mode === "object") return "object";
    return "object";
  }, [enhanceMode, analysis?.mode]);

  // 2026-08-09 corner-stick fix: stabilize the array identity so
  // PerspectiveCornerPicker doesn't see a new prop reference every
  // parent render. Keyed on the meaningful scalar inputs — the picker
  // only re-seeds when THESE change (via `resetToken`).
  const autoDetectedCornersMemo = useMemo<Quad | null>(() => {
    if (!analysis) return null;
    if (analysis.rectangleConfidence < 0.55) return defaultInsetQuad(0.1);
    return quadFromRect(analysis.suggestedCrop) ?? defaultInsetQuad(0.1);
  }, [
    analysis,
    analysis?.suggestedCrop?.x,
    analysis?.suggestedCrop?.y,
    analysis?.suggestedCrop?.w,
    analysis?.suggestedCrop?.h,
    analysis?.rectangleConfidence,
  ]);
  const perspectiveInitialCornersMemo = useMemo<Quad | null>(
    () => perspectiveCorners,
    [perspectiveCorners],
  );

  const runEnhancePreview = useCallback(async () => {
    if (!onEnhance) return;
    setEnhanceError(null);
    setEnhanceRunning(true);
    void recordUsageEvent({
      key: USAGE_KEYS.AI_IMAGE_ENHANCE_REQUESTED,
      featureKey: "ai.image_enhance",
      metadata: {
        mode: enhanceMode,
        provider: "local_opencv",
        source: meteringSource,
        latency_ms: null,
      },
    });
    try {
      if (resolvedAutoMode === "object") {
        // The local engine only covers the flat pipeline. Object mode
        // requires the server-side Photoroom hybrid, which is wired at
        // the parent-page level (single/bulk upload pages). Surface a
        // gentle hint so the user knows why the "Preview" button does
        // nothing here.
        setEnhanceError(t("upload.imageEnhance.objectHint"));
        void recordUsageEvent({
          key: USAGE_KEYS.AI_IMAGE_ENHANCE_FAILED,
          featureKey: "ai.image_enhance",
          metadata: {
            mode: enhanceMode,
            provider: "local_opencv",
            source: meteringSource,
            reason: "object_needs_server",
            latency_ms: null,
          },
        });
        return;
      }
      const seedCrop =
        crop ?? analysis?.suggestedCrop ?? { x: 0, y: 0, w: 1, h: 1 };
      const suggestion = analysis?.suggested ?? null;
      // Capture-mode presets — the scanner path disables perspective +
      // AWB; studio uses lighter tone; phone hand-held is the full
      // pipeline (matches proLookOn default).
      const isScanner = captureMode === "scanner";
      const wantsAwb = !isScanner;
      const wantsProLook = proLookEnabled;
      // Intensity multiplier: Studio is inherently gentler, so scale
      // by 0.5x on top of the user-chosen intensity. Applies to the
      // analyzer tone deltas AND the proLook config below.
      const iMult =
        (captureMode === "studio" ? 0.5 : 1) * intensityMultiplier(intensity);
      // 2026-08-09 auto keystone: when the analyzer is confident it
      // saw a flat rectangle AND the user hasn't picked corners
      // manually, pass the auto-detected corners so the pipeline
      // straightens the shot on first run. Scanner input skips this.
      const autoCorners: [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
      ] | null =
        !perspectiveCorners &&
        !isScanner &&
        analysis &&
        analysis.rectangleConfidence >= 0.55
          ? quadFromRect(analysis.suggestedCrop)
          : null;
      const sourceCornersToSend = perspectiveCorners ?? autoCorners;
      // 2026-08-09 pro-look tuning: pull Phase 2 defaults + intensity
      // multiplier. Values documented in proLook.ts and Todo 8.
      const proLookConfigOverrides = wantsProLook
        ? {
            enabled: true,
            satBoost: Math.min(0.09, 0.06 * iMult),
            warmthBias: Math.max(-0.05, Math.min(0.05, 0.02 * iMult)),
            claheClipLimit: Math.min(2.0, Math.max(0.8, 1.2 * (iMult === 0 ? 1 : Math.sqrt(iMult)))),
            exposureLumaTarget: Math.round(118 + (intensity === "strong" ? 8 : intensity === "light" ? -6 : 0)),
          }
        : undefined;
      // Homography — when the user opted into "원근 보정" and confirmed
      // corners via `PerspectiveCornerPicker`, pass them through. The
      // engine warps automatically. See homography.ts + the picker
      // component for the geometry contract.
      const result = await runFlatEnhancement({
        file,
        crop: seedCrop,
        sourceCorners: sourceCornersToSend,
        tone: suggestion
          ? {
              b: 1 + ((suggestion.b ?? 1) - 1) * iMult,
              c: 1 + ((suggestion.c ?? 1) - 1) * iMult,
              s: 1 + ((suggestion.s ?? 1) - 1) * iMult,
            }
          : undefined,
        proLook: proLookConfigOverrides,
        awb: wantsAwb
          ? {
              enabled: true,
              rectangle:
                analysis?.rectangleConfidence && analysis.rectangleConfidence >= 0.55
                  ? seedCrop
                  : null,
              rectangleConfidence: analysis?.rectangleConfidence ?? 0,
            }
          : undefined,
      });
      // A null blob means the canvas pipeline couldn't produce output
      // (HEIC decode failed, encode failed, no canvas API, …). We MUST
      // NOT wrap the original bytes in `flatBlobToFile` — that would
      // upload raw HEIC bytes with a `.webp` extension and `image/webp`
      // mime. Surface a specific error, log a `.failed`, and let the
      // user fall back to Quick adjust.
      if (!result.blob) {
        const reason = result.stageError ?? "local_pipeline_error";
        setEnhanceError(t("upload.imageEnhance.previewError"));
        void recordUsageEvent({
          key: USAGE_KEYS.AI_IMAGE_ENHANCE_FAILED,
          featureKey: "ai.image_enhance",
          metadata: {
            mode: enhanceMode,
            provider: "local_opencv",
            source: meteringSource,
            reason,
            latency_ms: result.latencyMs,
          },
        });
        return;
      }
      const displayFile = flatBlobToFile(file.name, result.blob);
      const sourceHash = await computeFileSha256(file);
      // Capture provenance — falls back to lastModified when EXIF is
      // absent (PNG/HEIC/WebP inputs).
      const capturedAtIso =
        exif?.dateTimeOriginal ?? new Date(file.lastModified).toISOString();
      const captureDevice = exif ? formatCaptureDevice(exif) : null;
      const meta: EnhancementMeta = {
        provider: "local_opencv",
        mode: enhanceMode,
        recipe: { kind: "flat", params: result.recipe as FlatRecipe },
        confidence: analysis?.rectangleConfidence ?? result.confidence,
        sourceHashSha256: sourceHash,
        processedAtIso: new Date().toISOString(),
        latencyMs: result.latencyMs,
        versions: {
          schema: ENHANCEMENT_META_SCHEMA_VERSION,
          engine: proLookEnabled ? "local_canvas_pro_v2" : "local_canvas_v1",
        },
        capturedAtIso,
        captureDevice,
      };
      if (enhancePreviewUrlRef.current) {
        try {
          URL.revokeObjectURL(enhancePreviewUrlRef.current);
        } catch {}
      }
      let finalDisplayFile = displayFile;
      let finalPreviewUrl = URL.createObjectURL(displayFile);
      let finalMeta = meta;
      // 2026-08-07 — Portfolio coherence pass on the single upload
      // path. Symmetric to bulk's G/H auto-wiring but per-file: we
      // apply ±4 % delta to the just-produced preview when the chip
      // is on AND we have >=3 samples cached for this artist.
      if (
        portfolioCoherenceOn &&
        portfolioAvailable &&
        portfolioStats &&
        result.recipe
      ) {
        const currentTone = result.recipe.tone;
        const currentSig = toneSignature(currentTone);
        const delta = computeToneDelta(currentSig, portfolioStats.signature, PORTFOLIO_ENVELOPE);
        const retone = await applyToneDeltaToFile(displayFile, delta);
        const nextTone = applyToneDelta(currentTone, delta);
        finalMeta = {
          ...meta,
          recipe: {
            kind: "flat",
            params: {
              ...meta.recipe.kind === "flat" ? meta.recipe.params : { sourceCorners: null, tone: nextTone, sharpen: 0, bezel: 0 },
              tone: nextTone,
            },
          },
          portfolioCoherence: buildPortfolioCoherenceMeta(
            portfolioStats.signature,
            delta,
            portfolioStats.sampleCount,
          ),
        };
        if (retone) {
          try {
            URL.revokeObjectURL(finalPreviewUrl);
          } catch {}
          finalDisplayFile = retone.file;
          finalPreviewUrl = retone.previewUrl;
        }
        if (!portfolioToastRef.current) {
          portfolioToastRef.current = true;
        }
      }
      enhancePreviewUrlRef.current = finalPreviewUrl;
      setEnhancePreview({
        displayFile: finalDisplayFile,
        previewUrl: finalPreviewUrl,
        meta: finalMeta,
      });
      void recordUsageEvent({
        // 2026-08-07 semantic split — preview success emits `.previewed`,
        // never `.completed`. `.completed` is reserved for the moment
        // this enhancement lands in a published storage row (fired
        // from the upload/publish flow).
        key: USAGE_KEYS.AI_IMAGE_ENHANCE_PREVIEWED,
        featureKey: "ai.image_enhance",
        metadata: {
          mode: enhanceMode,
          provider: "local_opencv",
          source: meteringSource,
          latency_ms: result.latencyMs,
          // Sub-stage timings — helps triage mobile-Safari perf
          // regressions without extra RUM plumbing.
          stage_decode_ms: result.stageTimings.decodeMs,
          stage_tone_ms: result.stageTimings.toneMs,
          stage_sharpen_ms: result.stageTimings.sharpenMs,
          stage_encode_ms: result.stageTimings.encodeMs,
        },
      });
    } catch (err) {
      setEnhanceError(
        err instanceof Error ? err.message : t("upload.imageEnhance.previewError"),
      );
      void recordUsageEvent({
        key: USAGE_KEYS.AI_IMAGE_ENHANCE_FAILED,
        featureKey: "ai.image_enhance",
        metadata: {
          mode: enhanceMode,
          provider: "local_opencv",
          source: meteringSource,
          reason: "local_pipeline_error",
          latency_ms: null,
        },
      });
    } finally {
      setEnhanceRunning(false);
    }
  }, [
    onEnhance,
    enhanceMode,
    resolvedAutoMode,
    meteringSource,
    t,
    file,
    crop,
    analysis,
    analysis?.suggestedCrop,
    analysis?.suggested,
    analysis?.rectangleConfidence,
    captureMode,
    exif,
    proLookEnabled,
    perspectiveCorners,
    portfolioCoherenceOn,
    portfolioAvailable,
    portfolioStats,
    intensity,
  ]);

  // 2026-08-09 Todo 4: auto-run a first preview as soon as analysis
  // completes, ONLY when the user is on the Enhance tab and hasn't
  // already got a saved enhancement or in-flight run. Guarded by a ref
  // so re-analysis of the same file doesn't re-fire.
  useEffect(() => {
    if (!onEnhance) return;
    if (tab !== "enhance") return;
    if (!analysis) return;
    if (enhancePreview) return;
    if (enhancement) return;
    if (enhanceRunning) return;
    if (didAutoPreviewRef.current) return;
    // Object mode needs the server-side hybrid pipeline; skip auto-run
    // there so we don't surface the "objectHint" error unexpectedly.
    if (resolvedAutoMode === "object") return;
    didAutoPreviewRef.current = true;
    void runEnhancePreview();
  }, [
    analysis,
    tab,
    onEnhance,
    enhancePreview,
    enhancement,
    enhanceRunning,
    resolvedAutoMode,
    runEnhancePreview,
  ]);

  // Reset the auto-preview sentinel when the underlying file changes
  // so a fresh upload gets its own first-run preview.
  useEffect(() => {
    didAutoPreviewRef.current = false;
  }, [file]);

  const handleEnhanceApprove = useCallback(() => {
    if (!onEnhance || !enhancePreview) return;
    onEnhance(enhancePreview);
    setEditingAfterSave(false);
    setSaveStatus(t("upload.imageEnhance.applied.status"));
    setAdvancedOpen(false);
    void recordUsageEvent({
      key: USAGE_KEYS.AI_IMAGE_ENHANCE_ACCEPTED,
      featureKey: "ai.image_enhance",
      metadata: {
        mode: enhancePreview.meta.mode,
        provider: enhancePreview.meta.provider,
        source: meteringSource,
        latency_ms: enhancePreview.meta.latencyMs,
      },
    });
  }, [enhancePreview, onEnhance, meteringSource, t]);

  const handleEnhanceReject = useCallback(() => {
    if (!onEnhance) return;
    const previous = enhancePreview;
    if (enhancePreviewUrlRef.current) {
      try {
        URL.revokeObjectURL(enhancePreviewUrlRef.current);
      } catch {}
      enhancePreviewUrlRef.current = null;
    }
    setEnhancePreview(null);
    onEnhance(null);
    if (previous) {
      void recordUsageEvent({
        key: USAGE_KEYS.AI_IMAGE_ENHANCE_REJECTED,
        featureKey: "ai.image_enhance",
        metadata: {
          mode: previous.meta.mode,
          provider: previous.meta.provider,
          source: meteringSource,
          latency_ms: previous.meta.latencyMs,
        },
      });
    }
  }, [enhancePreview, onEnhance, meteringSource]);

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

      {enhancementEnabled && (
        <div
          role="tablist"
          aria-label={t("upload.imageEnhance.tablist")}
          className="flex items-center gap-1 border-b border-zinc-200 pb-2 text-xs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "quick"}
            onClick={() => setTab("quick")}
            className={`rounded-full px-3 py-1 ${
              tab === "quick"
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {t("upload.imageEnhance.tabQuick")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "enhance"}
            onClick={() => setTab("enhance")}
            className={`rounded-full px-3 py-1 ${
              tab === "enhance"
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {t("upload.imageEnhance.tabEnhance")}
            <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">
              {t("upload.imageEnhance.beta")}
            </span>
          </button>
        </div>
      )}

      {enhancementEnabled && tab === "enhance" ? (
        <div className="space-y-3">
          {/* Aria-live region — announces save/reset transitions for
              screen readers. Kept visually hidden. */}
          <p
            className="sr-only"
            aria-live="polite"
            role="status"
          >
            {saveStatus ?? ""}
          </p>

          {/* SAVED VIEW — parent already has an approved enhancement.
              Compact confirmation card + "다시 편집" / "원본으로 되돌리기"
              affordances. User has to explicitly opt back in to see the
              full tools. */}
          {enhancement && !editingAfterSave ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enhancement.previewUrl}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-md border border-white object-cover"
                  draggable={false}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white">
                      {t("upload.imageEnhance.appliedChip")}
                    </span>
                    <span className="text-xs font-medium text-emerald-900">
                      {t("upload.imageEnhance.applied.title")}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAfterSave(true);
                        setSaveStatus(null);
                      }}
                      className="rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-emerald-800 hover:bg-emerald-100"
                    >
                      {t("upload.imageEnhance.applied.reopen")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleEnhanceReject();
                        setEditingAfterSave(false);
                        setSaveStatus(null);
                      }}
                      className="rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-zinc-700 hover:bg-zinc-100"
                    >
                      {t("upload.imageEnhance.applied.revert")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Reshoot advisory */}
              {analysis && (analysis.blurScore < 0.1 || analysis.glareScore > 0.1) && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  {t("upload.imageEnhance.reshootAdvisory")}
                </p>
              )}

              {/* Low-light warning (2026-08-06). */}
              {lowLight && (
                <p
                  className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
                  title={t("upload.imageEnhance.lowLightAdvisory")}
                >
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-amber-900">
                    {t("upload.imageEnhance.lowLight")}
                  </span>
                  <span>{t("upload.imageEnhance.lowLightAdvisory")}</span>
                </p>
              )}

              {/* BASIC — one-shot auto-enhance CTA + intensity + perspective */}
              <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
                <button
                  type="button"
                  onClick={() => {
                    setSaveStatus(null);
                    void runEnhancePreview();
                  }}
                  disabled={enhanceRunning || !analysis}
                  className="w-full rounded-full bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {enhanceRunning
                    ? t("upload.imageEnhance.running")
                    : t("upload.imageEnhance.autoRunCta")}
                </button>

                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-zinc-600">
                    {t("upload.imageEnhance.intensity.label")}
                  </span>
                  {(["light", "normal", "strong"] as Intensity[]).map((i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setIntensity(i)}
                      className={`rounded-full border px-2.5 py-1 ${
                        intensity === i
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      {t(`upload.imageEnhance.intensity.${i}`)}
                    </button>
                  ))}
                </div>
                <p className="text-[10.5px] leading-relaxed text-zinc-500">
                  {t("upload.imageEnhance.intensity.hint")}
                </p>

                {resolvedAutoMode === "flat" && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setPerspectiveOpen((v) => !v)}
                      className={`rounded-full border px-2.5 py-1 ${
                        perspectiveOpen || perspectiveCorners
                          ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                          : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                      aria-pressed={perspectiveOpen}
                      title={t("upload.imageEnhance.perspective.hint")}
                    >
                      {t("upload.imageEnhance.perspective.openBtn")}
                    </button>
                    {perspectiveCorners && !perspectiveOpen && (
                      <span className="text-[10px] text-emerald-700">
                        {t("upload.imageEnhance.perspective.applied")}
                      </span>
                    )}
                    {/* Auto-keystone chip. Visible when the analyzer is
                        confident AND the user hasn't taken over corners.
                        Click opens the picker so the user can nudge. */}
                    {!perspectiveCorners &&
                      !perspectiveOpen &&
                      analysis &&
                      analysis.rectangleConfidence >= 0.55 &&
                      captureMode !== "scanner" && (
                        <button
                          type="button"
                          onClick={() => setPerspectiveOpen(true)}
                          className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[10px] text-emerald-800 hover:bg-emerald-100"
                        >
                          {t("upload.imageEnhance.perspective.autoAppliedChip")}
                        </button>
                      )}
                  </div>
                )}
              </div>

              {perspectiveOpen && previewUrl && (
                <PerspectiveCornerPicker
                  imageUrl={previewUrl}
                  imageWidth={analysis?.width || 1024}
                  imageHeight={analysis?.height || 1024}
                  initialCorners={perspectiveInitialCornersMemo}
                  autoDetectedCorners={autoDetectedCornersMemo}
                  resetToken={perspectiveResetToken}
                  onConfirm={(q: Quad) => {
                    setPerspectiveCorners(q);
                    setPerspectiveOpen(false);
                    void runEnhancePreview();
                  }}
                  onCancel={() => setPerspectiveOpen(false)}
                />
              )}

              {/* Preview + save/rerun/cancel */}
              {enhancePreview ? (
                <>
                  <BeforeAfterCompare
                    beforeSrc={previewUrl ?? ""}
                    afterSrc={enhancePreview.previewUrl}
                    beforeAlt={t("upload.imageEnhance.beforeAlt")}
                    afterAlt={t("upload.imageEnhance.afterAlt")}
                  />
                  <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                    <button
                      type="button"
                      onClick={handleEnhanceReject}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
                    >
                      {t("upload.imageEnhance.cancelCta")}
                    </button>
                    <button
                      type="button"
                      onClick={runEnhancePreview}
                      disabled={enhanceRunning || !analysis}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      {t("upload.imageEnhance.rerunCta")}
                    </button>
                    <button
                      type="button"
                      onClick={handleEnhanceApprove}
                      className="rounded-full bg-zinc-900 px-3 py-1 text-white hover:bg-zinc-800"
                    >
                      {t("upload.imageEnhance.saveCta")}
                    </button>
                  </div>
                </>
              ) : (
                previewUrl && (
                  <div className="relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-zinc-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt=""
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
                    {glareOverlayOn && analysis && analysis.glareRegions.length > 0 && (
                      <>
                        <svg
                          className="pointer-events-none absolute inset-0 h-full w-full"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          aria-hidden
                        >
                          {analysis.glareRegions.map((r, i) => (
                            <rect
                              key={i}
                              x={r.x * 100}
                              y={r.y * 100}
                              width={r.w * 100}
                              height={r.h * 100}
                              fill="rgba(244,63,94,0.15)"
                              stroke="rgba(244,63,94,0.7)"
                              strokeWidth={0.5}
                              vectorEffect="non-scaling-stroke"
                            />
                          ))}
                        </svg>
                        <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-rose-900/70 px-2 py-1 text-[10px] text-white">
                          {t("upload.imageEnhance.glareOverlay.reshootHint")}
                        </p>
                      </>
                    )}
                  </div>
                )
              )}

              {/* ADVANCED — folded by default. Everything the user rarely
                  needs lives here: input type, glare overlay, portfolio
                  coherence, quality diagnosis chips. */}
              <details
                open={advancedOpen}
                onToggle={(e) =>
                  setAdvancedOpen((e.target as HTMLDetailsElement).open)
                }
                className="rounded-lg border border-zinc-200 bg-white"
              >
                <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50">
                  {t("upload.imageEnhance.advancedToggle")}
                </summary>
                <div className="space-y-3 border-t border-zinc-200 px-3 py-3">
                  {/* Consolidated input type */}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-zinc-600">
                        {t("upload.imageEnhance.inputType.label")}
                      </span>
                      {(["auto", "studio", "scanner"] as InputType[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setInputType(m)}
                          className={`rounded-full border px-2.5 py-1 ${
                            inputType === m
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                          }`}
                        >
                          {t(`upload.imageEnhance.inputType.${m}`)}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10.5px] leading-relaxed text-zinc-500">
                      {t("upload.imageEnhance.inputType.hint")}
                    </p>
                  </div>

                  {/* Glare overlay toggle */}
                  {analysis && analysis.glareRegions.length > 0 && (
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => setGlareOverlayOn((v) => !v)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${
                          glareOverlayOn
                            ? "border-rose-500 bg-rose-50 text-rose-800"
                            : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                        }`}
                        aria-pressed={glareOverlayOn}
                      >
                        {t("upload.imageEnhance.glareOverlay.toggle")}
                      </button>
                      <p className="text-[10.5px] leading-relaxed text-zinc-500">
                        {t("upload.imageEnhance.controls.glare.hint")}
                      </p>
                    </div>
                  )}

                  {/* Portfolio coherence checkbox */}
                  {portfolioAvailable && (
                    <label className="flex cursor-pointer items-start gap-2 text-[11px] text-zinc-700">
                      <input
                        type="checkbox"
                        checked={portfolioCoherenceOn}
                        onChange={(e) => setPortfolioCoherenceOn(e.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 accent-zinc-900"
                      />
                      <span>
                        <span className="font-medium">
                          {t("bulk.enhance.portfolioCoherence")}
                        </span>
                        <span className="ml-1 text-zinc-500">
                          {t("upload.imageEnhance.controls.portfolio.hint")}
                        </span>
                      </span>
                    </label>
                  )}

                  {/* Quality diagnosis chips — read-only */}
                  {analysis && (
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span
                        className={`rounded-full px-2 py-0.5 ${
                          analysis.rectangleConfidence >= 0.55
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-zinc-100 text-zinc-600"
                        }`}
                        title={t("upload.imageEnhance.rectangleHint")}
                      >
                        {t("upload.imageEnhance.rectangleConfidence")}
                        {": "}
                        {Math.round(analysis.rectangleConfidence * 100)}%
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 ${
                          analysis.blurScore < 0.15
                            ? "bg-amber-50 text-amber-700"
                            : "bg-zinc-100 text-zinc-600"
                        }`}
                        title={t("upload.imageEnhance.blurHint")}
                      >
                        {t("upload.imageEnhance.blurScore")}
                        {": "}
                        {Math.round(analysis.blurScore * 100)}%
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 ${
                          analysis.glareScore > 0.05
                            ? "bg-amber-50 text-amber-700"
                            : "bg-zinc-100 text-zinc-600"
                        }`}
                        title={t("upload.imageEnhance.glareHint")}
                      >
                        {t("upload.imageEnhance.glareScore")}
                        {": "}
                        {Math.round(analysis.glareScore * 100)}%
                      </span>
                    </div>
                  )}

                  {captureDeviceLabel && (
                    <p className="text-[10px] text-zinc-500">
                      {t("upload.imageEnhance.captureDeviceLabel")}: {captureDeviceLabel}
                    </p>
                  )}
                </div>
              </details>

              {enhanceError && (
                <p className="text-[11px] text-amber-700">{enhanceError}</p>
              )}
              {!enhancePreview && (
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  {t("upload.imageEnhance.footer")}
                </p>
              )}
            </>
          )}
        </div>
      ) : null}

      {enhancementEnabled && tab === "enhance" ? null : (
        <>

      {/* 2026-08-09 Todo 7: Quick Adjust doesn't feed the enhanced
          upload — surface that expectation up-front so users don't
          drag sliders and then be confused when the saved file is the
          untouched original. */}
      {enhancementEnabled && (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-600">
          {t("upload.imageEnhance.quickHint")}
        </p>
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
        </>
      )}
    </div>
  );
}
