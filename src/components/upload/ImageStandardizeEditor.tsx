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
import { resolveAdaptiveProLook } from "@/lib/image/enhancement/proLook.tunables";
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
  hasValidArea,
  quadFromRect,
  resolveAutoCorners,
  type Quad,
} from "@/lib/image/enhancement/cornerPickerGeometry";
import type { WallBrightness } from "@/lib/image/enhancement/awb";
import { ellipseRestorationCorners } from "@/lib/image/enhancement/ellipse";
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
import { aiApi } from "@/lib/ai/browser";
import type { ArtworkQualityGateResult } from "@/lib/ai/types";
import {
  getOrFetchVisionResult,
  prepareImageForVision,
} from "@/lib/image/enhancement/aiClient";
import { useQualityGatePref } from "@/lib/image/enhancement/qualityGatePref";
import { QualityGateBanner } from "@/components/upload/QualityGateBanner";

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
 * 2026-08-19 — Snapshot of the pre-flight quality gate the editor
 * pushes upstream through `onQualityGate` so a parent Save/Publish
 * CTA can gate itself on a `block` severity that the artist has not
 * overridden.
 *
 * `dismissed` is true after the artist explicitly acknowledges a
 * `warn` banner via "계속 진행". Parents should treat dismissed warns
 * exactly like `severity: "ok"` (upload proceeds normally).
 *
 * `degraded` mirrors the AI degradation flag — the parent should
 * NEVER block on a degraded gate.
 */
export type QualityGateSurfaceState = {
  severity: "ok" | "warn" | "block";
  override: boolean;
  degraded: boolean;
  dismissed: boolean;
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
   * 2026-08-19 — Pre-flight quality gate observer. Fires whenever the
   * gate result changes (result arrives, user clicks proceed / use
   * anyway, or file changes). Parents that render a Save/Publish CTA
   * use this to disable the button when
   * `severity === "block" && !override && !degraded && !dismissed`.
   * `null` means "gate has not produced a verdict yet on this file".
   */
  onQualityGate?: (state: QualityGateSurfaceState | null) => void;
  /**
   * 2026-08-19 — Called when the artist clicks the banner's "재촬영"
   * button. Parents SHOULD remove this file from their list; if
   * omitted, the banner only dismisses locally (the file stays and
   * the artist can retry).
   */
  onReshootRequest?: () => void;
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

/**
 * True when any corner of `a` deviates from the matching corner of
 * `b` by more than `tol` in either axis. Used by the wizard to
 * decide whether the "자동 감지값 복원" secondary action should
 * appear. `tol` defaults to 0.005 (0.5 % of the normalized image
 * width / height) — same tolerance the geometry helper uses for
 * axis-aligned detection.
 */
function quadsDiffer(
  a: Quad | null | undefined,
  b: Quad | null | undefined,
  tol: number = 0.005,
): boolean {
  if (!a || !b) return false;
  for (let i = 0; i < 4; i += 1) {
    if (
      Math.abs(a[i][0] - b[i][0]) > tol ||
      Math.abs(a[i][1] - b[i][1]) > tol
    ) {
      return true;
    }
  }
  return false;
}

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
  onQualityGate,
  onReshootRequest,
}: Props) {
  const { t, locale } = useT();
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

  // ------------------------------------------------------------------
  // 2026-08-19 — Pre-flight artwork quality gate (vision LLM)
  // ------------------------------------------------------------------
  //
  // Runs AFTER `analyzeImageFile` succeeds (so we can pass the DSP
  // `mode` hint) and BEFORE the "Save" / "Enhance" CTAs enable. The
  // gate is fail-open — any degraded response silently returns `ok`
  // so the artist is never hard-blocked by an AI infra failure.
  //
  // Dedup: `${sha256}:artwork_quality_gate` via the shared vision
  // cache. Re-opening the same photo in the wizard never re-hits
  // OpenAI in the same session.
  const qualityGatePref = useQualityGatePref();
  const [qualityGate, setQualityGate] =
    useState<ArtworkQualityGateResult | null>(null);
  const [qualityGateRunning, setQualityGateRunning] = useState(false);
  const [qualityGateOverride, setQualityGateOverride] = useState(false);
  const [qualityGateDismissed, setQualityGateDismissed] = useState(false);

  useEffect(() => {
    // Reset per-file so a new upload gets a fresh verdict.
    setQualityGate(null);
    setQualityGateOverride(false);
    setQualityGateDismissed(false);
  }, [file]);

  useEffect(() => {
    // Wait for the DSP analyzer to succeed — we key on `analysis.mode`
    // for the `contextHint`. If analyze failed, still run the gate
    // with `unknown` so a broken decode doesn't silence us.
    if (analyzing) return;
    if (!qualityGatePref) {
      setQualityGate(null);
      return;
    }
    let alive = true;
    setQualityGateRunning(true);
    (async () => {
      try {
        const contextHint =
          analysis?.mode === "flat"
            ? "flat_2d"
            : analysis?.mode === "object"
              ? "sculpture_3d"
              : "unknown";
        const payload = await prepareImageForVision(file);
        if (!alive) return;
        const key = `${payload.sha256}:artwork_quality_gate`;
        const result = await getOrFetchVisionResult<ArtworkQualityGateResult>(
          key,
          () =>
            aiApi.artworkQualityGate({
              imageBase64: payload.imageBase64,
              mime: payload.mime,
              imagePxWidth: payload.imagePxWidth,
              imagePxHeight: payload.imagePxHeight,
              contextHint,
            }),
        );
        if (!alive) return;
        setQualityGate(result);
      } catch {
        // Fail open — any exception (decode failed, network dropped)
        // silently degrades to "ok".
        if (!alive) return;
        setQualityGate({
          usable: true,
          severity: "ok",
          issues: [],
          reshootAdviceKo: "",
          reshootAdviceEn: "",
          scores: { sharpness: 0.5, glare: 0, exposure: 0.5, framing: 0.5 },
          degraded: true,
          reason: "error",
        });
      } finally {
        if (alive) setQualityGateRunning(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [file, analyzing, analysis?.mode, qualityGatePref]);

  // Push gate state upstream whenever any input to the observable
  // shape changes. Parent Save/Publish CTAs use this to gate on
  // `severity === "block" && !override && !degraded && !dismissed`.
  useEffect(() => {
    if (!onQualityGate) return;
    if (!qualityGate) {
      onQualityGate(null);
      return;
    }
    const isDegraded = qualityGate.degraded === true;
    onQualityGate({
      severity: qualityGate.severity,
      override: qualityGateOverride,
      degraded: isDegraded,
      dismissed: qualityGateDismissed,
    });
  }, [qualityGate, qualityGateOverride, qualityGateDismissed, onQualityGate]);

  // Effective severity — a degraded verdict or a dismissed warn is
  // treated as `ok` for banner rendering AND for auto-preview
  // gating. Block+override still surfaces the enhance flow, but the
  // meta records `override: true` for QA visibility.
  const effectiveGateSeverity: "ok" | "warn" | "block" = (() => {
    if (!qualityGate) return "ok";
    if (qualityGate.degraded) return "ok";
    if (qualityGate.severity === "warn" && qualityGateDismissed) return "ok";
    return qualityGate.severity;
  })();
  const gateBlocked =
    effectiveGateSeverity === "block" && !qualityGateOverride;

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
  // F2 (2026-08-10) — wall brightness chip. `normal` is the wizard
  // default (matte target 248 — bumped from the historical 243 so
  // walls actually read as white); users can dial to `soft` (245)
  // or `bright` (252) per image.
  const [wallBrightness, setWallBrightness] = useState<WallBrightness>("normal");
  // F4 (2026-08-10) — wizard step machine. Step 1 = perspective +
  // crop, step 2 = tone + wall, step 3 = review + save. Users can
  // freely revisit any step they have already advanced past; future
  // steps are unlocked once a preview exists (step 2 → 3 requires
  // a successful `runEnhancePreview`).
  const [wizardStep, setWizardStep] = useState<
    "perspective" | "tone" | "confirm"
  >("perspective");
  // Track whether the user has touched the picker on step 1. Enables
  // the "자동 감지값 복원" secondary action.
  const [perspectiveUserAdjusted, setPerspectiveUserAdjusted] =
    useState<boolean>(false);
  // Advanced-fold: "이 단계 건너뛰기" — when true, step 1 forwards to
  // step 2 without applying any perspective correction (source
  // corners forced to null so the pipeline runs crop-only).
  const [perspectiveSkipped, setPerspectiveSkipped] = useState<boolean>(false);
  // Advanced-fold: "원본 비율 유지" — when true, the engine keeps
  // the source aspect intact instead of rectifying to the estimated
  // artwork aspect. Threaded via `targetAspect`.
  const [keepOriginalAspect, setKeepOriginalAspect] = useState<boolean>(false);
  // F4 (2026-08-10) — per-step advanced folds live in their own
  // state so the two steps don't share a collapse state. The
  // pre-F4 single `advancedOpen` was removed with the drastic
  // simplification since each wizard step now hosts its own
  // <details> section.
  const [perspectiveAdvancedOpen, setPerspectiveAdvancedOpen] =
    useState<boolean>(false);
  const [toneAdvancedOpen, setToneAdvancedOpen] = useState<boolean>(false);
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

  // 2026-08-07 — Perspective correction. `perspectiveCorners` is
  // the *committed* 4-corner picker result (persisted into the
  // recipe on next preview run). Since F4 (2026-08-10) the picker
  // is always inline as Step 1 of the wizard, so the pre-F4
  // `perspectiveOpen` toggle no longer exists.
  const [perspectiveCorners, setPerspectiveCorners] = useState<
    [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] | null
  >(null);
  // Bump this integer to force PerspectiveCornerPicker to re-seed from
  // its auto-detected corners. Only bumped on explicit user actions
  // (analysis re-fires with a new rectangle, or the "자동 감지값 복원"
  // chip is tapped) — never as a side-effect of parent re-renders.
  const [perspectiveResetToken, setPerspectiveResetToken] =
    useState<number>(0);
  // F4 (2026-08-10) — the picker's live quad streamed via its new
  // `onChange` prop. The wizard's "다음" button snapshots this into
  // `perspectiveCorners` when advancing to step 2. Kept separate
  // from the committed `perspectiveCorners` so bouncing back to
  // step 1 preserves the draft.
  const [wizardPerspectiveDraft, setWizardPerspectiveDraft] =
    useState<Quad | null>(null);

  // 2026-08-07 — Glare heatmap toggle. Non-destructive overlay: never
  // touches the pipeline output, just draws red rectangles over the
  // saturated-highlight regions the analyzer surfaced.
  const [glareOverlayOn, setGlareOverlayOn] = useState<boolean>(false);

  // G1 (2026-08-10) — Wall-anchored WB pick point (normalized [0,1]
  // in image space). `null` means the engine auto-detects the wall
  // region; a `{ x, y }` object means the user clicked on the image
  // to pin the sample. `pickingWall` is a transient state: while true
  // the click surface consumes clicks into wall-pick instead of the
  // default no-op.
  const [wallPick, setWallPick] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [pickingWall, setPickingWall] = useState<boolean>(false);

  // G2 (2026-08-10) — ellipse (round-subject) restoration toggle.
  // Auto-suggests when the analyzer detects a circular subject with
  // aspect distortion > 3 %. User can dismiss ("되돌리기") to revert
  // to the ellipse (non-restored) pipeline.
  const [ellipseRestored, setEllipseRestored] = useState<boolean>(false);

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
    // Auto mode always runs the local flat pipeline. It is safe on any
    // image — corners/AWB become no-ops when analyzer confidence is
    // low, and the server-side "object" (background removal) path is
    // opt-in via an explicit input selector, never derived from the
    // analyzer's flat-vs-object heuristic. Previously this fell back
    // to "object" whenever `analysis.mode` was null/object, which
    // silently blocked the auto-run + preview button (QA 2026-08-09).
    return "flat";
  }, [enhanceMode]);

  // 2026-08-09 corner-stick fix: stabilize the array identity so
  // PerspectiveCornerPicker doesn't see a new prop reference every
  // parent render. Keyed on the meaningful scalar inputs — the picker
  // only re-seeds when THESE change (via `resetToken`).
  //
  // §Fix B (2026-08-10): the picker's seed is intentionally MORE
  // permissive than the auto-warp seed. When the analyzer surfaces
  // *any* edge-detected corners we show them in the picker so the user
  // has a starting point close to the artwork; the safer
  // `resolveAutoCorners` gate (below) still keeps the auto-warp from
  // firing on those low-confidence corners. Falls back to the
  // bounding-box quad, then to a 10 % inset quad.
  const autoDetectedCornersMemo = useMemo<Quad | null>(() => {
    if (!analysis) return null;
    if (analysis.suggestedRectangleCorners) {
      return analysis.suggestedRectangleCorners as Quad;
    }
    if (analysis.rectangleConfidence < 0.4) return defaultInsetQuad(0.1);
    return quadFromRect(analysis.suggestedCrop) ?? defaultInsetQuad(0.1);
  }, [
    analysis,
    analysis?.suggestedCrop?.x,
    analysis?.suggestedCrop?.y,
    analysis?.suggestedCrop?.w,
    analysis?.suggestedCrop?.h,
    analysis?.suggestedRectangleCorners,
    analysis?.rectangleConfidence,
  ]);
  // Same helper the pipeline uses so the "auto perspective 적용됨"
  // chip only appears when we're ACTUALLY going to warp. Cheap
  // recompute — pure over the analyzer output.
  const autoWarpCornersMemo = useMemo<Quad | null>(() => {
    if (!analysis) return null;
    return resolveAutoCorners({
      suggestedRectangleCorners: analysis.suggestedRectangleCorners as Quad | null,
      suggestedRectangleConfidence: analysis.suggestedRectangleConfidence,
      suggestedCrop: analysis.suggestedCrop,
      rectangleConfidence: analysis.rectangleConfidence,
    });
  }, [
    analysis,
    analysis?.suggestedRectangleCorners,
    analysis?.suggestedRectangleConfidence,
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

  // F4 (2026-08-10) — step-1 auto-seed provenance for the chip strip
  // above the picker. Follows the same priority the pipeline uses:
  //   edge quad (resolveAutoCorners) → bbox quad → manual.
  const perspectiveAutoSource: "edge" | "bbox" | "none" = useMemo(() => {
    if (!analysis) return "none";
    if (autoWarpCornersMemo) {
      // resolveAutoCorners emits an axis-aligned bbox when it
      // couldn't get a confident rotated edge quad. Distinguish via
      // the raw suggestedRectangleCorners field.
      const edge = analysis.suggestedRectangleCorners;
      const edgeConf = analysis.suggestedRectangleConfidence ?? 0;
      if (edge && hasValidArea(edge as Quad) && edgeConf >= 0.55) {
        return "edge";
      }
      return "bbox";
    }
    if (analysis.suggestedCrop && quadFromRect(analysis.suggestedCrop)) {
      return "bbox";
    }
    return "none";
  }, [analysis, autoWarpCornersMemo]);

  // Seed the Step-1 PerspectiveCornerPicker with (in order):
  //   1. user's committed corners,
  //   2. resolveAutoCorners edge/bbox quad,
  //   3. quadFromRect(suggestedCrop) as a last-chance bbox,
  //   4. defaultInsetQuad(0.1) so the picker isn't empty.
  const wizardPerspectiveSeed = useMemo<Quad>(() => {
    if (perspectiveCorners) return perspectiveCorners;
    if (autoWarpCornersMemo) return autoWarpCornersMemo;
    const bbox = analysis?.suggestedCrop
      ? quadFromRect(analysis.suggestedCrop)
      : null;
    if (bbox) return bbox;
    return defaultInsetQuad(0.1);
  }, [perspectiveCorners, autoWarpCornersMemo, analysis]);

  // §Fix C (2026-08-10) — surface "auto detected" chips in the Basic
  // view ONLY when the pipeline actually applied that auto action on
  // the currently-rendered preview. Prevents chips ghost-lingering
  // when a detection was possible but the user overrode it.
  const autoWarpFired = Boolean(
    enhancePreview &&
      !perspectiveCorners &&
      captureMode !== "scanner" &&
      autoWarpCornersMemo,
  );
  const wallAutoFired = Boolean(
    enhancePreview &&
      !wallPick &&
      captureMode !== "scanner" &&
      enhancePreview.meta.recipe.kind === "flat" &&
      enhancePreview.meta.recipe.params.awb?.source === "wall-biased",
  );

  const runEnhancePreview = useCallback(async () => {
    if (!onEnhance) return;
    // 2026-08-19 — Blocked by the pre-flight quality gate (and not
    // overridden). The banner tells the artist why; silently no-op
    // here so any manual "Preview" click also respects the block.
    if (gateBlocked) return;
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
      // Auto keystone: when the analyzer is confident it saw a flat
      // rectangle AND the user hasn't picked corners manually, pass the
      // auto-detected corners so the pipeline straightens the shot on
      // first run. Scanner input skips this.
      //
      // §Fix B (2026-08-10): funnel this through `resolveAutoCorners`
      // so a low-confidence edge-detector fit can't distort a
      // straight-on capture. The gate returns:
      //   • the edge-based quad when both detectors agree AND the quad
      //     is meaningfully rotated / keystoned,
      //   • the bounding-box quad (axis-aligned) when only the
      //     rectangle heuristic is confident — pipeline will skip the
      //     warp since `cornersLookQuadrilateral` is now aware of
      //     bounding-box-relative axis alignment (crop-only path),
      //   • null when nothing is trustworthy.
      const autoCorners: [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
      ] | null = (() => {
        if (perspectiveSkipped) return null;
        if (perspectiveCorners || isScanner || !analysis) return null;
        const resolved = resolveAutoCorners({
          suggestedRectangleCorners: analysis.suggestedRectangleCorners as Quad | null,
          suggestedRectangleConfidence: analysis.suggestedRectangleConfidence,
          suggestedCrop: analysis.suggestedCrop,
          rectangleConfidence: analysis.rectangleConfidence,
        });
        return resolved as [
          NormalizedPoint,
          NormalizedPoint,
          NormalizedPoint,
          NormalizedPoint,
        ] | null;
      })();
      // G2 (2026-08-10) — ellipse restoration override. When the user
      // opts into "restore circle" and the ellipse fit deviates from
      // 1:1 by more than 3 %, replace the source corners with the
      // ellipse's tight rotated bounding-quad and force a 1:1 target
      // aspect. This makes the engine warp the ellipse into an
      // axis-aligned circle without touching any other stage.
      const wantsEllipseRestore =
        ellipseRestored &&
        !isScanner &&
        !!analysis?.ellipse &&
        Math.abs(analysis.ellipse.aspect - 1) > 0.03 &&
        analysis.ellipse.confidence >= 0.6;
      const ellipseCorners: [
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
        NormalizedPoint,
      ] | null =
        wantsEllipseRestore && analysis?.ellipse
          ? (ellipseRestorationCorners(analysis.ellipse) as [
              NormalizedPoint,
              NormalizedPoint,
              NormalizedPoint,
              NormalizedPoint,
            ])
          : null;
      const sourceCornersToSend = perspectiveSkipped
        ? null
        : wantsEllipseRestore
          ? ellipseCorners
          : (perspectiveCorners ?? autoCorners);
      // F4 advanced fold — "원본 비율 유지" overrides the estimated
      // rectified aspect with the analyzer's source aspect so
      // straight-on captures keep their exact WxH ratio.
      const sourceAspect =
        analysis && analysis.height > 0
          ? analysis.width / analysis.height
          : undefined;
      const targetAspectOverride = wantsEllipseRestore
        ? 1
        : keepOriginalAspect && sourceAspect
          ? sourceAspect
          : undefined;
      // G3 (2026-08-10) — adaptive pro-look tuning. Instead of the
      // static intensity-multiplier scaling we used pre-G3, resolve
      // the tunables from analyzer signals (blurScore / glareScore)
      // and the user's paintingMode flag. See proLook.tunables.ts
      // for the mapping rationale.
      const paintingMode =
        analysis?.mode === "flat" || captureMode === "studio";
      const adaptive =
        wantsProLook && analysis
          ? resolveAdaptiveProLook(
              {
                blurScore: analysis.blurScore,
                glareScore: analysis.glareScore,
                intensityMultiplier: iMult,
                paintingMode,
              },
              {
                exposureLumaTarget: Math.round(
                  118 +
                    (intensity === "strong"
                      ? 8
                      : intensity === "light"
                      ? -6
                      : 0),
                ),
                warmthBias: Math.max(-0.05, Math.min(0.05, 0.02 * iMult)),
              },
            )
          : null;
      const proLookConfigOverrides = wantsProLook && adaptive
        ? {
            enabled: true,
            satBoost: adaptive.satBoost,
            warmthBias: adaptive.warmthBias,
            claheClipLimit: adaptive.claheClipLimit,
            exposureLumaTarget: adaptive.exposureLumaTarget,
            unsharpAmount: adaptive.unsharpAmount,
            highlightCompress: adaptive.highlightCompress,
          }
        : undefined;
      // Homography — when the user opted into "원근 보정" and confirmed
      // corners via `PerspectiveCornerPicker`, pass them through. The
      // engine warps automatically. See homography.ts + the picker
      // component for the geometry contract.
      const result = await runFlatEnhancement({
        file,
        // G5 (2026-08-10): unify long-edge cap to 2560 across every
        // upload path. Single + exhibition-linked used to inherit the
        // engine's 4096 default; bulk was already at 2560. Never
        // upscales (see `scale = longestCropEdge > maxLongEdge`).
        maxLongEdge: 2560,
        crop: seedCrop,
        sourceCorners: sourceCornersToSend,
        targetAspect: targetAspectOverride,
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
              // G1 wall-anchored WB. When the user clicked on the
              // wall we send that point; otherwise the engine auto-
              // detects the wall region. Falls back to gray-world if
              // neither yields a stable region.
              wallSample: wallPick ?? "auto",
            }
          : undefined,
        // F2 (2026-08-10) — user-facing wall-brightness chip.
        // Engine maps the enum to the numeric matte target used
        // by both AWB and the pro-look exposure cap.
        wallBrightness,
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
      // 2026-08-19 — Persist the pre-flight quality gate verdict into
      // enhancement_meta so QA / dashboards can slice on false-block
      // regressions later (severity + override + issues). Absent when
      // the gate degraded or was disabled by the user.
      const qualityGateProvenance =
        qualityGate && !qualityGate.degraded
          ? {
              severity: qualityGate.severity,
              issues: qualityGate.issues as string[],
              scores: qualityGate.scores,
              ...(qualityGateOverride ? { override: true } : {}),
            }
          : undefined;
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
        ...(qualityGateProvenance ? { qualityGate: qualityGateProvenance } : {}),
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
    wallBrightness,
    wallPick,
    ellipseRestored,
    perspectiveSkipped,
    keepOriginalAspect,
    gateBlocked,
    qualityGate,
    qualityGateOverride,
  ]);

  // F4 (2026-08-10) — auto-run a first preview as soon as the user
  // lands on Step 2 (tone). Guarded by a ref so bouncing back and
  // forth between steps doesn't re-fire the pipeline. Step 1 renders
  // the raw source under the picker, so we deliberately do NOT run
  // the enhancement there.
  useEffect(() => {
    if (!onEnhance) return;
    if (tab !== "enhance") return;
    if (wizardStep !== "tone") return;
    if (!analysis) return;
    if (enhancePreview) return;
    if (enhancement) return;
    if (enhanceRunning) return;
    if (didAutoPreviewRef.current) return;
    if (resolvedAutoMode === "object") return;
    // 2026-08-19 — Don't auto-run the enhance pipeline on a photo the
    // pre-flight gate has flagged as `block` (unless the artist
    // explicitly clicked "그래도 계속" to override). Warn severity
    // still auto-runs — it's a soft advisory.
    if (gateBlocked) return;
    didAutoPreviewRef.current = true;
    void runEnhancePreview();
  }, [
    analysis,
    tab,
    wizardStep,
    onEnhance,
    enhancePreview,
    enhancement,
    enhanceRunning,
    resolvedAutoMode,
    runEnhancePreview,
    gateBlocked,
  ]);

  // F4 — debounced re-run when the user changes intensity or wall
  // brightness inside Step 2. Only active while the user is on the
  // tone step so slider drag on other steps doesn't re-fire.
  const debouncedTone = useDebounced(
    { intensity, wallBrightness },
    250,
  );
  const lastToneKeyRef = useRef<string>(
    JSON.stringify({ intensity, wallBrightness }),
  );
  useEffect(() => {
    if (!onEnhance) return;
    if (tab !== "enhance") return;
    if (wizardStep !== "tone") return;
    if (!analysis) return;
    if (!didAutoPreviewRef.current) return; // wait for the initial run
    if (enhanceRunning) return;
    if (resolvedAutoMode === "object") return;
    const key = JSON.stringify(debouncedTone);
    if (key === lastToneKeyRef.current) return;
    lastToneKeyRef.current = key;
    void runEnhancePreview();
  }, [
    debouncedTone,
    tab,
    wizardStep,
    onEnhance,
    analysis,
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
    setPerspectiveAdvancedOpen(false);
    setToneAdvancedOpen(false);
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

      {/*
        2026-08-19 — Pre-flight quality gate surface. "detecting"
        status uses aria-live so screen readers hear the check without
        stealing focus; the banner itself renders only for warn/block
        verdicts (fail-open contract — degraded verdicts and ok
        verdicts are silent).
       */}
      {qualityGateRunning && !qualityGate && (
        <p
          className="text-xs text-zinc-500"
          role="status"
          aria-live="polite"
        >
          {t("enhancement.quality.detecting")}
        </p>
      )}
      {qualityGate &&
        !qualityGate.degraded &&
        (qualityGate.severity === "block" ||
          (qualityGate.severity === "warn" && !qualityGateDismissed)) && (
          <QualityGateBanner
            severity={qualityGate.severity}
            issues={qualityGate.issues}
            result={qualityGate}
            locale={locale}
            onReshoot={() => {
              if (onReshootRequest) onReshootRequest();
              else setQualityGateDismissed(true);
            }}
            onProceed={() => setQualityGateDismissed(true)}
            onUseAnyway={() => setQualityGateOverride(true)}
          />
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
              {/* F4 (2026-08-10) — wizard-by-default. The Basic view
                  is a 3-step flow (원근·크롭 → 톤·벽 색 → 확인·저장)
                  with a persistent progress indicator. Legacy top-
                  level widgets (run CTA / strength / perspective
                  toggle) are absorbed into the wizard; each step's
                  own Advanced fold hosts the fine-grained controls
                  that used to sit in the shared Advanced surface. */}
              {/* Progress indicator */}
              <nav
                aria-label={t("imageEnhance.wizard.stepIndicatorLabel")}
                className="flex items-center gap-1.5 text-[11px]"
              >
                {(
                  [
                    { key: "perspective" as const, num: 1, label: t("imageEnhance.wizard.step1Title") },
                    { key: "tone" as const, num: 2, label: t("imageEnhance.wizard.step2Title") },
                    { key: "confirm" as const, num: 3, label: t("imageEnhance.wizard.step3Title") },
                  ]
                ).map((step, idx) => {
                  const currentIdx =
                    wizardStep === "perspective" ? 0 : wizardStep === "tone" ? 1 : 2;
                  const isCurrent = wizardStep === step.key;
                  const isPast = currentIdx > idx;
                  const isFuture = currentIdx < idx;
                  const clickable = !isFuture;
                  return (
                    <button
                      key={step.key}
                      type="button"
                      onClick={() => {
                        if (!clickable) return;
                        setWizardStep(step.key);
                      }}
                      disabled={!clickable}
                      aria-current={isCurrent ? "step" : undefined}
                      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 transition ${
                        isCurrent
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : isPast
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                            : "cursor-not-allowed border-zinc-200 bg-white text-zinc-400"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                          isCurrent
                            ? "bg-white/20 text-white"
                            : isPast
                              ? "bg-emerald-600 text-white"
                              : "bg-zinc-200 text-zinc-500"
                        }`}
                      >
                        {isPast ? "✓" : step.num}
                      </span>
                      <span>{step.label}</span>
                    </button>
                  );
                })}
              </nav>

              {/* ─────────────────── STEP 1 — Perspective & Crop */}
              {wizardStep === "perspective" && (
                <div className="space-y-3">
                  {/* Chip strip — auto-seed provenance */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className={`rounded-full border px-2.5 py-1 ${
                        perspectiveAutoSource === "edge"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : perspectiveAutoSource === "bbox"
                            ? "border-amber-300 bg-amber-50 text-amber-800"
                            : "border-zinc-300 bg-zinc-50 text-zinc-700"
                      }`}
                    >
                      {perspectiveAutoSource === "edge"
                        ? t("imageEnhance.wizard.perspectiveAutoDetected")
                        : perspectiveAutoSource === "bbox"
                          ? t("imageEnhance.wizard.cropAutoDetected")
                          : t("imageEnhance.wizard.perspectiveManual")}
                    </span>
                  </div>

                  {/* Picker — always inline on this step */}
                  {previewUrl && analysis && !perspectiveSkipped && (
                    <PerspectiveCornerPicker
                      imageUrl={previewUrl}
                      imageWidth={analysis.width || 1024}
                      imageHeight={analysis.height || 1024}
                      initialCorners={wizardPerspectiveDraft ?? perspectiveInitialCornersMemo}
                      autoDetectedCorners={autoDetectedCornersMemo ?? wizardPerspectiveSeed}
                      resetToken={perspectiveResetToken}
                      onChange={(q) => {
                        setWizardPerspectiveDraft(q);
                        if (quadsDiffer(q, wizardPerspectiveSeed)) {
                          setPerspectiveUserAdjusted(true);
                        }
                      }}
                      onConfirm={() => {
                        /* wizard uses its own Next button */
                      }}
                      onCancel={() => {
                        /* wizard uses its own back nav */
                      }}
                      hideActions
                    />
                  )}
                  {perspectiveSkipped && previewUrl && (
                    <div
                      className="relative w-full overflow-hidden rounded-lg bg-zinc-100"
                      style={{
                        aspectRatio:
                          imageAspect && Number.isFinite(imageAspect)
                            ? `${imageAspect}`
                            : "4 / 3",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt=""
                        className="h-full w-full object-contain"
                        draggable={false}
                      />
                    </div>
                  )}

                  {/* Hint */}
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    {t("imageEnhance.wizard.perspectiveHint")}
                  </p>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      {perspectiveUserAdjusted && !perspectiveSkipped && (
                        <button
                          type="button"
                          onClick={() => {
                            setWizardPerspectiveDraft(null);
                            setPerspectiveUserAdjusted(false);
                            setPerspectiveResetToken((n) => n + 1);
                          }}
                          className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
                        >
                          {t("imageEnhance.wizard.resetToAuto")}
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (perspectiveSkipped) {
                          setPerspectiveCorners(null);
                        } else {
                          const snapshot = wizardPerspectiveDraft ?? wizardPerspectiveSeed;
                          if (perspectiveUserAdjusted && snapshot) {
                            setPerspectiveCorners(snapshot);
                          } else {
                            setPerspectiveCorners(null);
                          }
                        }
                        setWizardStep("tone");
                        setSaveStatus(null);
                        // Reset the auto-preview sentinel so the
                        // enhance actually re-runs when this is a
                        // second pass through step 1 → step 2.
                        didAutoPreviewRef.current = false;
                        if (enhancePreview) {
                          if (enhancePreviewUrlRef.current) {
                            try {
                              URL.revokeObjectURL(enhancePreviewUrlRef.current);
                            } catch {}
                            enhancePreviewUrlRef.current = null;
                          }
                          setEnhancePreview(null);
                        }
                      }}
                      className="rounded-full bg-zinc-900 px-4 py-1.5 text-white hover:bg-zinc-800"
                    >
                      {t("imageEnhance.wizard.nextToTone")}
                    </button>
                  </div>

                  {/* Advanced fold — step 1 */}
                  <details
                    open={perspectiveAdvancedOpen}
                    onToggle={(e) =>
                      setPerspectiveAdvancedOpen((e.target as HTMLDetailsElement).open)
                    }
                    className="rounded-lg border border-zinc-200 bg-white"
                  >
                    <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50">
                      {t("imageEnhance.wizard.advancedPerspectiveTitle")}
                    </summary>
                    <div className="space-y-3 border-t border-zinc-200 px-3 py-3">
                      <label className="flex cursor-pointer items-start gap-2 text-[11px] text-zinc-700">
                        <input
                          type="checkbox"
                          checked={perspectiveSkipped}
                          onChange={(e) => setPerspectiveSkipped(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 accent-zinc-900"
                        />
                        <span>{t("imageEnhance.wizard.skipPerspective")}</span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2 text-[11px] text-zinc-700">
                        <input
                          type="checkbox"
                          checked={keepOriginalAspect}
                          onChange={(e) => setKeepOriginalAspect(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 accent-zinc-900"
                        />
                        <span>{t("imageEnhance.wizard.keepAspect")}</span>
                      </label>
                    </div>
                  </details>
                </div>
              )}

              {/* ─────────────────── STEP 2 — Tone & Wall */}
              {wizardStep === "tone" && (
                <div className="space-y-3">
                  {/* Preview surface */}
                  {enhancePreview ? (
                    <BeforeAfterCompare
                      beforeSrc={previewUrl ?? ""}
                      afterSrc={enhancePreview.previewUrl}
                      beforeAlt={t("upload.imageEnhance.beforeAlt")}
                      afterAlt={t("upload.imageEnhance.afterAlt")}
                      aspectRatio={imageAspect}
                    />
                  ) : (
                    previewUrl && (
                      <div
                        className={`relative w-full overflow-hidden rounded-lg bg-zinc-100 ${
                          pickingWall ? "cursor-crosshair" : ""
                        }`}
                        style={{
                          aspectRatio:
                            imageAspect && Number.isFinite(imageAspect)
                              ? `${imageAspect}`
                              : "4 / 3",
                        }}
                        onClick={(e) => {
                          if (!pickingWall) return;
                          const el = e.currentTarget as HTMLDivElement;
                          const rect = el.getBoundingClientRect();
                          const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                          const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
                          setWallPick({ x: nx, y: ny });
                          setPickingWall(false);
                          setSaveStatus(null);
                          void runEnhancePreview();
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewUrl}
                          alt=""
                          className="h-full w-full object-contain"
                          draggable={false}
                        />
                        {wallPick && !pickingWall && (
                          <div
                            aria-hidden
                            className="pointer-events-none absolute rounded-full border-2 border-emerald-500 bg-emerald-500/20"
                            style={{
                              left: `calc(${wallPick.x * 100}% - 8px)`,
                              top: `calc(${wallPick.y * 100}% - 8px)`,
                              width: 16,
                              height: 16,
                            }}
                          />
                        )}
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

                  {/* Auto-detect status chips */}
                  {analysis && (autoWarpFired || wallAutoFired || ellipseRestored) && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      {wallAutoFired ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800">
                          {t("imageEnhance.wizard.summaryWbWall")} ✓
                        </span>
                      ) : (
                        enhancePreview && (
                          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-zinc-700">
                            {t("imageEnhance.wizard.summaryWbFallback")}
                          </span>
                        )
                      )}
                      {autoWarpFired && (
                        <button
                          type="button"
                          onClick={() => setWizardStep("perspective")}
                          className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-emerald-800 hover:bg-emerald-100"
                        >
                          {t("upload.imageEnhance.chip.autoPerspective")}
                        </button>
                      )}
                      {ellipseRestored && (
                        <button
                          type="button"
                          onClick={() => {
                            setEllipseRestored(false);
                            void runEnhancePreview();
                          }}
                          className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-emerald-800 hover:bg-emerald-100"
                        >
                          {t("upload.imageEnhance.chip.autoEllipse")}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Strength selector */}
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

                  {/* Wall brightness selector */}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-zinc-600">
                        {t("imageEnhance.wallBrightness.label")}
                      </span>
                      {(["soft", "normal", "bright"] as WallBrightness[]).map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => setWallBrightness(w)}
                          className={`rounded-full border px-2.5 py-1 ${
                            wallBrightness === w
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                          }`}
                        >
                          {t(`imageEnhance.wallBrightness.${w}`)}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10.5px] leading-relaxed text-zinc-500">
                      {t("imageEnhance.wallBrightness.hint")}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setWizardStep("perspective")}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
                    >
                      {t("imageEnhance.wizard.backToPerspective")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setWizardStep("confirm")}
                      disabled={!enhancePreview}
                      className="rounded-full bg-zinc-900 px-4 py-1.5 text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("imageEnhance.wizard.nextToConfirm")}
                    </button>
                  </div>

                  {/* Status */}
                  {enhanceRunning && (
                    <p className="text-[11px] text-zinc-500" aria-live="polite">
                      {t("upload.imageEnhance.running")}
                    </p>
                  )}
                  {!analysis && !analyzeError && (
                    <p className="text-[11px] text-zinc-500" aria-live="polite">
                      {t("upload.imageEnhance.preparing")}
                    </p>
                  )}
                  {enhanceError && (
                    <p className="text-[11px] text-amber-700" role="alert">
                      {enhanceError}
                    </p>
                  )}

                  {/* Advanced fold — step 2 */}
                  <details
                    open={toneAdvancedOpen}
                    onToggle={(e) =>
                      setToneAdvancedOpen((e.target as HTMLDetailsElement).open)
                    }
                    className="rounded-lg border border-zinc-200 bg-white"
                  >
                    <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50">
                      {t("imageEnhance.wizard.advancedToneTitle")}
                    </summary>
                    <div className="space-y-3 border-t border-zinc-200 px-3 py-3">
                      {analysis && (analysis.blurScore < 0.1 || analysis.glareScore > 0.1) && (
                        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                          {t("upload.imageEnhance.reshootAdvisory")}
                        </p>
                      )}
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
                      {/* WB pick */}
                      {captureMode !== "scanner" && (
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="text-zinc-600">
                              {t("upload.imageEnhance.wb.autoLabel")}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setWallPick(null);
                                setPickingWall(false);
                                setSaveStatus(null);
                                void runEnhancePreview();
                              }}
                              className="rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-zinc-700 hover:bg-zinc-50"
                              title={t("upload.imageEnhance.wb.pickHint")}
                            >
                              {t("upload.imageEnhance.wb.rePickLabel")}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPickingWall((v) => {
                                  const next = !v;
                                  if (next && enhancePreview) {
                                    if (enhancePreviewUrlRef.current) {
                                      try {
                                        URL.revokeObjectURL(enhancePreviewUrlRef.current);
                                      } catch {}
                                      enhancePreviewUrlRef.current = null;
                                    }
                                    setEnhancePreview(null);
                                  }
                                  return next;
                                });
                              }}
                              aria-pressed={pickingWall}
                              className={`rounded-full border px-2.5 py-1 ${
                                pickingWall || wallPick
                                  ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                              }`}
                              title={t("upload.imageEnhance.wb.pickHint")}
                            >
                              {t("upload.imageEnhance.wb.pickLabel")}
                            </button>
                            {wallPick && (
                              <button
                                type="button"
                                onClick={() => {
                                  setWallPick(null);
                                  setPickingWall(false);
                                  void runEnhancePreview();
                                }}
                                className="rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-zinc-700 hover:bg-zinc-50"
                              >
                                {t("upload.imageEnhance.wb.resetLabel")}
                              </button>
                            )}
                          </div>
                          {pickingWall && (
                            <p className="text-[10.5px] text-emerald-700">
                              {t("upload.imageEnhance.wb.pickHint")}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Input type */}
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

                      {/* Glare overlay */}
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

                      {/* Portfolio coherence */}
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

                      {/* Diagnostics */}
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
                </div>
              )}

              {/* ─────────────────── STEP 3 — Review & Save */}
              {wizardStep === "confirm" && enhancePreview && previewUrl && (
                <div className="space-y-3">
                  <BeforeAfterCompare
                    beforeSrc={previewUrl}
                    afterSrc={enhancePreview.previewUrl}
                    beforeAlt={t("upload.imageEnhance.beforeAlt")}
                    afterAlt={t("upload.imageEnhance.afterAlt")}
                    aspectRatio={imageAspect}
                    initialPercent={50}
                  />
                  {/* Summary card */}
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700">
                    <p className="mb-1 font-medium text-zinc-900">
                      {t("imageEnhance.wizard.summaryTitle")}
                    </p>
                    <ul className="space-y-0.5">
                      <li>
                        {t("imageEnhance.wizard.summaryPerspective")}:{" "}
                        {perspectiveSkipped
                          ? "—"
                          : perspectiveCorners
                            ? "✓"
                            : autoWarpFired
                              ? "✓ (auto)"
                              : "—"}
                      </li>
                      <li>
                        {t("imageEnhance.wizard.summaryWallBrightness")}:{" "}
                        {t(`imageEnhance.wallBrightness.${wallBrightness}`)} ✓
                      </li>
                      <li>
                        {t("imageEnhance.wizard.summaryIntensity")}:{" "}
                        {t(`upload.imageEnhance.intensity.${intensity}`)} ✓
                      </li>
                      <li>
                        {wallAutoFired
                          ? `${t("imageEnhance.wizard.summaryWbWall")} ✓`
                          : t("imageEnhance.wizard.summaryWbFallback")}
                      </li>
                    </ul>
                  </div>
                  {/* Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setWizardStep("tone")}
                        className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
                      >
                        {t("imageEnhance.wizard.backToTone")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          // Wipe the transient preview and drop the
                          // user back to step 1 (auto-preview
                          // re-fires on step 2 entry).
                          if (enhancePreviewUrlRef.current) {
                            try {
                              URL.revokeObjectURL(enhancePreviewUrlRef.current);
                            } catch {}
                            enhancePreviewUrlRef.current = null;
                          }
                          setEnhancePreview(null);
                          setPerspectiveCorners(null);
                          setWizardPerspectiveDraft(null);
                          setPerspectiveUserAdjusted(false);
                          setPerspectiveResetToken((n) => n + 1);
                          setIntensity("normal");
                          setWallBrightness("normal");
                          didAutoPreviewRef.current = false;
                          setWizardStep("perspective");
                        }}
                        className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
                      >
                        {t("imageEnhance.wizard.restart")}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleEnhanceApprove}
                      className="rounded-full bg-zinc-900 px-4 py-1.5 text-white hover:bg-zinc-800"
                    >
                      {t("imageEnhance.wizard.saveCta")}
                    </button>
                  </div>
                </div>
              )}

              {wizardStep === "confirm" && !enhancePreview && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  {t("upload.imageEnhance.preparing")}
                </div>
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
