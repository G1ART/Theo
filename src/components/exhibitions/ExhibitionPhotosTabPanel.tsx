"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { useT } from "@/lib/i18n/useT";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { getPublicImageUrl } from "@/lib/supabase/storage";
import { EmptyState } from "@/components/ds";

/**
 * 2026-08-03 (Phase B redesign) — 전시 상세의 "Exhibition Photos" 탭.
 *
 * 이전에는 여러 전시 사진이 가로 스크롤 캐러셀로 나열됐지만, 디자이너
 * 리뷰(2026-08-03) 결과 스크롤 부담이 크다고 판단되어 **큰 이미지 하나
 * + 좌우 화살표** 로 단일 이미지 뷰어로 재조립. 데이터 모델(버킷별
 * exhibition_media)은 그대로 두고 상위(호출자)가 flatten 해서
 * `items: PhotoTabItem[]` 을 넘긴다.
 *
 * - Loop navigation (첫/마지막에서 disable 하지 않음) — 리스트가 짧을 때
 *   ← → 왕복이 자연스러움.
 * - PDF 는 기존 카드에서와 동일하게 처리: PDF 인 경우 새 탭에서 원본
 *   열기 링크, 렌더 실패 (extension 이 .pdf 인 경우) 는 아이콘 폴백.
 * - 키보드 접근성: 좌/우 화살표 키로 이동 (탭 패널이 focus 를 잡고 있을
 *   때). 화살표 버튼에도 aria-label 붙임.
 */

export type PhotoTabItem = {
  id: string;
  storage_path: string;
  media_kind?: "image" | "pdf";
  original_storage_path?: string | null;
  bucket_title?: string | null;
};

export function ExhibitionPhotosTabPanel({ items }: { items: PhotoTabItem[] }) {
  const { t } = useT();
  // Note: React 룰(`react-hooks/set-state-in-effect`) 위배를 피하려고
  // effect 로 items 변경 시 reset 하지 않는다. 대신 index 를 렌더 시
  // 클램프해 out-of-bounds 를 방지 — items 가 줄어들거나 완전히
  // 교체돼도 자동으로 유효 범위 안으로 붙는다. 상위 라우트가
  // 다른 전시로 이동하면 페이지 자체가 리마운트돼 자연스럽게 0으로
  // 초기화된다 (Next App Router 의 `/e/[id]` 파라미터 변경 시).
  const [rawIndex, setRawIndex] = useState(0);
  const total = items.length;
  const index = total === 0 ? 0 : Math.min(Math.max(rawIndex, 0), total - 1);

  const go = useCallback(
    (dir: -1 | 1) => {
      if (total <= 1) return;
      setRawIndex((i) => {
        const bounded = Math.min(Math.max(i, 0), total - 1);
        return (bounded + dir + total) % total;
      });
    },
    [total]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    },
    [go]
  );

  if (total === 0) {
    return <EmptyState title={t("exhibition.tab.empty.photos")} size="sm" />;
  }

  const current = items[index];
  const isPdf = current.media_kind === "pdf";
  const isIconFallback = isPdf && /\.pdf$/i.test(current.storage_path);
  const pdfOpenPath = current.original_storage_path ?? (isPdf ? current.storage_path : null);
  const pdfOpenUrl = pdfOpenPath ? getPublicImageUrl(pdfOpenPath) : null;
  const pdfOpenLabel = t("exhibition.pdfOpen");
  const pdfOpenHint = t("exhibition.pdfOpenHint");

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={t("exhibition.tab.photos")}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 rounded-md"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
        {isIconFallback ? (
          <a
            href={pdfOpenUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-full w-full flex-col items-center justify-center gap-2 bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
            title={pdfOpenHint}
          >
            <span aria-hidden="true" className="text-6xl">📄</span>
            <span className="text-sm font-medium">{pdfOpenLabel}</span>
          </a>
        ) : isPdf && pdfOpenUrl ? (
          <a
            href={pdfOpenUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block h-full w-full"
            title={pdfOpenHint}
          >
            <Image
              key={current.id}
              src={getArtworkImageUrl(current.storage_path, "medium")}
              alt=""
              fill
              className="object-contain"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 720px"
              priority
            />
          </a>
        ) : (
          <Image
            key={current.id}
            src={getArtworkImageUrl(current.storage_path, "medium")}
            alt=""
            fill
            className="object-contain"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 720px"
            priority
          />
        )}
        {isPdf && (
          <span
            className="pointer-events-none absolute left-3 top-3 rounded bg-blue-600/90 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white shadow"
            title={pdfOpenHint}
          >
            PDF
          </span>
        )}
        {total > 1 && (
          <>
            <button
              type="button"
              aria-label={t("exhibition.photos.prev")}
              onClick={() => go(-1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-zinc-700 shadow-md hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M15 6l-6 6 6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              aria-label={t("exhibition.photos.next")}
              onClick={() => go(1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-zinc-700 shadow-md hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M9 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        )}
      </div>

      {total > 1 && (
        <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
          <span aria-live="polite" aria-atomic="true">
            {t("exhibition.tab.photoIndex")
              .replace("{current}", String(index + 1))
              .replace("{total}", String(total))}
          </span>
          {current.bucket_title ? (
            <span className="max-w-[60%] truncate text-right">{current.bucket_title}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
