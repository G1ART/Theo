"use client";

import { useT } from "@/lib/i18n/useT";
import type { ArtworkWithLikes } from "@/lib/supabase/artworks";
import { ExploreArtworkCard } from "@/components/explore/ExploreArtworkCard";
import { ExhibitionArtistSectionHeader } from "@/components/exhibitions/ExhibitionArtistSectionHeader";
import { EmptyState } from "@/components/ds";

/**
 * 2026-08-03 (Phase B redesign) — 활성 탭이 특정 작가일 때 렌더되는
 * 패널. 해당 작가의 작품만 2-col `ExploreArtworkCard` 그리드로 노출.
 *
 * - 헤더는 **미가입 작가일 때만** `ExhibitionArtistSectionHeader` 를
 *   재사용해 관심 등록 CTA (배지 + popover) 를 유지. 온보딩된 작가는
 *   탭 라벨 자체가 이미 작가 이름이므로 mini-header 를 생략해 반복
 *   렌더 방지.
 * - `suppressPassiveInterest={true}` — 탭 클릭 = 관심이 아니라
 *   탐색이라는 판단(2026-08-03 디자이너 리뷰). explicit CTA 클릭만
 *   신호로 카운트.
 */
export function ExhibitionArtistTabPanel({
  artistName,
  works,
  exhibitionId,
  onUnonboardedArtistClick,
}: {
  artistName: string;
  works: ArtworkWithLikes[];
  exhibitionId: string;
  onUnonboardedArtistClick: (
    externalArtistId: string,
    meta: { displayName: string; artworkId: string }
  ) => void;
}) {
  const { t } = useT();

  if (works.length === 0) {
    return <EmptyState title={t("exhibition.tab.empty.artist")} size="sm" />;
  }

  const first = works[0];
  const externalArtistIdOnFirst =
    (first as unknown as { claims?: Array<{ external_artist_id?: string | null }> }).claims
      ?.find((c) => c?.external_artist_id)?.external_artist_id ?? null;
  const showUnonboardedHeader = !!externalArtistIdOnFirst;

  return (
    <div>
      {showUnonboardedHeader && (
        <div className="mb-4">
          <ExhibitionArtistSectionHeader
            artistName={artistName}
            firstArtwork={first}
            exhibitionId={exhibitionId}
            suppressPassiveInterest
          />
        </div>
      )}
      <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2">
        {works.map((art) => (
          <ExploreArtworkCard
            key={art.id}
            artwork={art}
            onUnonboardedArtistClick={onUnonboardedArtistClick}
          />
        ))}
      </div>
    </div>
  );
}
