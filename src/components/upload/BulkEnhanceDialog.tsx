"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ImageStandardizeEditor,
  type EnhancementDraft,
} from "@/components/upload/ImageStandardizeEditor";
import {
  getArtworkImageUrl,
  replaceArtworkDisplayImage,
  type ArtworkImageViewType,
} from "@/lib/supabase/artworks";
import { getSession } from "@/lib/supabase/auth";
import { downloadArtworkFile } from "@/lib/supabase/storage";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import { useT } from "@/lib/i18n/useT";
import {
  readEnhanceSessionPreset,
  writeEnhanceSessionPreset,
  type EnhanceSessionPreset,
} from "@/lib/image/enhancement/sharedPreset";

export type ImageSlot = {
  /** `artwork_images.id` when available — purely for stable React keys. */
  id?: string | null;
  storage_path: string;
  original_storage_path?: string | null;
  sort_order?: number | null;
  view_type?: ArtworkImageViewType | string | null;
};

export function BulkEnhanceDialog({
  artworkId,
  artistProfileId,
  images,
  storageOwnerId,
  onClose,
  onSaved,
  artworkWidthCm = null,
  artworkHeightCm = null,
}: {
  artworkId: string;
  artistProfileId: string | null;
  /**
   * All photos belonging to this artwork, in display order (cover first).
   * The dialog lets the user switch between them; only the chosen one
   * is replaced on save (see Todo 4 — "all-shots" 2026-10-01).
   */
  images: ImageSlot[];
  /** Principal folder when acting-as. Otherwise the signed-in user. */
  storageOwnerId: string | null;
  onClose: () => void;
  onSaved: () => void;
  /**
   * 2026-10-02 — artwork cm dimensions forwarded from the parent page.
   * The dialog does not fetch the artwork row; it just passes these
   * values through so the Step 1 Advanced "작품 치수로" aspect chip
   * can offer a ratio locked to the real artwork size.
   */
  artworkWidthCm?: number | null;
  artworkHeightCm?: number | null;
}) {
  const { t } = useT();
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  /**
   * True while `file` holds only the small WebP display copy — the
   * original hi-res download is still in flight. See Todo 1 "open-fast"
   * (2026-10-01). Cleared the moment either the original lands or the
   * original download fails for good.
   */
  const [displayOnly, setDisplayOnly] = useState(false);
  const [replaced, setReplaced] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [enhancement, setEnhancement] = useState<EnhancementDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [preset, setPreset] = useState<EnhanceSessionPreset | null>(null);
  // Mirror `replaced` and `enhancement` into refs so the in-flight
  // download promises can see the latest values without having to
  // re-run the whole effect. Both must block the "swap display → original"
  // path: a replaced file is user-chosen work, and an enhancement draft
  // represents compute already spent against the display file.
  const replacedRef = useRef(false);
  useEffect(() => {
    replacedRef.current = replaced;
  }, [replaced]);
  const enhancementRef = useRef<EnhancementDraft | null>(null);
  useEffect(() => {
    enhancementRef.current = enhancement;
  }, [enhancement]);

  // Clamp `selectedIndex` into the current `images` range so an external
  // array shrink (e.g. a parallel delete) never leaves the thumb strip
  // without a highlighted tile or desyncs save() from what the user sees.
  const safeIndex = images.length === 0
    ? 0
    : Math.min(Math.max(0, selectedIndex), images.length - 1);
  const image = images[safeIndex];
  const thumbUrl = useMemo(
    () => (image ? getArtworkImageUrl(image.storage_path, "thumb") : null),
    [image],
  );

  useEffect(() => {
    setPreset(readEnhanceSessionPreset());
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  /**
   * Todo 1 — open-fast (2026-10-01).
   *
   * Prior behavior blocked the editor until the full-res original
   * finished downloading, which on gallery wifi can take 10+ seconds
   * and leaves the user looking at a single "Opening the image…" line.
   *
   * The new flow:
   *  1. Kick off the display WebP (same bytes the carousel already
   *     fetched for the row thumb) and set it as `file` the instant it
   *     arrives, flagged `displayOnly` so the UI can show a "high-res
   *     loading" chip.
   *  2. In PARALLEL start the original download. When it lands,
   *     overwrite `file` with the original UNLESS one of the guards
   *     below fires.
   *  3. Only surface `loadError` when BOTH downloads failed. A failed
   *     original with a successful display is silent — users can still
   *     work with the display copy.
   *  4. Reset per-image state (`enhancement`/`gate`/`replaced`) when
   *     the selected image changes so the result applies to the slot
   *     the user is actually looking at.
   */
  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    let originalApplied = false;

    setFile(null);
    setDisplayOnly(false);
    setLoadError(false);
    setEnhancement(null);
    setReplaced(false);

    const originalPath = image.original_storage_path?.trim() || "";
    const displayPath = image.storage_path;
    const samePath = !originalPath || originalPath === displayPath;

    let displayFailed = false;
    let originalFailed = false;

    const markBothFailed = () => {
      if (!cancelled && displayFailed && originalFailed) {
        setLoadError(true);
      }
    };

    const displayPromise = downloadArtworkFile(displayPath)
      .then((next) => {
        if (cancelled) return;
        if (!next.size) {
          displayFailed = true;
          markBothFailed();
          return;
        }
        // Do NOT overwrite when:
        //   - the original has already landed (don't downgrade),
        //   - the user picked a replacement file in the meantime,
        //   - the user already computed an enhancement draft (that
        //     work is tied to whatever `file` the editor currently
        //     holds and we must not remount it from under them).
        if (originalApplied || replacedRef.current || enhancementRef.current) return;
        setFile(next);
        setDisplayOnly(!samePath);
      })
      .catch(() => {
        if (cancelled) return;
        displayFailed = true;
        markBothFailed();
      });

    const originalPromise = samePath
      ? Promise.resolve()
      : downloadArtworkFile(originalPath)
          .then((next) => {
            if (cancelled) return;
            if (!next.size) {
              originalFailed = true;
              setDisplayOnly(false);
              markBothFailed();
              return;
            }
            // Preserve a user-chosen replacement OR an in-flight
            // enhancement draft — never clobber either with the
            // original we were silently fetching. In the enhancement
            // case we also silently drop `displayOnly` because the
            // chip only makes sense when the user hasn't started
            // working yet.
            if (replacedRef.current || enhancementRef.current) {
              setDisplayOnly(false);
              return;
            }
            originalApplied = true;
            setFile(next);
            setDisplayOnly(false);
            // Reset the derived analysis — the file identity just
            // changed under the ImageStandardizeEditor (its `key`
            // includes name/size/lastModified so it remounts, but
            // we still need to drop any computed enhancement/gate).
            setEnhancement(null);
          })
          .catch(() => {
            if (cancelled) return;
            originalFailed = true;
            setDisplayOnly(false);
            markBothFailed();
          });

    void Promise.all([displayPromise, originalPromise]);

    return () => {
      cancelled = true;
    };
    // We intentionally re-run when the selected slot's storage paths
    // change, including when `selectedIndex` moves between slots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.storage_path, image?.original_storage_path]);

  async function save() {
    const displayFile = enhancement?.displayFile ?? (replaced ? file : null);
    if (!displayFile || saving || !image) return;
    setSaving(true);
    setSaveError(false);
    const { data: { session } } = await getSession();
    const ownerId = storageOwnerId ?? session?.user?.id ?? null;
    if (!ownerId) {
      setSaving(false);
      setSaveError(true);
      return;
    }
    const { error } = await replaceArtworkDisplayImage({
      artworkId,
      ownerId,
      currentStoragePath: image.storage_path,
      currentOriginalPath: image.original_storage_path,
      displayFile,
      enhancementMeta: enhancement?.meta ?? null,
      replacementSource: replaced ? file : null,
    });
    if (error) {
      setSaving(false);
      setSaveError(true);
      return;
    }
    if (enhancement) {
      void recordUsageEvent({
        userId: session?.user?.id ?? undefined,
        key: USAGE_KEYS.AI_IMAGE_ENHANCE_COMPLETED,
        featureKey: "ai.image_enhance",
        metadata: {
          mode: enhancement.meta.mode,
          provider: enhancement.meta.provider,
          source: "bulk",
          latency_ms: enhancement.meta.latencyMs,
        },
      });
    }
    onSaved();
  }

  if (!mounted) return null;

  // Portaled to document.body so the scrim is a viewport layer. Inside
  // the center column, z-index cannot cover the right rail: that rail's
  // sticky box paints above the column's stacking context.
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-[calc(100dvh-1.5rem)] w-[min(1180px,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <div>
            <h2 id={titleId} className="text-sm font-medium text-zinc-900">
              {t("bulk.enhance.rowTitle")}
            </h2>
            {preset && (
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                {t("bulk.enhance.rowCarry")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            {t("bulk.enhance.rowClose")}
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
          {loadError && (
            <p className="text-sm text-red-600" role="alert">
              {t("bulk.enhance.rowLoadError")}
            </p>
          )}
          {/*
            Todo 1 — show the lightweight thumb immediately so the
            dialog has visible content from the very first paint. The
            thumb is dropped from the DOM as soon as the display WebP
            lands (`file` becomes non-null and the editor takes over).
          */}
          {!file && !loadError && thumbUrl && (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbUrl}
                alt=""
                className="max-h-full w-auto max-w-full rounded-lg border border-zinc-200 bg-zinc-100 object-contain"
                draggable={false}
              />
              <p className="text-xs text-zinc-500">
                {t("bulk.enhance.rowLoading")}
              </p>
            </div>
          )}
          {!file && !loadError && !thumbUrl && (
            <p className="text-sm text-zinc-500">{t("bulk.enhance.rowLoading")}</p>
          )}
          {file && displayOnly && (
            <p className="mb-2 inline-flex shrink-0 items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] text-amber-800">
              {t("bulk.enhance.rowDisplayOnly")}
            </p>
          )}
          {file && (
            <div className="min-h-0 flex-1">
              <ImageStandardizeEditor
                key={`${image?.id ?? image?.storage_path ?? "slot"}-${file.name}-${file.size}-${file.lastModified}`}
                file={file}
                value={null}
                onChange={() => {}}
                compact
                inEnhanceDialog
                onEnhance={setEnhancement}
                meteringSource="bulk"
                artistProfileId={artistProfileId}
                sharedPreset={preset}
                onSharedPreset={(next) => {
                  writeEnhanceSessionPreset(next);
                  setPreset(next);
                }}
                artworkWidthCm={artworkWidthCm}
                artworkHeightCm={artworkHeightCm}
              />
            </div>
          )}
          {/*
            Todo 4 — thumb strip. Only renders when the artwork has
            more than one slot. Clicking a thumb switches the active
            image, which drops local enhancement/gate/replaced state
            via the download effect above so the next save targets
            the chosen slot.
          */}
          {images.length > 1 && (
            <div className="mt-2 shrink-0">
              <p className="mb-2 text-[11px] text-zinc-500">
                {t("bulk.enhance.rowPick")}
              </p>
              <div className="flex gap-2 overflow-x-auto">
                {images.map((img, idx) => {
                  const url = getArtworkImageUrl(img.storage_path, "thumb");
                  const active = idx === safeIndex;
                  const isCover = idx === 0;
                  const key = img.id ?? img.storage_path ?? String(idx);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        if (idx === safeIndex) return;
                        setSelectedIndex(idx);
                      }}
                      aria-pressed={active}
                      className={`group relative overflow-hidden rounded-lg border-2 transition ${
                        active
                          ? "border-emerald-500 ring-2 ring-emerald-300"
                          : "border-zinc-200 hover:border-zinc-400"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                      title={isCover
                        ? t("bulk.enhance.rowPrimary")
                        : t("bulk.enhance.rowDetail")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt=""
                        className="h-16 w-16 object-cover sm:h-20 sm:w-20"
                        draggable={false}
                      />
                      <span
                        className={`absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[10px] ${
                          active
                            ? "bg-emerald-600 text-white"
                            : "bg-black/55 text-white"
                        }`}
                      >
                        {isCover
                          ? t("bulk.enhance.rowPrimary")
                          : t("bulk.enhance.rowDetail")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 px-4 py-3">
          <p
            className={`text-xs ${saveError ? "text-red-600" : "text-zinc-500"}`}
            role={saveError ? "alert" : "status"}
          >
            {saveError
              ? t("bulk.enhance.rowSaveError")
              : enhancement
                ? t("bulk.enhance.rowReady")
                : replaced
                  ? t("bulk.enhance.rowReplaceReady")
                  : t("bulk.enhance.rowNeedResult")}
          </p>
          <button
            type="button"
            disabled={(!enhancement && !replaced) || saving || !file}
            onClick={() => void save()}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? t("bulk.enhance.rowSaving") : t("bulk.enhance.rowSave")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
