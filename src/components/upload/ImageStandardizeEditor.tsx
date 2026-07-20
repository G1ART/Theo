"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * Inline standardization editor for a single uploaded image (feed image
 * standardization, 2026-07-20).
 *
 * Contract:
 *   - Preview panel shows the image with the CURRENT adjustment applied
 *     via CSS filter + a live crop overlay.
 *   - Two axes: brightness (horizontal bar under image) and contrast
 *     (vertical bar on the right). Saturation lives in a compact inline
 *     row to keep the primary controls symmetric with the wireframe.
 *   - Crop is opt-in: the analyzer proposes a rectangle when it detects
 *     uniform background borders; the user confirms, tweaks, or resets.
 *   - "Reset to original" flips everything back to neutral (adjustment
 *     becomes `null` when saved).
 *   - The editor never modifies the original `File`. All state lives
 *     upstream as a normalized `DisplayAdjust`.
 *
 * Preview-first (§0.6): auto-computed values are always shown as a
 * preview the user can trust or overrule. Nothing persists without a
 * user commit.
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
  // Map tone multiplier [TONE_MIN, TONE_MAX] to slider [-100, +100].
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

  // Reset local state whenever the parent value changes to something
  // structurally different (e.g. reset button clicked upstream).
  useEffect(() => {
    setB(value?.b ?? NEUTRAL.b);
    setC(value?.c ?? NEUTRAL.c);
    setS(value?.s ?? NEUTRAL.s);
    setCrop(value?.crop ?? null);
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

  // Run the analyzer once per file. On success, if the parent has NO
  // stored adjustment yet we auto-apply the suggestion (the user still
  // sees exactly what will be saved and can reset instantly). If the
  // parent already has one, we surface the suggestion as a re-apply
  // button but never overwrite silently.
  const hadValueOnMount = useRef<boolean>(value != null);
  useEffect(() => {
    let alive = true;
    setAnalyzing(true);
    setAnalyzeError(null);
    analyzeImageFile(file)
      .then((res) => {
        if (!alive) return;
        setAnalysis(res);
        if (!hadValueOnMount.current) {
          const sug = res.suggested;
          if (sug) {
            setB(sug.b ?? NEUTRAL.b);
            setC(sug.c ?? NEUTRAL.c);
            setS(sug.s ?? NEUTRAL.s);
            if (sug.crop) setCrop(sug.crop);
            onChange(sug);
          }
        }
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
    // Analyzer runs once per file; parent state never re-triggers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Push slider changes upstream (debounced so the parent doesn't
  // re-render on every 1px drag frame).
  const debouncedTone = useDebounced({ b, c, s, crop }, 120);
  const lastPushedRef = useRef<string>("");
  useEffect(() => {
    const next = normalizeDisplayAdjust({
      v: 1,
      b: debouncedTone.b,
      c: debouncedTone.c,
      s: debouncedTone.s,
      crop: debouncedTone.crop ?? undefined,
    });
    const key = JSON.stringify(next);
    if (key === lastPushedRef.current) return;
    lastPushedRef.current = key;
    onChange(next);
  }, [debouncedTone, onChange]);

  const previewAdjust: DisplayAdjust = useMemo(
    () => ({ v: 1, b, c, s, ...(crop ? { crop } : {}) }),
    [b, c, s, crop],
  );
  const filterCss = toFilterCss(previewAdjust);

  const handleReset = useCallback(() => {
    setB(NEUTRAL.b);
    setC(NEUTRAL.c);
    setS(NEUTRAL.s);
    setCrop(null);
    onChange(null);
  }, [onChange]);

  const handleReapplySuggestion = useCallback(() => {
    if (!analysis?.suggested) return;
    const sug = analysis.suggested;
    setB(sug.b ?? NEUTRAL.b);
    setC(sug.c ?? NEUTRAL.c);
    setS(sug.s ?? NEUTRAL.s);
    if (sug.crop) setCrop(sug.crop);
    onChange(sug);
  }, [analysis, onChange]);

  const handleAutoCrop = useCallback(() => {
    if (!analysis?.suggestedCrop) return;
    setCrop(analysis.suggestedCrop);
  }, [analysis]);

  const handleClearCrop = useCallback(() => {
    setCrop(null);
  }, []);

  // Show the crop rect as an overlay on top of the preview. The
  // overlay reflects the current `crop` rect exactly — the actual
  // clipping happens elsewhere (grid card) so the editor stays a
  // WYSIWYG preview of the target thumbnail.
  const cropOverlay = crop ? (
    <div
      className="pointer-events-none absolute rounded-sm ring-1 ring-white/90 ring-offset-1 ring-offset-black/40"
      style={{
        left: `${crop.x * 100}%`,
        top: `${crop.y * 100}%`,
        width: `${crop.w * 100}%`,
        height: `${crop.h * 100}%`,
      }}
    />
  ) : null;

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

      {/* Layout mirrors the wireframe: preview on the left, contrast
          vertical bar on the right, brightness horizontal bar below.
          Saturation + auto-crop chips live in a compact strip below. */}
      <div className="flex gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-zinc-100">
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
            {cropOverlay}
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
              onChange={(e) =>
                setB(fromSliderValue(Number(e.target.value)))
              }
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
            onChange={(e) =>
              setC(fromSliderValue(Number(e.target.value)))
            }
            aria-label={t("upload.imageStandardize.contrast")}
            // WebKit's rotated range slider needs a fixed track length;
            // rotating a full-height flex item is the cross-browser
            // path that works consistently in Chromium, Firefox, Safari.
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
            onChange={(e) => setS(fromSliderValue(Number(e.target.value)))}
            aria-label={t("upload.imageStandardize.saturation")}
            className="h-1 flex-1 cursor-pointer accent-zinc-800"
          />
          <span className="w-10 shrink-0 text-right tabular-nums text-zinc-500">
            {Math.round((s - 1) * 100)}
          </span>
        </label>
        {analysis?.suggestedCrop && !crop && (
          <button
            type="button"
            onClick={handleAutoCrop}
            className="rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
          >
            {t("upload.imageStandardize.autoCrop")}
          </button>
        )}
        {crop && (
          <button
            type="button"
            onClick={handleClearCrop}
            className="rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
          >
            {t("upload.imageStandardize.clearCrop")}
          </button>
        )}
        {analysis?.suggested && (
          <button
            type="button"
            onClick={handleReapplySuggestion}
            className="rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
          >
            {t("upload.imageStandardize.reapplyStandard")}
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
    </div>
  );
}
