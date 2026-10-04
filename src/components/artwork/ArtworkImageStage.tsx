"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { useT } from "@/lib/i18n/useT";
import { BodyPortal } from "@/components/ui/BodyPortal";
import { layer } from "@/lib/ui/layers";

type SortedImage = {
  storage_path: string;
  view_type?: string | null;
};

/**
 * Sprint 4 — extracted Passport image stage.
 * QA 2026-06-26 (#2/#5) — extended to a real carousel when an artwork
 * has more than one `artwork_images` row. The carousel preserves the
 * existing single-image contract (matte 1:1 container, object-contain,
 * desktop click-to-open at original size) and adds:
 *   - prev/next chevrons + dot pager,
 *   - keyboard ←/→ navigation when focused,
 *   - thumbnail strip below the stage with view-type label,
 *   - "view N of M · {viewType}" caption overlay (read by SR users too).
 * The lightbox now shows the CURRENT slide, not always slide 0, so
 * "open at original size" works for every image in the carousel.
 */
export function ArtworkImageStage({
  sortedImages,
  title,
  isDesktop,
  fullSizeOpen,
  onOpenFullSize,
  onCloseFullSize,
}: {
  sortedImages: SortedImage[];
  title: string | null;
  isDesktop: boolean;
  fullSizeOpen: boolean;
  onOpenFullSize: () => void;
  onCloseFullSize: () => void;
}) {
  const { t } = useT();
  const hasImage = sortedImages.length > 0;
  const canOpen = isDesktop && hasImage;
  const altLabel = title ?? t("common.untitled");
  const [index, setIndex] = useState(0);

  // If the underlying image set shrinks (e.g. user deletes images in
  // a future edit surface), bring the cursor back into range so we
  // never render an undefined slide.
  useEffect(() => {
    if (index >= sortedImages.length && sortedImages.length > 0) {
      setIndex(0);
    }
  }, [sortedImages.length, index]);

  const current = hasImage ? sortedImages[Math.min(index, sortedImages.length - 1)] : null;
  const viewTypeLabel = current?.view_type
    ? t(`upload.viewType.${current.view_type}`)
    : null;

  function go(delta: number) {
    if (sortedImages.length <= 1) return;
    setIndex((i) => {
      const next = (i + delta + sortedImages.length) % sortedImages.length;
      return next;
    });
  }

  return (
    <div className="space-y-2">
      <div
        className={`relative aspect-square w-full overflow-hidden rounded-lg bg-zinc-100 ${canOpen ? "cursor-zoom-in" : ""}`}
        role={canOpen ? "button" : undefined}
        tabIndex={hasImage ? 0 : undefined}
        onClick={() => {
          if (canOpen) onOpenFullSize();
        }}
        onKeyDown={(e) => {
          if (!hasImage) return;
          if (e.key === "ArrowRight") {
            e.preventDefault();
            go(1);
            return;
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(-1);
            return;
          }
          if (canOpen && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onOpenFullSize();
          }
        }}
      >
        {current ? (
          <Image
            src={getArtworkImageUrl(current.storage_path, "medium")}
            alt={altLabel}
            width={600}
            height={600}
            sizes="(max-width: 768px) 100vw, 600px"
            priority
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-zinc-400">
            {t("artwork.noImage")}
          </div>
        )}
        {sortedImages.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              aria-label={t("artwork.carouselPrev")}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/85 px-2 py-1 text-sm text-zinc-800 shadow hover:bg-white"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); go(1); }}
              aria-label={t("artwork.carouselNext")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/85 px-2 py-1 text-sm text-zinc-800 shadow hover:bg-white"
            >
              ›
            </button>
            <div
              role="status"
              aria-live="polite"
              className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white"
            >
              {t("artwork.carouselCounter")
                .replace("{n}", String(index + 1))
                .replace("{total}", String(sortedImages.length))}
              {viewTypeLabel ? ` · ${viewTypeLabel}` : ""}
            </div>
          </>
        )}
      </div>
      {sortedImages.length > 1 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("artwork.carouselThumbs")}>
          {sortedImages.map((img, i) => {
            const active = i === index;
            return (
              <li key={`${img.storage_path}-${i}`}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-current={active ? "true" : undefined}
                  className={`h-12 w-12 overflow-hidden rounded border ${active ? "border-zinc-900" : "border-zinc-200 hover:border-zinc-400"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getArtworkImageUrl(img.storage_path, "thumb")}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {fullSizeOpen && current ? (
        <BodyPortal>
          <div
            className={`fixed inset-0 ${layer.scrim} flex items-center justify-center bg-black/80 p-4`}
            role="dialog"
            aria-modal="true"
            aria-label={altLabel}
            onClick={onCloseFullSize}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getArtworkImageUrl(current.storage_path, "original")}
              alt={altLabel}
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </BodyPortal>
      ) : null}
    </div>
  );
}
