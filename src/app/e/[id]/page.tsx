"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
          <header className="mb-8">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-zinc-900">{exhibition.title}</h1>
                <p className="mt-1 text-sm text-zinc-500">
                  {exhibition.start_date && exhibition.end_date
                    ? `${exhibition.start_date} – ${exhibition.end_date}`
                    : exhibition.start_date ?? ""}
                  {" · "}
                  {getExhibitionHostCuratorLabel(exhibition, t)}
                  {" · "}
                  {t(STATUS_LABELS[exhibition.status] ?? "exhibition.statusPlanned")}
                </p>
              </div>
              {userId && (
                <button
                  type="button"
                  onClick={() => setShortlistOpen(true)}
                  className="shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  {t("boards.save.cta")}
                </button>
              )}
            </div>
          </header>
          <SaveToShortlistModal exhibitionId={id} open={shortlistOpen} onClose={() => setShortlistOpen(false)} />

          {byArtist.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-medium text-zinc-700">{t("exhibition.byArtist")}</h2>
              <div className="space-y-6">
                {byArtist.map(({ artistId, artistName, list }) => (
                  <div key={artistId} className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <p className="mb-3 text-sm font-medium text-zinc-900">{artistName}</p>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                      {list.map((art) => {
                        const img = art.artwork_images?.[0]?.storage_path;
                        return (
                          <div key={art.id} className="relative">
                            <Link
                              href={`/artwork/${art.id}`}
                              className="block aspect-square overflow-hidden rounded border border-zinc-100 bg-zinc-100"
                            >
                              {img ? (
                                <Image
                                  src={getArtworkImageUrl(img, "thumb")}
                                  alt={art.title ?? ""}
                                  width={120}
                                  height={120}
                                  className="h-full w-full object-cover"
                                  sizes="120px"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
                                  No image
                                </div>
                              )}
                            </Link>
                            <div className="mt-1 truncate text-xs text-zinc-600">{art.title ?? "Untitled"}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {artworks.length === 0 && (
            <div className="mb-8">
              <EmptyState title={t("exhibition.noWorks")} size="sm" />
            </div>
          )}

          {mediaBuckets.map((bucket) => (
            <section key={bucket.key} className="mb-8">
              <h2 className="mb-3 text-sm font-medium text-zinc-700">{bucket.title}</h2>
              {bucket.items.length === 0 ? (
                <p className="rounded border border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                  {t("exhibition.noMediaYet")}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {bucket.items.map((m) => (
                    <div
                      key={m.id}
                      className="relative aspect-square overflow-hidden rounded border border-zinc-200 bg-zinc-100"
                    >
                      <Image
                        src={getArtworkImageUrl(m.storage_path, "thumb")}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="150px"
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
