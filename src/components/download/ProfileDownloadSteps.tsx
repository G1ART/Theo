"use client";

import Image from "next/image";
import { useT } from "@/lib/i18n/useT";
import { getArtworkImageUrl, type ArtworkWithLikes } from "@/lib/supabase/artworks";
import { pickLocalizedArtworkTitle } from "@/lib/i18n/pickLocalized";
import { portfolioTemplateReady } from "@/lib/download/portfolio";
import type { BulkConfirmChoice } from "@/lib/download/preset";

type Mode = "order" | "confirm";

type Props = {
  mode: Mode;
  artworks: ArtworkWithLikes[];
  choice: BulkConfirmChoice;
  busy: boolean;
  error: string | null;
  onChoice: (choice: BulkConfirmChoice) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onNext: () => void;
  onBack: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const CHOICES: BulkConfirmChoice[] = ["png-zip", "jpeg-zip", "pdf"];

const CHOICE_KEY: Record<BulkConfirmChoice, string> = {
  "png-zip": "download.pngZip",
  "jpeg-zip": "download.jpegZip",
  pdf: "download.captionPdf",
};

export function ProfileDownloadSteps({
  mode,
  artworks,
  choice,
  busy,
  error,
  onChoice,
  onMove,
  onNext,
  onBack,
  onConfirm,
  onCancel,
}: Props) {
  const { t, locale } = useT();
  const portfolioReady = portfolioTemplateReady();

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900">
          {mode === "order" ? t("download.order") : t("download.confirmTitle")}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-50"
        >
          {t("common.cancel")}
        </button>
      </div>

      {mode === "order" ? (
        <>
          <p className="mb-3 text-xs text-zinc-500">{t("download.orderHint")}</p>
          <ol className="space-y-2">
            {artworks.map((artwork, index) => {
              const title =
                pickLocalizedArtworkTitle(artwork, locale) ||
                artwork.title ||
                t("download.untitled");
              const image = [...(artwork.artwork_images ?? [])].sort(
                (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
              )[0];
              return (
                <li
                  key={artwork.id}
                  className="flex items-center gap-3 rounded-md border border-zinc-200 px-2 py-2"
                >
                  <span className="w-6 text-center text-xs text-zinc-400">{index + 1}</span>
                  <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded bg-zinc-100">
                    {image?.storage_path ? (
                      <Image
                        src={getArtworkImageUrl(image.storage_path, "thumb")}
                        alt=""
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-900">{title}</span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      aria-label={t("download.moveUp")}
                      disabled={busy || index === 0}
                      onClick={() => onMove(index, -1)}
                      className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                    >
                      {t("download.moveUp")}
                    </button>
                    <button
                      type="button"
                      aria-label={t("download.moveDown")}
                      disabled={busy || index === artworks.length - 1}
                      onClick={() => onMove(index, 1)}
                      className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                    >
                      {t("download.moveDown")}
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onNext}
              disabled={busy || artworks.length === 0}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {t("download.next")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 text-xs text-zinc-500">{t("download.confirmHint")}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("download.format.title")}>
            {CHOICES.map((opt) => {
              const active = choice === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy}
                  onClick={() => onChoice(opt)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                    active
                      ? "bg-zinc-900 text-white"
                      : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  {t(CHOICE_KEY[opt])}
                </button>
              );
            })}
            <span className="inline-flex items-center rounded-full border border-dashed border-zinc-300 px-4 py-1.5 text-sm text-zinc-400">
              {portfolioReady ? t("download.portfolio") : t("download.portfolioNotReady")}
            </span>
          </div>
          {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onBack}
              disabled={busy}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {t("download.back")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy || artworks.length === 0}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy ? t("download.working") : t("download.action")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
