"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n/useT";
import type { ArtworkWithLikes } from "@/lib/supabase/artworks";
import { EmptyState } from "@/components/ds";
import {
  ExhibitionPhotosTabPanel,
  type PhotoTabItem,
} from "@/components/exhibitions/ExhibitionPhotosTabPanel";
import { ExhibitionArtistTabPanel } from "@/components/exhibitions/ExhibitionArtistTabPanel";

/**
 * 2026-08-03 (Phase B redesign) — 전시 상세 하단을 탭 구조로 재조립.
 *
 * 배경: 디자이너 리뷰 (2026-08-03) — "포스터/크레딧/서문 아래로 모든
 * 사진·작품이 하나의 스크롤에 줄줄이 쌓여 스크롤 부담이 크고 뒤로
 * 갈수록 흥미가 떨어진다." 해결: `[Exhibition Photos] [Artist 1]
 * [Artist 2] ...` 탭으로 분리해 한 화면에 한 세션(사진 or 특정 작가)
 * 만 노출.
 *
 * 렌더 규칙:
 * - 탭 순서: Photos (사진이 있을 때만) → 작가 순 (`byArtist` 배열
 *   순서 그대로 = `exhibition_works.sort_order` 기반).
 * - 사진이 하나도 없으면 Photos 탭 자체를 감춤. 기본 활성 탭은 첫
 *   아티스트 탭.
 * - 단일 작가 전시도 탭 UI 를 그대로 유지 (`[Photos] [Alice]`) — UX
 *   일관성이 조건 분기 두 가지 레이아웃을 유지하는 것보다 명확.
 * - 작가가 0명이고 사진도 0장이면 (구조적으로 흔치 않지만) 상위에서
 *   빈 상태를 보여줄 수 있게 아무 탭도 없을 땐 empty message 출력.
 *
 * URL query state (`?section=photos` / `?section=artist-{idx}`) 를
 * router.replace 로 반영 — 뒤로가기·공유·새로고침 지원. 스크롤은
 * 유지 (`scroll: false`).
 */

export type ArtistGroup = {
  artistId: string;
  artistName: string;
  list: ArtworkWithLikes[];
};

export function ExhibitionSectionsTabbedView({
  exhibitionId,
  byArtist,
  photoItems,
  onUnonboardedArtistClick,
}: {
  exhibitionId: string;
  byArtist: ArtistGroup[];
  photoItems: PhotoTabItem[];
  onUnonboardedArtistClick: (
    externalArtistId: string,
    meta: { displayName: string; artworkId: string }
  ) => void;
}) {
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hasPhotos = photoItems.length > 0;

  const tabDefs = useMemo(() => {
    const defs: Array<
      | { kind: "photos"; id: "photos"; label: string }
      | { kind: "artist"; id: string; label: string; index: number; group: ArtistGroup }
    > = [];
    if (hasPhotos) {
      defs.push({ kind: "photos", id: "photos", label: t("exhibition.tab.photos") });
    }
    byArtist.forEach((g, i) => {
      defs.push({
        kind: "artist",
        id: `artist-${i}`,
        label: g.artistName,
        index: i,
        group: g,
      });
    });
    return defs;
  }, [hasPhotos, byArtist, t]);

  const defaultTabId = tabDefs[0]?.id ?? null;
  const rawSection = searchParams.get("section");
  const activeId = useMemo(() => {
    if (rawSection && tabDefs.some((d) => d.id === rawSection)) return rawSection;
    return defaultTabId;
  }, [rawSection, tabDefs, defaultTabId]);

  // URL 이 유효하지 않은 section 값을 갖고 있을 때 (예: 사진 탭을 링크로
  // 공유했는데 그 사이 사진이 전부 삭제됨) 한 번 정리해 첫 탭으로.
  useEffect(() => {
    if (!defaultTabId) return;
    if (rawSection && !tabDefs.some((d) => d.id === rawSection)) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("section");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSection, defaultTabId]);

  const setActive = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams.toString());
      // 첫 탭 (기본값) 일 때는 URL 을 깔끔하게 유지하기 위해 key 를 제거.
      if (id === defaultTabId) {
        next.delete("section");
      } else {
        next.set("section", id);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [defaultTabId, pathname, router, searchParams]
  );

  const tabRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const setTabRef = useCallback(
    (id: string) => (el: HTMLButtonElement | null) => {
      tabRefs.current.set(id, el);
    },
    []
  );

  const onTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, currentId: string) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const ids = tabDefs.map((d) => d.id);
      const idx = ids.indexOf(currentId);
      if (idx === -1) return;
      const nextIdx = e.key === "ArrowLeft" ? (idx - 1 + ids.length) % ids.length : (idx + 1) % ids.length;
      const nextId = ids[nextIdx];
      setActive(nextId);
      // Move focus to the newly activated tab so keyboard users can
      // continue arrowing without re-tabbing into the list.
      requestAnimationFrame(() => {
        tabRefs.current.get(nextId)?.focus();
      });
    },
    [tabDefs, setActive]
  );

  if (tabDefs.length === 0) {
    return <EmptyState title={t("exhibition.tab.empty.all")} size="sm" />;
  }

  return (
    <section>
      {/* 탭 바 — 얇은 밑줄 (활성=검정 2px + text-black, 비활성=text-zinc-400).
          라벨이 많거나 길면 가로 스크롤로 폴백. */}
      <div
        role="tablist"
        aria-label={t("exhibition.tab.photos")}
        className="mb-6 flex gap-6 overflow-x-auto border-b border-zinc-200 pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabDefs.map((def) => {
          const isActive = def.id === activeId;
          return (
            <button
              key={def.id}
              ref={setTabRef(def.id)}
              type="button"
              role="tab"
              id={`tab-${def.id}`}
              aria-selected={isActive}
              aria-controls={`tabpanel-${def.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(def.id)}
              onKeyDown={(e) => onTabKeyDown(e, def.id)}
              className={
                "relative shrink-0 whitespace-nowrap pb-2 text-sm font-medium transition-colors focus-visible:outline-none " +
                (isActive
                  ? "text-zinc-900 after:absolute after:-bottom-px after:left-0 after:right-0 after:h-0.5 after:bg-zinc-900"
                  : "text-zinc-400 hover:text-zinc-600")
              }
            >
              {def.label}
            </button>
          );
        })}
      </div>

      {/* 활성 탭 패널 — 하나만 마운트 (사진 뷰어의 state 는 탭 전환 시
          자연스럽게 리셋되며, 작가 탭은 다시 클릭해도 refetch 없음). */}
      {tabDefs.map((def) => {
        const isActive = def.id === activeId;
        if (!isActive) return null;
        return (
          <div
            key={def.id}
            id={`tabpanel-${def.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${def.id}`}
          >
            {def.kind === "photos" ? (
              <ExhibitionPhotosTabPanel items={photoItems} />
            ) : (
              <ExhibitionArtistTabPanel
                artistName={def.group.artistName}
                works={def.group.list}
                exhibitionId={exhibitionId}
                onUnonboardedArtistClick={onUnonboardedArtistClick}
              />
            )}
          </div>
        );
      })}
    </section>
  );
}
