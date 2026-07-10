"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setExhibitionBack } from "@/lib/exhibitionBack";
import {
  getExhibitionHostCuratorLabel,
  type ExhibitionWithCredits,
} from "@/lib/exhibitionCredits";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { useT } from "@/lib/i18n/useT";

type Props = {
  exhibition: ExhibitionWithCredits;
  /** Blur meta info + route clicks to /onboarding (signup) for anonymous viewers. */
  locked?: boolean;
};

function pickYear(row: { start_date?: string | null; created_at?: string | null }): string | null {
  const raw = row.start_date ?? row.created_at ?? null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : String(d.getUTCFullYear());
}

export function ExploreExhibitionCard({ exhibition, locked = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useT();

  const cover = (exhibition.cover_image_paths ?? [])[0] ?? null;
  const imageUrl = cover ? getArtworkImageUrl(cover, "medium") : null;
  const year = pickYear(exhibition);
  const curatorLine = getExhibitionHostCuratorLabel(exhibition, t);

  const signupHref = `/onboarding?next=${encodeURIComponent(`/e/${exhibition.id}`)}`;

  function handleClick(e: React.MouseEvent) {
    if (locked) {
      e.preventDefault();
      router.push(signupHref);
      return;
    }
    setExhibitionBack(pathname ?? "/feed");
    router.push(`/e/${exhibition.id}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick(e as unknown as React.MouseEvent);
    }
  }

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={exhibition.title ?? undefined}
      className="group flex h-full cursor-pointer flex-col focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
    >
      <div className="relative w-full overflow-hidden bg-zinc-100">
        <div className="relative aspect-[4/3] w-full">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={exhibition.title ?? ""}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 45vw, 380px"
              loading="lazy"
              className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.01]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400" />
          )}
          <span
            className={`pointer-events-none absolute bottom-2 left-2 max-w-[65%] truncate rounded-sm bg-white/85 px-1.5 py-0.5 text-[11px] font-medium text-zinc-800 shadow-sm backdrop-blur-sm ${
              locked ? "select-none blur-sm" : ""
            }`}
          >
            {curatorLine || "\u00A0"}
          </span>
          {year && (
            <span className="pointer-events-none absolute bottom-2 right-2 rounded-sm bg-white/85 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 shadow-sm backdrop-blur-sm">
              {year}
            </span>
          )}
          {locked && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-8 opacity-0 transition-opacity group-hover:opacity-100">
              <Link
                href={signupHref}
                onClick={(e) => e.stopPropagation()}
                className="pointer-events-auto rounded-full bg-zinc-900/90 px-3 py-1.5 text-xs font-medium text-white shadow-md hover:bg-zinc-900"
              >
                {t("feed.anonLockCta")}
              </Link>
            </div>
          )}
        </div>
      </div>

      <p
        className={`mt-2 truncate text-xs tracking-tight text-zinc-700 ${
          locked ? "select-none blur-sm" : ""
        }`}
      >
        {exhibition.title ?? ""}
      </p>
    </article>
  );
}
