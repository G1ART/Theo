"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Image from "next/image";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";
import { backToLabel } from "@/lib/i18n/back";
import { getExhibitionBack } from "@/lib/exhibitionBack";
import { getExhibitionHostCuratorLabel } from "@/lib/exhibitionCredits";
import {
  ensureDefaultExhibitionMediaBuckets,
  getExhibitionById,
  listExhibitionMedia,
  listExhibitionMediaBuckets,
  listWorksInExhibition,
  groupExhibitionMediaByBucket,
  type ExhibitionMediaBucketRow,
  type ExhibitionMediaRow,
  type ExhibitionRow,
  type ExhibitionWorkRow,
} from "@/lib/supabase/exhibitions";
import { getArtworksByIds, getArtworkImageUrl, getArtworkArtistLabel, getArtworkArtistGroupKey, type ArtworkWithLikes } from "@/lib/supabase/artworks";
import { ExploreArtworkCard } from "@/components/explore/ExploreArtworkCard";
import { getSession } from "@/lib/supabase/auth";
import { listMyDelegations } from "@/lib/supabase/delegations";
import { SaveToShortlistModal } from "@/components/SaveToShortlistModal";
import { EmptyState } from "@/components/ds";

const STATUS_LABELS: Record<string, string> = {
  planned: "exhibition.statusPlanned",
  live: "exhibition.statusLive",
  ended: "exhibition.statusEnded",
};

export default function PublicExhibitionPage() {
  const params = useParams();
  const { t, locale } = useT();
  const id = typeof params.id === "string" ? params.id : "";
  const [exhibition, setExhibition] = useState<ExhibitionRow | null>(null);
  const [works, setWorks] = useState<ExhibitionWorkRow[]>([]);
  const [artworks, setArtworks] = useState<ArtworkWithLikes[]>([]);
  const [media, setMedia] = useState<ExhibitionMediaRow[]>([]);
  const [mediaBucketRows, setMediaBucketRows] = useState<ExhibitionMediaBucketRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [back, setBack] = useState<{ path: string; labelKey: string }>({
    path: "/feed",
    labelKey: "nav.feed",
  });

  useEffect(() => {
    // Read the entry context on the client only (sessionStorage) so the visitor
    // returns to where they came from (profile, room, shortlist…), not always feed.
    setBack(getExhibitionBack());
  }, []);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    await ensureDefaultExhibitionMediaBuckets(id);
    const [exRes, worksRes, mediaRes, bucketRes, sessionRes] = await Promise.all([
      getExhibitionById(id),
      listWorksInExhibition(id),
      listExhibitionMedia(id),
      listExhibitionMediaBuckets(id),
      getSession(),
    ]);
    const session = sessionRes?.data?.session;
    const uid = session?.user?.id ?? null;
    setUserId(uid);
    if (exRes.error || !exRes.data) {
      setCanManage(false);
      setLoading(false);
      setError(exRes.error ? (exRes.error instanceof Error ? exRes.error.message : t("common.notFound")) : t("common.notFound"));
      return;
    }
    setExhibition(exRes.data);
    setWorks(worksRes.data ?? []);
    setMedia(mediaRes.data ?? []);
    setMediaBucketRows(bucketRes.data ?? []);
    const isCuratorOrHost =
      !!uid &&
      (exRes.data.curator_id === uid || exRes.data.host_profile_id === uid);
    if (uid && !isCuratorOrHost) {
      const { data: delegations } = await listMyDelegations();
      const isDelegate = (delegations?.received ?? []).some(
        (d) =>
          d.scope_type === "project" &&
          d.status === "active" &&
          d.project_id === id
      );
      setCanManage(isDelegate);
    } else {
      setCanManage(!!isCuratorOrHost);
    }
    if ((worksRes.data ?? []).length === 0) {
      setArtworks([]);
      setLoading(false);
      return;
    }
    const { data: artList } = await getArtworksByIds(worksRes.data!.map((w) => w.work_id));
    setArtworks(artList ?? []);
    setLoading(false);
  }, [id]);

  const mediaBuckets = useMemo(() => {
    const all = groupExhibitionMediaByBucket(media, (k) => t(k), mediaBucketRows);
    return all.filter((b) => b.items.length > 0);
  }, [media, mediaBucketRows, t]);

  const byArtist = useMemo(() => {
    const byId = new Map(artworks.map((a) => [a.id, a]));
    const ordered = works.map((w) => byId.get(w.work_id)).filter((a): a is ArtworkWithLikes => !!a);
    const map = new Map<string, ArtworkWithLikes[]>();
    const nameMap = new Map<string, string>();
    const order: string[] = [];
    for (const a of ordered) {
      const { label } = getArtworkArtistLabel(a);
      // Group by external_artist_id when present so that several invited
      // (not-yet-onboarded) artists uploaded by one gallery — which share the
      // gallery's artist_id — each get their own section instead of collapsing
      // under the first artist's name.
      const key = getArtworkArtistGroupKey(a);
      if (!map.has(key)) {
        map.set(key, []);
        nameMap.set(key, label ?? t("artwork.artistFallback"));
        order.push(key);
      }
      map.get(key)!.push(a);
    }
    return order.map((key) => ({
      artistId: key,
      artistName: nameMap.get(key) ?? t("artwork.artistFallback"),
      list: map.get(key) ?? [],
    }));
  }, [artworks, works, t]);

  const isOwner = canManage;

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!id) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-zinc-600">{t("common.invalid") ?? "Invalid exhibition."}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href={back.path} className="text-sm text-zinc-600 hover:text-zinc-900">
          ← {backToLabel(t(back.labelKey as MessageKey), locale)}
        </Link>
        {isOwner && (
          <>
            <span className="text-zinc-400">|</span>
            <Link href={`/my/exhibitions/${id}`} className="text-sm text-zinc-600 hover:text-zinc-900">
              {t("exhibition.manageExhibition") ?? "전시 관리"}
            </Link>
          </>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">{t("common.loading")}</p>
      ) : !exhibition ? (
        <p className="text-zinc-600">{error ?? "Exhibition not found."}</p>
      ) : (
        <>
          {/* Wireframe hero: portrait cover on the left, meta stack on the
              right. On mobile the two halves stack vertically. */}
          <header className="mb-10 grid gap-6 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-start">
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
              {(exhibition.cover_image_paths ?? [])[0] ? (
                <Image
                  src={getArtworkImageUrl(exhibition.cover_image_paths![0], "medium")}
                  alt={exhibition.title ?? ""}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 100vw, 220px"
                  priority
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400" />
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
                {exhibition.title}
              </h1>
              <dl className="mt-3 space-y-1 text-sm text-zinc-600">
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-zinc-400">
                    {t("exhibition.curatorLabel")}
                  </dt>
                  <dd className="min-w-0">{getExhibitionHostCuratorLabel(exhibition, t)}</dd>
                </div>
                {(exhibition.start_date || exhibition.end_date) && (
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-zinc-400">
                      {t("exhibition.locationLabel")}
                    </dt>
                    <dd className="min-w-0">
                      {exhibition.start_date && exhibition.end_date
                        ? `${exhibition.start_date} – ${exhibition.end_date}`
                        : exhibition.start_date ?? ""}
                    </dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-zinc-400">
                    {t("exhibition.infoLabel")}
                  </dt>
                  <dd className="min-w-0">
                    {t(STATUS_LABELS[exhibition.status] ?? "exhibition.statusPlanned")}
                  </dd>
                </div>
              </dl>
              {userId && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setShortlistOpen(true)}
                    className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    {t("boards.save.cta")}
                  </button>
                </div>
              )}
            </div>
          </header>
          <SaveToShortlistModal exhibitionId={id} open={shortlistOpen} onClose={() => setShortlistOpen(false)} />

          {/* Exhibition Photos — merged media buckets rendered as a single
              horizontal carousel per wireframe. Keeps the original
              per-bucket data model but flattens the display so viewers get
              one scroll gesture, not one per bucket. */}
          {mediaBuckets.some((b) => b.items.length > 0) && (
            <section className="mb-10">
              <h2 className="mb-3 text-lg font-semibold text-zinc-900">
                {t("exhibition.photos")}
              </h2>
              <ExhibitionPhotosCarousel
                items={mediaBuckets.flatMap((b) =>
                  b.items.map((m) => ({ id: m.id, storage_path: m.storage_path }))
                )}
              />
            </section>
          )}

          {/* Artwork curated — 2-col grid of ExploreArtworkCard. Preserves
              artist-grouping semantics via the underlying data. When the
              exhibition has no works, show the existing empty state. */}
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold text-zinc-900">
              {t("exhibition.curated")}
            </h2>
            {artworks.length === 0 ? (
              <EmptyState title={t("exhibition.noWorks")} size="sm" />
            ) : (
              <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2">
                {byArtist.flatMap(({ list }) =>
                  list.map((art) => (
                    <ExploreArtworkCard key={art.id} artwork={art} />
                  ))
                )}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

type CarouselItem = { id: string; storage_path: string };

/**
 * Simple horizontal carousel for exhibition photos. Uses native scroll
 * (snap + smooth) so keyboard / trackpad / touch all Just Work; the
 * arrows only drive `scrollBy` when the user prefers to click. No
 * external deps — the exhibition detail page is otherwise lightweight
 * and we don't want to pull in a slider lib for a low-frequency surface.
 */
function ExhibitionPhotosCarousel({ items }: { items: CarouselItem[] }) {
  const trackRef = useRef<HTMLDivElement>(null);

  function scrollBy(dir: -1 | 1) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 320), behavior: "smooth" });
  }

  return (
    <div className="relative">
      <div
        ref={trackRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-2"
      >
        {items.map((m) => (
          <div
            key={m.id}
            className="relative aspect-[16/9] w-[85%] shrink-0 snap-start overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 sm:w-[70%] lg:w-[60%]"
          >
            <Image
              src={getArtworkImageUrl(m.storage_path, "medium")}
              alt=""
              fill
              className="object-cover"
              sizes="(max-width: 640px) 85vw, (max-width: 1280px) 70vw, 60vw"
            />
          </div>
        ))}
      </div>
      {items.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous"
            onClick={() => scrollBy(-1)}
            className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 p-2 text-zinc-700 shadow-md hover:bg-white sm:inline-flex"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => scrollBy(1)}
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 p-2 text-zinc-700 shadow-md hover:bg-white sm:inline-flex"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
