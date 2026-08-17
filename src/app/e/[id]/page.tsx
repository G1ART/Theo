"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Image from "next/image";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";
import { backToLabel } from "@/lib/i18n/back";
import { getExhibitionBack } from "@/lib/exhibitionBack";
import { ExhibitionHostCuratorCredits } from "@/lib/exhibitionCredits";
import { pickLocalizedTitle, pickLocalizedPreface, pickLocalizedVenueName } from "@/lib/i18n/pickLocalized";
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
import {
  getArtworksByIds,
  getArtworkImageUrl,
  getArtworkArtistLabel,
  getArtworkArtistGroupKey,
  type ArtworkWithLikes,
} from "@/lib/supabase/artworks";
import { ExhibitionSectionsTabbedView } from "@/components/exhibitions/ExhibitionSectionsTabbedView";
import type { PhotoTabItem } from "@/components/exhibitions/ExhibitionPhotosTabPanel";
import { UnonboardedArtistInterestPopover } from "@/components/artists/UnonboardedArtistInterestPopover";
import { getSession } from "@/lib/supabase/auth";
import { listMyDelegations } from "@/lib/supabase/delegations";
import { SaveToShortlistModal } from "@/components/SaveToShortlistModal";

const STATUS_LABELS: Record<string, string> = {
  planned: "exhibition.statusPlanned",
  live: "exhibition.statusLive",
  ended: "exhibition.statusEnded",
};

/**
 * 2026-07-29 hotfix — 대표 썸네일 방어적 렌더링.
 *
 * `exhibition.cover_image_paths` 는 exhibition_media / artwork_images 가
 * 나중에 삭제돼도 즉시 정리되지 않을 수 있다 (DB 트리거가 새로 생겼지만,
 * 과거에 이미 orphan 이 된 참조나 아직 백필 전인 데이터가 있을 수 있음).
 * 그런 경우 `<Image>` 가 404 storage 경로를 그려 큰 깨진 프레임을 보여주는
 * 대신, 다음 후보 경로로 순차 폴백하고 전부 실패하면 커버가 없을 때와
 * 동일한 빈 상태를 보여준다. `failedIndex` 는 useState 로만 전진하므로
 * (되돌아가지 않음) 재렌더가 반복 루프를 만들지 않는다.
 */
function ExhibitionPosterTile({ paths, alt }: { paths: string[]; alt: string }) {
  const [failedIndex, setFailedIndex] = useState(0);
  const activePath = paths[failedIndex];
  if (!activePath) {
    return <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400" />;
  }
  return (
    <Image
      key={activePath}
      src={getArtworkImageUrl(activePath, "medium")}
      alt={alt}
      fill
      className="object-cover"
      sizes="(max-width: 640px) 100vw, 220px"
      priority
      onError={() => setFailedIndex((i) => i + 1)}
    />
  );
}

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
  // QA 2026-07-29 (PART C.3) — explicit interest popover, opened from the
  // @handle badge on an unonboarded artist's ExploreArtworkCard within
  // this exhibition's grid.
  const [interestPopover, setInterestPopover] = useState<{
    externalArtistId: string;
    displayName: string;
    artworkId: string | null;
  } | null>(null);
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
      setError(
        exRes.error
          ? exRes.error instanceof Error
            ? exRes.error.message
            : t("common.notFound")
          : t("common.notFound")
      );
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
    // Defensive: never surface unpublished drafts on the public exhibition
    // page even if a draft was somehow linked (QA 2026-07-01).
    setArtworks((artList ?? []).filter((a) => a.visibility !== "draft"));
    setLoading(false);
  }, [id, t]);

  const mediaBuckets = useMemo(() => {
    const all = groupExhibitionMediaByBucket(media, (k) => t(k), mediaBucketRows);
    return all.filter((b) => b.items.length > 0);
  }, [media, mediaBucketRows, t]);

  /**
   * 2026-08-03 (Phase B redesign) — 탭 구조의 Exhibition Photos 패널이
   * 받아 쓰는 flat 리스트. bucket 별 순서 → sort_order 순서 그대로 이어
   * 붙임 (기존 캐러셀과 동일 순서). PDF row 는 `media_kind`/`original_storage_path`
   * 을 함께 실어 패널이 아이콘 폴백/원본 열기를 처리할 수 있게 한다.
   * bucket_title 은 아래 메타 라인 (예: "포스터", "전시전경") 표시용.
   */
  const photoItems: PhotoTabItem[] = useMemo(
    () =>
      mediaBuckets.flatMap((b) =>
        b.items.map((m) => ({
          id: m.id,
          storage_path: m.storage_path,
          media_kind: m.media_kind,
          original_storage_path: m.original_storage_path,
          bucket_title: b.title,
        }))
      ),
    [mediaBuckets]
  );

  const byArtist = useMemo(() => {
    const byId = new Map(artworks.map((a) => [a.id, a]));
    const ordered = works
      .map((w) => byId.get(w.work_id))
      .filter((a): a is ArtworkWithLikes => !!a);
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
              <ExhibitionPosterTile
                key={(exhibition.cover_image_paths ?? []).join("|")}
                paths={exhibition.cover_image_paths ?? []}
                alt={pickLocalizedTitle(exhibition, locale) || exhibition.title || ""}
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
                {pickLocalizedTitle(exhibition, locale) || exhibition.title}
              </h1>
              <dl className="mt-3 space-y-1 text-sm text-zinc-600">
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-zinc-400">
                    {t("exhibition.curatorLabel")}
                  </dt>
                  <dd className="min-w-0">
                    <ExhibitionHostCuratorCredits exhibition={exhibition} t={t} locale={locale} />
                  </dd>
                </div>
                {(exhibition.start_date || exhibition.end_date) && (
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-zinc-400">
                      {t("exhibition.datesLabel")}
                    </dt>
                    <dd className="min-w-0">
                      {exhibition.start_date && exhibition.end_date
                        ? `${exhibition.start_date} – ${exhibition.end_date}`
                        : exhibition.start_date ?? ""}
                    </dd>
                  </div>
                )}
                {pickLocalizedVenueName(exhibition, locale) && (
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-zinc-400">
                      {t("exhibition.locationLabel")}
                    </dt>
                    <dd className="min-w-0">
                      {pickLocalizedVenueName(exhibition, locale)}
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
          <SaveToShortlistModal
            exhibitionId={id}
            open={shortlistOpen}
            onClose={() => setShortlistOpen(false)}
          />

          {/*
            QA 2026-07-28 — 서문(preface) 렌더. 큐레이터가 작성한 소개문을
            공개 상세에서 works grid 위에 노출. 언어는 pickLocalizedPreface
            로 UI locale 우선, 상대 언어 fallback. 값이 비어 있으면 아무
            것도 렌더링하지 않아 기존 전시 상세와 동일하게 보인다.
          */}
          {pickLocalizedPreface(exhibition, locale) && (
            <section className="mb-10">
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-700">
                {pickLocalizedPreface(exhibition, locale)}
              </p>
            </section>
          )}

          {/*
            2026-08-03 (Phase B redesign) — 이 아래는 이전에 (1) 사진
            캐러셀 → (2) 작가별 그룹 스택 순으로 세로 쌓여 있어 스크롤이
            길었다. 이제 하나의 탭 컨트롤 (`[Exhibition Photos] [Artist
            A] [Artist B] ...`) 로 통합해 화면 하나에 한 세션만 노출.

            `useSearchParams` 를 쓰는 자식 컴포넌트라 정적 프리렌더 시
            Suspense fallback 이 필요 — 뷰는 이미 클라이언트 fetch 이후
            렌더되므로 빈 fallback 으로 충분.
          */}
          <Suspense fallback={null}>
            <ExhibitionSectionsTabbedView
              exhibitionId={id}
              byArtist={byArtist}
              photoItems={photoItems}
              onUnonboardedArtistClick={(externalArtistId, meta) =>
                setInterestPopover({
                  externalArtistId,
                  displayName: meta.displayName,
                  artworkId: meta.artworkId,
                })
              }
            />
          </Suspense>
          {interestPopover && (
            <UnonboardedArtistInterestPopover
              open={!!interestPopover}
              onClose={() => setInterestPopover(null)}
              externalArtistId={interestPopover.externalArtistId}
              displayName={interestPopover.displayName}
              contextArtworkId={interestPopover.artworkId}
              contextExhibitionId={id}
            />
          )}
        </>
      )}
    </main>
  );
}
