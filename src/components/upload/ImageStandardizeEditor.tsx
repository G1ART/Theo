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
import {
  type EnhancementMeta,
  type EnhancementMode,
  type FlatRecipe,
  type NormalizedPoint,
  ENHANCEMENT_META_SCHEMA_VERSION,
  round3,
} from "@/lib/image/enhancement/types";
import {
  runFlatEnhancement,
  flatBlobToFile,
  STANDARD_STUDIO_BEZEL,
} from "@/lib/image/enhancement/localFlatEngine";
import { resolveAdaptiveProLook } from "@/lib/image/enhancement/proLook.tunables";
import { computeFileSha256 } from "@/lib/image/prepareArtworkImageForUpload";
import { PerspectiveCornerPicker } from "@/components/upload/PerspectiveCornerPicker";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import {
  formatCaptureDevice,
  readExif,
  type ExifReadResult,
} from "@/lib/image/exifRead";
import {
  defaultInsetQuad,
  hasValidArea,
  resolveAutoCorners,
  type Quad,
} from "@/lib/image/enhancement/cornerPickerGeometry";
import {
  resolveTargetAspect,
  formatAspectLabel,
  type AspectMode,
} from "@/lib/image/enhancement/aspectResolve";
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
import { applyToneDeltaToFile, applyUserFineTuneToFile } from "@/lib/image/enhancement/applyToneDelta";
import {
  detectArtworkQuad,
  type ArtworkVisionSeed,
} from "@/lib/image/enhancement/detectArtworkQuad";
import { requestSilhouetteCutout } from "@/lib/image/enhancement/silhouetteClient";
import { aiApi } from "@/lib/ai/browser";
import type { ArtworkQualityGateResult } from "@/lib/ai/types";
import {
  getOrFetchVisionResult,
  prepareImageForVision,
} from "@/lib/image/enhancement/aiClient";
import { useQualityGatePref } from "@/lib/image/enhancement/qualityGatePref";
import { QualityGateBanner } from "@/components/upload/QualityGateBanner";
import {
  fileIdentityKey,
  getQualityGateAck,
  rememberQualityGateAck,
  shouldShowQualityGateBanner,
} from "@/lib/image/enhancement/qualityGateBannerVisibility";
import { setEnhanceWizardActive } from "@/lib/tours/enhanceWizardTour";

/**
 * Color-handling mode (2026-10-02 redesign). The old capture-oriented
 * trio (자동/스튜디오/스캐너) implied *how the photo was shot*, but it
 * actually only controlled how aggressively we re-color the artwork —
 * and the aggressive end (full wall-anchored AWB + Pro Look) neutralized
 * the artist's intended warm tone and over-saturated flat works, which
 * drew repeated "the result looks nothing like my painting" reports.
 *
 * It is now an honest two-way *fidelity* selector, decoupled from the
 * perspective/geometry pipeline (which runs identically in both modes):
 *   - `original` — trust the captured color. No AWB, no Pro Look; only a
 *     gentle brightness/saturation lift. This is the default and is what
 *     the old "스캐너" did for color (the mode users found truest).
 *   - `enhance` — partial white balance (0.5 strength, so warmth
 *     survives) + a gentle Pro Look pass. For shots that genuinely need
 *     a cast fixed (e.g. yellow indoor light).
 */
type CaptureMode = "original" | "enhance";

/** User-facing alias for {@link CaptureMode}. */
type InputType = "original" | "enhance";

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
 * Enhancement preview state. The local flat pass is pushed to the
 * parent through `onEnhance` as soon as a preview blob exists, so
 * Publish cannot silently ship the phone original. 「이 이미지 사용」
 * still locks the wizard; it is not the only commit.
 */
export type EnhancementDraft = {
  displayFile: File;
  previewUrl: string;
  meta: EnhancementMeta;
};

const STUDIO_MATTE = "#f3f3f3";
const PREVIEW_CROSSFADE_MS = 200;

function revokeBlobUrl(url: string | null | undefined, protect?: string | null) {
  if (!url || url === protect) return;
  try {
    URL.revokeObjectURL(url);
  } catch {}
}

function sourceCornersFromDraft(
  draft: EnhancementDraft | null | undefined,
): Quad | null {
  if (!draft) return null;
  const recipe = draft.meta.recipe;
  if (recipe.kind !== "flat") return null;
  return recipe.params.sourceCorners ?? null;
}

/** Catalog preview of the converted file — never the original room shot. */
function StudioResultPreview({
  src,
  aspect,
  alt,
  onRetiredSrc,
}: {
  src: string;
  aspect: number | null;
  alt: string;
  /** Fired when a previous blob URL is no longer painted (after load + fade). */
  onRetiredSrc?: (url: string) => void;
}) {
  const [baseSrc, setBaseSrc] = useState(src);
  const [incomingSrc, setIncomingSrc] = useState<string | null>(null);
  const [incomingVisible, setIncomingVisible] = useState(false);
  const baseSrcRef = useRef(baseSrc);
  const incomingSrcRef = useRef(incomingSrc);
  const onRetiredRef = useRef(onRetiredSrc);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  baseSrcRef.current = baseSrc;
  incomingSrcRef.current = incomingSrc;
  onRetiredRef.current = onRetiredSrc;

  const clearFadeTimer = () => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (src === baseSrcRef.current) {
      const pending = incomingSrcRef.current;
      if (pending && pending !== src) {
        onRetiredRef.current?.(pending);
      }
      clearFadeTimer();
      setIncomingSrc(null);
      setIncomingVisible(false);
      return;
    }
    if (src === incomingSrcRef.current) return;
    const superseded = incomingSrcRef.current;
    if (superseded && superseded !== src && superseded !== baseSrcRef.current) {
      onRetiredRef.current?.(superseded);
    }
    clearFadeTimer();
    setIncomingSrc(src);
    setIncomingVisible(false);
  }, [src]);

  useEffect(() => () => clearFadeTimer(), []);

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg"
      style={{
        backgroundColor: STUDIO_MATTE,
        aspectRatio:
          aspect && Number.isFinite(aspect) && aspect > 0 ? `${aspect}` : "4 / 3",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={baseSrc}
        alt={alt}
        className="absolute inset-0 h-full w-full object-contain"
        draggable={false}
      />
      {incomingSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={incomingSrc}
          alt=""
          className="absolute inset-0 h-full w-full object-contain transition-opacity ease-out"
          style={{
            opacity: incomingVisible ? 1 : 0,
            transitionDuration: `${PREVIEW_CROSSFADE_MS}ms`,
          }}
          draggable={false}
          onLoad={(e) => {
            const loaded =
              (e.currentTarget as HTMLImageElement).getAttribute("src") ??
              incomingSrc;
            if (!loaded || loaded !== incomingSrcRef.current) return;
            setIncomingVisible(true);
            clearFadeTimer();
            fadeTimerRef.current = setTimeout(() => {
              const outgoing = baseSrcRef.current;
              setBaseSrc(loaded);
              setIncomingSrc(null);
              setIncomingVisible(false);
              if (outgoing && outgoing !== loaded) {
                onRetiredRef.current?.(outgoing);
              }
            }, PREVIEW_CROSSFADE_MS);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * 2026-08-19 — Snapshot of the pre-flight quality gate the editor
 * pushes upstream through `onQualityGate` so a parent Save/Publish
 * CTA can gate itself on a `block` severity that the artist has not
 * overridden.
 *
 * `dismissed` is true after the artist acknowledges a warn ("계속
 * 진행") or a block ("그래도 계속"). Parents should treat dismissed
 * gates like `severity: "ok"` for the banner; block still records
 * `override: true` when they used the escape hatch.
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
  /**
   * Look carried from the previous work in this browser tab: capture
   * setup plus brightness, contrast, and saturation. Corners stay per image.
   */
  sharedPreset?: import("@/lib/image/enhancement/sharedPreset").EnhanceSessionPreset | null;
  onSharedPreset?: (
    preset: import("@/lib/image/enhancement/sharedPreset").EnhanceSessionPreset,
  ) => void;
  /**
   * Artwork cm dimensions (`artworks.width_cm` / `artworks.height_cm`).
   * Threaded in so the "작품 치수로" aspect chip in Step 1's Advanced
   * fold can offer a ratio locked to the real artwork size. Null when
   * the artwork row is missing either value — the chip simply hides.
   */
  artworkWidthCm?: number | null;
  artworkHeightCm?: number | null;
};

/** Debounce a value change so slider drag doesn't spam parent state.
 *  Object values are compared by JSON content — a fresh `{ b, c }`
 *  every render must not reset the timer or we never settle. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the content identity
  }, [key, delayMs]);
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

function isIdentityFineTune(tone: { b: number; c: number; s: number }): boolean {
  return (
    Math.abs(tone.b - 1) < 0.005 &&
    Math.abs(tone.c - 1) < 0.005 &&
    Math.abs(tone.s - 1) < 0.005
  );
}

function withUserFineTune(
  draft: EnhancementDraft,
  tone: { b: number; c: number; s: number },
): EnhancementDraft {
  const recipe = draft.meta.recipe;
  if (recipe.kind !== "flat") return draft;
  const b = Math.min(TONE_MAX, Math.max(TONE_MIN, Number.isFinite(tone.b) ? tone.b : 1));
  const c = Math.min(TONE_MAX, Math.max(TONE_MIN, Number.isFinite(tone.c) ? tone.c : 1));
  const s = Math.min(TONE_MAX, Math.max(TONE_MIN, Number.isFinite(tone.s) ? tone.s : 1));
  const next: FlatRecipe = { ...recipe.params };
  if (isIdentityFineTune({ b, c, s })) {
    if (!next.userFineTune) return draft;
    const rest = { ...next };
    delete rest.userFineTune;
    return {
      ...draft,
      meta: { ...draft.meta, recipe: { kind: "flat", params: rest } },
    };
  }
  return {
    ...draft,
    meta: {
      ...draft.meta,
      recipe: {
        kind: "flat",
        params: {
          ...next,
          userFineTune: { b: round3(b), c: round3(c), s: round3(s) },
        },
      },
    },
  };
}

function FineToneSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-zinc-600">
      <span className="w-14 shrink-0 tracking-tight">{label}</span>
      <input
        type="range"
        min={-100}
        max={100}
        step={1}
        value={toSliderValue(value)}
        onChange={(e) => onChange(fromSliderValue(Number(e.target.value)))}
        aria-label={label}
        className="h-1 flex-1 cursor-pointer accent-zinc-800"
      />
      <span className="w-10 shrink-0 text-right tabular-nums text-zinc-500">
        {Math.round((value - 1) * 100)}
      </span>
    </label>
  );
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
  sharedPreset = null,
  onSharedPreset,
  artworkWidthCm = null,
  artworkHeightCm = null,
}: Props) {
  const { t, locale } = useT();
  const enhancementEnabled = typeof onEnhance === "function";
  const [tab, setTab] = useState<"quick" | "enhance">(
    enhancementEnabled ? "enhance" : "quick",
  );
  const previewUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewNaturalSize, setPreviewNaturalSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
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

  useEffect(() => {
    if (!previewUrl) {
      setPreviewNaturalSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setPreviewNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.src = previewUrl;
  }, [previewUrl]);

  const [enhancePreviewNaturalSize, setEnhancePreviewNaturalSize] = useState<{
    w: number;
    h: number;
  } | null>(null);

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
  const [qualityGateOverride, setQualityGateOverride] = useState(
    () => getQualityGateAck(file).override,
  );
  const [qualityGateDismissed, setQualityGateDismissed] = useState(
    () => getQualityGateAck(file).dismissed,
  );
  const fileKey = fileIdentityKey(file);

  useEffect(() => {
    // Identity (name+size+lastModified), not File object reference —
    // parent re-renders that wrap a new File for the same photo must
    // not resurrect the banner.
    const ack = getQualityGateAck(file);
    setQualityGate(null);
    setQualityGateOverride(ack.override);
    setQualityGateDismissed(ack.dismissed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fileKey is the identity
  }, [fileKey]);

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
  // treated as `ok` for auto-preview gating. Block+override still
  // surfaces the enhance flow; the banner itself is hidden via
  // `shouldShowQualityGateBanner` once dismissed / overridden.
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
  /**
   * 2026-08-22 — upload path. `null` asks original vs AI first so a
   * already-final studio file is not forced through geometry/tone.
   * `original` = standard margin only. `ai` = confirm canvas corners,
   * un-keystone, gallery margin, then lighting.
   */
  const [pathChoice, setPathChoice] = useState<"original" | "ai" | null>(
    enhancement ? "ai" : null,
  );
  useEffect(() => {
    const active = pathChoice !== null;
    setEnhanceWizardActive(active);
    return () => setEnhanceWizardActive(false);
  }, [pathChoice]);
  const [detectingArtwork, setDetectingArtwork] = useState(false);
  const [visionQuad, setVisionQuad] = useState<Quad | null>(null);
  const [visionConfidence, setVisionConfidence] = useState(0);
  const [visionLook, setVisionLook] = useState<ArtworkVisionSeed["look"]>(null);
  // A carried bulk preset, or a tap on the color chips, locks the
  // vision "look" out so a late model response cannot overwrite a
  // choice the user already made.
  const colorSeedLockedRef = useRef(Boolean(sharedPreset));
  const [visionStatus, setVisionStatus] = useState<
    "idle" | "loading" | "ok" | "miss"
  >("idle");
  const [enhanceMode] = useState<EnhancementMode>("auto");
  const [enhancePreview, setEnhancePreview] = useState<EnhancementDraft | null>(
    enhancement ?? null,
  );
  const enhancePreviewRef = useRef<EnhancementDraft | null>(enhancePreview);
  enhancePreviewRef.current = enhancePreview;
  const [enhanceRunning, setEnhanceRunning] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const enhancePreviewUrlRef = useRef<string | null>(null);
  const parentPreviewUrlRef = useRef<string | null>(null);
  parentPreviewUrlRef.current = enhancement?.previewUrl ?? null;
  const sharedPresetRef = useRef(sharedPreset);
  sharedPresetRef.current = sharedPreset;
  const onEnhanceRef = useRef(onEnhance);
  onEnhanceRef.current = onEnhance;
  const pushDraftToParent = useCallback((draft: EnhancementDraft) => {
    const fn = onEnhanceRef.current;
    if (!fn) return;
    // Parent owns the blob URL so hiding the editor cannot drop it.
    enhancePreviewUrlRef.current = null;
    fn(draft);
  }, []);
  useEffect(() => {
    return () => {
      const draft = enhancePreviewRef.current;
      if (draft) onEnhanceRef.current?.(draft);
    };
  }, []);
  // Engine output after intensity + capture setup + portfolio coherence.
  // Fine-tune sliders bake onto a copy of this; the base blob is never
  // revoked until a new full pipeline result (or file change).
  const baseEnhanceRef = useRef<EnhancementDraft | null>(null);
  const fineTuneGenRef = useRef(0);
  const [fineB, setFineB] = useState(sharedPreset?.b ?? 1);
  const [fineC, setFineC] = useState(sharedPreset?.c ?? 1);
  const [fineS, setFineS] = useState(sharedPreset?.s ?? 1);
  const fineBRef = useRef(fineB);
  const fineCRef = useRef(fineC);
  const fineSRef = useRef(fineS);
  fineBRef.current = fineB;
  fineCRef.current = fineC;
  fineSRef.current = fineS;

  useEffect(() => {
    const url = enhancePreview?.previewUrl ?? null;
    if (!url) {
      setEnhancePreviewNaturalSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setEnhancePreviewNaturalSize({
          w: img.naturalWidth,
          h: img.naturalHeight,
        });
      }
    };
    img.src = url;
  }, [enhancePreview?.previewUrl]);

  const enhancePreviewAspect =
    enhancePreviewNaturalSize && enhancePreviewNaturalSize.h > 0
      ? enhancePreviewNaturalSize.w / enhancePreviewNaturalSize.h
      : null;
  // 2026-08-09: Basic-view intensity selector.
  const [intensity, setIntensity] = useState<Intensity>(sharedPreset?.intensity ?? "normal");
  // 2026-08-22: capture setup (how the photo was shot) on the tone step.
  // Not lighting — brightness is 보정 강도 + the post-engine sliders.
  const [inputType, setInputType] = useState<InputType>(sharedPreset?.inputType ?? "original");
  // F2 (2026-08-10) — wall brightness chip. `normal` is the wizard
  // default. 2026-10-01 bulk-claim-5: reset the matte target back to
  // 243 (the matte reference used elsewhere in the pipeline) after
  // users reported a visible seam between the 248 wall and the 243
  // matte painted around the artwork; users can dial to `soft` (245)
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
  const perspectiveUserAdjustedRef = useRef(false);
  perspectiveUserAdjustedRef.current = perspectiveUserAdjusted;
  // Advanced-fold: "이 단계 건너뛰기" — when true, step 1 forwards to
  // step 2 without applying any perspective correction (source
  // corners forced to null so the pipeline runs crop-only).
  const [perspectiveSkipped, setPerspectiveSkipped] = useState<boolean>(false);
  // Quad corners stay the default. Silhouette is opt-in and never
  // writes those corners, so the rectangular crop path is unchanged
  // until the artist explicitly chooses "이 모양 그대로".
  const [boundaryMode, setBoundaryMode] = useState<"quad" | "silhouette">("quad");
  const boundaryModeRef = useRef(boundaryMode);
  boundaryModeRef.current = boundaryMode;
  const silhouetteFileRef = useRef<File | null>(null);
  const [silhouetteUrl, setSilhouetteUrl] = useState<string | null>(null);
  const [silhouetteRunning, setSilhouetteRunning] = useState(false);
  const [silhouetteError, setSilhouetteError] = useState<string | null>(null);
  // Advanced-fold: 2026-10-02 output aspect selector. Replaces the
  // pre-2026-10 single `keepOriginalAspect` checkbox. `aspectMode =
  // "auto"` is the default and preserves the engine's historical
  // behavior (Zhang/Cao heuristic from corner edge lengths). Preset
  // tokens, `"square"`, `"artwork_cm"` (locked to the artwork row's
  // cm dimensions), `"photo_sensor"` (direct replacement for the old
  // checkbox), and `"custom"` all collapse to a concrete target
  // aspect via `resolveTargetAspect`. The value plus `customAspect`
  // ride on `sharedPreset` so a bulk session carries it between images.
  const [aspectMode, setAspectMode] = useState<AspectMode>(
    sharedPreset?.aspectMode ?? "auto",
  );
  const [customAspect, setCustomAspect] = useState<{ w: number; h: number } | null>(
    sharedPreset?.customAspect ?? null,
  );
  // Editing buffers for the two "직접 (custom)" numeric inputs. We
  // keep them as strings so the user can transiently type `""` / `"0."`
  // without us re-rendering a 0 under their caret. Committed to
  // `customAspect` by the "적용" button.
  const [customAspectWInput, setCustomAspectWInput] = useState<string>(() =>
    sharedPreset?.customAspect?.w ? String(sharedPreset.customAspect.w) : "",
  );
  const [customAspectHInput, setCustomAspectHInput] = useState<string>(() =>
    sharedPreset?.customAspect?.h ? String(sharedPreset.customAspect.h) : "",
  );
  // F4 (2026-08-10) — per-step advanced folds live in their own
  // state so the two steps don't share a collapse state. The
  // pre-F4 single `advancedOpen` was removed with the drastic
  // simplification since each wizard step now hosts its own
  // <details> section.
  const [perspectiveAdvancedOpen, setPerspectiveAdvancedOpen] =
    useState<boolean>(false);
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
  const enhanceGenRef = useRef(0);
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
  // Capture mode — derived from the capture-setup selector. The
  // `phone` legacy value is folded into `auto` since the analyzer
  // already picks the right pipeline from EXIF.
  const captureMode: CaptureMode = inputType;
  const isOriginalColor = captureMode === "original";
  // 2026-10-02 — color-handling split. "원본 색감" trusts the captured
  // color: no wall-anchored AWB and no Pro Look (which together caused
  // the over-correction reports). "선명 보정" runs Pro Look + partial AWB.
  // Perspective/geometry is NOT gated on this — both modes warp the same.
  const proLookEnabled = !isOriginalColor;
  // Partial white-balance strength for the "선명 보정" mode (threaded into
  // the engine's `awb.strength`). 0.5 keeps the artist's warm tone while
  // still easing a genuine cast. AWB is disabled entirely for "원본 색감".
  const ENHANCE_AWB_STRENGTH = 0.5;
  // "원본 색감" has Pro Look off, so its only tonal move is the classic
  // tone pass. Bake in the gentle brightness/saturation lift the artist
  // asked for ("스캐너 + 명채도 살짝 ↑") so the faithful default still has
  // a touch of life. Applied on top of the analyzer suggestion + bias.
  const ORIGINAL_COLOR_LIFT = { b: 0.03, c: 0.02, s: 0.05 } as const;

  // 2026-08-07 — Perspective correction. `perspectiveCorners` is
  // the *committed* 4-corner picker result (persisted into the
  // recipe on next preview run). Since F4 (2026-08-10) the picker
  // is always inline as Step 1 of the wizard, so the pre-F4
  // `perspectiveOpen` toggle no longer exists.
  const [perspectiveCorners, setPerspectiveCorners] = useState<
    [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] | null
  >(null);
  const perspectiveCornersRef = useRef<Quad | null>(null);
  perspectiveCornersRef.current = perspectiveCorners;
  const lastSuccessfulSourceCornersRef = useRef<Quad | null>(
    sourceCornersFromDraft(enhancement ?? null),
  );
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
      const protect = parentPreviewUrlRef.current;
      const shown = enhancePreviewUrlRef.current;
      const baseUrl = baseEnhanceRef.current?.previewUrl;
      revokeBlobUrl(shown, protect);
      if (baseUrl && baseUrl !== shown) revokeBlobUrl(baseUrl, protect);
    };
  }, []);

  useEffect(() => {
    // Reset preview when the underlying file swaps. A flickering
    // parent `enhancement` identity must not wipe a newer in-editor
    // crop. Never revoke a blob the parent now owns as
    // `enhancement.previewUrl`.
    const incoming = enhancement?.previewUrl ?? null;
    const shown = enhancePreviewUrlRef.current;
    const baseUrl = baseEnhanceRef.current?.previewUrl;
    if (shown !== incoming) {
      revokeBlobUrl(shown, incoming);
    }
    if (baseUrl && baseUrl !== incoming && baseUrl !== shown) {
      revokeBlobUrl(baseUrl, incoming);
    }
    enhancePreviewUrlRef.current = null;
    baseEnhanceRef.current = null;
    fineTuneGenRef.current += 1;
    const carried = sharedPresetRef.current;
    setFineB(carried?.b ?? 1);
    setFineC(carried?.c ?? 1);
    setFineS(carried?.s ?? 1);
    setEnhancePreview(enhancement ?? null);
    lastSuccessfulSourceCornersRef.current = sourceCornersFromDraft(
      enhancement ?? null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- file identity only
  }, [file]);

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

  // Seed the Step-1 PerspectiveCornerPicker with (in order):
  //   1. user's committed corners,
  //   2. vision 4-corner trapezoid (the model owns the first guess),
  //   3. local matte / edge detectors, only when vision missed,
  //   4. defaultInsetQuad as a visual starting point only.
  const matteQuad = (analysis?.matteForegroundCorners ?? null) as Quad | null;
  const matteReady = Boolean(matteQuad && hasValidArea(matteQuad));
  const wizardPerspectiveSeed = useMemo<Quad>(() => {
    if (perspectiveCorners) return perspectiveCorners;
    if (visionQuad) return visionQuad;
    if (matteQuad && hasValidArea(matteQuad)) return matteQuad;
    const edge = analysis?.suggestedRectangleCorners as Quad | null | undefined;
    const edgeConf = analysis?.suggestedRectangleConfidence ?? 0;
    if (edge && hasValidArea(edge) && edgeConf >= 0.55) return edge;
    return defaultInsetQuad(0.15);
  }, [perspectiveCorners, matteQuad, visionQuad, analysis]);
  // 2026-10-01 — surface low-confidence auto corners as a dashed
  // hint rather than a solid outline, so the user understands they
  // should confirm instead of trusting the shape. Hint fires when
  // the seed came from the matte fallback (confidence proxy low),
  // from a low-confidence rectangle detector (<0.55), or when the
  // picker is sitting on the default inset quad (no seed at all).
  // User-committed corners never get the hint.
  const perspectiveAutoHint = useMemo<boolean>(() => {
    if (perspectiveCorners) return false;
    const rectConf = analysis?.rectangleConfidence ?? 0;
    const edgeConf = analysis?.suggestedRectangleConfidence ?? 0;
    // A confident vision quad is a real preset, not a dashed guess.
    // Below 0.7 the prompt itself says the client should not trust it.
    if (visionQuad) return visionConfidence < 0.7;
    if (matteQuad && hasValidArea(matteQuad)) return true;
    return edgeConf < 0.55 || rectConf < 0.55;
  }, [perspectiveCorners, matteQuad, visionQuad, visionConfidence, analysis]);

  const pickerImageWidth =
    analysis?.width || previewNaturalSize?.w || 1024;
  const pickerImageHeight =
    analysis?.height || previewNaturalSize?.h || 1024;

  const canConfirmCrop =
    perspectiveSkipped ||
    Boolean(visionQuad) ||
    matteReady ||
    perspectiveUserAdjusted;

  // Honest "we isolated the canvas" only when the displayed draft
  // actually warped from sourceCorners. Silent AABB/full-frame warps
  // must not claim success.
  const autoWarpFired = Boolean(
    enhancePreview && sourceCornersFromDraft(enhancePreview),
  );
  const wallAutoFired = Boolean(
    enhancePreview &&
      !isOriginalColor &&
      enhancePreview.meta.recipe.kind === "flat" &&
      enhancePreview.meta.recipe.params.awb?.source === "wall-biased",
  );

  const applyFineTuneToBase = useCallback(
    async (
      base: EnhancementDraft,
      tone: { b: number; c: number; s: number },
      gen: number,
    ): Promise<EnhancementDraft | null> => {
      const protect = parentPreviewUrlRef.current;
      const stale = () =>
        gen !== fineTuneGenRef.current ||
        baseEnhanceRef.current?.previewUrl !== base.previewUrl;
      const attachedBase = withUserFineTune(
        {
          displayFile: base.displayFile,
          previewUrl: base.previewUrl,
          meta: base.meta,
        },
        tone,
      );
      if (isIdentityFineTune(tone)) {
        if (stale()) return null;
        // Do not revoke the outgoing blob here — StudioResultPreview
        // keeps it painted until the incoming src has loaded (and faded).
        enhancePreviewUrlRef.current = base.previewUrl;
        setEnhancePreview(attachedBase);
        pushDraftToParent(attachedBase);
        return attachedBase;
      }
      const bezel =
        base.meta.recipe.kind === "flat" || base.meta.recipe.kind === "object"
          ? base.meta.recipe.params.bezel
          : 0;
      const result = await applyUserFineTuneToFile(base.displayFile, tone, {
        bezel,
      });
      if (stale()) {
        if (result) revokeBlobUrl(result.previewUrl, protect);
        return null;
      }
      if (!result) {
        enhancePreviewUrlRef.current = base.previewUrl;
        setEnhancePreview(attachedBase);
        pushDraftToParent(attachedBase);
        return attachedBase;
      }
      enhancePreviewUrlRef.current = result.previewUrl;
      const draft = withUserFineTune(
        {
          displayFile: result.file,
          previewUrl: result.previewUrl,
          meta: base.meta,
        },
        tone,
      );
      setEnhancePreview(draft);
      pushDraftToParent(draft);
      return draft;
    },
    [pushDraftToParent],
  );
  const applyFineTuneToBaseRef = useRef(applyFineTuneToBase);
  applyFineTuneToBaseRef.current = applyFineTuneToBase;

  const runEnhancePreview = useCallback(async () => {
    if (!onEnhance) return;
    // 2026-08-19 — Blocked by the pre-flight quality gate (and not
    // overridden). The banner tells the artist why; silently no-op
    // here so any manual "Preview" click also respects the block.
    if (gateBlocked) return;
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
    // Ellipse restoration is a *geometry* decision (restore a circular
    // work shot at an angle back to a circle), so it is independent of
    // the color-handling mode — both "원본 색감" and "선명 보정" honor the
    // user's `ellipseRestored` toggle.
    const wantsEllipseRestore =
      ellipseRestored &&
      !!analysis?.ellipse &&
      Math.abs(analysis.ellipse.aspect - 1) > 0.03 &&
      analysis.ellipse.confidence >= 0.6;
    const ellipseCorners: Quad | null =
      wantsEllipseRestore && analysis?.ellipse
        ? (ellipseRestorationCorners(analysis.ellipse) as Quad)
        : null;
    // Intensity re-runs can close over a stale `perspectiveCorners ===
    // null`. Always read committed corners from the ref, never silent
    // autoCorners on the AI path.
    const sourceCornersToSend: Quad | null = perspectiveSkipped
      ? null
      : wantsEllipseRestore
        ? ellipseCorners
        : pathChoice === "ai"
          ? (perspectiveCornersRef.current ??
            lastSuccessfulSourceCornersRef.current ??
            sourceCornersFromDraft(enhancePreviewRef.current))
          : (perspectiveCornersRef.current ??
            (analysis
              ? (resolveAutoCorners({
                  suggestedRectangleCorners:
                    analysis.suggestedRectangleCorners as Quad | null,
                  suggestedRectangleConfidence:
                    analysis.suggestedRectangleConfidence,
                  suggestedCrop: analysis.suggestedCrop,
                  rectangleConfidence: analysis.rectangleConfidence,
                }) as Quad | null)
              : null));
    const useSilhouette =
      boundaryModeRef.current === "silhouette" && silhouetteFileRef.current != null;
    if (pathChoice === "ai" && !perspectiveSkipped && !useSilhouette && !sourceCornersToSend) {
      // Do not full-frame enhance over a confirmed (or pending) crop.
      return;
    }
    const gen = ++enhanceGenRef.current;
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
      const seedCrop =
        crop ?? analysis?.suggestedCrop ?? { x: 0, y: 0, w: 1, h: 1 };
      const suggestion = analysis?.suggested ?? null;
      // Color handling: "원본 색감" disables AWB + Pro Look entirely;
      // "선명 보정" runs both (AWB at partial strength — see the
      // `awb.strength` thread below).
      const wantsAwb = !isOriginalColor && !useSilhouette;
      const wantsProLook = proLookEnabled;
      // Intensity multiplier. "선명 보정" stays deliberately gentle (0.6x
      // base) so Pro Look adds clarity without the lurid over-boost the
      // old "자동" produced; "원본 색감" keeps 1x so the analyzer's honest
      // tone suggestion (the only tonal move when Pro Look is off) lands
      // at full fidelity. Applies to the analyzer tone deltas AND the
      // proLook config below.
      const iMult =
        (isOriginalColor ? 1 : 0.6) * intensityMultiplier(intensity);
      // 2026-10-02 output aspect selector. `aspectMode = "auto"` keeps
      // the engine's historical behavior (Zhang/Cao estimate from the
      // user's corner edges). `wantsEllipseRestore` always forces 1:1
      // because ellipse-to-circle restoration is undefined otherwise.
      // See `resolveTargetAspect` for the full matrix.
      const sourceAspect =
        analysis && analysis.height > 0
          ? analysis.width / analysis.height
          : undefined;
      const targetAspectOverride = wantsEllipseRestore
        ? 1
        : resolveTargetAspect(aspectMode, {
            customAspect,
            artworkCm: { w: artworkWidthCm, h: artworkHeightCm },
            sourceAspect,
          });
      // G3 (2026-08-10) — adaptive pro-look tuning. Instead of the
      // static intensity-multiplier scaling we used pre-G3, resolve
      // the tunables from analyzer signals (blurScore / glareScore)
      // and the user's paintingMode flag. See proLook.tunables.ts
      // for the mapping rationale.
      // Painting mode caps saturation (0.03 vs 0.06) so paper/canvas
      // works never neonize. Driven purely by the analyzer's flat-work
      // detection now that the capture-mode trio is gone.
      const paintingMode = analysis?.mode === "flat";
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
                exposureLumaTarget:
                  intensity === "strong" ? 136 : intensity === "light" ? 108 : 122,
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
      const toneBias =
        intensity === "strong"
          ? { b: 0.07, c: 0.1, s: 0.06 }
          : intensity === "light"
            ? { b: -0.05, c: -0.06, s: -0.04 }
            : { b: 0.02, c: 0.03, s: 0.01 };
      const result = await runFlatEnhancement({
        file: useSilhouette ? silhouetteFileRef.current! : file,
        // G5 (2026-08-10): unify long-edge cap to 2560 across every
        // upload path. Single + exhibition-linked used to inherit the
        // engine's 4096 default; bulk was already at 2560. Never
        // upscales (see `scale = longestCropEdge > maxLongEdge`).
        maxLongEdge: 2560,
        // The silhouette route already matted the subject. A second
        // bezel would frame the frame. Quad mode keeps the studio bezel.
        bezel: useSilhouette ? 0 : STANDARD_STUDIO_BEZEL,
        // When corners exist, omit AABB crop so suggestedCrop cannot
        // become the warp rectangle. normalizeCropFromCorners already
        // prefers the corner AABB. Silhouette has no corners to warp.
        crop: useSilhouette || sourceCornersToSend ? null : seedCrop,
        sourceCorners: useSilhouette ? null : sourceCornersToSend,
        targetAspect: useSilhouette ? undefined : targetAspectOverride,
        tone: {
          // The classic tone pass only runs when Pro Look is OFF (i.e.
          // "원본 색감"); the engine skips it under Pro Look. So the
          // `ORIGINAL_COLOR_LIFT` nudge only takes effect in the faithful
          // mode, giving it the "스캐너 + 명채도 살짝 ↑" feel the artist asked
          // for without touching the "선명 보정" result.
          b:
            1 +
            ((suggestion?.b ?? 1) - 1) * iMult +
            toneBias.b +
            (isOriginalColor ? ORIGINAL_COLOR_LIFT.b : 0),
          c:
            1 +
            ((suggestion?.c ?? 1) - 1) * iMult +
            toneBias.c +
            (isOriginalColor ? ORIGINAL_COLOR_LIFT.c : 0),
          s:
            1 +
            ((suggestion?.s ?? 1) - 1) * iMult +
            toneBias.s +
            (isOriginalColor ? ORIGINAL_COLOR_LIFT.s : 0),
        },
        proLook: proLookConfigOverrides,
        awb: wantsAwb
          ? {
              enabled: true,
              rectangle:
                analysis?.rectangleConfidence && analysis.rectangleConfidence >= 0.55
                  ? seedCrop
                  : null,
              rectangleConfidence: analysis?.rectangleConfidence ?? 0,
              // Engine auto-WB: detect the wall region, gray-world fallback.
              // Wall-pick UI is not on the artist tone step.
              wallSample: "auto",
              // Partial strength (0.5) so a genuine cast is eased without
              // neutralizing the artist's intended warm tone — the root
              // cause of the "doesn't look like my painting" reports.
              strength: ENHANCE_AWB_STRENGTH,
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
      if (
        pathChoice === "ai" &&
        !perspectiveSkipped &&
        perspectiveCornersRef.current &&
        !result.recipe.sourceCorners
      ) {
        // Uncropped/full-frame result must not overwrite a good crop.
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
      if (gen !== enhanceGenRef.current) {
        revokeBlobUrl(finalPreviewUrl, parentPreviewUrlRef.current);
        return;
      }
      const baseDraft: EnhancementDraft = {
        displayFile: finalDisplayFile,
        previewUrl: finalPreviewUrl,
        meta: finalMeta,
      };
      const previousShown = enhancePreviewUrlRef.current;
      const previousBaseUrl = baseEnhanceRef.current?.previewUrl;
      const protect = parentPreviewUrlRef.current ?? finalPreviewUrl;
      // Keep `previousShown` until StudioResultPreview retires it after
      // the incoming image has loaded. Unused prior engine blobs that
      // are not currently painted can go immediately.
      if (
        previousBaseUrl &&
        previousBaseUrl !== finalPreviewUrl &&
        previousBaseUrl !== previousShown &&
        previousBaseUrl !== protect
      ) {
        revokeBlobUrl(previousBaseUrl, protect);
      }
      baseEnhanceRef.current = baseDraft;
      enhancePreviewUrlRef.current = finalPreviewUrl;
      lastSuccessfulSourceCornersRef.current =
        sourceCornersFromDraft(baseDraft) ?? lastSuccessfulSourceCornersRef.current;
      const tone = {
        b: fineBRef.current,
        c: fineCRef.current,
        s: fineSRef.current,
      };
      const fineGen = ++fineTuneGenRef.current;
      const shown = withUserFineTune(baseDraft, tone);
      setEnhancePreview(shown);
      if (!isIdentityFineTune(tone)) {
        void applyFineTuneToBaseRef.current(baseDraft, tone, fineGen);
      } else {
        pushDraftToParent(shown);
      }
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
      if (gen === enhanceGenRef.current) setEnhanceRunning(false);
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
    portfolioCoherenceOn,
    portfolioAvailable,
    portfolioStats,
    intensity,
    wallBrightness,
    ellipseRestored,
    perspectiveSkipped,
    aspectMode,
    customAspect,
    artworkWidthCm,
    artworkHeightCm,
    gateBlocked,
    qualityGate,
    qualityGateOverride,
    pathChoice,
    pushDraftToParent,
  ]);
  const runEnhancePreviewRef = useRef(runEnhancePreview);
  runEnhancePreviewRef.current = runEnhancePreview;

  const runOriginalMarginPreview = useCallback(async () => {
    if (!onEnhance) return;
    setEnhanceError(null);
    setEnhanceRunning(true);
    void recordUsageEvent({
      key: USAGE_KEYS.AI_IMAGE_ENHANCE_REQUESTED,
      featureKey: "ai.image_enhance",
      metadata: {
        mode: "auto",
        provider: "local_opencv",
        source: meteringSource,
        path: "original_margin",
        latency_ms: null,
      },
    });
    try {
      const result = await runFlatEnhancement({
        file,
        maxLongEdge: 2560,
        crop: { x: 0, y: 0, w: 1, h: 1 },
        sourceCorners: null,
        bezel: STANDARD_STUDIO_BEZEL,
        sharpen: 0,
        proLook: { enabled: false },
        awb: { enabled: false, wallSample: "off" },
      });
      if (!result.blob) {
        setEnhanceError(t("upload.imageEnhance.previewError"));
        setPathChoice(null);
        return;
      }
      const displayFile = flatBlobToFile(file.name, result.blob);
      const sourceHash = await computeFileSha256(file);
      const preview = URL.createObjectURL(displayFile);
      revokeBlobUrl(enhancePreviewUrlRef.current, enhancement?.previewUrl);
      enhancePreviewUrlRef.current = preview;
      const draft: EnhancementDraft = {
        displayFile,
        previewUrl: preview,
        meta: {
          provider: "local_opencv",
          mode: "auto",
          recipe: { kind: "flat", params: result.recipe as FlatRecipe },
          confidence: 1,
          sourceHashSha256: sourceHash,
          processedAtIso: new Date().toISOString(),
          latencyMs: result.latencyMs,
          versions: {
            schema: ENHANCEMENT_META_SCHEMA_VERSION,
            engine: "studio_margin_v1",
          },
        },
      };
      setEnhancePreview(draft);
      setPathChoice("original");
      enhancePreviewUrlRef.current = null;
      onEnhance(draft);
      setSaveStatus(t("upload.imageEnhance.applied.status"));
    } catch {
      setEnhanceError(t("upload.imageEnhance.previewError"));
      setPathChoice(null);
    } finally {
      setEnhanceRunning(false);
    }
  }, [onEnhance, file, meteringSource, t, enhancement?.previewUrl]);

  const previewRecipeKey = JSON.stringify({
    intensity,
    inputType,
    wallBrightness,
    wizardStep,
    pathChoice,
    skipped: perspectiveSkipped,
    corners: perspectiveCorners,
    boundary: boundaryMode,
    silhouette: silhouetteUrl ? "ready" : "",
  });
  const lastPreviewRecipeKeyRef = useRef<string>("");

  // First result and later strength / capture-setup changes share one
  // trigger. Drive by recipe key + guards only — never `analysis`
  // (picker can confirm before analyze), never `enhancePreview` /
  // `runEnhancePreview` identity (those caused last-key races), and
  // never fineB/C/S (those bake as a post-pass on the base blob).
  useEffect(() => {
    if (!onEnhance) return;
    if (pathChoice !== "ai") return;
    if (tab !== "enhance") return;
    if (wizardStep !== "tone") return;
    const silhouetteReady =
      boundaryModeRef.current === "silhouette" && silhouetteFileRef.current != null;
    if (
      !silhouetteReady &&
      !perspectiveSkipped &&
      !perspectiveCorners &&
      !perspectiveCornersRef.current
    ) {
      return;
    }
    if (resolvedAutoMode === "object") return;
    if (gateBlocked) return;
    if (previewRecipeKey === lastPreviewRecipeKeyRef.current) return;
    lastPreviewRecipeKeyRef.current = previewRecipeKey;
    didAutoPreviewRef.current = true;
    void runEnhancePreviewRef.current();
    // Intentionally omits `analysis`, `enhancePreview`, and
    // `runEnhancePreview` — those identities raced last-key skips.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recipe key + guards only
  }, [
    previewRecipeKey,
    pathChoice,
    tab,
    wizardStep,
    perspectiveSkipped,
    perspectiveCorners,
    resolvedAutoMode,
    gateBlocked,
    onEnhance,
  ]);

  const debouncedFine = useDebounced({ b: fineB, c: fineC, s: fineS }, 120);
  useEffect(() => {
    const base = baseEnhanceRef.current;
    if (!base) return;
    if (pathChoice !== "ai") return;
    if (wizardStep !== "tone") return;
    const gen = ++fineTuneGenRef.current;
    void applyFineTuneToBaseRef.current(base, debouncedFine, gen);
  }, [debouncedFine, pathChoice, wizardStep]);

  // Reset the auto-preview sentinel when the underlying file changes
  // so a fresh upload gets its own first-run preview.
  useEffect(() => {
    didAutoPreviewRef.current = false;
    lastPreviewRecipeKeyRef.current = "";
    perspectiveCornersRef.current = null;
    setVisionQuad(null);
    setVisionConfidence(0);
    setVisionLook(null);
    setBoundaryMode("quad");
    silhouetteFileRef.current = null;
    setSilhouetteUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setSilhouetteError(null);
    colorSeedLockedRef.current = Boolean(sharedPreset);
    setVisionStatus("idle");
    setDetectingArtwork(false);
    setPerspectiveCorners(null);
    setWizardPerspectiveDraft(null);
    setPerspectiveUserAdjusted(false);
    setWizardStep("perspective");
    setPathChoice(enhancement ? "ai" : null);
    // `enhancement` is read only to restore the AI path when a new file
    // already has a saved result. Corner state must not reset when the
    // parent merely accepts a preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- file identity only
  }, [file]);

  // Seed the crop picker from vision; never warp until the user confirms.
  useEffect(() => {
    if (pathChoice !== "ai") return;
    if (enhancement && !editingAfterSave) return;
    if (perspectiveCorners) return;
    let cancelled = false;
    setDetectingArtwork(true);
    setVisionStatus("loading");
    void detectArtworkQuad(file)
      .then((seed) => {
        if (cancelled) return;
        const corners = seed?.corners ?? null;
        setVisionQuad(corners);
        setVisionConfidence(seed?.confidence ?? 0);
        setVisionLook(seed?.look ?? null);
        setVisionStatus(corners ? "ok" : "miss");
        if (
          seed?.look &&
          !colorSeedLockedRef.current
        ) {
          setInputType(seed.look.colorMode);
          setIntensity(seed.look.intensity);
        }
        if (corners && !perspectiveUserAdjustedRef.current) {
          setWizardPerspectiveDraft(null);
          setPerspectiveResetToken((n) => n + 1);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setVisionQuad(null);
        setVisionStatus("miss");
      })
      .finally(() => {
        if (!cancelled) setDetectingArtwork(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathChoice, file, enhancement, editingAfterSave, perspectiveCorners]);

  const handleEnhanceApprove = useCallback(async () => {
    if (!onEnhance) return;
    const base = baseEnhanceRef.current;
    const tone = {
      b: fineBRef.current,
      c: fineCRef.current,
      s: fineSRef.current,
    };
    let draft: EnhancementDraft | null = null;
    if (base) {
      const gen = ++fineTuneGenRef.current;
      draft = await applyFineTuneToBaseRef.current(base, tone, gen);
    }
    draft = draft ?? enhancePreviewRef.current;
    if (!draft) return;
    const handed = draft.previewUrl;
    const baseUrl = baseEnhanceRef.current?.previewUrl;
    if (baseUrl && baseUrl !== handed) {
      revokeBlobUrl(baseUrl, parentPreviewUrlRef.current ?? handed);
    }
    baseEnhanceRef.current = null;
    // Parent takes ownership of the (possibly fine-tuned) preview blob.
    enhancePreviewUrlRef.current = null;
    onEnhance(draft);
    onSharedPreset?.({
      inputType,
      intensity,
      b: fineBRef.current,
      c: fineCRef.current,
      s: fineSRef.current,
      aspectMode,
      customAspect,
    });
    setEditingAfterSave(false);
    setSaveStatus(t("upload.imageEnhance.applied.status"));
    setPerspectiveAdvancedOpen(false);
    const recipe = draft.meta.recipe;
    const fine =
      recipe.kind === "flat" ? recipe.params.userFineTune : undefined;
    void recordUsageEvent({
      key: USAGE_KEYS.AI_IMAGE_ENHANCE_ACCEPTED,
      featureKey: "ai.image_enhance",
      metadata: {
        mode: draft.meta.mode,
        provider: draft.meta.provider,
        source: meteringSource,
        latency_ms: draft.meta.latencyMs,
        intensity,
        input_type: inputType,
        fine_b: fine?.b ?? round3(fineBRef.current),
        fine_c: fine?.c ?? round3(fineCRef.current),
        fine_s: fine?.s ?? round3(fineSRef.current),
        ...(draft.meta.captureDevice
          ? { captureDevice: draft.meta.captureDevice }
          : {}),
      },
    });
  }, [onEnhance, onSharedPreset, meteringSource, t, intensity, inputType, aspectMode, customAspect]);

  const handleEnhanceReject = useCallback(() => {
    if (!onEnhance) return;
    const previous = enhancePreview;
    const protect = parentPreviewUrlRef.current;
    const shown = enhancePreviewUrlRef.current;
    const baseUrl = baseEnhanceRef.current?.previewUrl;
    revokeBlobUrl(shown, protect);
    if (baseUrl && baseUrl !== shown) revokeBlobUrl(baseUrl, protect);
    enhancePreviewUrlRef.current = null;
    baseEnhanceRef.current = null;
    setEnhancePreview(null);
    setPathChoice(null);
    setEditingAfterSave(false);
    setWizardStep("perspective");
    setPerspectiveCorners(null);
    perspectiveCornersRef.current = null;
    lastSuccessfulSourceCornersRef.current = null;
    lastPreviewRecipeKeyRef.current = "";
    onEnhance(null);
    if (previous) {
      const recipe = previous.meta.recipe;
      const fine =
        recipe.kind === "flat" ? recipe.params.userFineTune : undefined;
      void recordUsageEvent({
        key: USAGE_KEYS.AI_IMAGE_ENHANCE_REJECTED,
        featureKey: "ai.image_enhance",
        metadata: {
          mode: previous.meta.mode,
          provider: previous.meta.provider,
          source: meteringSource,
          latency_ms: previous.meta.latencyMs,
          intensity,
          input_type: inputType,
          fine_b: fine?.b ?? round3(fineBRef.current),
          fine_c: fine?.c ?? round3(fineCRef.current),
          fine_s: fine?.s ?? round3(fineSRef.current),
          ...(previous.meta.captureDevice
            ? { captureDevice: previous.meta.captureDevice }
            : {}),
        },
      });
    }
  }, [enhancePreview, onEnhance, meteringSource, intensity, inputType]);

  const lightingAtDefaults =
    intensity === "normal" &&
    isIdentityFineTune({ b: fineB, c: fineC, s: fineS });

  const handleResetLighting = useCallback(() => {
    // Keep confirmed crop / keystone / matte and 촬영 방식. Only
    // lighting work (strength + B/C/S) returns to the recommended look.
    const intensityAlreadyNormal = intensity === "normal";
    setFineB(1);
    setFineC(1);
    setFineS(1);
    fineBRef.current = 1;
    fineCRef.current = 1;
    fineSRef.current = 1;
    const gen = ++fineTuneGenRef.current;
    if (!intensityAlreadyNormal) {
      setIntensity("normal");
      return;
    }
    const base = baseEnhanceRef.current;
    if (base) {
      void applyFineTuneToBaseRef.current(base, { b: 1, c: 1, s: 1 }, gen);
    }
  }, [intensity]);

  const handleRetiredPreviewSrc = useCallback((url: string) => {
    if (!url) return;
    if (url === parentPreviewUrlRef.current) return;
    if (url === baseEnhanceRef.current?.previewUrl) return;
    if (url === enhancePreviewUrlRef.current) return;
    revokeBlobUrl(url, parentPreviewUrlRef.current);
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

  // 2026-10-02 — derived state for the Step 1 Advanced aspect picker.
  // Co-located here (rather than at module scope) so the chip labels
  // react to translations without a separate memo contract. `aspectMode`,
  // `customAspect`, and the artwork cm props feed `resolvedAspectValue`
  // through the same resolver the enhance pipeline uses, so the status
  // line is always consistent with the engine input.
  const aspectPresetChipDefs: Array<{ mode: AspectMode; label: string }> = [
    { mode: "auto", label: t("imageEnhance.wizard.aspectAuto") },
    { mode: "square", label: "1:1" },
    { mode: "2:3", label: "2:3" },
    { mode: "3:2", label: "3:2" },
    { mode: "3:4", label: "3:4" },
    { mode: "4:3", label: "4:3" },
    { mode: "4:5", label: "4:5" },
    { mode: "5:4", label: "5:4" },
    { mode: "16:9", label: "16:9" },
    { mode: "9:16", label: "9:16" },
  ];
  const artworkCmHasBoth =
    typeof artworkWidthCm === "number" &&
    typeof artworkHeightCm === "number" &&
    Number.isFinite(artworkWidthCm) &&
    Number.isFinite(artworkHeightCm) &&
    artworkWidthCm > 0 &&
    artworkHeightCm > 0;
  const artworkAspectChipLabel = artworkCmHasBoth
    ? t("imageEnhance.wizard.aspectArtworkChipFormat")
        .replace("{w}", String(artworkWidthCm))
        .replace("{h}", String(artworkHeightCm))
        .replace(
          "{ratio}",
          formatAspectLabel(
            (artworkWidthCm as number) / (artworkHeightCm as number),
          ),
        )
    : null;
  const resolvedAspectSourceAspect =
    analysis && analysis.height > 0
      ? analysis.width / analysis.height
      : previewNaturalSize && previewNaturalSize.h > 0
        ? previewNaturalSize.w / previewNaturalSize.h
        : undefined;
  const resolvedAspectValue = resolveTargetAspect(aspectMode, {
    customAspect,
    artworkCm: { w: artworkWidthCm, h: artworkHeightCm },
    sourceAspect: resolvedAspectSourceAspect,
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
          {!enhancementEnabled && (
            <button
              type="button"
              onClick={handleReset}
              className="shrink-0 rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
            >
              {t("upload.imageStandardize.reset")}
            </button>
          )}
        </div>
      )}

      {/*
        2026-08-19 — Pre-flight quality gate surface. "detecting"
        status uses aria-live so screen readers hear the check without
        stealing focus; the banner itself renders only for warn/block
        verdicts (fail-open contract — degraded verdicts and ok
        verdicts are silent).
       */}
      {pathChoice === "ai" && qualityGateRunning && !qualityGate && (
        <p
          className="text-xs text-zinc-500"
          role="status"
          aria-live="polite"
        >
          {t("enhancement.quality.detecting")}
        </p>
      )}
      {shouldShowQualityGateBanner({
        pathChoice,
        result: qualityGate,
        dismissed: qualityGateDismissed,
        override: qualityGateOverride,
      }) &&
        qualityGate && (
          <QualityGateBanner
            severity={qualityGate.severity}
            issues={qualityGate.issues}
            result={qualityGate}
            locale={locale}
            onReshoot={() => {
              if (onReshootRequest) onReshootRequest();
              else {
                rememberQualityGateAck(file, { dismissed: true });
                setQualityGateDismissed(true);
              }
            }}
            onProceed={() => {
              rememberQualityGateAck(file, { dismissed: true });
              setQualityGateDismissed(true);
            }}
            onUseAnyway={() => {
              rememberQualityGateAck(file, {
                override: true,
                dismissed: true,
              });
              setQualityGateOverride(true);
              setQualityGateDismissed(true);
            }}
          />
        )}

      {enhancementEnabled && pathChoice === null && (!enhancement || editingAfterSave) && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-zinc-900">
              {t("upload.imageEnhance.flow.chooseTitle")}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              {t("upload.imageEnhance.flow.chooseHint")}
            </p>
          </div>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              className="max-h-48 w-full rounded-lg border border-zinc-200 object-contain bg-zinc-50"
            />
          )}
          {enhanceRunning && (
            <p className="text-[11px] text-zinc-500" aria-live="polite">
              {t("upload.imageEnhance.flow.originalRunning")}
            </p>
          )}
          {enhanceError && (
            <p className="text-[11px] text-amber-700" role="alert">
              {enhanceError}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={enhanceRunning}
              onClick={() => {
                void runOriginalMarginPreview();
              }}
              className="rounded-xl border border-zinc-300 bg-white px-3 py-3 text-left hover:bg-zinc-50 disabled:opacity-50"
            >
              <span className="block text-sm font-medium text-zinc-900">
                {t("upload.imageEnhance.flow.originalTitle")}
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-zinc-500">
                {t("upload.imageEnhance.flow.originalHint")}
              </span>
            </button>
            <button
              type="button"
              disabled={enhanceRunning}
              onClick={() => {
                setPathChoice("ai");
                setTab("enhance");
                setWizardStep("perspective");
                didAutoPreviewRef.current = false;
              }}
              className="rounded-xl border border-zinc-900 bg-zinc-900 px-3 py-3 text-left text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              <span className="block text-sm font-medium">
                {t("upload.imageEnhance.flow.aiTitle")}
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-white/70">
                {t("upload.imageEnhance.flow.aiHint")}
              </span>
            </button>
          </div>
        </div>
      )}

      {enhancementEnabled && enhancement && !editingAfterSave && (
        <div className="space-y-3">
          <StudioResultPreview
            src={enhancement.previewUrl}
            aspect={enhancePreviewAspect}
            alt={t("upload.imageEnhance.afterAlt")}
            onRetiredSrc={handleRetiredPreviewSrc}
          />
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
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
                  const recipe = enhancement.meta.recipe;
                  const corners =
                    recipe.kind === "flat" ? recipe.params.sourceCorners : null;
                  const savedFine =
                    recipe.kind === "flat" ? recipe.params.userFineTune : undefined;
                  setFineB(savedFine?.b ?? 1);
                  setFineC(savedFine?.c ?? 1);
                  setFineS(savedFine?.s ?? 1);
                  setSaveStatus(null);
                  setEditingAfterSave(true);
                  if (corners) {
                    perspectiveCornersRef.current = corners;
                    lastSuccessfulSourceCornersRef.current = corners;
                    setPerspectiveCorners(corners);
                    setPathChoice("ai");
                    setWizardStep("tone");
                    setEnhancePreview(enhancement);
                    didAutoPreviewRef.current = true;
                    lastPreviewRecipeKeyRef.current = "";
                  } else {
                    setPathChoice(null);
                  }
                }}
                className="rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-emerald-800 hover:bg-emerald-100"
              >
                {t("upload.imageEnhance.applied.reopen")}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleEnhanceReject();
                  setSaveStatus(null);
                }}
                className="rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-zinc-700 hover:bg-zinc-100"
              >
                {t("upload.imageEnhance.applied.revert")}
              </button>
            </div>
          </div>
        </div>
      )}

      {enhancementEnabled && pathChoice === "ai" && (!enhancement || editingAfterSave) && (
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

          <>
              {/* F4 (2026-08-10) — wizard-by-default. The Basic view
                  is a 3-step flow (원근·크롭 → 톤·벽 색 → 확인·저장)
                  with a persistent progress indicator. Legacy top-
                  level widgets (run CTA / strength / perspective
                  toggle) are absorbed into the wizard; each step's
                  own Advanced fold hosts the fine-grained controls
                  that used to sit in the shared Advanced surface. */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-zinc-900">
                    {wizardStep === "perspective"
                      ? t("upload.imageEnhance.flow.cropTitle")
                      : t("upload.imageEnhance.flow.lightTitle")}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                    {wizardStep === "perspective"
                      ? boundaryMode === "silhouette"
                        ? t("upload.imageEnhance.flow.boundaryShapeHint")
                        : t("upload.imageEnhance.flow.cropHint")
                      : t("upload.imageEnhance.flow.lightHint")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={() => {
                    didAutoPreviewRef.current = false;
                    if (enhancement) handleEnhanceReject();
                    else {
                      const protect = parentPreviewUrlRef.current;
                      const shown = enhancePreviewUrlRef.current;
                      const baseUrl = baseEnhanceRef.current?.previewUrl;
                      revokeBlobUrl(shown, protect);
                      if (baseUrl && baseUrl !== shown) revokeBlobUrl(baseUrl, protect);
                      enhancePreviewUrlRef.current = null;
                      baseEnhanceRef.current = null;
                      setEnhancePreview(null);
                      setWizardStep("perspective");
                      setPathChoice(null);
                    }
                  }}
                  className="rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50"
                >
                  {t("upload.imageEnhance.flow.changePath")}
                </button>
                {wizardStep === "tone" && (
                  <button
                    type="button"
                    onClick={handleResetLighting}
                    disabled={lightingAtDefaults}
                    title={t("upload.imageEnhance.flow.resetLightingHint")}
                    className="rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("upload.imageEnhance.flow.resetLighting")}
                  </button>
                )}
                </div>
              </div>

              {/* ─────────────────── STEP 1 — Perspective & Crop (extra) */}
              {wizardStep === "perspective" && (
                <div className="space-y-3">
                  {/* Chip strip — auto-seed provenance */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className={`rounded-full border px-2.5 py-1 ${
                        visionStatus === "ok" || matteReady
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : visionStatus === "miss"
                            ? "border-amber-300 bg-amber-50 text-amber-800"
                            : "border-zinc-300 bg-zinc-50 text-zinc-700"
                      }`}
                    >
                      {visionStatus === "ok" || matteReady
                        ? t("imageEnhance.wizard.perspectiveAutoDetected")
                        : visionStatus === "miss"
                          ? t("imageEnhance.wizard.perspectiveManual")
                          : t("upload.imageEnhance.flow.detectingArtwork")}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setBoundaryMode("quad")}
                      className={`rounded-full border px-2.5 py-1 text-[11px] ${
                        boundaryMode === "quad"
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      {t("upload.imageEnhance.flow.boundaryQuad")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBoundaryMode("silhouette")}
                      className={`rounded-full border px-2.5 py-1 text-[11px] ${
                        boundaryMode === "silhouette"
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      {t("upload.imageEnhance.flow.boundaryShape")}
                    </button>
                  </div>

                  {boundaryMode === "silhouette" ? (
                    <div className="space-y-2">
                      {previewUrl || silhouetteUrl ? (
                        <div className="overflow-hidden rounded-lg bg-[#f3f3f3]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={silhouetteUrl ?? previewUrl ?? ""}
                            alt=""
                            className="mx-auto max-h-[420px] w-full object-contain"
                          />
                        </div>
                      ) : null}
                      <button
                        type="button"
                        disabled={silhouetteRunning}
                        onClick={() => {
                          setSilhouetteError(null);
                          setSilhouetteRunning(true);
                          void requestSilhouetteCutout(file)
                            .then((blob) => {
                              const next = new File([blob], "silhouette.webp", { type: "image/webp" });
                              silhouetteFileRef.current = next;
                              setSilhouetteUrl((prev) => {
                                if (prev) URL.revokeObjectURL(prev);
                                return URL.createObjectURL(next);
                              });
                            })
                            .catch((err: unknown) => {
                              const reason = err instanceof Error ? err.message : "error";
                              setSilhouetteError(
                                reason === "no_key"
                                  ? t("upload.imageEnhance.flow.boundaryShapeNoKey")
                                  : reason === "provider_quota"
                                    ? t("upload.imageEnhance.flow.boundaryShapeQuota")
                                    : t("upload.imageEnhance.flow.boundaryShapeFailed"),
                              );
                            })
                            .finally(() => setSilhouetteRunning(false));
                        }}
                        className="rounded-full border border-zinc-300 px-3 py-1 text-[11px] text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                      >
                        {silhouetteRunning
                          ? t("upload.imageEnhance.flow.boundaryShapeRunning")
                          : t("upload.imageEnhance.flow.boundaryShapeRun")}
                      </button>
                      {silhouetteError ? (
                        <p className="text-[11px] text-amber-800" role="alert">{silhouetteError}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Picker — rectangular works only. Silhouette does not touch it. */}
                  {boundaryMode === "quad" && previewUrl && !perspectiveSkipped && (
                    <PerspectiveCornerPicker
                      imageUrl={previewUrl}
                      imageWidth={pickerImageWidth}
                      imageHeight={pickerImageHeight}
                      initialCorners={wizardPerspectiveDraft ?? wizardPerspectiveSeed}
                      autoDetectedCorners={wizardPerspectiveSeed}
                      autoHint={!perspectiveUserAdjusted && perspectiveAutoHint}
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
                  {boundaryMode === "quad" && perspectiveSkipped && previewUrl && (
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
                  {boundaryMode === "quad" && detectingArtwork && (
                    <p className="text-[11px] leading-relaxed text-zinc-500" aria-live="polite">
                      {t("upload.imageEnhance.flow.detectingArtwork")}
                    </p>
                  )}
                  {boundaryMode === "quad" && !detectingArtwork && visionStatus === "miss" && !matteReady && !perspectiveUserAdjusted && (
                    <p className="text-[11px] leading-relaxed text-amber-800" role="status">
                      {t("upload.imageEnhance.flow.cropNeedCorners")}
                    </p>
                  )}
                  {boundaryMode === "quad" && !detectingArtwork && (visionStatus !== "miss" || matteReady) && (
                    <p className="text-[11px] leading-relaxed text-zinc-500">
                      {t("imageEnhance.wizard.perspectiveHint")}
                    </p>
                  )}
                  {/* 2026-10-02 — lens-curvature hint. Users on phones
                      often shoot through a wide-angle lens that bows
                      the artwork's edges outward. Guiding them to the
                      apex of each curved edge keeps the warp honest
                      and lets `paintBorderWall` do its wall-color
                      cleanup on the thin leftover band. */}
                  {boundaryMode === "quad" && !perspectiveSkipped &&
                    (visionStatus === "miss" || matteReady || perspectiveUserAdjusted) && (
                      <p className="text-[11px] leading-relaxed text-amber-700">
                        {t("imageEnhance.wizard.perspectiveLensHint")}
                      </p>
                    )}

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
                      disabled={
                        boundaryMode === "silhouette"
                          ? silhouetteRunning || !silhouetteUrl
                          : (detectingArtwork && !matteReady) || !canConfirmCrop
                      }
                      onClick={() => {
                        if (boundaryMode === "silhouette") {
                          if (!silhouetteFileRef.current) return;
                          perspectiveCornersRef.current = null;
                          setPerspectiveCorners(null);
                        } else if (perspectiveSkipped) {
                          perspectiveCornersRef.current = null;
                          setPerspectiveCorners(null);
                        } else {
                          const snapshot =
                            wizardPerspectiveDraft ??
                            wizardPerspectiveSeed;
                          perspectiveCornersRef.current = snapshot;
                          setPerspectiveCorners(snapshot);
                        }
                        lastPreviewRecipeKeyRef.current = "";
                        setWizardStep("tone");
                        setSaveStatus(null);
                        // Reset the auto-preview sentinel so the
                        // enhance actually re-runs when this is a
                        // second pass through step 1 → step 2.
                        didAutoPreviewRef.current = false;
                        // Keep the last cropped blob until the new
                        // result lands. Nulling here showed the raw
                        // studio photo under "보정 결과".
                      }}
                      className="rounded-full bg-zinc-900 px-4 py-1.5 text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("upload.imageEnhance.flow.cropConfirm")}
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
                      {/* 2026-10-02 — output aspect selector (replaces
                          the `keepOriginalAspect` checkbox). Preset row
                          + artwork-cm chip (hidden when the DB row has
                          no dims) + photo-sensor chip (= the old
                          checkbox) + custom W/H form. Rides on
                          `sharedPreset` so a bulk session carries the
                          choice forward. */}
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium text-zinc-700">
                          {t("imageEnhance.wizard.aspectTitle")}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {aspectPresetChipDefs.map((item) => {
                            const active = aspectMode === item.mode;
                            return (
                              <button
                                key={item.mode}
                                type="button"
                                onClick={() => setAspectMode(item.mode)}
                                className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                                  active
                                    ? "border-zinc-900 bg-zinc-900 text-white"
                                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                                }`}
                              >
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {artworkAspectChipLabel && (
                            <button
                              type="button"
                              onClick={() => setAspectMode("artwork_cm")}
                              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                                aspectMode === "artwork_cm"
                                  ? "border-zinc-900 bg-zinc-900 text-white"
                                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                              }`}
                            >
                              {artworkAspectChipLabel}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setAspectMode("photo_sensor")}
                            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                              aspectMode === "photo_sensor"
                                ? "border-zinc-900 bg-zinc-900 text-white"
                                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                            }`}
                          >
                            {t("imageEnhance.wizard.aspectPhotoSensor")}
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-zinc-500">
                            {t("imageEnhance.wizard.aspectCustom")}
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="any"
                            aria-label="W"
                            placeholder="W"
                            value={customAspectWInput}
                            onChange={(e) => setCustomAspectWInput(e.target.value)}
                            className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-[11px]"
                          />
                          <span className="text-[11px] text-zinc-500">×</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="any"
                            aria-label="H"
                            placeholder="H"
                            value={customAspectHInput}
                            onChange={(e) => setCustomAspectHInput(e.target.value)}
                            className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-[11px]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const w = Number.parseFloat(customAspectWInput);
                              const h = Number.parseFloat(customAspectHInput);
                              if (
                                Number.isFinite(w) &&
                                Number.isFinite(h) &&
                                w > 0 &&
                                h > 0
                              ) {
                                setCustomAspect({ w, h });
                                setAspectMode("custom");
                              }
                            }}
                            className="rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
                          >
                            {t("imageEnhance.wizard.aspectApply")}
                          </button>
                        </div>
                        <p className="text-[11px] text-zinc-500">
                          {resolvedAspectValue === undefined
                            ? t("imageEnhance.wizard.aspectResolvedAuto")
                            : t("imageEnhance.wizard.aspectResolvedLabel").replace(
                                "{ratio}",
                                formatAspectLabel(resolvedAspectValue),
                              )}
                        </p>
                      </div>
                    </div>
                  </details>
                </div>
              )}

              {/* ─────────────────── STEP 2 — Tone & Wall */}
              {wizardStep === "tone" && (
                <div className="space-y-3">
                  {/* Never fall back to the original studio photo once
                      corners are confirmed. */}
                  {enhancePreview ? (
                    <StudioResultPreview
                      src={enhancePreview.previewUrl}
                      aspect={enhancePreviewAspect}
                      alt={t("upload.imageEnhance.afterAlt")}
                      onRetiredSrc={handleRetiredPreviewSrc}
                    />
                  ) : (
                    <div
                      className="relative w-full overflow-hidden rounded-lg"
                      style={{
                        backgroundColor: STUDIO_MATTE,
                        minHeight: 192,
                      }}
                      aria-busy="true"
                    />
                  )}

                  {/* Auto-detect status chips */}
                  {enhancePreview && autoWarpFired && (
                    <p className="text-[11px] text-zinc-500">
                      {t("upload.imageEnhance.flow.artworkIsolated")}
                    </p>
                  )}

                  {/* Strength selector */}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-zinc-600">
                        {t("upload.imageEnhance.intensity.label")}
                      </span>
                      {(["light", "normal", "strong"] as Intensity[]).map((i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            colorSeedLockedRef.current = true;
                            setIntensity(i);
                          }}
                          className={`rounded-full border px-2.5 py-1 ${
                            intensity === i
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                          }`}
                        >
                          {i === "normal"
                            ? t("upload.imageEnhance.flow.intensityRecommended")
                            : t(`upload.imageEnhance.intensity.${i}`)}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] leading-relaxed text-zinc-500">
                      {t("upload.imageEnhance.intensity.hint")}
                    </p>
                  </div>

                  {/* Color handling — fidelity (원본 색감 / 선명 보정), not lighting */}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-zinc-600">
                        {t("upload.imageEnhance.inputType.label")}
                      </span>
                      {(["original", "enhance"] as InputType[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            colorSeedLockedRef.current = true;
                            setInputType(m);
                          }}
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
                    <p className="text-[11px] leading-relaxed text-zinc-500">
                      {t("upload.imageEnhance.inputType.hint")}
                    </p>
                    {visionLook && (locale === "en" ? visionLook.noteEn : visionLook.noteKo) ? (
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        {locale === "en" ? visionLook.noteEn : visionLook.noteKo}
                      </p>
                    ) : null}
                  </div>

                  {/* Post-engine fine-tune — always visible, does not re-run crop */}
                  <div className="space-y-2 rounded-lg border border-zinc-200 bg-white px-3 py-3">
                    <p className="text-[11px] font-medium text-zinc-700">
                      {t("upload.imageEnhance.flow.extraToggle")}
                    </p>
                    <p className="text-[10.5px] leading-relaxed text-zinc-500">
                      {t("upload.imageEnhance.flow.extraHint")}
                    </p>
                    <FineToneSlider
                      label={t("upload.imageStandardize.brightness")}
                      value={fineB}
                      onChange={setFineB}
                    />
                    <FineToneSlider
                      label={t("upload.imageStandardize.contrast")}
                      value={fineC}
                      onChange={setFineC}
                    />
                    <FineToneSlider
                      label={t("upload.imageStandardize.saturation")}
                      value={fineS}
                      onChange={setFineS}
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setWizardStep("perspective")}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
                    >
                      {t("upload.imageEnhance.flow.cropRecrop")}
                    </button>
                    <button
                      type="button"
                      onClick={handleEnhanceApprove}
                      disabled={!enhancePreview || enhanceRunning}
                      className="rounded-full bg-zinc-900 px-4 py-1.5 text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("upload.imageEnhance.flow.lightApply")}
                    </button>
                  </div>

                  {/* Status */}
                  {detectingArtwork && (
                    <p className="text-[11px] text-zinc-500" aria-live="polite">
                      {t("upload.imageEnhance.flow.detectingArtwork")}
                    </p>
                  )}
                  {((enhanceRunning ||
                    (!enhancePreview && !enhanceError)) &&
                    !detectingArtwork) && (
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
                </div>
              )}

              {/* ─────────────────── STEP 3 — Review & Save */}
              {wizardStep === "confirm" && enhancePreview && (
                <div className="space-y-3">
                  <StudioResultPreview
                    src={enhancePreview.previewUrl}
                    aspect={enhancePreviewAspect}
                    alt={t("upload.imageEnhance.afterAlt")}
                    onRetiredSrc={handleRetiredPreviewSrc}
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
                        {t("imageEnhance.wizard.summaryIntensity")}:{" "}
                        {t(`upload.imageEnhance.intensity.${intensity}`)} ✓
                      </li>
                      {isOriginalColor ? (
                        // "원본 색감" runs no AWB / Pro Look, so the wall
                        // brightness + WB-source lines would misrepresent
                        // the result. Report the faithful intent instead.
                        <li>{t("imageEnhance.wizard.summaryColorOriginal")}</li>
                      ) : (
                        <>
                          <li>{t("imageEnhance.wizard.summaryColorEnhance")}</li>
                          <li>
                            {t("imageEnhance.wizard.summaryWallBrightness")}:{" "}
                            {t(`imageEnhance.wallBrightness.${wallBrightness}`)} ✓
                          </li>
                          <li>
                            {wallAutoFired
                              ? `${t("imageEnhance.wizard.summaryWbWall")} ✓`
                              : t("imageEnhance.wizard.summaryWbFallback")}
                          </li>
                        </>
                      )}
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
                          const protect = parentPreviewUrlRef.current;
                          const shown = enhancePreviewUrlRef.current;
                          const baseUrl = baseEnhanceRef.current?.previewUrl;
                          revokeBlobUrl(shown, protect);
                          if (baseUrl && baseUrl !== shown) {
                            revokeBlobUrl(baseUrl, protect);
                          }
                          enhancePreviewUrlRef.current = null;
                          baseEnhanceRef.current = null;
                          fineTuneGenRef.current += 1;
                          setEnhancePreview(null);
                          perspectiveCornersRef.current = null;
                          lastSuccessfulSourceCornersRef.current = null;
                          lastPreviewRecipeKeyRef.current = "";
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
        </div>
      )}

      {!enhancementEnabled && (
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
                    <div className="absolute inset-y-0 left-1/3 w-px bg-[#fff]/40" />
                    <div className="absolute inset-y-0 left-2/3 w-px bg-[#fff]/40" />
                    <div className="absolute inset-x-0 top-1/3 h-px bg-[#fff]/40" />
                    <div className="absolute inset-x-0 top-2/3 h-px bg-[#fff]/40" />
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
