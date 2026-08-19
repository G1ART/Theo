"use client";

/**
 * "+ 작품 추가" picker for the space editor.
 *
 * Sources (as tabs):
 *   • Saved   — artworks pulled from every shortlist the user owns.
 *   • Recent  — recent public artworks (proxy for "recently seen"
 *               because we don't yet persist a per-viewer recent list).
 *   • Search  — title/free-text search against `artworks.title*`
 *               (also queries the medium so a locale-neutral hit lands).
 *
 * Filtering:
 *   • Only `work_form === 'flat_2d'` (default for legacy) is offered.
 *     Sculpture / installation / time-based render a muted line above
 *     the tab bar promising "3D 시뮬은 곧 제공됩니다".
 *
 * The picker never modifies the DB directly — it hands the chosen
 * artwork back to the caller (`onPick`) so the editor can build the
 * placement row and route through its own optimistic path.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/useT";
import {
  getArtworkImageUrl,
  listPublicArtworks,
  type ArtworkWithLikes,
} from "@/lib/supabase/artworks";
import {
  listMyShortlists,
  listShortlistItems,
} from "@/lib/supabase/shortlists";
import type { Locale } from "@/lib/i18n/locale";
import { pickLocalizedArtworkTitle } from "@/lib/i18n/pickLocalized";

const PICKER_SELECT = `
  id,
  title,
  title_ko,
  title_en,
  artist_id,
  work_form,
  width_cm,
  height_cm,
  depth_cm,
  size,
  size_unit,
  visibility,
  artwork_images(storage_path, sort_order)
`;

type PickerArtwork = {
  id: string;
  title: string;
  titleKo: string | null;
  titleEn: string | null;
  artistId: string;
  imageUrl: string | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  /** Free-form legacy size (nullable). Kept so the SpaceEditor can
   *  re-parse when the structured columns are still empty for legacy
   *  rows the backfill migration couldn't resolve. */
  size: string | null;
  sizeUnit: "cm" | "in" | null;
  workForm:
    | "flat_2d"
    | "relief"
    | "sculpture_3d"
    | "installation"
    | "time_based";
};

function firstImagePath(
  images: { storage_path: string | null; sort_order: number | null }[] | null,
): string | null {
  if (!images || images.length === 0) return null;
  const sorted = [...images].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  return sorted[0]?.storage_path ?? null;
}

type RawPickerRow = {
  id: string;
  title: string | null;
  title_ko: string | null;
  title_en: string | null;
  artist_id: string;
  work_form:
    | "flat_2d"
    | "relief"
    | "sculpture_3d"
    | "installation"
    | "time_based"
    | null;
  width_cm: number | null;
  height_cm: number | null;
  depth_cm: number | null;
  size: string | null;
  size_unit: "cm" | "in" | null;
  visibility: string | null;
  artwork_images:
    | { storage_path: string | null; sort_order: number | null }[]
    | null;
};

function normalizeRow(row: RawPickerRow, locale: Locale): PickerArtwork {
  const path = firstImagePath(row.artwork_images);
  const workForm = row.work_form ?? "flat_2d";
  return {
    id: row.id,
    title:
      pickLocalizedArtworkTitle(
        {
          title: row.title,
          title_ko: row.title_ko,
          title_en: row.title_en,
        },
        locale,
      ) ||
      row.title ||
      "",
    titleKo: row.title_ko,
    titleEn: row.title_en,
    artistId: row.artist_id,
    imageUrl: path ? getArtworkImageUrl(path, "thumb") : null,
    widthCm: row.width_cm,
    heightCm: row.height_cm,
    depthCm: row.depth_cm,
    size: row.size,
    sizeUnit: row.size_unit,
    workForm,
  };
}

type TabKey = "saved" | "recent" | "search";

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (artwork: PickerArtwork) => void;
  /** Artworks already placed — dimmed so the user knows they can add
   *  duplicates but sees which are on the wall. Optional. */
  existingArtworkIds?: ReadonlySet<string>;
};

export function ArtworkPickerSheet({
  open,
  onClose,
  onPick,
  existingArtworkIds,
}: Props) {
  const { t, locale } = useT();
  const [tab, setTab] = useState<TabKey>("saved");
  const [saved, setSaved] = useState<PickerArtwork[]>([]);
  const [recent, setRecent] = useState<PickerArtwork[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<PickerArtwork[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setSavedLoading(true);
      const { data: lists } = await listMyShortlists();
      if (cancelled) return;
      const artworkIds = new Set<string>();
      for (const sl of lists) {
        const { data: items } = await listShortlistItems(sl.id);
        for (const it of items) {
          if (it.artwork_id) artworkIds.add(it.artwork_id);
        }
      }
      if (cancelled) return;
      if (artworkIds.size === 0) {
        setSaved([]);
        setSavedLoading(false);
        return;
      }
      const { data } = await supabase
        .from("artworks")
        .select(PICKER_SELECT)
        .in("id", Array.from(artworkIds));
      if (cancelled) return;
      const rows = (data ?? []) as unknown as RawPickerRow[];
      setSaved(rows.map((r) => normalizeRow(r, locale)));
      setSavedLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, locale]);

  useEffect(() => {
    if (!open || tab !== "recent" || recent.length > 0) return;
    let cancelled = false;
    (async () => {
      setRecentLoading(true);
      const { data } = await listPublicArtworks({ limit: 30, sort: "latest" });
      if (cancelled) return;
      // `listPublicArtworks` returns `ArtworkWithLikes` — massage into
      // PickerArtwork by re-hitting the picker projection. We can't
      // enrich per-row because the public list lacks `work_form`; do
      // a small `in()` re-select so the flat_2d filter is meaningful.
      const ids = data.map((row: ArtworkWithLikes) => row.id);
      if (ids.length === 0) {
        setRecent([]);
        setRecentLoading(false);
        return;
      }
      const { data: enriched } = await supabase
        .from("artworks")
        .select(PICKER_SELECT)
        .in("id", ids);
      if (cancelled) return;
      const rows = (enriched ?? []) as unknown as RawPickerRow[];
      // Preserve the `listPublicArtworks` ordering.
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = ids
        .map((id: string) => byId.get(id))
        .filter((r): r is RawPickerRow => Boolean(r));
      setRecent(ordered.map((r) => normalizeRow(r, locale)));
      setRecentLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tab, recent.length, locale]);

  useEffect(() => {
    if (tab !== "search") return;
    const q = searchQ.trim();
    if (q.length < 2) {
      // Reset the results when the query gets too short — this is a
      // legitimate synchronize-with-external-state pattern (the URL
      // query drives the visible list). See HANDOFF 2026-08-17 (13).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const handle = setTimeout(async () => {
      const like = `%${q.replace(/[%_]/g, "").slice(0, 60)}%`;
      const { data } = await supabase
        .from("artworks")
        .select(PICKER_SELECT)
        .or(`title.ilike.${like},title_ko.ilike.${like},title_en.ilike.${like}`)
        .eq("visibility", "public")
        .limit(30);
      if (cancelled) return;
      const rows = (data ?? []) as unknown as RawPickerRow[];
      setSearchResults(rows.map((r) => normalizeRow(r, locale)));
      setSearchLoading(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [tab, searchQ, locale]);

  const list = useMemo(() => {
    const raw =
      tab === "saved" ? saved : tab === "recent" ? recent : searchResults;
    return raw.filter((a) => a.workForm === "flat_2d");
  }, [tab, saved, recent, searchResults]);

  const loading =
    (tab === "saved" && savedLoading) ||
    (tab === "recent" && recentLoading) ||
    (tab === "search" && searchLoading);

  const handlePick = useCallback(
    (artwork: PickerArtwork) => {
      onPick(artwork);
    },
    [onPick],
  );

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("simulation.picker.title")}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">
            {t("simulation.picker.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600"
            aria-label={t("simulation.picker.close")}
          >
            ×
          </button>
        </header>

        <p className="px-4 pt-2 text-[11px] text-zinc-500">
          {t("simulation.picker.filterHint")}
        </p>

        <div
          role="tablist"
          className="mx-3 mb-2 mt-2 flex gap-1 rounded-lg bg-zinc-100 p-1"
        >
          {(["saved", "recent", "search"] as TabKey[]).map((k) => {
            const active = tab === k;
            return (
              <button
                key={k}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setTab(k)}
                className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-800"
                }`}
              >
                {t(`simulation.picker.tab.${k}`)}
              </button>
            );
          })}
        </div>

        {tab === "search" && (
          <div className="px-4 pb-2">
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder={t("simulation.picker.searchPlaceholder")}
              className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {loading ? (
            <p className="p-4 text-center text-sm text-zinc-500">
              {t("common.loading")}
            </p>
          ) : list.length === 0 ? (
            <p className="p-4 text-center text-sm text-zinc-500">
              {t("simulation.picker.empty")}
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {list.map((artwork) => {
                const already = existingArtworkIds?.has(artwork.id) ?? false;
                return (
                  <li key={artwork.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(artwork)}
                      aria-pressed={already}
                      className={`group relative flex w-full flex-col overflow-hidden rounded-lg border bg-white text-left transition-all hover:shadow-sm active:scale-[0.98] ${
                        already
                          ? "border-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.25)]"
                          : "border-zinc-200"
                      }`}
                    >
                      <span className="relative block aspect-square w-full bg-zinc-100">
                        {artwork.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={artwork.imageUrl}
                            alt={artwork.title || ""}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-[11px] text-zinc-400">
                            —
                          </span>
                        )}
                        {/*
                          P1 (2026-08-19) — "already hung on this wall"
                          indicator. Prior UI faded the whole card at
                          opacity 60 %, which readers reasonably
                          misread as "the artwork I just selected"
                          (they've picked nothing yet — the fade meant
                          "already placed"). A green ✓ badge + label is
                          unambiguous and doesn't dim the thumbnail
                          the user is trying to look at.
                        */}
                        {already && (
                          <>
                            <span
                              aria-hidden
                              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm"
                            >
                              <svg
                                viewBox="0 0 20 20"
                                fill="currentColor"
                                className="h-3.5 w-3.5"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </span>
                            <span className="absolute inset-x-0 bottom-0 bg-emerald-500/95 px-2 py-0.5 text-center text-[10px] font-medium text-white">
                              {t("simulation.picker.alreadyPlaced")}
                            </span>
                          </>
                        )}
                      </span>
                      <span className="block p-2">
                        <span className="block truncate text-xs font-medium text-zinc-800">
                          {artwork.title || "—"}
                        </span>
                        {(artwork.widthCm ?? 0) > 0 &&
                        (artwork.heightCm ?? 0) > 0 ? (
                          <span className="mt-0.5 block truncate text-[10px] text-zinc-500">
                            {`${Math.round(artwork.widthCm ?? 0)} × ${Math.round(
                              artwork.heightCm ?? 0,
                            )} cm`}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export type { PickerArtwork };
