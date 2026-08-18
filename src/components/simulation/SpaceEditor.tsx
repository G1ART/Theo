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
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useT } from "@/lib/i18n/useT";
import { AuthGate } from "@/components/AuthGate";
import {
  deletePlacement as deletePlacementRow,
  exportSpace,
  getSpaceById,
  SimulationEntitlementError,
  updateSpace,
  updateSurface,
  upsertPlacements,
  type SpaceScene,
} from "@/lib/supabase/spaces";
import { uploadSpacePhoto } from "@/lib/simulation/storage";
import {
  renderScene2D,
  type ArtworkThumbMap,
} from "@/lib/simulation/renderer2d";
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
import { SimulationPaywallCard } from "./SimulationPaywallCard";
import { applyHomography } from "@/lib/image/enhancement/homography";

const SNAP_TOLERANCE_CM = 3;
const EYE_LEVEL_CM = 150;
const UNDO_LIMIT = 20;
const PERSIST_DEBOUNCE_MS = 400;
/** Fallback wall dimensions when the space has never been calibrated
 *  — 400 × 260 cm approximates a modest room wall. Once the user opens
 *  the corner picker or dimensions inputs these are replaced. */
const FALLBACK_WALL_WIDTH_CM = 400;
const FALLBACK_WALL_HEIGHT_CM = 260;

/** Ephemeral placement id used before we've persisted a new one. */
function tempId(): string {
  return `tmp_${Math.random().toString(36).slice(2, 10)}`;
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
  const [saving, setSaving] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cornersOpen, setCornersOpen] = useState(false);
  const [imageBox, setImageBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [uploadBusy, setUploadBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [snapHints, setSnapHints] = useState<SnapHint[]>([]);
  const [dragPlacementId, setDragPlacementId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyPlacements = useRef<Map<string, ScenePlacement>>(new Map());
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
  const flushPlacements = useCallback(async () => {
    if (!state) return;
    const rows = Array.from(dirtyPlacements.current.values());
    if (rows.length === 0) return;
    dirtyPlacements.current.clear();
    setSaving(true);
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
    }));
    const { error } = await upsertPlacements(state.space.id, upserts);
    setSaving(false);
    if (error) {
      setToast(t("simulation.editor.saveFailed"));
      return;
    }
    // Re-hydrate to pick up server-generated ids on newly-inserted rows.
    void load();
  }, [state, t, load]);

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

  const handleUploadPhoto = useCallback(
    async (file: File) => {
      if (!state) return;
      setUploadBusy(true);
      try {
        await uploadSpacePhoto(state.space.id, file);
        await load();
      } catch {
        setToast(t("simulation.errors.uploadFailed"));
      } finally {
        setUploadBusy(false);
      }
    },
    [state, load, t],
  );

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

  const handleUnit = useCallback(
    async (unit: "cm" | "in") => {
      if (!state || state.space.unit === unit) return;
      setState((prev) =>
        prev ? { ...prev, space: { ...prev.space, unit } } : prev,
      );
      await updateSpace(state.space.id, { unit });
    },
    [state],
  );

  const handlePickArtwork = useCallback(
    async (artwork: PickerArtwork) => {
      if (!state) return;
      setPickerOpen(false);
      pushHistory();
      const surface = state.space.surfaces[0];
      const surfaceId = surface?.id ?? null;
      const wallW = surface?.widthCm ?? FALLBACK_WALL_WIDTH_CM;
      const wallH = surface?.heightCm ?? FALLBACK_WALL_HEIGHT_CM;
      const now = new Date().toISOString();
      const nextPlacement: ScenePlacement = {
        id: tempId(),
        spaceId: state.space.id,
        surfaceId,
        artworkId: artwork.id,
        xCm: wallW / 2,
        yCm: Math.min(EYE_LEVEL_CM, wallH - (artwork.heightCm ?? 60) / 2),
        zCm: 0,
        rotXDeg: 0,
        rotYDeg: 0,
        rotZDeg: 0,
        widthCm: artwork.widthCm,
        heightCm: artwork.heightCm,
        depthCm: artwork.depthCm,
        zOrder: state.space.placements.length,
        createdAt: now,
        updatedAt: now,
      };
      const artworks = new Map(state.artworks);
      const thumb: ArtworkThumbForScene = {
        id: artwork.id,
        title: artwork.title,
        imageUrl: artwork.imageUrl,
        widthCm: artwork.widthCm,
        heightCm: artwork.heightCm,
        depthCm: artwork.depthCm,
        workForm: artwork.workForm,
      };
      artworks.set(artwork.id, thumb);
      setState({
        space: {
          ...state.space,
          placements: [...state.space.placements, nextPlacement],
        },
        artworks,
      });
      dirtyPlacements.current.set(nextPlacement.id, nextPlacement);
      setSelectedId(nextPlacement.id);
      scheduleFlush();
    },
    [state, pushHistory, scheduleFlush],
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

  const handleWallDims = useCallback(
    async (patch: { widthCm?: number | null; heightCm?: number | null }) => {
      if (!state || !primarySurface) return;
      setState((prev) =>
        prev
          ? {
              ...prev,
              space: {
                ...prev.space,
                surfaces: prev.space.surfaces.map((s) =>
                  s.id === primarySurface.id ? { ...s, ...patch } : s,
                ),
              },
            }
          : prev,
      );
      await updateSurface(primarySurface.id, patch, {
        spaceIdForTouch: state.space.id,
      });
    },
    [state, primarySurface],
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
  }, [undo, redo, selectedId, handleDeleteSelected]);

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
  const cmDisplay = space.unit === "in" ? (v: number) => v / 2.54 : (v: number) => v;
  const unitSuffix = space.unit;

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
          {saving && (
            <span className="text-xs text-zinc-400">
              {t("simulation.editor.saving")}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section ref={canvasRef} className="min-w-0">
          {photoUrl ? (
            <div className="relative w-full overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={photoUrl}
                alt={space.title || ""}
                className="block h-auto w-full select-none"
                draggable={false}
                onClick={() => setSelectedId(null)}
              />
              {/* Placement overlays */}
              {rendered.map((rp) => {
                const isSelected = rp.placement.id === selectedId;
                const isDragging = rp.placement.id === dragPlacementId;
                const surface = rp.surface;
                if (!surface) return null;
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
                      boxShadow: isSelected
                        ? "0 0 0 2px rgba(15,23,42,0.9)"
                        : "0 6px 12px rgba(0,0,0,0.15)",
                    }}
                  >
                    {rp.artwork.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={rp.artwork.imageUrl}
                        alt={rp.artwork.title}
                        className="pointer-events-none h-full w-full select-none object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white text-[10px] text-zinc-400">
                        {rp.artwork.title}
                      </div>
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
              {rendered.length === 0 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto max-w-xs rounded-full bg-black/70 px-3 py-1.5 text-center text-xs text-white">
                  {t("simulation.editor.emptyCanvas")}
                </div>
              )}
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
                          const cm = space.unit === "in" ? raw * 2.54 : raw;
                          mutatePlacement(selected.id, { widthCm: cm });
                        }}
                        className="w-20 rounded border border-zinc-300 px-2 py-1 text-sm"
                      />
                      <span className="text-xs text-zinc-400">{unitSuffix}</span>
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
                            ? Number(cmDisplay(selected.heightCm).toFixed(1))
                            : ""
                        }
                        onChange={(e) => {
                          const raw = parseFloat(e.target.value);
                          if (!Number.isFinite(raw)) return;
                          const cm = space.unit === "in" ? raw * 2.54 : raw;
                          mutatePlacement(selected.id, { heightCm: cm });
                        }}
                        className="w-20 rounded border border-zinc-300 px-2 py-1 text-sm"
                      />
                      <span className="text-xs text-zinc-400">{unitSuffix}</span>
                    </label>
                  </div>
                </div>
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
                <button
                  type="button"
                  onClick={() => void handleDeleteSelected()}
                  className="text-xs font-medium text-red-600 hover:text-red-800"
                >
                  {t("simulation.inspector.remove")}
                </button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-zinc-500">
                {t("simulation.inspector.selectHint")}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">
              {t("simulation.wall.title")}
            </h2>
            <div className="mt-3 space-y-2 text-sm">
              <label className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">
                  {t("simulation.wall.widthCm")}
                </span>
                <input
                  type="number"
                  step="1"
                  value={primarySurface?.widthCm ?? ""}
                  onChange={(e) => {
                    const raw = parseFloat(e.target.value);
                    void handleWallDims({
                      widthCm: Number.isFinite(raw) ? raw : null,
                    });
                  }}
                  className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">
                  {t("simulation.wall.heightCm")}
                </span>
                <input
                  type="number"
                  step="1"
                  value={primarySurface?.heightCm ?? ""}
                  onChange={(e) => {
                    const raw = parseFloat(e.target.value);
                    void handleWallDims({
                      heightCm: Number.isFinite(raw) ? raw : null,
                    });
                  }}
                  className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm"
                />
              </label>
              {photoUrl && (
                <button
                  type="button"
                  onClick={() => setCornersOpen((v) => !v)}
                  className="mt-2 rounded-lg border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                >
                  {cornersOpen
                    ? t("simulation.wall.closeCorners")
                    : t("simulation.wall.editCorners")}
                </button>
              )}
              {photoUrl && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-zinc-500 hover:text-zinc-800"
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
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">
              {t("simulation.inspector.unit")}
            </h2>
            <div className="mt-2 inline-flex rounded-lg bg-zinc-100 p-1 text-xs">
              {(["cm", "in"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => void handleUnit(u)}
                  className={`rounded-md px-3 py-1 ${
                    space.unit === u
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-800"
                  }`}
                >
                  {t(`simulation.inspector.unit.${u}`)}
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

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-lg"
        >
          {toast}
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
