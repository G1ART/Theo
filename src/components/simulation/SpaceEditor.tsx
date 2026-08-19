"use client";

/**
 * `/my/spaces/[id]` — Chunk C editor for the P1 Display / Hang
 * Simulation.
 *
 * Layout:
 *   • Center: canvas — the room photo below, DOM overlay per
 *     placement (matrix3d-transformed <div> sized by
 *     `renderScene2D` output).
 *   • Right rail (`lg:` and up) / below-canvas (`< lg`): inspector
 *     with wall calibration + selected placement controls.
 *
 * Persistence:
 *   • Placement drags update local state in <16 ms; a 400 ms
 *     debounced `upsertPlacements` writes them back through the
 *     Chunk B lib. Individual `deletePlacement` and `updateSurface`
 *     calls fire immediately (small blast radius).
 *   • Header title edits go through `updateSpace` on blur.
 *
 * Snap guides:
 *   • Eye level (150 cm) — horizontal center of every placement
 *     while dragging.
 *   • Sibling top / bottom / vertical center — computed live from
 *     every OTHER placement's cm rect.
 *   • Tolerance = 3 cm, drawn as a light dashed line while snap
 *     candidate is active.
 *
 * Undo / redo:
 *   • Local ring, 20 slots. Every commit-to-DB pushes the
 *     PRE-commit state onto the undo stack. Redo mirrors this.
 *   • Never persisted server-side — mirrors editor conventions like
 *     Figma or Google Slides for a lightweight action stack.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useT } from "@/lib/i18n/useT";
import { AuthGate } from "@/components/AuthGate";
import {
  deletePlacement as deletePlacementRow,
  exportSpace,
  getArtworkSceneThumb,
  getSpaceById,
  SimulationEntitlementError,
  updateSpace,
  updateSurface,
  upsertPlacements,
  type SpaceScene,
} from "@/lib/supabase/spaces";
import { updateArtworkDimsIfMissing } from "@/lib/supabase/artworks";
import { parseSizeToDimensionsCm } from "@/lib/size/format";
import {
  replaceSpacePhotoWithCleaned,
  uploadSpacePhoto,
} from "@/lib/simulation/storage";
import { cleanupWallRegion } from "@/lib/simulation/wallCleanup";
import {
  PLACEMENT_FALLBACK_HEIGHT_CM,
  PLACEMENT_FALLBACK_WIDTH_CM,
  renderScene2D,
  type ArtworkThumbMap,
} from "@/lib/simulation/renderer2d";
import {
  buildMountLayers,
  readLightDirection,
  resolveFramePreset,
} from "@/lib/simulation/mounting";
import { FRAME_PRESETS, type FramePreset } from "@/lib/simulation/scene";
import {
  computeSurfaceLocalPx,
  pxToCm,
  surfaceLocalToImageHomography,
} from "@/lib/simulation/transforms";
import type {
  ArtworkThumbForScene,
  ScenePlacement,
  SceneSurface,
  PhotoCorners,
} from "@/lib/simulation/scene";
import { spacePhotoUrl } from "./spacePhotoUrl";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { PerspectiveCornerPicker } from "@/components/upload/PerspectiveCornerPicker";
import type { Quad } from "@/lib/image/enhancement/cornerPickerGeometry";
import {
  ArtworkPickerSheet,
  type PickerArtwork,
} from "./ArtworkPickerSheet";
import { SavePill, type SavePillStatus } from "./SavePill";
import { SimulationPaywallCard } from "./SimulationPaywallCard";
import {
  applyHomography,
  invertHomography,
} from "@/lib/image/enhancement/homography";
import { aiApi } from "@/lib/ai/browser";
import type { SpaceCalibrateCandidate } from "@/lib/ai/types";
import { useAiCalibrationPref } from "@/lib/simulation/calibrationPref";
import {
  runPhotoroomCutout,
  runVisionBboxCrop,
} from "@/lib/simulation/cutoutClient";

const SNAP_TOLERANCE_CM = 3;
const EYE_LEVEL_CM = 150;
const UNDO_LIMIT = 20;
const PERSIST_DEBOUNCE_MS = 400;
/** Fallback wall dimensions when the space has never been calibrated
 *  — 400 × 260 cm approximates a modest room wall. Once the user opens
 *  the corner picker or dimensions inputs these are replaced. */
const FALLBACK_WALL_WIDTH_CM = 400;
const FALLBACK_WALL_HEIGHT_CM = 260;

/**
 * P1 render-quality (2026-08-19) — threshold for showing the
 * "image aspect ≠ placement aspect" warning in the inspector.
 *
 * We compare the artwork's SOURCE image aspect (from
 * `artwork_images.width/height`) with the placement's physical
 * aspect (`widthCm / heightCm`) and flag the delta as suspicious
 * when it exceeds this fraction of the larger side.
 *
 * A photo of a painting that includes visible wall/frame padding
 * typically inflates one dimension by 10–30 %, so 6 % is a
 * comfortable "signal not noise" cutoff:
 *   • rounding & EXIF quirks stay under ~2 %.
 *   • JPEG re-encodes and mild letterboxing land in the 2–4 % band.
 *   • Genuine padding cases (the P1 report's 121.9×106.7 cm portrait
 *     that looked square) sit at 30–50 %.
 *
 * Tunable — bump toward 8 % if we get complaints about the warning
 * being noisy, drop toward 5 % if users report missed cases.
 */
const ASPECT_MISMATCH_THRESHOLD = 0.06;

/**
 * Phase 3 (2026-08-19) — silent auto-crop failure cache. Keeps a
 * per-artwork "don't retry until" timestamp in localStorage so a
 * legacy work that consistently trips the low-confidence branch
 * doesn't burn tokens on every canvas tap. 30-min TTL keeps the
 * cache fresh enough that a user who re-uploads a better image
 * gets a retry within a session.
 */
const AUTOCROP_FAILED_LS_KEY = "abstract:sim:autocrop:failed";
const AUTOCROP_FAILED_TTL_MS = 30 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────
// P1 (2026-08-19 hot-fix) — Display-unit ("cm | in | m | ft") helpers.
//
// The persisted `spaces.unit` column stays a "cm" | "in" family flag
// (schema-frozen for the P1 milestone). But the editor's wall-size
// affordance and manual-measure input display in a wider 4-way unit
// set, because room dimensions are conventionally talked about in
// metres / feet — 332 cm is a mouthful compared to 3.33 m. Storage
// remains cm; only the display converts.
//
// Selection is remembered per-browser via localStorage, not per-space
// — a user who thinks in metres tends to think in metres across every
// space they open.
// ─────────────────────────────────────────────────────────────────────

type DisplayUnit = "m" | "cm" | "in" | "ft";

/** Multiply "in display unit" × factor → cm. Divide cm ÷ factor → display. */
const DISPLAY_UNIT_FACTOR: Record<DisplayUnit, number> = {
  m: 100,
  cm: 1,
  in: 2.54,
  ft: 30.48,
};

/** Decimal places to show for each unit — chosen so a 3 m wall reads
 *  "3.00 m" but an 8-foot ceiling reads "2.44 m" without absurd zeros. */
const DISPLAY_UNIT_DECIMALS: Record<DisplayUnit, number> = {
  m: 2,
  cm: 1,
  in: 1,
  ft: 2,
};

const DISPLAY_UNIT_ORDER: readonly DisplayUnit[] = ["m", "cm", "in", "ft"];

const DISPLAY_UNIT_LS_KEY = "abstract:sim:wall-unit";

function cmToDisplayNumber(cm: number, unit: DisplayUnit): number {
  return cm / DISPLAY_UNIT_FACTOR[unit];
}

function displayNumberToCm(value: number, unit: DisplayUnit): number {
  return value * DISPLAY_UNIT_FACTOR[unit];
}

/** Rounded display string (e.g. 332.85 cm → "3.33" for unit "m"). */
function formatCmForUnit(cm: number, unit: DisplayUnit): string {
  const v = cmToDisplayNumber(cm, unit);
  return v.toFixed(DISPLAY_UNIT_DECIMALS[unit]);
}

/**
 * "cm" / "in" family for the DB-level `spaces.unit` column. Metric
 * → "cm", imperial → "in" — that column keeps its existing meaning
 * as a placement-inspector affordance (artwork sizes are still
 * conventionally cm/in, never m/ft) so the persisted value stays
 * useful even when the display unit is m or ft.
 */
function displayUnitToSpaceUnit(unit: DisplayUnit): "cm" | "in" {
  return unit === "in" || unit === "ft" ? "in" : "cm";
}

function readInitialDisplayUnit(fallback: DisplayUnit): DisplayUnit {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(DISPLAY_UNIT_LS_KEY);
    if (v === "m" || v === "cm" || v === "in" || v === "ft") return v;
  } catch {
    /* private mode / disabled — fall back to prop default */
  }
  return fallback;
}

/** Ephemeral placement id used before we've persisted a new one. */
function tempId(): string {
  return `tmp_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * P1 — measurement-based calibration helpers. Kept top-level (pure)
 * so they can be unit-tested independently of the editor state and so
 * the render logic stays readable.
 */

/** Convert a File into a raw base64 string (no `data:` prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      const commaIdx = raw.indexOf(",");
      resolve(commaIdx >= 0 ? raw.slice(commaIdx + 1) : raw);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Compute the bounding-box "length" in NATIVE photo pixels for the
 * dimension the AI wants the user to measure.
 *   - width  → normalized bbox width × native photo width
 *   - height → normalized bbox height × native photo height
 *   - diagonal → Pythagoras across width & height (native px)
 *   - seat_back → treated as width (sofa seat-back horizontal length)
 */
function candidateNativePxLength(
  candidate: SpaceCalibrateCandidate,
  imagePxWidth: number,
  imagePxHeight: number,
): number {
  const { bbox, dimension } = candidate;
  const wPx = Math.max(0, bbox.x1 - bbox.x0) * imagePxWidth;
  const hPx = Math.max(0, bbox.y1 - bbox.y0) * imagePxHeight;
  switch (dimension) {
    case "height":
      return hPx;
    case "diagonal":
      return Math.sqrt(wPx * wPx + hPx * hPx);
    case "width":
    case "seat_back":
    default:
      return wPx;
  }
}

/** Midpoint of the model-supplied cm range, used as the input placeholder. */
function typicalMidpoint(candidate: SpaceCalibrateCandidate): number {
  const { min, max } = candidate.typical_range_cm;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 100;
  return Math.round((min + max) / 2);
}

/**
 * Compare an artwork's source-image aspect with a placement's
 * physical aspect (both expressed as width / height). Returns the
 * fractional delta relative to the larger aspect, plus the two
 * inputs so the inspector can display them.
 *
 * Returns `null` when either input is missing or degenerate — the
 * inspector treats that as "no signal, hide the warning".
 */
function computeAspectMismatch(
  imagePxWidth: number | null,
  imagePxHeight: number | null,
  placementWidthCm: number | null,
  placementHeightCm: number | null,
): {
  imageAspect: number;
  placementAspect: number;
  delta: number;
} | null {
  if (
    imagePxWidth == null ||
    imagePxHeight == null ||
    placementWidthCm == null ||
    placementHeightCm == null
  ) {
    return null;
  }
  if (
    imagePxWidth <= 0 ||
    imagePxHeight <= 0 ||
    placementWidthCm <= 0 ||
    placementHeightCm <= 0
  ) {
    return null;
  }
  const imageAspect = imagePxWidth / imagePxHeight;
  const placementAspect = placementWidthCm / placementHeightCm;
  if (!Number.isFinite(imageAspect) || !Number.isFinite(placementAspect)) {
    return null;
  }
  const denom = Math.max(imageAspect, placementAspect);
  if (denom <= 0) return null;
  const delta = Math.abs(imageAspect - placementAspect) / denom;
  return { imageAspect, placementAspect, delta };
}

type MeasurePoint = { x: number; y: number };
type MeasureState =
  | { phase: "idle" }
  | { phase: "pointA" }
  | { phase: "pointB"; pointA: MeasurePoint }
  | { phase: "input"; pointA: MeasurePoint; pointB: MeasurePoint };

/**
 * Tiny 14×14 preview swatch for the frame preset picker. Static
 * (no light direction), just enough visual differentiation that a
 * user can tell "black frame" from "wood frame" at a glance.
 */
function FramePresetSwatch({ preset }: { preset: FramePreset }) {
  const swatchStyle: CSSProperties = (() => {
    switch (preset) {
      case "none":
        return {
          background: "#f4f4f5",
          border: "1px dashed #a1a1aa",
        };
      case "matte_white_thin":
        return {
          background: "#ffffff",
          border: "1px solid #d4d4d8",
          boxShadow: "inset 0 0 0 2px #ffffff, inset 0 0 0 3px #a1a1aa",
        };
      case "frame_black":
        return {
          background: "#0a0a0a",
          border: "1px solid #0a0a0a",
        };
      case "frame_wood":
        return {
          background: "linear-gradient(180deg, #b47a48 0%, #7a4a24 100%)",
          border: "1px solid #6a4020",
        };
      case "canvas_edge":
        return {
          background: "#f5f2ec",
          border: "1px solid #d6cec1",
          boxShadow: "inset 2px 0 0 rgba(0,0,0,0.08)",
        };
      default:
        return { background: "#f4f4f5", border: "1px solid #d4d4d8" };
    }
  })();
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        borderRadius: 2,
        ...swatchStyle,
      }}
    />
  );
}

type EditorState = {
  space: SpaceScene["space"];
  artworks: ArtworkThumbMap;
};

type SnapHint = {
  type: "eyeLevel" | "siblingTop" | "siblingBottom" | "siblingCenterY" | "siblingCenterX";
  atCm: number;
};

function SpaceEditorContent({ id }: { id: string }) {
  const { t, locale } = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");

  const [state, setState] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);
  const [toast, setToast] = useState<string | null>(null);
  // Phase 3 (2026-08-19) — the boolean "저장 중…" flag was replaced
  // by the SavePill status enum below. Kept as a plain `setter-only`
  // in case a future consumer wants a boolean; unread by default so
  // TS's noUnusedLocals stays quiet (config permitting).
  const [, setSaving] = useState(false);
  const [savePillStatus, setSavePillStatus] =
    useState<SavePillStatus>("idle");
  const [titleDraft, setTitleDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingArtwork, setPendingArtwork] = useState<PickerArtwork | null>(
    null,
  );
  const [cornersOpen, setCornersOpen] = useState(false);
  const [imageBox, setImageBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [uploadBusy, setUploadBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [snapHints, setSnapHints] = useState<SnapHint[]>([]);
  const [dragPlacementId, setDragPlacementId] = useState<string | null>(null);

  // P1 (2026-08-19) — measurement-based calibration state.
  //
  // `calibrateCandidates` holds the raw AI response (empty when the
  // model returned nothing, the pref is off, or we skipped). We render
  // one candidate at a time (`calibrateIdx`) and let the user cycle via
  // "다른 물건 / Try another". `calibrateInputCm` is the user's typed
  // real-world length; on Apply we derive pxPerCm and persist.
  const [calibrateCandidates, setCalibrateCandidates] = useState<
    SpaceCalibrateCandidate[]
  >([]);
  const [calibrateIdx, setCalibrateIdx] = useState(0);
  const [calibrateInputCm, setCalibrateInputCm] = useState("");

  // Manual tap-to-measure state. The user drops 2 points on the photo,
  // then enters the real distance for that segment. Coordinates live in
  // `imageBox` CSS-pixel space (i.e., relative to the rendered <img>).
  const [measureState, setMeasureState] = useState<MeasureState>({ phase: "idle" });
  const [measureInputCm, setMeasureInputCm] = useState("");
  const [calibrateBusy, setCalibrateBusy] = useState(false);

  const aiCalibrationEnabled = useAiCalibrationPref();

  /**
   * P1 (2026-08-19) — Persistent status for the auto wall-cleanup
   * pass. The pipeline is intentionally "fail open" (a bad polygon
   * would distort the whole photo, so a skip is the right default),
   * but silent skips left the user staring at a still-warped photo
   * wondering whether the AI actually ran. This state drives a slim
   * inline notice on the canvas with a CTA to (a) upload a clearer
   * photo or (b) open the manual corner picker.
   *
   *   "idle"          — nothing to say yet (fresh mount, still working).
   *   "applied"       — cleanup ran end-to-end; transient toast handled
   *                     separately; we don't need a persistent notice.
   *   "skipped-low"   — model returned low confidence / <3 vertices
   *                     ("AI couldn't find a wall").
   *   "skipped-coverage" — cleanup module bailed on the mask coverage
   *                     guard (<5% or >95% of the image).
   *   "skipped-error" — network / decode / storage swap failure.
   *
   * Kept per-space-id in `wallCleanupNoticeRef` so that a genuine
   * "please try another photo" hint doesn't linger after a fresh
   * upload — every upload resets the notice.
   */
  const [wallCleanupNotice, setWallCleanupNotice] = useState<
    | { kind: "skipped-low" }
    | { kind: "skipped-coverage" }
    | { kind: "skipped-error" }
    | null
  >(null);

  // Display Simulation Phase 2 (2026-08-20) — cutout CTA busy state.
  // Two tracks (`bbox` = Track 1 free auto-crop, `alpha` = Track 2
  // Photoroom Pro) share a single busy indicator scoped to a
  // specific artwork id so the buttons disable together while the
  // pipeline runs, but do not disable buttons for other artworks in
  // the same space.
  const [cutoutBusy, setCutoutBusy] = useState<
    { artworkId: string; track: "bbox" | "alpha" } | null
  >(null);

  // Auto-fire guard for the on-mount AI calibration path (Fix #3 in
  // the P1 bug patch). Set on the FIRST attempt for a given space so
  // we never re-fire on re-renders / state churn; the load-triggered
  // reset ensures navigating to a different space still fires once.
  const autoCalibrateFiredRef = useRef<string | null>(null);
  // Same idea for wall-cleanup: kicks in on spaces uploaded before
  // d5775f7 (cleanup feature landed) OR when cleanup was silently
  // skipped on the first upload. Keyed by space id so navigating
  // between spaces still fires once per space per session.
  const autoWallCleanupFiredRef = useRef<string | null>(null);

  // Display unit (m | cm | in | ft) — UI-only, localStorage-backed.
  // Read defers until after we know `state.space.unit` so the metric/
  // imperial family of a saved space is respected when localStorage
  // is empty. See `useEffect` below.
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>("cm");
  const displayUnitInitialisedRef = useRef(false);
  const [wallCleanupBusy, setWallCleanupBusy] = useState(false);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyPlacements = useRef<Map<string, ScenePlacement>>(new Map());
  // Phase 3 (2026-08-19) — auto-crop dispatcher, wired up after
  // `runAutoCropForArtwork` is defined further down. flushPlacements
  // triggers it via a ref so we don't cycle through the callback
  // tree. Takes an artworkId (not a placement id) so we don't race
  // against React's batched state commit — a placement id lookup
  // after `setState(swap)` would still see the old tmp_ id.
  const maybeAutoCropRef = useRef<((artworkId: string) => void) | null>(null);
  const dragRef = useRef<{
    placementId: string;
    surfaceId: string;
    startPointerX: number;
    startPointerY: number;
    startXCm: number;
    startYCm: number;
    pxPerCm: number;
  } | null>(null);

  // Local undo/redo ring — 20 slots max. Each entry is a snapshot of
  // `placements` before the mutation, kept intentionally shallow (we
  // never mutate placement objects in place, just replace the array).
  const undoStack = useRef<ScenePlacement[][]>([]);
  const redoStack = useRef<ScenePlacement[][]>([]);

  const featureAccess = useFeatureAccess("simulation.2d");
  const overCap = featureAccess.decision != null && featureAccess.decision.allowed === false;
  const exportAccess = useFeatureAccess("simulation.2d.export");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await getSpaceById(id, { locale });
    if (!data) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    // Defensive guard: a headless space (no primary surface) silently
    // no-ops every handler in this editor — the wall-dims inputs, the
    // tap-to-place path, and the AI calibrate Apply all dereference
    // `surfaces[0]`. `createEmptySpace` now seeds a wall row eagerly
    // and 20260819020000_backfill_empty_space_surfaces.sql cleaned up
    // the historical rows, so hitting this branch means we regressed
    // one of those seeds. Warn loudly in dev so it's caught fast; we
    // deliberately do NOT client-side create a surface here because
    // that would paper over server-side regressions.
    if (
      data.space.surfaces.length === 0 &&
      process.env.NODE_ENV !== "production"
    ) {
      console.warn(
        "[simulation] space is missing primary surface — wall-dims / tap-to-place / AI apply will silently no-op",
        { spaceId: data.space.id, title: data.space.title },
      );
    }
    setState({ space: data.space, artworks: data.artworks });
    setTitleDraft(data.space.title);
    setLoading(false);
  }, [id, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(h);
  }, [toast]);

  // ── Measure the rendered image rect so overlays match the object-contain box.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const measure = () => {
      if (!imgRef.current) return;
      const r = imgRef.current.getBoundingClientRect();
      setImageBox({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(img);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [state?.space.photoStoragePath]);

  const primarySurface: SceneSurface | null = state?.space.surfaces[0] ?? null;

  const photoUrl = spacePhotoUrl(state?.space.photoStoragePath ?? null);
  const placements = state?.space.placements ?? [];

  const rendered = useMemo(() => {
    if (!state || !primarySurface || imageBox.w === 0 || imageBox.h === 0) {
      return [];
    }
    return renderScene2D(state.space, imageBox, state.artworks);
  }, [state, primarySurface, imageBox]);

  // Note: pxPerCm is computed per-drag inside `onOverlayPointerDown` via
  // `computeSurfaceLocalPx(...)` for the pointer capture path — we don't
  // keep a memoized editor-level value because the drag handler resolves
  // it from the surface at click-time.

  const homography = useMemo(() => {
    if (!primarySurface || imageBox.w === 0) return null;
    return surfaceLocalToImageHomography(primarySurface, imageBox);
  }, [primarySurface, imageBox]);

  // ── Persist ──────────────────────────────────────────────────
  //
  // Phase 3 (2026-08-19) — flushPlacements is now fully optimistic. We
  // send the dirty rows to PostgREST, receive the server-materialized
  // rows back (thanks to the new `.upsert().select()` in
  // `upsertPlacements`), and swap our client-side `tmp_` ids for the
  // real UUIDs in-place. No `void load()` re-hydrate at the end — the
  // whole editor stayed frozen for ~600 ms after every action because
  // every artwork thumb was re-downloaded and re-mounted.
  //
  // Race handling:
  //   • A new tmp_ landed while we were in-flight → it stays in
  //     `dirtyPlacements` (we cleared the map before the await) and
  //     rides the next debounce tick.
  //   • A row we sent got deleted locally while in-flight → we skip
  //     the id swap for it (the server row lands orphaned; the next
  //     flush re-syncs, and the delete already fired `deletePlacement`
  //     directly so it's gone from the DB anyway).
  //   • The primary key of a real-UUID row can never move, so the
  //     swap is a no-op for updates.
  const flushPlacements = useCallback(async () => {
    if (!state) return;
    const rows = Array.from(dirtyPlacements.current.values());
    if (rows.length === 0) return;
    dirtyPlacements.current.clear();
    // Remember which local tmp_ id maps to which artwork+surface+time
    // signature so we can pair it back to a server row after the
    // insert. `(artworkId, xCm, yCm, zOrder)` is unique enough within
    // a single flush cycle; ties are broken by insertion order.
    const tmpIds = rows.filter((r) => r.id.startsWith("tmp_")).map((r) => r.id);
    setSaving(true);
    setSavePillStatus("saving");
    const upserts = rows.map((p) => ({
      // Only include `id` when it's a real UUID (persisted). Temp ids
      // are stripped so PostgREST generates a fresh one.
      ...(p.id.startsWith("tmp_") ? {} : { id: p.id }),
      spaceId: p.spaceId,
      surfaceId: p.surfaceId,
      artworkId: p.artworkId,
      xCm: p.xCm,
      yCm: p.yCm,
      zCm: p.zCm,
      rotXDeg: p.rotXDeg,
      rotYDeg: p.rotYDeg,
      rotZDeg: p.rotZDeg,
      widthCm: p.widthCm,
      heightCm: p.heightCm,
      depthCm: p.depthCm,
      zOrder: p.zOrder,
      framePreset: p.framePreset,
    }));
    const { data: serverRows, error } = await upsertPlacements(
      state.space.id,
      upserts,
    );
    setSaving(false);
    if (error) {
      setSavePillStatus("error");
      // Roll the state back — a phantom placement that persists in
      // memory but never lands in the DB is worse than a hard failure
      // toast, because subsequent drags / flushes reference an id
      // PostgREST has never seen and the whole editor drifts. Drop
      // every temp-id placement we just tried to insert; keep updates
      // for real-uuid rows (server state is authoritative — the next
      // manual reload will resync them) but clear the dirty set so we
      // don't retry.
      const tempIdsToDrop = new Set(tmpIds);
      if (tempIdsToDrop.size > 0) {
        setState((prev) => {
          if (!prev) return prev;
          const nextPlacements = prev.space.placements.filter(
            (p) => !tempIdsToDrop.has(p.id),
          );
          return {
            ...prev,
            space: { ...prev.space, placements: nextPlacements },
          };
        });
        setSelectedId((prev) => (prev && tempIdsToDrop.has(prev) ? null : prev));
      }
      if (process.env.NODE_ENV !== "production") {
        console.debug("[simulation] upsertPlacements failed — rolled back", {
          error,
          droppedTempIds: Array.from(tempIdsToDrop),
        });
      }
      setToast(t("simulation.editor.saveFailed"));
      return;
    }
    setSavePillStatus("saved");
    // ── Success path — swap tmp_ ids for server UUIDs in-place ──
    if (!serverRows || serverRows.length === 0) return;
    // Match sent tmp_ rows to returned server rows by
    // (artworkId, xCm, yCm) — the tuple is stable across the trip
    // and only ambiguous when the user places two identical works
    // at the exact same coordinates in one flush window (extremely
    // rare, and even then the wrong-order id swap still points at a
    // valid server row for the same artwork).
    const tmpQueueByKey = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.id.startsWith("tmp_")) continue;
      const key = `${row.artworkId}|${row.xCm.toFixed(2)}|${row.yCm.toFixed(2)}`;
      const q = tmpQueueByKey.get(key) ?? [];
      q.push(row.id);
      tmpQueueByKey.set(key, q);
    }
    const idSwaps = new Map<string, string>();
    for (const s of serverRows) {
      // Only care about rows we actually just inserted. Update
      // responses will match our original UUID, so skip them.
      const key = `${s.artworkId}|${s.xCm.toFixed(2)}|${s.yCm.toFixed(2)}`;
      const q = tmpQueueByKey.get(key);
      if (!q || q.length === 0) continue;
      const tmp = q.shift();
      if (tmp) idSwaps.set(tmp, s.id);
    }
    if (idSwaps.size === 0) return;
    setState((prev) => {
      if (!prev) return prev;
      const nextPlacements = prev.space.placements.map((p) => {
        const swap = idSwaps.get(p.id);
        return swap ? { ...p, id: swap } : p;
      });
      return { ...prev, space: { ...prev.space, placements: nextPlacements } };
    });
    setSelectedId((prev) => (prev && idSwaps.has(prev) ? idSwaps.get(prev)! : prev));
    // If any of the swapped-id placements got mutated again between
    // "start of flush" and "response", they'll still be tracked under
    // their tmp_ key in `dirtyPlacements` — re-key those under the
    // new UUID so the next flush updates rather than re-inserts.
    for (const [tmp, real] of idSwaps) {
      const stillDirty = dirtyPlacements.current.get(tmp);
      if (stillDirty) {
        dirtyPlacements.current.delete(tmp);
        dirtyPlacements.current.set(real, { ...stillDirty, id: real });
      }
    }
    // ── Phase 3 auto-crop hook (Part 3) — fire silent Track 1 for
    // any newly-inserted placement whose artwork has no cutout yet.
    // Fired by artworkId (not placement id) so the callback doesn't
    // need to re-lookup the placement in the freshly-mutated state.
    const artworkIdsForAutoCrop = new Set<string>();
    for (const row of rows) {
      if (row.id.startsWith("tmp_")) artworkIdsForAutoCrop.add(row.artworkId);
    }
    for (const artworkId of artworkIdsForAutoCrop) {
      maybeAutoCropRef.current?.(artworkId);
    }
  }, [state, t]);

  const scheduleFlush = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void flushPlacements();
    }, PERSIST_DEBOUNCE_MS);
  }, [flushPlacements]);

  const pushHistory = useCallback(() => {
    if (!state) return;
    const snapshot = state.space.placements.map((p) => ({ ...p }));
    undoStack.current.push(snapshot);
    if (undoStack.current.length > UNDO_LIMIT) {
      undoStack.current.shift();
    }
    redoStack.current = [];
  }, [state]);

  const applyPlacements = useCallback(
    (next: ScenePlacement[]) => {
      setState((prev) =>
        prev ? { ...prev, space: { ...prev.space, placements: next } } : prev,
      );
    },
    [],
  );

  const mutatePlacement = useCallback(
    (placementId: string, patch: Partial<ScenePlacement>, markDirty = true) => {
      pushHistory();
      setState((prev) => {
        if (!prev) return prev;
        const next = prev.space.placements.map((p) =>
          p.id === placementId ? { ...p, ...patch } : p,
        );
        if (markDirty) {
          const updated = next.find((p) => p.id === placementId);
          if (updated) dirtyPlacements.current.set(placementId, updated);
        }
        return { ...prev, space: { ...prev.space, placements: next } };
      });
      if (markDirty) scheduleFlush();
    },
    [pushHistory, scheduleFlush],
  );

  // ── Snap helpers ─────────────────────────────────────────────
  const computeSnappedPosition = useCallback(
    (
      placement: ScenePlacement,
      candidateX: number,
      candidateY: number,
    ): { x: number; y: number; hints: SnapHint[] } => {
      const hints: SnapHint[] = [];
      const height = placement.heightCm ?? 0;
      let snappedX = candidateX;
      let snappedY = candidateY;

      // Eye level snap on the horizontal center-line.
      if (Math.abs(candidateY - EYE_LEVEL_CM) <= SNAP_TOLERANCE_CM) {
        snappedY = EYE_LEVEL_CM;
        hints.push({ type: "eyeLevel", atCm: EYE_LEVEL_CM });
      }

      const siblings = (state?.space.placements ?? []).filter(
        (p) => p.id !== placement.id,
      );
      for (const sib of siblings) {
        const sWidth = sib.widthCm ?? 0;
        const sHeight = sib.heightCm ?? 0;
        const sTop = sib.yCm - sHeight / 2;
        const sBottom = sib.yCm + sHeight / 2;
        const myTop = candidateY - height / 2;
        const myBottom = candidateY + height / 2;

        if (Math.abs(myTop - sTop) <= SNAP_TOLERANCE_CM) {
          snappedY = sTop + height / 2;
          hints.push({ type: "siblingTop", atCm: sTop });
        }
        if (Math.abs(myBottom - sBottom) <= SNAP_TOLERANCE_CM) {
          snappedY = sBottom - height / 2;
          hints.push({ type: "siblingBottom", atCm: sBottom });
        }
        if (Math.abs(candidateY - sib.yCm) <= SNAP_TOLERANCE_CM) {
          snappedY = sib.yCm;
          hints.push({ type: "siblingCenterY", atCm: sib.yCm });
        }
        if (Math.abs(candidateX - sib.xCm) <= SNAP_TOLERANCE_CM) {
          snappedX = sib.xCm;
          hints.push({ type: "siblingCenterX", atCm: sib.xCm });
        }
        void sWidth; // reserved for symmetric X snapping in a future pass
      }
      return { x: snappedX, y: snappedY, hints };
    },
    [state],
  );

  // ── Drag handling ────────────────────────────────────────────
  const onOverlayPointerDown = useCallback(
    (placement: ScenePlacement, surface: SceneSurface, e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (!primarySurface || !imgRef.current) return;
      setSelectedId(placement.id);
      const rect = imgRef.current.getBoundingClientRect();
      const local = computeSurfaceLocalPx(surface, {
        w: rect.width,
        h: rect.height,
      });
      dragRef.current = {
        placementId: placement.id,
        surfaceId: surface.id,
        startPointerX: e.clientX,
        startPointerY: e.clientY,
        startXCm: placement.xCm,
        startYCm: placement.yCm,
        pxPerCm: local.pxPerCm,
      };
      pushHistory();
      setDragPlacementId(placement.id);
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [primarySurface, pushHistory],
  );

  const onOverlayPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dxPx = e.clientX - drag.startPointerX;
      const dyPx = e.clientY - drag.startPointerY;
      // The homography squishes uniformly for typical eye-level room
      // photos; we approximate cm-per-image-pixel by inverting the
      // surface's on-photo top-edge pxPerCm scale. Precise inverse
      // homography would give a more perspective-correct feel but the
      // approximation is close enough for the P1 drag UX.
      const dxCm = pxToCm(dxPx, drag.pxPerCm);
      const dyCm = pxToCm(dyPx, drag.pxPerCm);
      const state = stateRef.current;
      if (!state) return;
      const placement = state.space.placements.find(
        (p) => p.id === drag.placementId,
      );
      if (!placement) return;
      const { x, y, hints } = computeSnappedPosition(
        placement,
        drag.startXCm + dxCm,
        drag.startYCm + dyCm,
      );
      setSnapHints(hints);
      const next = state.space.placements.map((p) =>
        p.id === drag.placementId ? { ...p, xCm: x, yCm: y } : p,
      );
      applyPlacements(next);
    },
    [applyPlacements, computeSnappedPosition],
  );

  const onOverlayPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* best-effort */
      }
      const state = stateRef.current;
      const placement = state?.space.placements.find(
        (p) => p.id === drag.placementId,
      );
      if (placement) {
        dirtyPlacements.current.set(placement.id, placement);
        scheduleFlush();
      }
      dragRef.current = null;
      setDragPlacementId(null);
      setSnapHints([]);
    },
    [scheduleFlush],
  );

  const stateRef = useRef<EditorState | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ── Actions ──────────────────────────────────────────────────
  const handleTitleBlur = useCallback(async () => {
    if (!state) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === state.space.title) return;
    await updateSpace(state.space.id, { title: trimmed });
    setState((prev) =>
      prev ? { ...prev, space: { ...prev.space, title: trimmed } } : prev,
    );
  }, [state, titleDraft]);

  const handleShare = useCallback(() => {
    if (!state) return;
    const url = `${window.location.origin}/space/${state.space.shareToken}`;
    void navigator.clipboard.writeText(url).then(
      () => setToast(t("simulation.editor.share.copied")),
      () => setToast(t("simulation.errors.generic")),
    );
  }, [state, t]);

  const handleExport = useCallback(async () => {
    if (!state) return;
    setExportBusy(true);
    try {
      const result = await exportSpace(state.space.id, { mode: "share" });
      await navigator.clipboard.writeText(result.url).catch(() => undefined);
      setToast(t("simulation.editor.share.copied"));
    } catch (err) {
      if (err instanceof SimulationEntitlementError) {
        setToast(t("simulation.errors.entitlementExport"));
      } else {
        setToast(t("simulation.errors.generic"));
      }
    } finally {
      setExportBusy(false);
    }
  }, [state, t]);

  /**
   * Shared AI space-calibrate invocation. Renders one candidate card
   * on success and reports back so callers can pick their own error
   * copy (upload path stays silent; retrigger path surfaces a
   * "couldn't find" toast so the user knows the button did fire).
   *
   * Guardrails (mime allowlist, non-zero photo dims) live here so
   * the two entry points (post-upload + manual retrigger) stay in
   * sync. `setCalibrateBusy` toggles a lock so the manual button
   * can't stack requests.
   */
  const runAiCalibration = useCallback(
    async (input: {
      file: File;
      imagePxWidth: number;
      imagePxHeight: number;
      spaceId: string;
      mode: "upload" | "retrigger";
    }): Promise<{ ok: boolean; empty: boolean }> => {
      if (input.imagePxWidth <= 0 || input.imagePxHeight <= 0) {
        return { ok: false, empty: true };
      }
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(input.file.type)
      ) {
        return { ok: false, empty: true };
      }
      setCalibrateBusy(true);
      setToast(
        t(
          input.mode === "retrigger"
            ? "simulation.calibrate.retriggering"
            : "simulation.calibrate.detecting",
        ),
      );
      try {
        const base64 = await fileToBase64(input.file);
        const res = await aiApi.spaceCalibrate({
          spaceId: input.spaceId,
          imageBase64: base64,
          mime: input.file.type,
          imagePxWidth: input.imagePxWidth,
          imagePxHeight: input.imagePxHeight,
        });
        if (res.candidates.length > 0) {
          setCalibrateCandidates(res.candidates);
          setCalibrateIdx(0);
          setCalibrateInputCm("");
          setToast(null);
          return { ok: true, empty: false };
        }
        // Degraded / empty. Upload path stays silent (the manual
        // "직접 재기" entry point in the accordion is always visible);
        // retrigger path tells the user AI didn't find anything so
        // the button press isn't perceived as broken.
        setToast(
          input.mode === "retrigger"
            ? t("simulation.calibrate.retriggerEmpty")
            : null,
        );
        if (process.env.NODE_ENV !== "production") {
          console.debug("[simulation] calibrate empty/degraded", res);
        }
        return { ok: false, empty: true };
      } catch (err) {
        setToast(
          input.mode === "retrigger"
            ? t("simulation.calibrate.retriggerEmpty")
            : null,
        );
        if (process.env.NODE_ENV !== "production") {
          console.debug("[simulation] calibrate failed", err);
        }
        return { ok: false, empty: true };
      } finally {
        setCalibrateBusy(false);
      }
    },
    [t],
  );

  /**
   * Re-fire the AI calibration for a space whose photo is already on
   * disk (either uploaded before the AI feature landed OR after the
   * user dismissed the initial card). Fetches the working WebP copy,
   * repackages it as a `File`, and hands off to `runAiCalibration`.
   *
   * Guarded by the caller — this helper doesn't check the "already
   * calibrated" condition so it stays reusable for both the auto-fire
   * useEffect and the manual "AI로 스케일 다시 감지" button.
   */
  const runAiCalibrationFromCurrentPhoto = useCallback(
    async (mode: "upload" | "retrigger"): Promise<{ ok: boolean; empty: boolean }> => {
      if (!state) return { ok: false, empty: true };
      const url = spacePhotoUrl(state.space.photoStoragePath);
      if (!url) return { ok: false, empty: true };
      const pxW = state.space.photoWidthPx ?? 0;
      const pxH = state.space.photoHeightPx ?? 0;
      if (pxW <= 0 || pxH <= 0) return { ok: false, empty: true };
      try {
        const resp = await fetch(url);
        if (!resp.ok) return { ok: false, empty: true };
        const blob = await resp.blob();
        // Storage sets content-type to image/webp for the display copy.
        // Fall back to webp when the response omits it (some CDN edges).
        const mime = blob.type || "image/webp";
        const file = new File([blob], "space-photo", { type: mime });
        return await runAiCalibration({
          file,
          imagePxWidth: pxW,
          imagePxHeight: pxH,
          spaceId: state.space.id,
          mode,
        });
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[simulation] retrigger fetch failed", err);
        }
        if (mode === "retrigger") {
          setToast(t("simulation.calibrate.retriggerEmpty"));
        }
        return { ok: false, empty: true };
      }
    },
    [state, runAiCalibration, t],
  );

  /**
   * P1 (2026-08-19) — Automatic wall-region cleanup pass.
   *
   * Runs BETWEEN upload and AI scale detect (`runAiCalibration`) so
   * every downstream step — including object detection — operates on
   * the cleaned image. The pipeline is intentionally forgiving:
   * anything that fails silently (no vision key, low confidence,
   * degenerate polygon, canvas throw) simply returns and the caller
   * continues with the original photo. Users never see a "cleanup
   * failed" error — cleanup is a "value-add" pass, not a gate.
   *
   * Detailed flow:
   *   1. Prepare the vision payload (768 px longest-edge JPEG, base64).
   *   2. Fire `POST /api/ai/space-wall-detect`.
   *   3. If `confidence >= 0.4` AND the polygon has ≥ 3 vertices,
   *      run `cleanupWallRegion` on the NATIVE-RES original blob.
   *   4. Upload the cleaned blob as `photo_cleaned.jpg` and swap
   *      `photo_storage_path` to point at it.
   *   5. Reload the space so the editor picks up the new path
   *      (dimensions unchanged — placements stay in place).
   *
   * The processing toast auto-clears on completion regardless of
   * whether the cleanup applied — a silent skip is preferable to a
   * lingering "still processing" spinner when the model bails.
   */
  const runWallCleanup = useCallback(
    async (input: {
      file: File;
      imagePxWidth: number;
      imagePxHeight: number;
      spaceId: string;
    }): Promise<{ applied: boolean; cleanedFile: File | null }> => {
      if (input.imagePxWidth <= 0 || input.imagePxHeight <= 0) {
        return { applied: false, cleanedFile: null };
      }
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(input.file.type)
      ) {
        return { applied: false, cleanedFile: null };
      }
      setToast(t("simulation.wallCleanup.processing"));
      try {
        const base64 = await fileToBase64(input.file);
        const res = await aiApi.spaceWallDetect({
          spaceId: input.spaceId,
          imageBase64: base64,
          mime: input.file.type,
          imagePxWidth: input.imagePxWidth,
          imagePxHeight: input.imagePxHeight,
        });
        if (res.confidence < 0.4 || res.wallPolygon.length < 3) {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[simulation] wall cleanup skipped", {
              confidence: res.confidence,
              polygonPoints: res.wallPolygon.length,
              degraded: res.degraded,
              reason: res.reason,
            });
          }
          setToast(null);
          setWallCleanupNotice({ kind: "skipped-low" });
          return { applied: false, cleanedFile: null };
        }
        const cleanup = await cleanupWallRegion({
          originalBlob: input.file,
          wallPolygon: res.wallPolygon,
          wallMedianRgb: res.wallMedianRgb,
          imageWidth: input.imagePxWidth,
          imageHeight: input.imagePxHeight,
        });
        if (!cleanup.applied) {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[simulation] wall cleanup coverage-skipped", {
              maskCoverage: cleanup.maskCoverage,
            });
          }
          setToast(null);
          setWallCleanupNotice({ kind: "skipped-coverage" });
          return { applied: false, cleanedFile: null };
        }
        const swap = await replaceSpacePhotoWithCleaned(
          input.spaceId,
          cleanup.cleanedBlob,
        );
        if (swap.error) {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[simulation] wall cleanup swap failed", swap.error);
          }
          setToast(null);
          setWallCleanupNotice({ kind: "skipped-error" });
          return { applied: false, cleanedFile: null };
        }
        // Phase 2 (2026-08-20) — persist the wall-detect
        // `lightDirection` onto the primary surface's `pose` blob so
        // downstream renderers (mount shadow direction) can read a
        // consistent value across editor + share view. `pose` is
        // schemaless jsonb; we merge in place to avoid stomping
        // any other keys that later features may add.
        try {
          const primary = state?.space.surfaces[0];
          if (primary?.id) {
            const nextPose = {
              ...(primary.pose ?? {}),
              lightDirection: res.lightDirection,
            };
            await updateSurface(
              primary.id,
              { pose: nextPose },
              { spaceIdForTouch: input.spaceId },
            );
          }
        } catch (poseErr) {
          if (process.env.NODE_ENV !== "production") {
            console.debug(
              "[simulation] wall cleanup pose persist skipped",
              poseErr,
            );
          }
        }
        await load();
        setWallCleanupNotice(null);
        setToast(t("simulation.wallCleanup.done"));
        if (process.env.NODE_ENV !== "production") {
          console.debug("[simulation] wall cleanup applied", {
            spaceId: input.spaceId,
            maskCoverage: cleanup.maskCoverage,
            confidence: res.confidence,
            lightDirection: res.lightDirection,
            polygonPoints: res.wallPolygon.length,
          });
        }
        // Wrap the cleaned Blob as a File so the downstream calibrator
        // can process it with the same runAiCalibration path used for
        // fresh uploads. The `name` is arbitrary — the vision route
        // only reads `type` + `imageBase64`.
        const cleanedFile = new File(
          [cleanup.cleanedBlob],
          "space-cleaned.jpg",
          { type: "image/jpeg" },
        );
        return { applied: true, cleanedFile };
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[simulation] wall cleanup failed", err);
        }
        setToast(null);
        setWallCleanupNotice({ kind: "skipped-error" });
        return { applied: false, cleanedFile: null };
      }
    },
    [load, t],
  );

  /**
   * P1 (2026-08-19 hot-fix) — Re-fire the wall-cleanup pipeline for
   * a space whose photo is already on disk. Two callers:
   *
   *   1. Auto-fire useEffect on mount, when the space has a photo
   *      but no cleaned variant yet. Covers users who uploaded before
   *      d5775f7 landed AND uploads whose cleanup silently skipped
   *      (low confidence / degraded polygon / coverage guard).
   *   2. Manual "벽 정돈 다시 실행" button in the advanced accordion.
   *
   * We prefer the ORIGINAL storage path (`photo_original.<ext>`) as
   * the source blob so we never process an already-cleaned image
   * twice. Falls back to the display copy when the original wasn't
   * kept (rare — every `uploadSpacePhoto` since c1333e6 saves both).
   */
  const runWallCleanupFromCurrentPhoto = useCallback(
    async (mode: "auto" | "manual"): Promise<{ applied: boolean }> => {
      if (!state) return { applied: false };
      // Prefer original; fall back to display copy when it's missing.
      const path =
        state.space.photoOriginalStoragePath ?? state.space.photoStoragePath;
      const url = spacePhotoUrl(path);
      if (!url) return { applied: false };
      const pxW = state.space.photoWidthPx ?? 0;
      const pxH = state.space.photoHeightPx ?? 0;
      if (pxW <= 0 || pxH <= 0) return { applied: false };
      setWallCleanupBusy(true);
      try {
        const resp = await fetch(url);
        if (!resp.ok) return { applied: false };
        const blob = await resp.blob();
        // Storage sets content-type per the upload; the vision route
        // only accepts JPEG / PNG / WebP so coerce anything unusual
        // (e.g. HEIC saved as octet-stream) to webp which is the
        // universally-supported display copy encoding.
        let mime = blob.type || "image/webp";
        if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
          mime = "image/webp";
        }
        const file = new File([blob], "space-photo", { type: mime });
        const result = await runWallCleanup({
          file,
          imagePxWidth: pxW,
          imagePxHeight: pxH,
          spaceId: state.space.id,
        });
        if (mode === "manual" && !result.applied) {
          // Manual button — always surface SOME feedback so the user
          // knows the button fired. `runWallCleanup` clears the toast
          // on skip (which is intentional for the silent upload path).
          setToast(t("simulation.wallCleanup.skipped"));
        }
        return { applied: result.applied };
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[simulation] wall cleanup retrigger failed", err);
        }
        if (mode === "manual") {
          setToast(t("simulation.wallCleanup.skipped"));
        }
        return { applied: false };
      } finally {
        setWallCleanupBusy(false);
      }
    },
    [state, runWallCleanup, t],
  );

  const handleManualWallCleanupRetry = useCallback(async () => {
    if (wallCleanupBusy) return;
    await runWallCleanupFromCurrentPhoto("manual");
  }, [wallCleanupBusy, runWallCleanupFromCurrentPhoto]);

  // Auto-fire wall cleanup on mount for spaces whose current display
  // photo has NOT been cleaned yet. Marker: photoStoragePath ends
  // with the `photo_cleaned.jpg` suffix (`replaceSpacePhotoWithCleaned`
  // writes exactly this path). No marker → cleanup either never ran
  // (pre-d5775f7 upload) or silently skipped. We re-attempt once per
  // space per session so a truly un-cleanable photo doesn't loop.
  //
  // Guards (all must hold):
  //   • space has a photo (path + non-zero native dims)
  //   • current display path is NOT already a cleaned variant
  //   • cleanup isn't already running (upload path)
  //   • auto-retrigger hasn't fired for this space id yet
  useEffect(() => {
    if (!state) return;
    if (uploadBusy) return;
    if (wallCleanupBusy) return;
    if (!state.space.photoStoragePath) return;
    if (!state.space.photoWidthPx || !state.space.photoHeightPx) return;
    if (state.space.photoStoragePath.endsWith("/photo_cleaned.jpg")) return;
    if (autoWallCleanupFiredRef.current === state.space.id) return;
    autoWallCleanupFiredRef.current = state.space.id;
    void runWallCleanupFromCurrentPhoto("auto");
  }, [state, uploadBusy, wallCleanupBusy, runWallCleanupFromCurrentPhoto]);

  const handleUploadPhoto = useCallback(
    async (file: File) => {
      if (!state) return;
      // Snapshot the "already calibrated?" decision BEFORE the upload
      // reload rewrites `state`. We only want AI to run on a truly
      // fresh space, so a photo replacement on an already-corrected
      // wall keeps the user's calibration untouched. Reading from
      // `state` (pre-load) is intentional.
      const hadCorners = Boolean(
        state.space.surfaces[0]?.photoCorners,
      );
      const hadWallDims = Boolean(state.space.surfaces[0]?.widthCm);
      // Both auto-effects are keyed by space id — mark them as
      // "handled by the upload path" so the load() below doesn't
      // race them into firing a redundant second pass.
      autoWallCleanupFiredRef.current = state.space.id;
      // Fresh photo → clear any stale "cleanup skipped" notice from the
      // previous upload so the collector doesn't stare at a warning
      // that belongs to a discarded photo.
      setWallCleanupNotice(null);
      setUploadBusy(true);
      try {
        const upload = await uploadSpacePhoto(state.space.id, file);
        await load();

        // Wall cleanup runs BEFORE scale detect so both the user's
        // first look at the space AND the vision-based calibrator see
        // the tidied photo. Cleanup is auto-fire (no toggle), fails
        // open silently, and preserves the original at
        // `photo_original_storage_path` for the "원본 사용" toggle.
        //
        // We only route the ORIGINAL File (native resolution) into
        // cleanup — the browser's compressed WebP display copy is
        // adequate for calibration but throws away the fidelity we
        // want to preserve on the cleanup output. The vision route
        // encodes its own 768 px thumbnail from `file` for detection
        // (client-side `prepareImageForVision` isn't used here yet —
        // the base64 payload is derived below).
        const cleanup = await runWallCleanup({
          file,
          imagePxWidth: upload.widthPx,
          imagePxHeight: upload.heightPx,
          spaceId: state.space.id,
        });

        // Guard: only trigger AI on a truly first-time upload for this
        // surface. Already-calibrated spaces (either photoCorners set
        // via the advanced corner picker OR widthCm already persisted
        // via AI / manual measure) are left alone so re-uploads never
        // overwrite the user's confirmed scale.
        if (hadCorners || hadWallDims) return;
        if (!aiCalibrationEnabled) return;

        // Mark auto-fire as consumed so the mount-triggered effect
        // doesn't double-fire against the same photo after `load()`
        // repopulates the state we just uploaded to.
        autoCalibrateFiredRef.current = state.space.id;
        // Prefer the CLEANED variant for object detection when
        // cleanup ran — a photo with flat, even lighting confuses the
        // vision model less than one with harsh shadow gradients. When
        // cleanup skipped (low confidence, degraded, coverage guard),
        // fall back to the raw file so the calibrator still fires.
        await runAiCalibration({
          file: cleanup.cleanedFile ?? file,
          imagePxWidth: upload.widthPx,
          imagePxHeight: upload.heightPx,
          spaceId: state.space.id,
          mode: "upload",
        });
      } catch {
        setToast(t("simulation.errors.uploadFailed"));
      } finally {
        setUploadBusy(false);
      }
    },
    [state, load, t, aiCalibrationEnabled, runAiCalibration, runWallCleanup],
  );

  /**
   * Manual "AI로 스케일 다시 감지" trigger. Wired to the accordion
   * button; also invoked by the auto-fire useEffect below. Kept as a
   * thin wrapper so the button + effect share the exact same guards.
   */
  const handleManualAiRetrigger = useCallback(async () => {
    if (calibrateBusy) return;
    await runAiCalibrationFromCurrentPhoto("retrigger");
  }, [calibrateBusy, runAiCalibrationFromCurrentPhoto]);

  // Auto-fire AI calibration ONCE per space when the editor mounts on
  // a space that has a photo but no scale yet. This covers users who
  // uploaded before commit c1333e6 (AI feature landed) — without the
  // effect they'd never see the card unless they replace the photo.
  //
  // Guards (all must hold):
  //   • AI calibration pref is on
  //   • space has a photo (path + non-zero native dims)
  //   • primary surface exists but has neither widthCm nor photoCorners
  //   • auto-fire hasn't already run for this space id
  //   • no candidate card currently rendered (would be double-work)
  //
  // `autoCalibrateFiredRef` is keyed by space id so navigating from
  // one space editor to another still fires once per space, while
  // re-renders on the same space never re-fire.
  useEffect(() => {
    if (!state) return;
    if (!aiCalibrationEnabled) return;
    if (calibrateBusy) return;
    if (calibrateCandidates.length > 0) return;
    const surface = state.space.surfaces[0];
    if (!surface) return;
    if (surface.widthCm != null || surface.photoCorners != null) return;
    if (!state.space.photoStoragePath) return;
    if (!state.space.photoWidthPx || !state.space.photoHeightPx) return;
    if (autoCalibrateFiredRef.current === state.space.id) return;
    autoCalibrateFiredRef.current = state.space.id;
    void runAiCalibrationFromCurrentPhoto("upload");
  }, [
    state,
    aiCalibrationEnabled,
    calibrateBusy,
    calibrateCandidates.length,
    runAiCalibrationFromCurrentPhoto,
  ]);

  const handleDeleteSelected = useCallback(async () => {
    if (!state || !selectedId) return;
    const placement = state.space.placements.find((p) => p.id === selectedId);
    if (!placement) return;
    pushHistory();
    applyPlacements(state.space.placements.filter((p) => p.id !== selectedId));
    dirtyPlacements.current.delete(selectedId);
    setSelectedId(null);
    if (!selectedId.startsWith("tmp_")) {
      await deletePlacementRow(selectedId, { spaceIdForTouch: state.space.id });
    }
  }, [state, selectedId, pushHistory, applyPlacements]);

  // ─────────────────────────────────────────────────────────────
  // Phase 3 (2026-08-19) — auto-background Track 1 machinery.
  //
  // Trigger: whenever `flushPlacements` lands a fresh server row for
  // an artwork whose `state.artworks` bag has no cutout yet. We fire
  // Track 1 (free Vision bbox) fire-and-forget, then, on success:
  //   1. re-fetch just that artwork's thumb (NOT the whole space —
  //      avoids the Phase 2 "page refresh" feel);
  //   2. patch `state.artworks` in place so the renderer picks up
  //      the new cutout URL (`renderScene2D` already prefers
  //      cutoutAlpha > cutout > primary);
  //   3. snap the placement's cm rect to the cutout's aspect using
  //      the same "keep long axis" rule the inspector's
  //      aspect-mismatch card uses.
  //
  // Guardrails:
  //   • In-flight dedupe via `autoCropInFlightRef` — shared with the
  //     bulk cleanup path so a manual "여백 일괄 정리" click never
  //     double-fires against a background job.
  //   • Failure cache (`abstract:sim:autocrop:failed` in
  //     localStorage) with a 30-min TTL so we don't burn tokens on
  //     an artwork that consistently trips the "low confidence" or
  //     "decode failed" branch.
  //   • Silent: no toast on failure, `console.debug` only. Success
  //     fires a subtle low-corner "여백 자동 정리됨" toast that sits
  //     opposite the top-right SavePill.
  // ─────────────────────────────────────────────────────────────

  const autoCropInFlightRef = useRef<Set<string>>(new Set());
  // Phase 3 (2026-08-19) — dedicated low-corner "여백 자동 정리됨"
  // toast so it doesn't sit under the SavePill (top-right) or the
  // primary bottom-center toast used for save errors / manual CTA
  // status. Auto-fades after 2 s.
  const [autoCropToast, setAutoCropToast] = useState<string | null>(null);
  useEffect(() => {
    if (!autoCropToast) return;
    const h = setTimeout(() => setAutoCropToast(null), 2000);
    return () => clearTimeout(h);
  }, [autoCropToast]);

  const readAutoCropFailedCache = useCallback((): Record<string, number> => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(AUTOCROP_FAILED_LS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, number>;
      const now = Date.now();
      let mutated = false;
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "number" && v > now) cleaned[k] = v;
        else mutated = true;
      }
      if (mutated) {
        try {
          window.localStorage.setItem(
            AUTOCROP_FAILED_LS_KEY,
            JSON.stringify(cleaned),
          );
        } catch {
          /* quota — best-effort */
        }
      }
      return cleaned;
    } catch {
      return {};
    }
  }, []);

  const writeAutoCropFailed = useCallback(
    (artworkId: string) => {
      if (typeof window === "undefined") return;
      const cache = readAutoCropFailedCache();
      cache[artworkId] = Date.now() + AUTOCROP_FAILED_TTL_MS;
      try {
        window.localStorage.setItem(
          AUTOCROP_FAILED_LS_KEY,
          JSON.stringify(cache),
        );
      } catch {
        /* quota — best-effort */
      }
    },
    [readAutoCropFailedCache],
  );

  /**
   * "Keep long axis" aspect snap — mirrors
   * `applyFitToImage("long")` in the inspector's aspect-mismatch
   * card. Given a placement's current cm rect and a cutout's pixel
   * aspect, returns the new cm rect that freezes the longer side
   * and derives the shorter from the aspect. Returns null when
   * inputs are degenerate (missing dims / non-positive aspect).
   */
  function snapPlacementToCutoutAspect(
    widthCm: number | null,
    heightCm: number | null,
    cutoutPxW: number | null,
    cutoutPxH: number | null,
  ): { widthCm: number; heightCm: number } | null {
    if (
      widthCm == null ||
      heightCm == null ||
      widthCm <= 0 ||
      heightCm <= 0 ||
      cutoutPxW == null ||
      cutoutPxH == null ||
      cutoutPxW <= 0 ||
      cutoutPxH <= 0
    ) {
      return null;
    }
    const imgAspect = cutoutPxW / cutoutPxH;
    const widthIsLonger = widthCm >= heightCm;
    const nextWidth = widthIsLonger ? widthCm : heightCm * imgAspect;
    const nextHeight = widthIsLonger ? widthCm / imgAspect : heightCm;
    if (
      !Number.isFinite(nextWidth) ||
      !Number.isFinite(nextHeight) ||
      nextWidth <= 0 ||
      nextHeight <= 0
    ) {
      return null;
    }
    return {
      widthCm: Number(nextWidth.toFixed(2)),
      heightCm: Number(nextHeight.toFixed(2)),
    };
  }

  /**
   * Refresh a single artwork's scene-thumb in `state.artworks` and,
   * if the fresh thumb carries a new cutout, snap every placement
   * that references it to the cutout's aspect. Used by both the
   * silent auto-crop path and the existing manual CTAs (which used
   * to `await load()` — Phase 3 replaces those with this lighter
   * per-artwork refetch).
   */
  const refreshArtworkThumb = useCallback(
    async (artworkId: string) => {
      const { data: thumb } = await getArtworkSceneThumb(artworkId, { locale });
      if (!thumb) return;
      setState((prev) => {
        if (!prev) return prev;
        const nextArtworks = new Map(prev.artworks);
        nextArtworks.set(artworkId, thumb);
        // Aspect-snap: only when a NEW cutout arrived (i.e. we
        // didn't already have one before this refresh). Reads the
        // OLD map so we don't re-snap on every refresh.
        const oldThumb = prev.artworks.get(artworkId);
        const hadCutout = Boolean(
          oldThumb?.cutoutImageUrl || oldThumb?.cutoutAlphaImageUrl,
        );
        const hasCutout = Boolean(
          thumb.cutoutImageUrl || thumb.cutoutAlphaImageUrl,
        );
        if (!hadCutout && hasCutout) {
          const cutoutPxW =
            thumb.cutoutAlphaImagePxWidth ?? thumb.cutoutImagePxWidth ?? null;
          const cutoutPxH =
            thumb.cutoutAlphaImagePxHeight ?? thumb.cutoutImagePxHeight ?? null;
          const nextPlacements = prev.space.placements.map((p) => {
            if (p.artworkId !== artworkId) return p;
            const snap = snapPlacementToCutoutAspect(
              p.widthCm,
              p.heightCm,
              cutoutPxW,
              cutoutPxH,
            );
            if (!snap) return p;
            const next = { ...p, ...snap };
            // Queue for the next flush so the aspect snap lands in
            // the DB (dragging / re-selecting doesn't re-snap
            // because the aspect will already match).
            dirtyPlacements.current.set(next.id, next);
            return next;
          });
          scheduleFlush();
          return {
            ...prev,
            artworks: nextArtworks,
            space: { ...prev.space, placements: nextPlacements },
          };
        }
        return { ...prev, artworks: nextArtworks };
      });
    },
    [locale, scheduleFlush],
  );

  /**
   * Silent background Track 1 for a single artwork. No-op unless
   * the artwork lacks BOTH cutout variants, is not currently
   * in-flight, and is not on the 30-min failure cache. Always
   * resolves — errors are swallowed to `console.debug`.
   *
   * Takes an artworkId (not a placement id) so the caller can fire
   * it right after the flush swap without waiting for React's
   * batched state commit — the artwork thumb map is the source of
   * truth for "has cutout" regardless of placement id ordering.
   */
  const runAutoCropForArtwork = useCallback(
    async (artworkId: string) => {
      const s = stateRef.current;
      if (!s) return;
      const artwork = s.artworks.get(artworkId);
      if (!artwork?.imageUrl) return;
      if (artwork.cutoutImageUrl || artwork.cutoutAlphaImageUrl) return;
      if (autoCropInFlightRef.current.has(artworkId)) return;
      const failedCache = readAutoCropFailedCache();
      if (failedCache[artworkId]) return;
      autoCropInFlightRef.current.add(artworkId);
      try {
        const res = await runVisionBboxCrop({
          artworkId,
          imageUrl: artwork.imageUrl,
        });
        if (res.applied) {
          await refreshArtworkThumb(artworkId);
          setAutoCropToast(t("simulation.autocrop.tidied"));
        } else if (
          res.reason === "already_tight" ||
          res.reason === "low_confidence"
        ) {
          // Not a "true" failure — cache anyway so we don't retry on
          // every re-selection. `already_tight` is idempotent; the
          // primary image will keep rendering.
          writeAutoCropFailed(artworkId);
        } else {
          writeAutoCropFailed(artworkId);
          if (process.env.NODE_ENV !== "production") {
            console.debug("[simulation] auto-crop soft-failed", {
              artworkId,
              reason: res.reason,
            });
          }
        }
      } catch (err) {
        writeAutoCropFailed(artworkId);
        if (process.env.NODE_ENV !== "production") {
          console.debug("[simulation] auto-crop threw", err);
        }
      } finally {
        autoCropInFlightRef.current.delete(artworkId);
      }
    },
    [readAutoCropFailedCache, refreshArtworkThumb, t, writeAutoCropFailed],
  );

  // Wire `flushPlacements` -> `runAutoCropForArtwork` via a ref so
  // we don't cycle through the callback tree (flushPlacements would
  // otherwise pull runAutoCrop into its deps → change every render →
  // re-schedule the debounce).
  useEffect(() => {
    maybeAutoCropRef.current = (artworkId: string) => {
      void runAutoCropForArtwork(artworkId);
    };
  }, [runAutoCropForArtwork]);

  // Bulk cleanup dialog state (Part 4).
  const [bulkCropOpen, setBulkCropOpen] = useState(false);
  const [bulkCropRunning, setBulkCropRunning] = useState(false);
  const [bulkCropProgress, setBulkCropProgress] = useState<{
    done: number;
    total: number;
  }>({ done: 0, total: 0 });

  /**
   * Distinct artwork ids on this space that (a) have a placement,
   * (b) have no cutout yet, and (c) are not currently on the failure
   * cache — this is the queue the toolbar CTA will drain when the
   * user hits "여백 일괄 정리".
   */
  const bulkCropCandidates = useMemo<string[]>(() => {
    if (!state) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    const failedCache = readAutoCropFailedCache();
    for (const p of state.space.placements) {
      const art = state.artworks.get(p.artworkId);
      if (!art?.imageUrl) continue;
      if (art.cutoutImageUrl || art.cutoutAlphaImageUrl) continue;
      if (seen.has(p.artworkId)) continue;
      if (failedCache[p.artworkId]) continue;
      seen.add(p.artworkId);
      out.push(p.artworkId);
    }
    return out;
  }, [state, readAutoCropFailedCache]);

  /**
   * Drain the bulk-crop queue with a small parallelism (3) so we
   * don't hammer the Vision endpoint. Skips artworks already
   * in-flight (auto-crop). Progress state drives both the toolbar
   * button label and the confirm dialog's live counter.
   */
  const runBulkCrop = useCallback(async () => {
    const queue = bulkCropCandidates.filter(
      (id) => !autoCropInFlightRef.current.has(id),
    );
    if (queue.length === 0) {
      setBulkCropOpen(false);
      return;
    }
    setBulkCropRunning(true);
    setBulkCropProgress({ done: 0, total: queue.length });
    let doneCount = 0;
    let anyFailed = false;
    const CONCURRENCY = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const idx = cursor++;
        const artworkId = queue[idx];
        if (!artworkId) continue;
        // Feed the in-flight set so the auto-crop path doesn't
        // duplicate work if a placement change fires mid-drain.
        autoCropInFlightRef.current.add(artworkId);
        try {
          const s = stateRef.current;
          const art = s?.artworks.get(artworkId);
          if (!art?.imageUrl) {
            continue;
          }
          const res = await runVisionBboxCrop({
            artworkId,
            imageUrl: art.imageUrl,
          });
          if (res.applied) {
            await refreshArtworkThumb(artworkId);
          } else if (
            res.reason === "already_tight" ||
            res.reason === "low_confidence"
          ) {
            writeAutoCropFailed(artworkId);
          } else {
            writeAutoCropFailed(artworkId);
            anyFailed = true;
          }
        } catch (err) {
          writeAutoCropFailed(artworkId);
          anyFailed = true;
          if (process.env.NODE_ENV !== "production") {
            console.debug("[simulation] bulk-crop worker threw", err);
          }
        } finally {
          autoCropInFlightRef.current.delete(artworkId);
          doneCount += 1;
          setBulkCropProgress({ done: doneCount, total: queue.length });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () =>
        worker(),
      ),
    );
    setBulkCropRunning(false);
    setBulkCropOpen(false);
    setBulkCropProgress({ done: 0, total: 0 });
    if (anyFailed) {
      setToast(t("simulation.bulkCrop.failed"));
    } else {
      setToast(
        t("simulation.bulkCrop.done").replace(
          "{count}",
          String(queue.length),
        ),
      );
    }
  }, [bulkCropCandidates, refreshArtworkThumb, t, writeAutoCropFailed]);

  /**
   * Display Simulation Phase 2 (2026-08-20) — Track 1 auto-crop CTA.
   * Fires the free Vision bbox pipeline for the selected placement's
   * artwork and reloads so the renderer picks up the new `cutout`
   * sibling row. Refuses to re-run while another cutout job is in
   * flight for the same artwork.
   */
  const handleRunBboxCrop = useCallback(
    async (artworkId: string) => {
      if (!state) return;
      const artwork = state.artworks.get(artworkId);
      if (!artwork?.imageUrl) return;
      if (cutoutBusy) return;
      // Phase 3: dedupe against the silent auto-crop path.
      if (autoCropInFlightRef.current.has(artworkId)) return;
      autoCropInFlightRef.current.add(artworkId);
      setCutoutBusy({ artworkId, track: "bbox" });
      setToast(t("simulation.cutout.bbox.running"));
      try {
        const res = await runVisionBboxCrop({
          artworkId,
          imageUrl: artwork.imageUrl,
        });
        if (res.applied) {
          // 2026-08-19 (personal cutouts fix) — swap toast copy so
          // artists see "published for this artwork" and collectors
          // see "for your space". Falls back to the neutral key when
          // scope is unknown (older result shape / older server).
          const doneKey =
            res.cutoutScope === "global"
              ? "simulation.cutout.bbox.doneGlobal"
              : res.cutoutScope === "personal"
                ? "simulation.cutout.bbox.donePersonal"
                : "simulation.cutout.bbox.done";
          setToast(t(doneKey));
          // Phase 3: refresh just this artwork instead of the whole
          // scene — same aspect-snap path as the auto-fire.
          await refreshArtworkThumb(artworkId);
        } else if (res.reason === "already_tight") {
          setToast(t("simulation.cutout.bbox.alreadyTight"));
        } else if (res.reason === "low_confidence") {
          setToast(t("simulation.cutout.bbox.lowConfidence"));
        } else {
          setToast(t("simulation.cutout.bbox.failed"));
        }
      } finally {
        autoCropInFlightRef.current.delete(artworkId);
        setCutoutBusy(null);
      }
    },
    [state, cutoutBusy, refreshArtworkThumb, t],
  );

  /**
   * Display Simulation Phase 2 (2026-08-20) — Track 2 Photoroom CTA.
   * Server-side proxy call; on success the renderer prefers the new
   * `cutout_alpha` row (transparent PNG) so the painting composites
   * cleanly onto the wall photo.
   */
  const handleRunPhotoroomCutout = useCallback(
    async (artworkId: string) => {
      if (!state) return;
      if (cutoutBusy) return;
      setCutoutBusy({ artworkId, track: "alpha" });
      setToast(t("simulation.cutout.alpha.running"));
      try {
        const res = await runPhotoroomCutout({ artworkId });
        if (res.applied) {
          const doneKey =
            res.cutoutScope === "global"
              ? "simulation.cutout.alpha.doneGlobal"
              : res.cutoutScope === "personal"
                ? "simulation.cutout.alpha.donePersonal"
                : "simulation.cutout.alpha.done";
          setToast(t(doneKey));
          // Phase 3: refresh just this artwork.
          await refreshArtworkThumb(artworkId);
        } else if (res.reason === "not_configured") {
          setToast(t("simulation.cutout.alpha.notConfigured"));
        } else if (res.reason === "not_entitled") {
          setToast(t("simulation.cutout.alpha.notEntitled"));
        } else if (res.reason === "cap_reached") {
          setToast(t("simulation.cutout.alpha.capReached"));
        } else {
          setToast(t("simulation.cutout.alpha.failed"));
        }
      } finally {
        setCutoutBusy(null);
      }
    },
    [state, cutoutBusy, refreshArtworkThumb, t],
  );

  const handleDisplayUnit = useCallback(
    async (unit: DisplayUnit) => {
      setDisplayUnit(unit);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(DISPLAY_UNIT_LS_KEY, unit);
        } catch {
          /* localStorage disabled — best-effort */
        }
      }
      if (!state) return;
      // Persist the "cm | in" family flag on the space so the placement
      // inspector (which stays in cm/in for artwork sizes) picks the
      // matching column back up on next load.
      const family = displayUnitToSpaceUnit(unit);
      if (state.space.unit === family) return;
      setState((prev) =>
        prev ? { ...prev, space: { ...prev.space, unit: family } } : prev,
      );
      await updateSpace(state.space.id, { unit: family });
    },
    [state],
  );

  // Hydrate `displayUnit` on first load — prefer localStorage, then
  // fall back to the space's persisted cm/in family so a saved
  // "imperial" space defaults to "in" (not "cm") for a fresh browser.
  useEffect(() => {
    if (displayUnitInitialisedRef.current) return;
    if (!state) return;
    const fallback: DisplayUnit = state.space.unit === "in" ? "in" : "cm";
    setDisplayUnit(readInitialDisplayUnit(fallback));
    displayUnitInitialisedRef.current = true;
  }, [state]);

  /**
   * Picking an artwork no longer auto-places it — we defer placement
   * until the collector taps a location on the canvas. This keeps the
   * "just show me where to put it" mental model that the P1 feedback
   * called out: precision tools (wall calibration, dimensions inputs)
   * remain available, but the primary interaction is a single tap.
   */
  const handlePickArtwork = useCallback((artwork: PickerArtwork) => {
    setPickerOpen(false);
    setPendingArtwork(artwork);
    setSelectedId(null);
  }, []);

  /**
   * Convert an image-pixel point into surface-local centimetres. When
   * the surface has been calibrated (photo corners exist) we invert
   * the surface→image homography for a perspective-correct mapping;
   * otherwise we fall back to a linear map that treats the whole
   * photo as the wall — matches the fallback `FALLBACK_WALL_*_CM`
   * rendering path so first-time users get sensible placements.
   */
  const imagePxToWallCm = useCallback(
    (
      xImg: number,
      yImg: number,
      surface: SceneSurface | null,
    ): { xCm: number; yCm: number } => {
      const wallW = surface?.widthCm ?? FALLBACK_WALL_WIDTH_CM;
      const wallH = surface?.heightCm ?? FALLBACK_WALL_HEIGHT_CM;
      if (
        surface?.photoCorners &&
        homography &&
        imageBox.w > 0 &&
        imageBox.h > 0
      ) {
        const inverse = invertHomography(homography);
        const localPx = inverse
          ? applyHomography(inverse, [xImg, yImg])
          : null;
        if (localPx) {
          const local = computeSurfaceLocalPx(surface, imageBox);
          if (local.pxPerCm > 0) {
            return {
              xCm: localPx[0] / local.pxPerCm,
              yCm: localPx[1] / local.pxPerCm,
            };
          }
        }
      }
      const boxW = Math.max(imageBox.w, 1);
      const boxH = Math.max(imageBox.h, 1);
      return {
        xCm: (xImg / boxW) * wallW,
        yCm: (yImg / boxH) * wallH,
      };
    },
    [homography, imageBox],
  );

  const handleCanvasTap = useCallback(
    (e: ReactMouseEvent<HTMLImageElement>) => {
      if (!pendingArtwork || !state || !imgRef.current) return;
      const rect = imgRef.current.getBoundingClientRect();
      const xImg = e.clientX - rect.left;
      const yImg = e.clientY - rect.top;
      const surface = state.space.surfaces[0] ?? null;
      const surfaceId = surface?.id ?? null;
      const { xCm: rawX, yCm: rawY } = imagePxToWallCm(xImg, yImg, surface);
      const now = new Date().toISOString();
      // Legacy artworks (uploaded before the dimensions gate) still
      // have null width_cm/height_cm even after the 2026-08-19 backfill
      // migration (rows the parser couldn't resolve — "Variable size",
      // bare "91*72.2" with no size_unit, "30호", etc.). Attempt one
      // more parse here against the free-form `size` string; if that
      // fails, fall through to the 50 × 70 hot-fix default so the
      // placement stays visible (renderer's null-drop filter would
      // otherwise vanish the row — the "0.1초 flash → 사라짐" P1 bug).
      let placementWidthCm: number;
      let placementHeightCm: number;
      let placementDepthCm: number | null | undefined = pendingArtwork.depthCm;
      let recoveredDims: {
        widthCm: number;
        heightCm: number;
        depthCm?: number;
      } | null = null;
      const artworkHasDims =
        pendingArtwork.widthCm != null &&
        pendingArtwork.widthCm > 0 &&
        pendingArtwork.heightCm != null &&
        pendingArtwork.heightCm > 0;
      if (artworkHasDims) {
        placementWidthCm = pendingArtwork.widthCm as number;
        placementHeightCm = pendingArtwork.heightCm as number;
      } else {
        recoveredDims = parseSizeToDimensionsCm(
          pendingArtwork.size,
          pendingArtwork.sizeUnit,
        );
        if (recoveredDims) {
          placementWidthCm = recoveredDims.widthCm;
          placementHeightCm = recoveredDims.heightCm;
          if (recoveredDims.depthCm != null) {
            placementDepthCm = recoveredDims.depthCm;
          }
        } else {
          placementWidthCm = PLACEMENT_FALLBACK_WIDTH_CM;
          placementHeightCm = PLACEMENT_FALLBACK_HEIGHT_CM;
        }
      }
      const provisional: ScenePlacement = {
        id: tempId(),
        spaceId: state.space.id,
        surfaceId,
        artworkId: pendingArtwork.id,
        xCm: rawX,
        yCm: rawY,
        zCm: 0,
        rotXDeg: 0,
        rotYDeg: 0,
        rotZDeg: 0,
        widthCm: placementWidthCm,
        heightCm: placementHeightCm,
        depthCm: placementDepthCm ?? null,
        zOrder: state.space.placements.length,
        // Phase 2 — new placements start with `null` (platform
        // default; renders as `"none"`). Users pick a preset from
        // the inspector post-drop; the choice persists back to
        // `space_placements.frame_preset`.
        framePreset: null,
        createdAt: now,
        updatedAt: now,
      };
      // Snap the initial drop to eye-level and sibling edges so the
      // first placement is aligned even before the user drags.
      const { x: snappedX, y: snappedY } = computeSnappedPosition(
        provisional,
        rawX,
        rawY,
      );
      const nextPlacement: ScenePlacement = {
        ...provisional,
        xCm: snappedX,
        yCm: snappedY,
      };
      pushHistory();
      const artworks = new Map(state.artworks);
      const thumb: ArtworkThumbForScene = {
        id: pendingArtwork.id,
        title: pendingArtwork.title,
        imageUrl: pendingArtwork.imageUrl,
        // When we recovered dims from the free-form `size` treat them
        // as the artwork's canonical values on the scene so the
        // inspector and renderer stop routing through the fallback.
        widthCm: recoveredDims
          ? recoveredDims.widthCm
          : pendingArtwork.widthCm,
        heightCm: recoveredDims
          ? recoveredDims.heightCm
          : pendingArtwork.heightCm,
        depthCm:
          recoveredDims?.depthCm != null
            ? recoveredDims.depthCm
            : pendingArtwork.depthCm,
        // Piped through the picker so the aspect-mismatch signal
        // fires the moment a new placement is dropped, not only
        // after a full reload.
        imagePxWidth: pendingArtwork.imagePxWidth,
        imagePxHeight: pendingArtwork.imagePxHeight,
        workForm: pendingArtwork.workForm,
        // Phase 2 — the picker doesn't carry cutout metadata yet
        // (it's derived from `artwork_images` at load time). After
        // the auto-fire Track 1 upload / manual CTA, the space
        // reloads via `load()` and the fresh thumb picks up the
        // sibling rows. Seed as null so the renderer falls back
        // to `imageUrl` until the reload lands.
        cutoutImageUrl: null,
        cutoutImagePxWidth: null,
        cutoutImagePxHeight: null,
        cutoutAlphaImageUrl: null,
        cutoutAlphaImagePxWidth: null,
        cutoutAlphaImagePxHeight: null,
      };
      artworks.set(pendingArtwork.id, thumb);
      setState({
        space: {
          ...state.space,
          placements: [...state.space.placements, nextPlacement],
        },
        artworks,
      });
      dirtyPlacements.current.set(nextPlacement.id, nextPlacement);
      setSelectedId(nextPlacement.id);
      setPendingArtwork(null);
      if (!artworkHasDims && recoveredDims) {
        // We recovered structured dims from the legacy `size` string.
        // Confirm the placement with the collector so they know we
        // used the artist's actual size rather than the 50×70 default,
        // and best-effort propagate the parsed dims back onto the
        // artwork row. RLS blocks non-owners — silent-fail is fine
        // (the placement itself is already correct on this canvas).
        const wRound = Math.round(recoveredDims.widthCm);
        const hRound = Math.round(recoveredDims.heightCm);
        setToast(
          t("simulation.editor.parsedSizeApplied")
            .replace("{width}", String(wRound))
            .replace("{height}", String(hRound)),
        );
        void updateArtworkDimsIfMissing(pendingArtwork.id, recoveredDims);
      } else if (!artworkHasDims) {
        // Surface the fallback so the user knows to correct the size —
        // silent placement at the wrong scale is more confusing than a
        // gentle "here's a placeholder, tune it in the inspector" nudge.
        setToast(t("simulation.editor.fallbackSizeApplied"));
      }
      scheduleFlush();
    },
    [
      pendingArtwork,
      state,
      imagePxToWallCm,
      computeSnappedPosition,
      pushHistory,
      scheduleFlush,
      t,
    ],
  );

  const handleCornersConfirm = useCallback(
    async (quad: Quad) => {
      if (!state || !primarySurface) return;
      const corners: PhotoCorners = {
        tl: { x: quad[0][0], y: quad[0][1] },
        tr: { x: quad[1][0], y: quad[1][1] },
        br: { x: quad[2][0], y: quad[2][1] },
        bl: { x: quad[3][0], y: quad[3][1] },
      };
      setState((prev) =>
        prev
          ? {
              ...prev,
              space: {
                ...prev.space,
                surfaces: prev.space.surfaces.map((s) =>
                  s.id === primarySurface.id
                    ? { ...s, photoCorners: corners }
                    : s,
                ),
              },
            }
          : prev,
      );
      await updateSurface(
        primarySurface.id,
        { photoCorners: corners },
        { spaceIdForTouch: state.space.id },
      );
      setCornersOpen(false);
    },
    [state, primarySurface],
  );

  /**
   * Apply the currently-active AI calibration candidate.
   *
   * Math (all in NATIVE photo pixels — the AI's normalized bbox is
   * relative to the native photo dimensions, NOT the on-screen `<img>`
   * frame):
   *   pxLen  = normalizedBboxDim × native photo dim  (per `dimension`)
   *   pxPerCm = pxLen / userInputCm
   *   wallWidthCm  = imagePxWidth  / pxPerCm
   *   wallHeightCm = imagePxHeight / pxPerCm
   * This gives the "full photo → wall" mapping — so a placement's
   * `imagePxToWallCm` fallback (which linearly maps image → wall)
   * lands at real-world scale even before the user opens the
   * advanced corner picker.
   */
  const handleApplyCalibrateCandidate = useCallback(async () => {
    if (!state || !primarySurface) return;
    const candidate = calibrateCandidates[calibrateIdx];
    if (!candidate) return;
    const rawInput = parseFloat(calibrateInputCm);
    if (!Number.isFinite(rawInput) || rawInput <= 0) return;
    // Respect the current display unit — user may be typing m/cm/in/ft.
    const cm = displayNumberToCm(rawInput, displayUnit);
    const nativeW = state.space.photoWidthPx ?? 0;
    const nativeH = state.space.photoHeightPx ?? 0;
    if (nativeW <= 0 || nativeH <= 0) return;
    const pxLen = candidateNativePxLength(candidate, nativeW, nativeH);
    if (pxLen <= 0) return;
    const pxPerCm = pxLen / cm;
    if (!Number.isFinite(pxPerCm) || pxPerCm <= 0) return;
    const wallWidthCm = nativeW / pxPerCm;
    const wallHeightCm = nativeH / pxPerCm;
    setState((prev) =>
      prev
        ? {
            ...prev,
            space: {
              ...prev.space,
              surfaces: prev.space.surfaces.map((s) =>
                s.id === primarySurface.id
                  ? { ...s, widthCm: wallWidthCm, heightCm: wallHeightCm }
                  : s,
              ),
            },
          }
        : prev,
    );
    await updateSurface(
      primarySurface.id,
      { widthCm: wallWidthCm, heightCm: wallHeightCm },
      { spaceIdForTouch: state.space.id },
    );
    setCalibrateCandidates([]);
    setCalibrateIdx(0);
    setCalibrateInputCm("");
    setToast(t("simulation.calibrate.applied"));
  }, [
    state,
    primarySurface,
    calibrateCandidates,
    calibrateIdx,
    calibrateInputCm,
    displayUnit,
    t,
  ]);

  const handleCycleCandidate = useCallback(() => {
    if (calibrateCandidates.length <= 1) return;
    setCalibrateIdx((i) => (i + 1) % calibrateCandidates.length);
    setCalibrateInputCm("");
  }, [calibrateCandidates.length]);

  const handleDismissCalibrate = useCallback(() => {
    setCalibrateCandidates([]);
    setCalibrateIdx(0);
    setCalibrateInputCm("");
  }, []);

  /**
   * Enter manual tap-to-measure mode. Clears the AI card AND any
   * pending artwork placement so the canvas clicks route unambiguously
   * to the measure flow.
   */
  const startManualMeasure = useCallback(() => {
    setCalibrateCandidates([]);
    setPendingArtwork(null);
    setMeasureState({ phase: "pointA" });
    setMeasureInputCm("");
  }, []);

  const cancelManualMeasure = useCallback(() => {
    setMeasureState({ phase: "idle" });
    setMeasureInputCm("");
  }, []);

  /**
   * Apply the manual 2-point measurement. Distance is measured in the
   * imageBox (CSS-pixel) frame; we rescale to native photo pixels via
   * the `imagePxWidth / imageBox.w` ratio before deriving pxPerCm so
   * downstream widthCm matches the calibration math above (i.e. same
   * "full photo → wall" mapping).
   */
  const handleApplyManualMeasure = useCallback(async () => {
    if (!state || !primarySurface) return;
    if (measureState.phase !== "input") return;
    const raw = parseFloat(measureInputCm);
    if (!Number.isFinite(raw) || raw <= 0) return;
    // Manual measure honors the wider display unit set — a user
    // measuring "3.3 m" between two points on the photo is far more
    // natural than typing "330 cm".
    const cm = displayNumberToCm(raw, displayUnit);
    const dxCss = measureState.pointB.x - measureState.pointA.x;
    const dyCss = measureState.pointB.y - measureState.pointA.y;
    const pxDistanceCss = Math.sqrt(dxCss * dxCss + dyCss * dyCss);
    if (pxDistanceCss <= 0 || imageBox.w <= 0) return;
    const nativeW = state.space.photoWidthPx ?? 0;
    const nativeH = state.space.photoHeightPx ?? 0;
    if (nativeW <= 0 || nativeH <= 0) return;
    const cssToNative = nativeW / imageBox.w;
    const pxDistanceNative = pxDistanceCss * cssToNative;
    const pxPerCm = pxDistanceNative / cm;
    if (!Number.isFinite(pxPerCm) || pxPerCm <= 0) return;
    const wallWidthCm = nativeW / pxPerCm;
    const wallHeightCm = nativeH / pxPerCm;
    setState((prev) =>
      prev
        ? {
            ...prev,
            space: {
              ...prev.space,
              surfaces: prev.space.surfaces.map((s) =>
                s.id === primarySurface.id
                  ? { ...s, widthCm: wallWidthCm, heightCm: wallHeightCm }
                  : s,
              ),
            },
          }
        : prev,
    );
    await updateSurface(
      primarySurface.id,
      { widthCm: wallWidthCm, heightCm: wallHeightCm },
      { spaceIdForTouch: state.space.id },
    );
    setMeasureState({ phase: "idle" });
    setMeasureInputCm("");
    setToast(t("simulation.calibrate.applied"));
  }, [
    state,
    primarySurface,
    measureState,
    measureInputCm,
    imageBox.w,
    displayUnit,
    t,
  ]);

  // Phase 3 (2026-08-19) — wall size flush is debounced (500 ms) so
  // typing "332" into the width input doesn't fire three separate
  // updateSurface calls / three SavePill blinks. The optimistic
  // state.surfaces update stays immediate so the canvas responds
  // instantly to every keystroke; only the DB round trip is
  // coalesced.
  const wallDimsDraftRef = useRef<{
    widthCm?: number | null;
    heightCm?: number | null;
  }>({});
  const wallDimsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const WALL_DIMS_DEBOUNCE_MS = 500;

  const handleWallDims = useCallback(
    (patch: { widthCm?: number | null; heightCm?: number | null }) => {
      if (!state || !primarySurface) return;
      const surfaceId = primarySurface.id;
      const spaceId = state.space.id;
      // Optimistic local update — canvas re-renders at the new
      // wall dimensions immediately.
      setState((prev) =>
        prev
          ? {
              ...prev,
              space: {
                ...prev.space,
                surfaces: prev.space.surfaces.map((s) =>
                  s.id === surfaceId ? { ...s, ...patch } : s,
                ),
              },
            }
          : prev,
      );
      // Merge into the pending draft — the debounced flush sends
      // whichever fields the user touched inside the window.
      wallDimsDraftRef.current = {
        ...wallDimsDraftRef.current,
        ...patch,
      };
      if (wallDimsTimerRef.current) {
        clearTimeout(wallDimsTimerRef.current);
      }
      setSaving(true);
      setSavePillStatus("saving");
      wallDimsTimerRef.current = setTimeout(() => {
        const pending = wallDimsDraftRef.current;
        wallDimsDraftRef.current = {};
        wallDimsTimerRef.current = null;
        void (async () => {
          const { error } = await updateSurface(surfaceId, pending, {
            spaceIdForTouch: spaceId,
          });
          setSaving(false);
          if (error) {
            setSavePillStatus("error");
            setToast(t("simulation.editor.saveFailed"));
          } else {
            setSavePillStatus("saved");
          }
        })();
      }, WALL_DIMS_DEBOUNCE_MS);
    },
    [state, primarySurface, t],
  );

  /**
   * P1 (2026-08-19) — "원본 사용 / Use original photo without cleanup"
   * toggle. Swaps `photo_storage_path` between the untouched original
   * (`photo_original_storage_path`) and the previously auto-cleaned
   * variant. Both blobs share identical native dimensions (cleanup
   * encodes at the input resolution), so existing placements stay
   * pixel-accurate across the swap — no re-derivation needed.
   *
   * The toggle is only offered when BOTH variants exist and differ.
   * Re-cleanup does NOT run here; it only fires on fresh uploads
   * (matches the "no options at upload" directive — users can opt out
   * of a bad cleanup, but the AUTO decision to run it is unchanged).
   *
   * The `swapTo` sentinel is either the concrete original path or the
   * previously cleaned path. We derive the cleaned path from the
   * standardized suffix (`photo_cleaned.jpg` under the same folder as
   * `photo.webp`), which matches `replaceSpacePhotoWithCleaned`. If the
   * derived cleaned path doesn't exist on disk yet (e.g. cleanup was
   * skipped for coverage reasons) the swap-back just fails gracefully
   * and the toggle re-renders to reflect the actual state.
   */
  const handleTogglePhotoVariant = useCallback(
    async (useOriginal: boolean) => {
      if (!state) return;
      const originalPath = state.space.photoOriginalStoragePath;
      const currentPath = state.space.photoStoragePath;
      if (!originalPath || !currentPath) return;
      // Derive the cleaned path from the original's folder — matches
      // `replaceSpacePhotoWithCleaned` conventions. This lets us swap
      // BACK to the cleaned variant without needing an extra column on
      // `spaces` to remember it.
      const idx = originalPath.lastIndexOf("/");
      const folder = idx >= 0 ? originalPath.slice(0, idx) : "";
      const cleanedPath = folder
        ? `${folder}/photo_cleaned.jpg`
        : "photo_cleaned.jpg";
      const nextPath = useOriginal ? originalPath : cleanedPath;
      if (nextPath === currentPath) return;
      setState((prev) =>
        prev
          ? {
              ...prev,
              space: { ...prev.space, photoStoragePath: nextPath },
            }
          : prev,
      );
      const { error } = await updateSpace(state.space.id, {
        photoStoragePath: nextPath,
      });
      if (error) {
        // Roll back the optimistic swap so the toggle reflects reality.
        setState((prev) =>
          prev
            ? {
                ...prev,
                space: { ...prev.space, photoStoragePath: currentPath },
              }
            : prev,
        );
      }
    },
    [state],
  );

  // ── Undo / Redo ──────────────────────────────────────────────
  const undo = useCallback(() => {
    if (!state) return;
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(state.space.placements.map((p) => ({ ...p })));
    applyPlacements(prev);
    for (const p of prev) dirtyPlacements.current.set(p.id, p);
    scheduleFlush();
  }, [state, applyPlacements, scheduleFlush]);

  const redo = useCallback(() => {
    if (!state) return;
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(state.space.placements.map((p) => ({ ...p })));
    applyPlacements(next);
    for (const p of next) dirtyPlacements.current.set(p.id, p);
    scheduleFlush();
  }, [state, applyPlacements, scheduleFlush]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "Escape") {
        if (measureState.phase !== "idle") {
          e.preventDefault();
          cancelManualMeasure();
          return;
        }
        if (pendingArtwork) {
          e.preventDefault();
          setPendingArtwork(null);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        ((e.metaKey || e.ctrlKey) && e.key === "y") ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "z")
      ) {
        e.preventDefault();
        redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          e.preventDefault();
          void handleDeleteSelected();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    undo,
    redo,
    selectedId,
    handleDeleteSelected,
    pendingArtwork,
    measureState.phase,
    cancelManualMeasure,
  ]);

  // ── Snap-hint lines (image-space, projected) ─────────────────
  const snapLines = useMemo(() => {
    if (!primarySurface || !homography || snapHints.length === 0) return [];
    const local = computeSurfaceLocalPx(primarySurface, imageBox);
    const width = local.widthPx;
    const height = local.heightPx;
    return snapHints
      .map((h) => {
        let a: [number, number] | null = null;
        let b: [number, number] | null = null;
        if (
          h.type === "eyeLevel" ||
          h.type === "siblingTop" ||
          h.type === "siblingBottom" ||
          h.type === "siblingCenterY"
        ) {
          const yPx = h.atCm * local.pxPerCm;
          a = [0, yPx];
          b = [width, yPx];
        } else if (h.type === "siblingCenterX") {
          const xPx = h.atCm * local.pxPerCm;
          a = [xPx, 0];
          b = [xPx, height];
        }
        if (!a || !b) return null;
        const aImg = applyHomography(homography, a);
        const bImg = applyHomography(homography, b);
        if (!aImg || !bImg) return null;
        return { a: aImg, b: bImg, key: `${h.type}:${h.atCm}` };
      })
      .filter((x): x is { a: [number, number]; b: [number, number]; key: string } => Boolean(x));
  }, [primarySurface, homography, snapHints, imageBox]);

  // ── Render ───────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="aspect-[4/3] w-full animate-pulse rounded-2xl bg-zinc-100" />
      </main>
    );
  }

  if (notFound || !state) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-sm text-zinc-600">{t("simulation.errors.notFound")}</p>
        <Link
          href="/my/spaces"
          className="mt-4 inline-block text-sm text-zinc-500 hover:text-zinc-800"
        >
          ← {t("simulation.editor.back")}
        </Link>
      </main>
    );
  }

  const { space } = state;
  const selected = selectedId
    ? placements.find((p) => p.id === selectedId) ?? null
    : null;
  const existingIds = new Set(placements.map((p) => p.artworkId));
  // Placement inspector stays in cm/in only (artwork sizes are still
  // conventionally cm/in, not m/ft). `space.unit` is kept in sync
  // with the metric/imperial family of `displayUnit` on toggle.
  const sizeUnit: "cm" | "in" = space.unit === "in" ? "in" : "cm";
  const cmDisplay = sizeUnit === "in" ? (v: number) => v / 2.54 : (v: number) => v;
  const unitSuffix = sizeUnit;
  const wallUnitFactor = DISPLAY_UNIT_FACTOR[displayUnit];
  const wallUnitDecimals = DISPLAY_UNIT_DECIMALS[displayUnit];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Link
            href="/my/spaces"
            className="text-sm text-zinc-500 hover:text-zinc-800"
          >
            ← {t("simulation.editor.back")}
          </Link>
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void handleTitleBlur()}
            placeholder={t("simulation.editor.titlePlaceholder")}
            className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-lg font-semibold text-zinc-900 outline-none focus:bg-zinc-50"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/*
            Phase 3 (2026-08-19) — subtle save-state pill.
            Replaces the ex-"저장 중" span that hung next to the title
            and the (also-removed) full-page pessimistic re-hydrate.
          */}
          <SavePill status={savePillStatus} />
          {/*
            Phase 3 (2026-08-19) — bulk padding cleanup CTA. Shown
            only when at least one placement's artwork still has no
            cutout. Handler defined near the auto-crop machinery so
            the in-flight set stays a single source of truth.
          */}
          {bulkCropCandidates.length > 0 && (
            <button
              type="button"
              onClick={() => setBulkCropOpen(true)}
              disabled={bulkCropRunning}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              title={t("simulation.bulkCrop.cta")}
            >
              {bulkCropRunning
                ? t("simulation.bulkCrop.progress")
                    .replace("{done}", String(bulkCropProgress.done))
                    .replace("{total}", String(bulkCropProgress.total))
                : t("simulation.bulkCrop.cta")}
            </button>
          )}
          <button
            type="button"
            onClick={handleShare}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            {t("simulation.editor.share")}
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exportBusy || (exportAccess.decision != null && !exportAccess.decision.allowed)}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {exportBusy
              ? t("simulation.editor.exportBusy")
              : t("simulation.editor.export")}
          </button>
        </div>
      </header>

      {overCap && (
        <div className="mb-4">
          <SimulationPaywallCard decision={featureAccess.decision} />
        </div>
      )}

      {/* P1 — AI calibration card. Renders above the canvas so the
          bbox overlay (drawn inside the canvas) and the question
          card sit side-by-side on the same visual axis. Priority over
          the detecting toast; only shown when the model returned at
          least one candidate. */}
      {calibrateCandidates.length > 0 && (() => {
        const c = calibrateCandidates[calibrateIdx];
        if (!c) return null;
        const label = locale === "ko" ? c.label_ko : c.label_en;
        const ask = locale === "ko" ? c.ask_ko : c.ask_en;
        const midpoint = typicalMidpoint(c);
        // Range/hint/placeholder all follow the wider display unit so
        // a user in `m` sees "보통 1.9-2.2m" for door height, not
        // "190-220cm" while their input row already shows "m".
        const rangeMin = Number(
          formatCmForUnit(c.typical_range_cm.min, displayUnit),
        );
        const rangeMax = Number(
          formatCmForUnit(c.typical_range_cm.max, displayUnit),
        );
        const rangeHint = t("simulation.calibrate.rangeHint")
          .replace("{min}", String(rangeMin))
          .replace("{max}", String(rangeMax))
          .replace("{unit}", displayUnit);
        const placeholder = formatCmForUnit(midpoint, displayUnit);
        return (
          <div
            role="dialog"
            aria-labelledby="calibrate-card-title"
            className="mb-4 flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-50/70 p-4 shadow-sm"
          >
            <div>
              <h3
                id="calibrate-card-title"
                className="text-sm font-semibold text-emerald-900"
              >
                {t("simulation.calibrate.cardTitle").replace(
                  "{label}",
                  label,
                )}
              </h3>
              <p className="mt-1 text-xs text-emerald-800">{ask}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-2 py-1.5">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min={1}
                  value={calibrateInputCm}
                  onChange={(e) => setCalibrateInputCm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleApplyCalibrateCandidate();
                    }
                  }}
                  placeholder={placeholder}
                  className="w-20 rounded border-0 px-1 py-0.5 text-sm outline-none focus:ring-0"
                  aria-label={ask}
                />
                <span className="text-xs text-zinc-500">{displayUnit}</span>
              </label>
              <span className="text-[11px] text-emerald-700">{rangeHint}</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleApplyCalibrateCandidate()}
                  disabled={!parseFloat(calibrateInputCm)}
                  className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  {t("simulation.calibrate.apply")}
                </button>
                {calibrateCandidates.length > 1 && (
                  <button
                    type="button"
                    onClick={handleCycleCandidate}
                    className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
                  >
                    {t("simulation.calibrate.tryAnother")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={startManualMeasure}
                  className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
                >
                  {t("simulation.calibrate.manual")}
                </button>
                <button
                  type="button"
                  onClick={handleDismissCalibrate}
                  className="rounded-full px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                >
                  {t("simulation.calibrate.later")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section ref={canvasRef} className="min-w-0">
          {/*
            P1 (2026-08-19) — Wall-cleanup skip notice. The auto pass
            silently fails open when the model can't confidently locate
            a wall polygon (chaotic scenes, occluded walls, wall
            heavily lit by direct sun). Before this notice existed, the
            user just saw a still-warped photo with no clue the AI even
            ran. Two CTAs so we don't strand them: (a) upload a
            different photo, (b) open the manual corner picker.
          */}
          {photoUrl && wallCleanupNotice && (
            <div
              role="status"
              className="mb-3 flex flex-wrap items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
            >
              <span aria-hidden className="text-lg leading-none">⚠️</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {t("simulation.wallCleanup.notice.title")}
                </p>
                <p className="mt-0.5 text-[11px] text-amber-800/90">
                  {t(
                    wallCleanupNotice.kind === "skipped-low"
                      ? "simulation.wallCleanup.notice.lowConfidence"
                      : wallCleanupNotice.kind === "skipped-coverage"
                      ? "simulation.wallCleanup.notice.coverage"
                      : "simulation.wallCleanup.notice.error",
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadBusy}
                  className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  {t("simulation.wallCleanup.notice.replacePhoto")}
                </button>
                <button
                  type="button"
                  onClick={() => setCornersOpen(true)}
                  className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                >
                  {t("simulation.wallCleanup.notice.pickCorners")}
                </button>
                <button
                  type="button"
                  onClick={() => setWallCleanupNotice(null)}
                  className="rounded-lg px-1.5 py-1 text-[11px] text-amber-700 hover:text-amber-900"
                  aria-label={t("simulation.picker.close")}
                >
                  ×
                </button>
              </div>
            </div>
          )}
          {photoUrl ? (
            <div className="relative w-full overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={photoUrl}
                alt={space.title || ""}
                className="block h-auto w-full select-none"
                draggable={false}
                style={{
                  cursor:
                    pendingArtwork ||
                    measureState.phase === "pointA" ||
                    measureState.phase === "pointB"
                      ? "crosshair"
                      : "default",
                }}
                onClick={(e) => {
                  // Manual tap-to-measure takes priority — it's a
                  // modal-ish sub-mode entered explicitly by the user
                  // (via the AI card or the "정확한 스케일" accordion).
                  if (
                    measureState.phase === "pointA" ||
                    measureState.phase === "pointB"
                  ) {
                    if (!imgRef.current) return;
                    const rect = imgRef.current.getBoundingClientRect();
                    const p = {
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top,
                    };
                    if (measureState.phase === "pointA") {
                      setMeasureState({ phase: "pointB", pointA: p });
                    } else {
                      setMeasureState({
                        phase: "input",
                        pointA: measureState.pointA,
                        pointB: p,
                      });
                    }
                    return;
                  }
                  if (pendingArtwork) {
                    handleCanvasTap(e);
                    return;
                  }
                  setSelectedId(null);
                }}
              />
              {/*
                Placement overlays.

                Display Simulation Phase 2 (2026-08-20) — the hairline
                outline + inline drop-shadow added in release 27 are
                replaced by a shared mount stack (`buildMountLayers`).
                Every placement now renders as:
                  outer wrapper  → frame material + directional cast
                                   shadow + mounting lift shadow
                    matte div    → optional white matte (thin_matte)
                      image well → transparent well (composites the
                                   cutout/alpha PNG onto the wall)
                        <img>    → `object-contain`, so the physical
                                   `widthCm × heightCm` rectangle
                                   never distorts the source pixels.

                Selection ring is folded into the outer wrapper's
                outline so it survives every frame preset without
                fighting the drop-shadow filter.
              */}
              {rendered.map((rp) => {
                const isSelected = rp.placement.id === selectedId;
                const isDragging = rp.placement.id === dragPlacementId;
                const surface = rp.surface;
                if (!surface) return null;
                // `pxPerCm` — the physical→display scale for THIS
                // placement's rendered rect. Frame padding is stored
                // in cm so we can keep 3 cm reading as 3 cm at every
                // resolution / device. `widthCm` collapses to 0 when
                // both the placement override and artwork's canonical
                // dimensions are null — the fallback branch skips
                // frame padding entirely (framePx = 0).
                const placementWidthCm = rp.placement.widthCm ?? 0;
                const pxPerCm =
                  placementWidthCm > 0
                    ? rp.css.widthPx / placementWidthCm
                    : 0;
                const framePreset = resolveFramePreset(
                  rp.placement.framePreset,
                );
                const light = readLightDirection(surface.pose);
                const layers = buildMountLayers({
                  preset: framePreset,
                  pxPerCm,
                  lightDirection: light,
                  selected: isSelected,
                  resolvedImageSource: rp.resolvedImageSource,
                });
                const imgNode = rp.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={rp.imageUrl}
                    alt={rp.artwork.title}
                    className="pointer-events-none max-h-full max-w-full select-none object-contain"
                    style={{ width: "100%", height: "100%" }}
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white text-[10px] text-zinc-400">
                    {rp.artwork.title}
                  </div>
                );
                return (
                  <div
                    key={rp.placement.id}
                    role="button"
                    tabIndex={0}
                    aria-label={rp.artwork.title}
                    onPointerDown={(e) =>
                      onOverlayPointerDown(rp.placement, surface, e)
                    }
                    onPointerMove={onOverlayPointerMove}
                    onPointerUp={onOverlayPointerUp}
                    onPointerCancel={onOverlayPointerUp}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      width: `${rp.css.widthPx}px`,
                      height: `${rp.css.heightPx}px`,
                      transformOrigin: "0 0",
                      transform: rp.css.matrix3d,
                      zIndex: rp.css.zIndex + 1,
                      touchAction: "none",
                      cursor: isDragging ? "grabbing" : "grab",
                      // Phase 3 (2026-08-19) — smooth transitions on
                      // width/height/transform so aspect-snap on
                      // cutout arrival (Track 1) is a soft resize
                      // rather than a jump. Off during drag so the
                      // pointer stays pixel-precise and CSS doesn't
                      // fight the 60 fps translate; `will-change`
                      // hints the compositor to promote the layer.
                      willChange: isDragging ? "transform" : undefined,
                      transition: isDragging
                        ? "none"
                        : "width 200ms ease-out, height 200ms ease-out, transform 120ms ease-out, outline-color 150ms ease-out",
                      ...layers.outer,
                    }}
                  >
                    {layers.matte ? (
                      <div style={layers.matte}>
                        <div style={layers.imageWell}>{imgNode}</div>
                      </div>
                    ) : (
                      <div style={layers.imageWell}>{imgNode}</div>
                    )}
                  </div>
                );
              })}
              {/* Snap guides */}
              {imageBox.w > 0 && snapLines.length > 0 && (
                <svg
                  className="pointer-events-none absolute left-0 top-0"
                  width={imageBox.w}
                  height={imageBox.h}
                  aria-hidden
                >
                  {snapLines.map((l) => (
                    <line
                      key={l.key}
                      x1={l.a[0]}
                      y1={l.a[1]}
                      x2={l.b[0]}
                      y2={l.b[1]}
                      stroke="rgba(16, 185, 129, 0.8)"
                      strokeWidth={1}
                      strokeDasharray="6 4"
                    />
                  ))}
                </svg>
              )}
              {rendered.length === 0 &&
                !pendingArtwork &&
                measureState.phase === "idle" && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto max-w-xs rounded-full bg-black/70 px-3 py-1.5 text-center text-xs text-white">
                    {t("simulation.editor.emptyCanvas")}
                  </div>
                )}
              {pendingArtwork && (
                <div
                  className="pointer-events-none absolute inset-x-0 top-3 mx-auto flex w-max max-w-[92%] items-center gap-2 rounded-full bg-zinc-900/90 px-3 py-1.5 text-xs text-white shadow-lg"
                  role="status"
                  aria-live="polite"
                >
                  <span className="truncate">
                    📍 {pendingArtwork.title} ·{" "}
                    {t("simulation.editor.tapToPlace")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingArtwork(null)}
                    className="pointer-events-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-white/20"
                  >
                    {t("simulation.editor.cancelPlacement")}
                  </button>
                </div>
              )}

              {/*
                Manual measure — unified top-of-canvas banner. In
                point-drop phases it just labels the mode + cancel.
                In "input" phase we expand it into a full input row
                (distance + unit + apply + retry + cancel) so the
                input never hovers over the "작품을 추가하여 시작하세요"
                empty-canvas hint or the segment midpoint on the
                photo. The banner uses `pointer-events-none` on the
                shell and re-enables on interactive children.
              */}
              {measureState.phase !== "idle" && (
                <div
                  className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col gap-2"
                  role="status"
                  aria-live="polite"
                >
                  <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-200 bg-white/95 px-3 py-2 text-xs text-zinc-800 shadow-lg backdrop-blur">
                    <span className="flex items-center gap-1 font-medium text-emerald-800">
                      📐{" "}
                      {measureState.phase === "input"
                        ? t("simulation.calibrate.manualDistanceLabel")
                        : t("simulation.calibrate.manualHint")}
                    </span>
                    {measureState.phase === "input" && (
                      <label className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2 py-1">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min={0.01}
                          value={measureInputCm}
                          onChange={(e) => setMeasureInputCm(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleApplyManualMeasure();
                            }
                          }}
                          className="w-20 rounded border-0 px-1 py-0.5 text-sm outline-none focus:ring-0"
                          placeholder={
                            displayUnit === "m"
                              ? "1.00"
                              : displayUnit === "ft"
                              ? "3.00"
                              : displayUnit === "in"
                              ? "36.0"
                              : "100.0"
                          }
                          autoFocus
                        />
                        <span className="text-[11px] font-medium text-zinc-500">
                          {displayUnit}
                        </span>
                      </label>
                    )}
                    {measureState.phase === "input" && (
                      <button
                        type="button"
                        onClick={() => void handleApplyManualMeasure()}
                        disabled={!parseFloat(measureInputCm)}
                        className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                      >
                        {t("simulation.calibrate.apply")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={startManualMeasure}
                      className="rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
                    >
                      {t("simulation.calibrate.manualRetry")}
                    </button>
                    <button
                      type="button"
                      onClick={cancelManualMeasure}
                      className="rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
                    >
                      {t("simulation.editor.cancelPlacement")}
                    </button>
                  </div>
                </div>
              )}

              {/*
                Manual measure — dropped-point + line overlay. Dots
                get a drop-shadow filter for readability against both
                bright walls and dark furniture; labels 1/2 sit inside
                each dot in white.
              */}
              {imageBox.w > 0 &&
                (measureState.phase === "pointB" ||
                  measureState.phase === "input") && (
                  <svg
                    className="pointer-events-none absolute left-0 top-0"
                    width={imageBox.w}
                    height={imageBox.h}
                    aria-hidden
                    style={{
                      filter: "drop-shadow(0 0 6px rgba(0,0,0,0.45))",
                    }}
                  >
                    {(() => {
                      const a = measureState.pointA;
                      const b =
                        measureState.phase === "input"
                          ? measureState.pointB
                          : null;
                      return (
                        <g>
                          {b && (
                            <line
                              x1={a.x}
                              y1={a.y}
                              x2={b.x}
                              y2={b.y}
                              stroke="rgba(16, 185, 129, 0.95)"
                              strokeWidth={2}
                              strokeDasharray="6 4"
                            />
                          )}
                          <circle
                            cx={a.x}
                            cy={a.y}
                            r={9}
                            fill="rgba(16, 185, 129, 0.98)"
                            stroke="white"
                            strokeWidth={2.5}
                          />
                          <text
                            x={a.x}
                            y={a.y + 4}
                            textAnchor="middle"
                            fontSize={11}
                            fontWeight={700}
                            fill="white"
                          >
                            1
                          </text>
                          {b && (
                            <>
                              <circle
                                cx={b.x}
                                cy={b.y}
                                r={9}
                                fill="rgba(16, 185, 129, 0.98)"
                                stroke="white"
                                strokeWidth={2.5}
                              />
                              <text
                                x={b.x}
                                y={b.y + 4}
                                textAnchor="middle"
                                fontSize={11}
                                fontWeight={700}
                                fill="white"
                              >
                                2
                              </text>
                            </>
                          )}
                        </g>
                      );
                    })()}
                  </svg>
                )}

              {/* AI calibration — bbox overlay for the active candidate. */}
              {calibrateCandidates.length > 0 &&
                imageBox.w > 0 &&
                (() => {
                  const c = calibrateCandidates[calibrateIdx];
                  if (!c) return null;
                  const boxLeft = c.bbox.x0 * imageBox.w;
                  const boxTop = c.bbox.y0 * imageBox.h;
                  const boxW = (c.bbox.x1 - c.bbox.x0) * imageBox.w;
                  const boxH = (c.bbox.y1 - c.bbox.y0) * imageBox.h;
                  const label = locale === "ko" ? c.label_ko : c.label_en;
                  return (
                    <div
                      className="pointer-events-none absolute rounded-md border-2 border-dashed border-emerald-400/90"
                      style={{
                        left: boxLeft,
                        top: boxTop,
                        width: boxW,
                        height: boxH,
                        boxShadow:
                          "0 0 0 9999px rgba(0,0,0,0.08) inset",
                      }}
                      aria-hidden
                    >
                      <span className="absolute -top-2 left-2 -translate-y-full rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white shadow">
                        {label}
                      </span>
                    </div>
                  );
                })()}
            </div>
          ) : (
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 px-4 text-center">
              <p className="text-sm text-zinc-600">
                {t("simulation.editor.needsPhoto")}
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadBusy}
                className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {uploadBusy
                  ? t("simulation.create.submitting")
                  : t("simulation.editor.uploadPhoto")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUploadPhoto(f);
                }}
              />
            </div>
          )}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={!photoUrl || overCap}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {t("simulation.editor.addArtwork")}
            </button>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">
              {t("simulation.inspector.selection")}
            </h2>
            {selected ? (
              (() => {
                // P1 render-quality (2026-08-19) — aspect-ratio
                // mismatch signal. The renderer already draws the
                // image with `object-contain` so pixels never
                // stretch; this signal + CTA lets the user snap the
                // PLACEMENT rectangle to the image's true aspect
                // when the source photo carries background padding.
                //
                // Deliberately does NOT mutate
                // `artworks.width_cm/height_cm` — that would leak
                // into every other user's placement of the same
                // work. Placement dims are RLS-scoped to space
                // owner, so this stays a safe local edit.
                const artwork = state?.artworks.get(selected.artworkId) ?? null;
                // Phase 2 (2026-08-20) — pick the strongest image
                // source available for this artwork; the resolved
                // source drives the aspect-mismatch suppression and
                // the cutout CTA visibility below.
                const hasAlphaCutout = Boolean(artwork?.cutoutAlphaImageUrl);
                const hasBboxCutout = Boolean(artwork?.cutoutImageUrl);
                const resolvedSource: "primary" | "cutout" | "cutout_alpha" =
                  hasAlphaCutout
                    ? "cutout_alpha"
                    : hasBboxCutout
                      ? "cutout"
                      : "primary";
                // Fold the resolved-source signal into the aspect
                // mismatch check. When a cutout row exists, the
                // renderer already draws the cropped painting at
                // exactly the placement aspect — the "padding" that
                // the warning was designed to surface no longer
                // exists, so showing it would confuse the user.
                const mismatch =
                  artwork && resolvedSource === "primary"
                    ? computeAspectMismatch(
                        artwork.imagePxWidth,
                        artwork.imagePxHeight,
                        selected.widthCm,
                        selected.heightCm,
                      )
                    : null;
                const showMismatch =
                  mismatch != null &&
                  mismatch.delta >= ASPECT_MISMATCH_THRESHOLD;
                const currentFramePreset = resolveFramePreset(
                  selected.framePreset,
                );
                const bboxBusy =
                  cutoutBusy?.artworkId === selected.artworkId &&
                  cutoutBusy.track === "bbox";
                const alphaBusy =
                  cutoutBusy?.artworkId === selected.artworkId &&
                  cutoutBusy.track === "alpha";
                const applyFitToImage = (axis: "long" | "short") => {
                  if (
                    !mismatch ||
                    selected.widthCm == null ||
                    selected.heightCm == null
                  ) {
                    return;
                  }
                  // "긴 축 유지" — freeze whichever placement axis
                  // is currently longer (in cm) and derive the
                  // other from the image aspect. "짧은 축 유지" is
                  // the inverse. Both preserve one physical size
                  // the user cared about while removing the aspect
                  // mismatch entirely.
                  const wCm = selected.widthCm;
                  const hCm = selected.heightCm;
                  const imgAspect = mismatch.imageAspect; // w / h
                  const widthIsLonger = wCm >= hCm;
                  const keepWidth =
                    (axis === "long" && widthIsLonger) ||
                    (axis === "short" && !widthIsLonger);
                  const nextWidth = keepWidth ? wCm : hCm * imgAspect;
                  const nextHeight = keepWidth ? wCm / imgAspect : hCm;
                  if (
                    !Number.isFinite(nextWidth) ||
                    !Number.isFinite(nextHeight) ||
                    nextWidth <= 0 ||
                    nextHeight <= 0
                  ) {
                    return;
                  }
                  mutatePlacement(selected.id, {
                    widthCm: Number(nextWidth.toFixed(2)),
                    heightCm: Number(nextHeight.toFixed(2)),
                  });
                };
                return (
                  <div className="mt-3 space-y-3 text-sm text-zinc-700">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-zinc-500">
                        {t("simulation.inspector.dimensions")}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <label className="flex items-center gap-1">
                          <span className="text-xs text-zinc-500">
                            {t("simulation.inspector.width")}
                          </span>
                          <input
                            type="number"
                            step="0.5"
                            value={
                              selected.widthCm != null
                                ? Number(cmDisplay(selected.widthCm).toFixed(1))
                                : ""
                            }
                            onChange={(e) => {
                              const raw = parseFloat(e.target.value);
                              if (!Number.isFinite(raw)) return;
                              const cm = sizeUnit === "in" ? raw * 2.54 : raw;
                              mutatePlacement(selected.id, { widthCm: cm });
                            }}
                            className="w-20 rounded border border-zinc-300 px-2 py-1 text-sm"
                          />
                          <span className="text-xs text-zinc-400">
                            {unitSuffix}
                          </span>
                        </label>
                        <label className="flex items-center gap-1">
                          <span className="text-xs text-zinc-500">
                            {t("simulation.inspector.height")}
                          </span>
                          <input
                            type="number"
                            step="0.5"
                            value={
                              selected.heightCm != null
                                ? Number(
                                    cmDisplay(selected.heightCm).toFixed(1),
                                  )
                                : ""
                            }
                            onChange={(e) => {
                              const raw = parseFloat(e.target.value);
                              if (!Number.isFinite(raw)) return;
                              const cm = sizeUnit === "in" ? raw * 2.54 : raw;
                              mutatePlacement(selected.id, { heightCm: cm });
                            }}
                            className="w-20 rounded border border-zinc-300 px-2 py-1 text-sm"
                          />
                          <span className="text-xs text-zinc-400">
                            {unitSuffix}
                          </span>
                        </label>
                      </div>
                    </div>
                    {showMismatch && (
                      <div
                        role="status"
                        className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
                      >
                        <div className="flex items-start gap-2">
                          <span aria-hidden className="text-sm leading-none">
                            ⚠️
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">
                              {t(
                                "simulation.inspector.aspectMismatch.title",
                              )}
                            </p>
                            <p className="mt-0.5 text-[11px] text-amber-800/90">
                              {t(
                                "simulation.inspector.aspectMismatch.hint",
                              )}
                            </p>
                            <p className="mt-1 text-[11px] text-amber-800/80">
                              {t(
                                "simulation.inspector.aspectMismatch.stats",
                              )
                                .replace(
                                  "{placementRatio}",
                                  mismatch.placementAspect.toFixed(2),
                                )
                                .replace(
                                  "{imageRatio}",
                                  mismatch.imageAspect.toFixed(2),
                                )
                                .replace(
                                  "{delta}",
                                  Math.round(mismatch.delta * 100).toString(),
                                )}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => applyFitToImage("long")}
                            className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                          >
                            {t(
                              "simulation.inspector.aspectMismatch.keepLong",
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => applyFitToImage("short")}
                            className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                          >
                            {t(
                              "simulation.inspector.aspectMismatch.keepShort",
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                    <div>
                      <label
                        htmlFor="rot-z-input"
                        className="text-xs uppercase tracking-wide text-zinc-500"
                      >
                        {t("simulation.inspector.rotation")}
                      </label>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          id="rot-z-input"
                          type="range"
                          min={-45}
                          max={45}
                          step={0.5}
                          value={selected.rotZDeg}
                          onChange={(e) =>
                            mutatePlacement(selected.id, {
                              rotZDeg: parseFloat(e.target.value),
                            })
                          }
                          className="flex-1"
                        />
                        <span className="w-12 text-right text-xs text-zinc-500">
                          {selected.rotZDeg.toFixed(1)}°
                        </span>
                      </div>
                    </div>
                    {/*
                      Frame preset picker (Phase 2 mounting realism).
                      Segmented control with a swatch per preset so
                      users can preview "matte / black / wood /
                      canvas" without leaving the inspector. The
                      persistence flow reuses the debounced placement
                      upsert path — same as widthCm / heightCm — so
                      picks land in `space_placements.frame_preset`
                      within ~400 ms of the click.
                    */}
                    <div>
                      <div className="text-xs uppercase tracking-wide text-zinc-500">
                        {t("simulation.inspector.frame.title")}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {FRAME_PRESETS.map((preset) => {
                          const active = currentFramePreset === preset;
                          return (
                            <button
                              key={preset}
                              type="button"
                              onClick={() =>
                                mutatePlacement(selected.id, {
                                  framePreset: preset,
                                })
                              }
                              className={[
                                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                                active
                                  ? "border-zinc-900 bg-zinc-900 text-white"
                                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50",
                              ].join(" ")}
                              aria-pressed={active}
                              title={t(
                                `simulation.inspector.frame.preset.${preset}`,
                              )}
                            >
                              <FramePresetSwatch preset={preset} />
                              <span>
                                {t(
                                  `simulation.inspector.frame.preset.${preset}`,
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-1.5 text-[11px] text-zinc-500">
                        {t("simulation.inspector.frame.hint")}
                      </p>
                    </div>
                    {/*
                      Cutout CTAs (Phase 2 painting isolation).
                      Track 1 (bbox crop) is always visible when the
                      artwork has no bbox cutout yet — free, one-shot,
                      no gating. Track 2 (Photoroom alpha) is labelled
                      "Pro" and shows a "Beta 무료 사용 가능" hint
                      while `PLAN_FEATURE_MATRIX` is unlocked for all
                      plans. Both re-fetch the space on success so
                      the renderer picks the new sibling row.
                    */}
                    {artwork?.imageUrl && (
                      <div>
                        <div className="text-xs uppercase tracking-wide text-zinc-500">
                          {t("simulation.inspector.cutout.title")}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {!hasBboxCutout && !hasAlphaCutout && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleRunBboxCrop(selected.artworkId)
                              }
                              disabled={bboxBusy || Boolean(cutoutBusy)}
                              className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                            >
                              {bboxBusy
                                ? t("simulation.cutout.bbox.running")
                                : t("simulation.cutout.bbox.cta")}
                            </button>
                          )}
                          {!hasAlphaCutout && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleRunPhotoroomCutout(
                                  selected.artworkId,
                                )
                              }
                              disabled={alphaBusy || Boolean(cutoutBusy)}
                              className="rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                            >
                              {alphaBusy
                                ? t("simulation.cutout.alpha.running")
                                : t("simulation.cutout.alpha.cta")}
                            </button>
                          )}
                        </div>
                        {(hasBboxCutout || hasAlphaCutout) && (
                          <p className="mt-1.5 text-[11px] text-emerald-700">
                            {hasAlphaCutout
                              ? t("simulation.cutout.applied.alpha")
                              : t("simulation.cutout.applied.bbox")}
                          </p>
                        )}
                        {!hasAlphaCutout && (
                          <p className="mt-1 text-[11px] text-zinc-500">
                            {t("simulation.cutout.alpha.betaHint")}
                          </p>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDeleteSelected()}
                      className="text-xs font-medium text-red-600 hover:text-red-800"
                    >
                      {t("simulation.inspector.remove")}
                    </button>
                  </div>
                );
              })()
            ) : (
              <p className="mt-3 text-xs text-zinc-500">
                {t("simulation.inspector.selectHint")}
              </p>
            )}
          </div>

          {photoUrl && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-sm font-medium text-zinc-700 hover:text-zinc-900 disabled:opacity-50"
                disabled={uploadBusy}
              >
                {uploadBusy
                  ? t("simulation.create.submitting")
                  : t("simulation.editor.replacePhoto")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUploadPhoto(f);
                }}
              />
            </div>
          )}

          <details className="group rounded-2xl border border-zinc-200 bg-white p-4 open:pb-4">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-zinc-900 marker:hidden">
              <span>{t("simulation.wall.advancedTitle")}</span>
              <span
                aria-hidden
                className="text-xs text-zinc-400 transition-transform group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <p className="mt-2 text-xs text-zinc-500">
              {t("simulation.wall.advancedHint")}
            </p>
            <div className="mt-3 space-y-2 text-sm">
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-500">
                  {t("simulation.wall.width")} ({displayUnit})
                </span>
                <input
                  type="number"
                  step={displayUnit === "m" ? "0.01" : displayUnit === "ft" ? "0.1" : "1"}
                  value={
                    primarySurface?.widthCm != null
                      ? Number(
                          (primarySurface.widthCm / wallUnitFactor).toFixed(
                            wallUnitDecimals,
                          ),
                        )
                      : ""
                  }
                  onChange={(e) => {
                    const raw = parseFloat(e.target.value);
                    void handleWallDims({
                      widthCm: Number.isFinite(raw) ? raw * wallUnitFactor : null,
                    });
                  }}
                  className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-500">
                  {t("simulation.wall.height")} ({displayUnit})
                </span>
                <input
                  type="number"
                  step={displayUnit === "m" ? "0.01" : displayUnit === "ft" ? "0.1" : "1"}
                  value={
                    primarySurface?.heightCm != null
                      ? Number(
                          (primarySurface.heightCm / wallUnitFactor).toFixed(
                            wallUnitDecimals,
                          ),
                        )
                      : ""
                  }
                  onChange={(e) => {
                    const raw = parseFloat(e.target.value);
                    void handleWallDims({
                      heightCm: Number.isFinite(raw) ? raw * wallUnitFactor : null,
                    });
                  }}
                  className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm"
                />
              </label>
              {photoUrl && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCornersOpen((v) => !v)}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                  >
                    {cornersOpen
                      ? t("simulation.wall.closeCorners")
                      : t("simulation.wall.editCorners")}
                  </button>
                  <button
                    type="button"
                    onClick={startManualMeasure}
                    className="rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs text-emerald-800 hover:bg-emerald-50"
                  >
                    {t("simulation.calibrate.manual")}
                  </button>
                  {/*
                    Manual re-trigger for the AI calibration card.
                    Shown only when the space still has an unset scale
                    (widthCm null AND photoCorners null) so users who
                    already calibrated don't accidentally re-run the
                    AI + risk overwriting a good value on Apply. The
                    pref must also be on — hides the button entirely
                    for users who opted out at Settings.
                  */}
                  {aiCalibrationEnabled &&
                    !primarySurface?.widthCm &&
                    !primarySurface?.photoCorners && (
                      <button
                        type="button"
                        onClick={() => void handleManualAiRetrigger()}
                        disabled={calibrateBusy}
                        className="rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        {calibrateBusy
                          ? t("simulation.calibrate.retriggering")
                          : t("simulation.calibrate.retrigger")}
                      </button>
                    )}
                  {/*
                    Manual "벽 정돈 다시 실행" — same shape as the AI
                    retrigger. Always available when a photo exists
                    (unlike calibration, cleanup is idempotent —
                    re-running against `photo_original_storage_path`
                    just produces a fresh cleaned copy).
                  */}
                  <button
                    type="button"
                    onClick={() => void handleManualWallCleanupRetry()}
                    disabled={wallCleanupBusy}
                    className="rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {wallCleanupBusy
                      ? t("simulation.wallCleanup.processing")
                      : t("simulation.wallCleanup.retry")}
                  </button>
                </div>
              )}
              {/*
                P1 (2026-08-19) — "원본 사용 / Use original" toggle.
                Only rendered when the auto wall-cleanup produced a
                distinct variant (i.e. `photo_original_storage_path`
                exists and DIFFERS from `photo_storage_path`). Toggling
                on swaps `photo_storage_path` back to the untouched
                original so users who feel the cleanup is too
                aggressive have an escape hatch — but the AUTO decision
                to run cleanup on upload is unchanged, per the "no
                options at upload" directive.
              */}
              {space.photoOriginalStoragePath &&
                space.photoStoragePath &&
                space.photoOriginalStoragePath !==
                  space.photoStoragePath && (
                  <label className="mt-3 flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50/70 p-2 text-xs text-zinc-700">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={
                        space.photoStoragePath ===
                        space.photoOriginalStoragePath
                      }
                      onChange={(e) =>
                        void handleTogglePhotoVariant(e.target.checked)
                      }
                    />
                    <span className="flex-1">
                      <span className="font-medium text-zinc-800">
                        {t("simulation.wallCleanup.useOriginal.label")}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-zinc-500">
                        {t("simulation.wallCleanup.useOriginal.hint")}
                      </span>
                    </span>
                  </label>
                )}
            </div>
          </details>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">
              {t("simulation.inspector.unit")}
            </h2>
            <p className="mt-1 text-[11px] text-zinc-500">
              {t("simulation.inspector.unitHint")}
            </p>
            <div className="mt-2 inline-flex rounded-lg bg-zinc-100 p-1 text-xs">
              {DISPLAY_UNIT_ORDER.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => void handleDisplayUnit(u)}
                  className={`rounded-md px-3 py-1 ${
                    displayUnit === u
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-800"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {cornersOpen && photoUrl && primarySurface && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                {t("simulation.wall.title")}
              </h3>
              <button
                type="button"
                onClick={() => setCornersOpen(false)}
                className="text-zinc-400 hover:text-zinc-600"
                aria-label={t("simulation.picker.close")}
              >
                ×
              </button>
            </div>
            <p className="mb-2 text-xs text-zinc-500">
              {t("simulation.wall.cornersHint")}
            </p>
            <PerspectiveCornerPicker
              imageUrl={photoUrl}
              imageWidth={space.photoWidthPx ?? 2048}
              imageHeight={space.photoHeightPx ?? 1536}
              initialCorners={
                primarySurface.photoCorners
                  ? [
                      [
                        primarySurface.photoCorners.tl.x,
                        primarySurface.photoCorners.tl.y,
                      ],
                      [
                        primarySurface.photoCorners.tr.x,
                        primarySurface.photoCorners.tr.y,
                      ],
                      [
                        primarySurface.photoCorners.br.x,
                        primarySurface.photoCorners.br.y,
                      ],
                      [
                        primarySurface.photoCorners.bl.x,
                        primarySurface.photoCorners.bl.y,
                      ],
                    ]
                  : null
              }
              autoDetectedCorners={null}
              onConfirm={(quad) => void handleCornersConfirm(quad)}
              onCancel={() => setCornersOpen(false)}
            />
          </div>
        </div>
      )}

      <ArtworkPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(a) => void handlePickArtwork(a)}
        existingArtworkIds={existingIds}
      />

      {bulkCropOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-crop-title"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !bulkCropRunning) {
              setBulkCropOpen(false);
            }
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h3
              id="bulk-crop-title"
              className="text-sm font-semibold text-zinc-900"
            >
              {t("simulation.bulkCrop.cta")}
            </h3>
            <p className="mt-2 text-xs text-zinc-600">
              {bulkCropCandidates.length === 0
                ? t("simulation.bulkCrop.empty")
                : t("simulation.bulkCrop.preview")
                    .replace(
                      "{count}",
                      String(bulkCropCandidates.length),
                    )
                    /*
                      Heuristic: ~5 s per crop end-to-end (Vision
                      round trip + canvas + upload + attach). Divided
                      by concurrency of 3, rounded up to keep the
                      preview honest for small queues.
                    */
                    .replace(
                      "{seconds}",
                      String(Math.max(3, Math.ceil((bulkCropCandidates.length * 5) / 3))),
                    )}
            </p>
            {bulkCropRunning && (
              <p className="mt-2 text-[11px] text-zinc-500">
                {t("simulation.bulkCrop.progress")
                  .replace("{done}", String(bulkCropProgress.done))
                  .replace("{total}", String(bulkCropProgress.total))}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkCropOpen(false)}
                disabled={bulkCropRunning}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                {t("simulation.bulkCrop.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void runBulkCrop()}
                disabled={bulkCropRunning || bulkCropCandidates.length === 0}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {t("simulation.bulkCrop.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-lg"
        >
          {toast}
        </div>
      )}

      {/*
        Phase 3 (2026-08-19) — auto-crop confirmation toast. Placed
        bottom-left so it doesn't collide with the top-right SavePill
        or the bottom-center primary toast used for save errors and
        manual CTA status.
      */}
      {autoCropToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-6 rounded-full bg-emerald-600/95 px-3 py-1.5 text-[11px] font-medium text-white shadow-md"
        >
          <span aria-hidden className="mr-1">✓</span>
          {autoCropToast}
        </div>
      )}

      {/* Keep router / focusId referenced so unused-var lint stays quiet
          — focusId is honored via the selectedId initializer above; the
          router reference lets a future "back to spaces" toast redirect
          cleanly. */}
      <span aria-hidden className="sr-only">
        {router && focusId ? "" : ""}
      </span>
    </main>
  );
}

export function SpaceEditor({ id }: { id: string }) {
  return (
    <AuthGate>
      <SpaceEditorContent id={id} />
    </AuthGate>
  );
}
