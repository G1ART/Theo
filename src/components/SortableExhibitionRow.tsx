"use client";

import Image from "next/image";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ExhibitionWithCredits } from "@/lib/supabase/exhibitions";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { getExhibitionHostCuratorLabel } from "@/lib/exhibitionCredits";
import { useT } from "@/lib/i18n/useT";
import { pickLocalizedTitle } from "@/lib/i18n/pickLocalized";

function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="6" cy="4" r="1.5" />
      <circle cx="10" cy="4" r="1.5" />
      <circle cx="6" cy="8" r="1.5" />
      <circle cx="10" cy="8" r="1.5" />
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="10" cy="12" r="1.5" />
    </svg>
  );
}

type Props = {
  exhibition: ExhibitionWithCredits;
};

/**
 * Drag-sortable list row for exhibitions in reorder mode.
 *
 * The row intentionally does NOT navigate (no anchor) while reordering — the
 * grip handle is the only interactive surface. This mirrors how
 * `SortableArtworkCard` disables card navigation in reorder mode.
 */
export function SortableExhibitionRow({ exhibition }: Props) {
  const { t, locale } = useT();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: exhibition.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const firstCover = (exhibition.cover_image_paths ?? [])[0];

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-2.5 shadow-sm ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded p-1 text-zinc-400 hover:text-zinc-600 active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label={t("profile.reorder")}
      >
        <GripIcon />
      </button>
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
        {firstCover ? (
          <Image
            src={getArtworkImageUrl(firstCover, "thumb")}
            alt=""
            fill
            className="object-cover"
            sizes="56px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-400">·</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-900">
          {pickLocalizedTitle(exhibition, locale) || exhibition.title}
        </p>
        <p className="truncate text-xs text-zinc-500">
          {exhibition.start_date && exhibition.end_date
            ? `${exhibition.start_date} – ${exhibition.end_date}`
            : exhibition.start_date ?? exhibition.status}
          {" · "}
          {getExhibitionHostCuratorLabel(exhibition, t, locale)}
        </p>
      </div>
    </li>
  );
}
