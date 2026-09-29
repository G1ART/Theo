"use client";

import { useEffect, useId, useState } from "react";
import {
  ImageStandardizeEditor,
  type EnhancementDraft,
  type QualityGateSurfaceState,
} from "@/components/upload/ImageStandardizeEditor";
import { replaceArtworkDisplayImage } from "@/lib/supabase/artworks";
import { getSession } from "@/lib/supabase/auth";
import { downloadArtworkFile } from "@/lib/supabase/storage";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import { useT } from "@/lib/i18n/useT";

type ImageSlot = {
  storage_path: string;
  original_storage_path?: string | null;
};

export function BulkEnhanceDialog({
  artworkId,
  artistProfileId,
  image,
  storageOwnerId,
  onClose,
  onSaved,
}: {
  artworkId: string;
  artistProfileId: string | null;
  image: ImageSlot;
  /** Principal folder when acting-as. Otherwise the signed-in user. */
  storageOwnerId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const titleId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [enhancement, setEnhancement] = useState<EnhancementDraft | null>(null);
  const [gate, setGate] = useState<QualityGateSurfaceState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    const source = image.original_storage_path?.trim() || image.storage_path;
    void downloadArtworkFile(source)
      .then((next) => {
        if (cancelled) return;
        if (!next.size) {
          setLoadError(true);
          return;
        }
        setFile(next);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [image.original_storage_path, image.storage_path]);

  const gateBlocked =
    !!gate &&
    !gate.degraded &&
    !gate.dismissed &&
    gate.severity === "block" &&
    !gate.override;

  async function save() {
    if (!enhancement || saving || gateBlocked) return;
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
      displayFile: enhancement.displayFile,
      enhancementMeta: enhancement.meta,
    });
    if (error) {
      setSaving(false);
      setSaveError(true);
      return;
    }
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
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 px-3 py-6 sm:items-center sm:px-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(92vh,880px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <div>
            <h2 id={titleId} className="text-sm font-medium text-zinc-900">
              {t("bulk.enhance.rowTitle")}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              {t("bulk.enhance.rowHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            {t("bulk.enhance.rowClose")}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loadError && (
            <p className="text-sm text-red-600" role="alert">
              {t("bulk.enhance.rowLoadError")}
            </p>
          )}
          {!file && !loadError && (
            <p className="text-sm text-zinc-500">{t("bulk.enhance.rowLoading")}</p>
          )}
          {file && (
            <ImageStandardizeEditor
              file={file}
              value={null}
              onChange={() => {}}
              compact
              onEnhance={setEnhancement}
              onQualityGate={setGate}
              meteringSource="bulk"
              artistProfileId={artistProfileId}
            />
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-3">
          <p
            className={`text-xs ${saveError ? "text-red-600" : "text-zinc-500"}`}
            role={saveError ? "alert" : "status"}
          >
            {saveError
              ? t("bulk.enhance.rowSaveError")
              : enhancement
                ? t("bulk.enhance.rowReady")
                : t("bulk.enhance.rowNeedResult")}
          </p>
          <button
            type="button"
            disabled={!enhancement || saving || gateBlocked || !file}
            onClick={() => void save()}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? t("bulk.enhance.rowSaving") : t("bulk.enhance.rowSave")}
          </button>
        </div>
      </div>
    </div>
  );
}
