"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SaveToShortlistModal } from "@/components/SaveToShortlistModal";
import { BodyPortal } from "@/components/ui/BodyPortal";
import type { FollowRelation } from "@/lib/follow/relation";
import { formatIdentityPair } from "@/lib/identity/format";
import { useT } from "@/lib/i18n/useT";
import {
  EMPTY_LIKED_FILTERS,
  LIKED_SORTS,
  artistOptions,
  filterLikedWorks,
  filtersActive,
  kindOptions,
  priceBandOptions,
  sizeOptions,
  sortLikedWorks,
  summarizeLikedWorks,
  type LikedFilters,
  type LikedSort,
  type LikedStatusFilter,
  type LikedWork,
} from "@/lib/likes/likedWorksView";
import { searchArtworkHrefs } from "@/lib/search/artworkQuery";
import { getExternalArtistClaim, type ArtworkWithLikes } from "@/lib/supabase/artworks";
import { getFollowRelations } from "@/lib/supabase/follows";
import {
  forgetMyLikedWorks,
  listMyLikedWorks,
  peekMyLikedWorks,
  type LikedRow,
  type MyLikedWorks,
} from "@/lib/supabase/likedWorks";
import { unlike } from "@/lib/supabase/likes";
import { claimedOnboardedArtist, personUnderArtworkTitle } from "@/lib/upload/artworkOwner";
import { layer } from "@/lib/ui/layers";
import { LikedArtworkCard } from "./LikedArtworkCard";

type Props = {
  viewerId: string;
  /** Set while operating another account: likes stay the login's own. */
  actingLabel: string | null;
  onCountChange?: (count: number) => void;
};

const UNDO_MS = 6000;

// Filters and sort survive a trip to a detail and back.
let lastView: { filters: LikedFilters; sort: LikedSort } = { filters: EMPTY_LIKED_FILTERS, sort: "recent" };

type Translate = (key: string) => string;

function toLikedWork(row: LikedRow, t: Translate, locale: string): LikedWork<ArtworkWithLikes> {
  const artwork = row.artwork;
  const stored = artwork.profiles ?? null;
  const credited =
    personUnderArtworkTitle({
      storedArtist: stored,
      uploaderId: artwork.created_by ?? null,
      claimedArtist: claimedOnboardedArtist(artwork.claims, artwork.created_by ?? null),
    }) ?? stored;
  const external = getExternalArtistClaim(artwork);
  const ext = (external?.external_artists ?? null) as {
    display_name?: string | null;
    display_name_ko?: string | null;
    display_name_en?: string | null;
  } | null;
  const identity = external
    ? {
        display_name: ext?.display_name ?? null,
        display_name_ko: ext?.display_name_ko ?? null,
        display_name_en: ext?.display_name_en ?? null,
        username: null,
      }
    : credited;
  const { primary } = formatIdentityPair(identity, t, locale as "ko" | "en");
  const artistName = primary || "—";
  const hrefs = searchArtworkHrefs({
    artworkId: artwork.id,
    artistUsername: external ? "" : (credited?.username ?? ""),
    artistIsExternal: Boolean(external),
  });
  const creditedId = (credited as { id?: string } | null)?.id ?? null;
  const artistKey = external
    ? `ext:${external.external_artist_id ?? artistName}`
    : creditedId ?? artwork.artist_id;
  const ownerShown = !external && artwork.artist_id != null && (creditedId ?? artwork.artist_id) === artwork.artist_id;
  return {
    artwork,
    likedAt: row.likedAt,
    exhibition: row.exhibition,
    changes: row.changes,
    mine: row.mine,
    moreAvailable: row.moreAvailable,
    artistKey,
    artistName,
    artistHref: hrefs.artistHref,
    relationProfileId: ownerShown ? artwork.artist_id : null,
  };
}

// The last relations per viewer, so returning to the tab does not flash.
let lastRelations: { viewerId: string; relations: Map<string, FollowRelation> } | null = null;

function ChipSelect<V extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  options: Array<{ value: V; label: string }>;
}) {
  const active = value !== options[0]?.value;
  return (
    <label className="inline-flex">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as V)}
        className={`max-w-[12rem] cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 ${
          active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500"
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LikedWorksPanel({ viewerId, actingLabel, onCountChange }: Props) {
  const { t, locale } = useT();
  const [data, setData] = useState<MyLikedWorks | null>(() => peekMyLikedWorks(viewerId));
  const [loading, setLoading] = useState(() => peekMyLikedWorks(viewerId) == null);
  const [failed, setFailed] = useState(false);
  const [filters, setFilters] = useState<LikedFilters>(lastView.filters);
  const [sort, setSort] = useState<LikedSort>(lastView.sort);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [toastId, setToastId] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const timers = useRef(new Map<string, number>());
  const pendingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    lastView = { filters, sort };
  }, [filters, sort]);

  const applyResult = useCallback((next: MyLikedWorks | null, error: unknown) => {
    if (error || !next) {
      setFailed(Boolean(error));
      setLoading(false);
      return;
    }
    setFailed(false);
    setData(next);
    setLoading(false);
  }, []);

  const load = useCallback(() => {
    void listMyLikedWorks().then(({ data: next, error }) => applyResult(next, error));
  }, [applyResult]);

  useEffect(() => {
    let cancelled = false;
    void listMyLikedWorks().then(({ data: next, error }) => {
      if (!cancelled) applyResult(next, error);
    });
    return () => {
      cancelled = true;
    };
  }, [applyResult]);

  const total = data ? data.rows.length + data.unavailableIds.length : null;
  useEffect(() => {
    if (total != null) onCountChange?.(total);
  }, [total, onCountChange]);

  const commitUnlike = useCallback((artworkId: string) => {
    timers.current.delete(artworkId);
    pendingRef.current.delete(artworkId);
    void unlike(artworkId).then(({ error }) => {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(artworkId);
        return next;
      });
      setToastId((current) => (current === artworkId ? null : current));
      if (error) return;
      forgetMyLikedWorks([artworkId]);
      setData((prev) =>
        prev ? { ...prev, rows: prev.rows.filter((row) => row.artwork.id !== artworkId) } : prev,
      );
    });
  }, []);

  // Leaving the page (or the tab) commits every pending removal.
  useEffect(() => {
    const flush = () => {
      for (const [artworkId, timer] of timers.current) {
        window.clearTimeout(timer);
        timers.current.delete(artworkId);
        void unlike(artworkId);
        forgetMyLikedWorks([artworkId]);
      }
      pendingRef.current.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const toggleLike = useCallback(
    (artworkId: string) => {
      const timer = timers.current.get(artworkId);
      if (timer != null) {
        window.clearTimeout(timer);
        timers.current.delete(artworkId);
        pendingRef.current.delete(artworkId);
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(artworkId);
          return next;
        });
        setToastId((current) => (current === artworkId ? null : current));
        return;
      }
      pendingRef.current.add(artworkId);
      setPending((prev) => new Set(prev).add(artworkId));
      setToastId(artworkId);
      timers.current.set(
        artworkId,
        window.setTimeout(() => commitUnlike(artworkId), UNDO_MS),
      );
    },
    [commitUnlike],
  );

  const clearUnavailable = useCallback(async () => {
    if (!data || data.unavailableIds.length === 0 || clearing) return;
    setClearing(true);
    const ids = [...data.unavailableIds];
    const results = await Promise.all(ids.map((id) => unlike(id)));
    const cleared = ids.filter((_, index) => !results[index]?.error);
    forgetMyLikedWorks(cleared);
    setData((prev) =>
      prev ? { ...prev, unavailableIds: prev.unavailableIds.filter((id) => !cleared.includes(id)) } : prev,
    );
    setClearing(false);
  }, [data, clearing]);

  const items = useMemo(
    () => (data?.rows ?? []).map((row) => toLikedWork(row, t, locale)),
    [data, t, locale],
  );
  const [relations, setRelations] = useState<Map<string, FollowRelation>>(() =>
    lastRelations?.viewerId === viewerId ? lastRelations.relations : new Map(),
  );
  const relationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.relationProfileId && item.relationProfileId !== viewerId) ids.add(item.relationProfileId);
    }
    return [...ids].sort();
  }, [items, viewerId]);
  const relationKey = relationIds.join(",");
  useEffect(() => {
    if (!relationKey) return;
    let cancelled = false;
    void getFollowRelations(relationKey.split(",")).then(({ data: next, error }) => {
      if (cancelled || error) return;
      lastRelations = { viewerId, relations: next };
      setRelations(next);
    });
    return () => {
      cancelled = true;
    };
  }, [relationKey, viewerId]);
  const summary = useMemo(() => summarizeLikedWorks(items), [items]);
  const visible = useMemo(
    () => sortLikedWorks(filterLikedWorks(items, filters), sort, locale),
    [items, filters, sort, locale],
  );
  const artists = useMemo(() => artistOptions(items, locale), [items, locale]);
  const bands = useMemo(() => priceBandOptions(items), [items]);
  const kinds = useMemo(() => kindOptions(items), [items]);
  const sizes = useMemo(() => sizeOptions(items), [items]);

  const setStatus = (status: LikedStatusFilter) =>
    setFilters((prev) => ({ ...prev, status: prev.status === status ? "all" : status }));

  const kindLabel = (kind: string) =>
    kind === "print_edition"
      ? t("profile.kind.printEdition")
      : kind === "art_goods"
        ? t("profile.kind.artGoods")
        : kind === "collected"
          ? t("profile.kind.collected")
          : t("likes.kind.artwork");

  if (loading && !data) {
    return <p className="py-10 text-center text-sm text-zinc-500">{t("common.loading")}</p>;
  }

  if (failed && !data) {
    return (
      <div className="py-10 text-center text-sm text-zinc-600">
        <p>{t("likes.loadFailed")}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="mt-3 rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const unavailableCount = data?.unavailableIds.length ?? 0;

  if (items.length === 0 && unavailableCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
        <p className="text-sm font-medium text-zinc-900">{t("likes.empty.title")}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">{t("likes.empty.body")}</p>
        <Link
          href="/feed?tab=all&sort=latest"
          className="mt-5 inline-flex rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800"
        >
          {t("likes.empty.cta")}
        </Link>
        <p className="mt-6 text-xs text-zinc-400">{t("likes.privacy")}</p>
      </div>
    );
  }

  const summaryChips: Array<{ key: LikedStatusFilter; label: string; show: boolean }> = [
    { key: "all", label: t("likes.summary.all").replace("{n}", String(summary.all)), show: true },
    {
      key: "available",
      label: t("likes.summary.available").replace("{n}", String(summary.available)),
      show: summary.available > 0,
    },
    { key: "onView", label: t("likes.summary.onView").replace("{n}", String(summary.onView)), show: summary.onView > 0 },
    { key: "changed", label: t("likes.summary.changed").replace("{n}", String(summary.changed)), show: summary.changed > 0 },
  ];

  const toastWork = toastId ? items.find((item) => item.artwork.id === toastId) : null;

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-500">{t("likes.subtitle")}</p>
      {actingLabel ? (
        <p className="mb-4 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          {t("likes.actingNote").replace("{name}", actingLabel)}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        {summaryChips
          .filter((chip) => chip.show)
          .map((chip) => {
            const active = chip.key === "all" ? filters.status === "all" : filters.status === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={active}
                onClick={() => (chip.key === "all" ? setFilters((prev) => ({ ...prev, status: "all" })) : setStatus(chip.key))}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active ? "bg-zinc-900 text-white" : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
      </div>

      <div className="mb-3">
        <label className="block">
          <span className="sr-only">{t("likes.searchPlaceholder")}</span>
          <input
            type="search"
            value={filters.q}
            onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
            placeholder={t("likes.searchPlaceholder")}
            className="w-full rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none"
          />
        </label>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {artists.length > 1 ? (
          <ChipSelect
            label={t("likes.filter.artistAll")}
            value={filters.artist ?? ""}
            onChange={(value) => setFilters((prev) => ({ ...prev, artist: value || null }))}
            options={[
              { value: "", label: t("likes.filter.artistAll") },
              ...artists.map((artist) => ({ value: artist.key, label: `${artist.label} (${artist.count})` })),
            ]}
          />
        ) : null}
        <ChipSelect<LikedStatusFilter>
          label={t("likes.filter.statusAll")}
          value={filters.status}
          onChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
          options={[
            { value: "all", label: t("likes.filter.statusAll") },
            { value: "available", label: t("likes.status.available") },
            { value: "onView", label: t("likes.status.onView") },
            { value: "changed", label: t("likes.status.changed") },
            { value: "ask", label: t("likes.status.ask") },
            { value: "off", label: t("likes.status.off") },
          ]}
        />
        <ChipSelect
          label={t("likes.filter.priceAll")}
          value={filters.price ?? ""}
          onChange={(value) => setFilters((prev) => ({ ...prev, price: value || null }))}
          options={[
            { value: "", label: t("likes.filter.priceAll") },
            ...bands.map((band) => ({
              value: band,
              label: band.endsWith(":all") ? band.replace(":all", "") : t(`likes.band.${band}`),
            })),
            { value: "ask", label: t("likes.filter.priceAsk") },
          ]}
        />
        {sizes.length > 1 ? (
          <ChipSelect
            label={t("likes.filter.sizeAll")}
            value={filters.size ?? ""}
            onChange={(value) =>
              setFilters((prev) => ({ ...prev, size: (value || null) as LikedFilters["size"] }))
            }
            options={[
              { value: "", label: t("likes.filter.sizeAll") },
              ...sizes.map((size) => ({ value: size, label: t(`likes.size.${size}`) })),
            ]}
          />
        ) : null}
        {kinds.length > 1 ? (
          <ChipSelect
            label={t("likes.filter.kindAll")}
            value={filters.kind ?? ""}
            onChange={(value) => setFilters((prev) => ({ ...prev, kind: value || null }))}
            options={[
              { value: "", label: t("likes.filter.kindAll") },
              ...kinds.map((kind) => ({ value: kind, label: kindLabel(kind) })),
            ]}
          />
        ) : null}
        <div className="ml-auto">
          <ChipSelect<LikedSort>
            label={t("likes.sort.recent")}
            value={sort}
            onChange={setSort}
            options={LIKED_SORTS.map((key) => ({ value: key, label: t(`likes.sort.${key}`) }))}
          />
        </div>
        {filtersActive(filters) ? (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_LIKED_FILTERS)}
            className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
          >
            {t("likes.clearFilters")}
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">{t("likes.noMatch")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((item) => (
            <LikedArtworkCard
              key={item.artwork.id}
              item={item}
              viewerId={viewerId}
              removed={pending.has(item.artwork.id)}
              relation={item.relationProfileId ? (relations.get(item.relationProfileId) ?? null) : null}
              onToggleLike={toggleLike}
              onSaveToBoard={setBoardId}
            />
          ))}
        </div>
      )}

      {unavailableCount > 0 ? (
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-zinc-800">
              {t("likes.unavailable").replace("{n}", String(unavailableCount))}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">{t("likes.unavailableHint")}</p>
          </div>
          <button
            type="button"
            disabled={clearing}
            onClick={() => void clearUnavailable()}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500 disabled:opacity-50"
          >
            {t("likes.unavailableClear")}
          </button>
        </div>
      ) : null}

      <p className="mt-10 text-center text-xs text-zinc-400">{t("likes.privacy")}</p>

      <SaveToShortlistModal
        artworkId={boardId ?? undefined}
        open={boardId != null}
        onClose={() => {
          setBoardId(null);
          load();
        }}
      />

      {toastWork ? (
        <BodyPortal>
          <div
            role="status"
            className={`fixed bottom-6 left-1/2 ${layer.toast} flex -translate-x-1/2 items-center gap-3 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-lg`}
          >
            <span>{t("likes.removed")}</span>
            <button
              type="button"
              onClick={() => toggleLike(toastWork.artwork.id)}
              className="underline underline-offset-2"
            >
              {t("likes.undo")}
            </button>
          </div>
        </BodyPortal>
      ) : null}
    </div>
  );
}
