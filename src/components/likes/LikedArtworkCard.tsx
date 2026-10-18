"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArtworkSizeCapsule } from "@/components/artwork/ArtworkSizeCapsule";
import { CroppedArtworkImage } from "@/components/artwork/CroppedArtworkImage";
import { FollowRelationChip } from "@/components/FollowRelationChip";
import { cardTradeView } from "@/lib/artworks/cardTrade";
import { setArtworkBack } from "@/lib/artworkBack";
import { setExhibitionBack } from "@/lib/exhibitionBack";
import type { FollowRelation } from "@/lib/follow/relation";
import { pickLocalizedArtworkTitle, pickLocalizedTitle } from "@/lib/i18n/pickLocalized";
import { useT } from "@/lib/i18n/useT";
import { readDisplayAdjust } from "@/lib/image/displayAdjust";
import {
  latestChange,
  likedCta,
  likedStatus,
  priceView,
  type LikedChange,
  type LikedShow,
  type LikedWork,
} from "@/lib/likes/likedWorksView";
import { rememberProfileGridScrollFromWindow } from "@/lib/profile/scrollRestore";
import { formatArtworkSizeOverlay } from "@/lib/size/format";
import { useSizeUnitPref } from "@/lib/size/preference";
import {
  getArtworkImageUrl,
  getArtworkPriceDisplay,
  type ArtworkWithLikes,
} from "@/lib/supabase/artworks";
import { getCardGateCopy } from "@/lib/visibility/copy";

type Props = {
  item: LikedWork<ArtworkWithLikes>;
  viewerId: string;
  removed: boolean;
  relation: FollowRelation | null;
  onToggleLike: (artworkId: string) => void;
  onSaveToBoard: (artworkId: string) => void;
};

function shortDate(value: string | null, locale: string): string {
  if (!value) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" });
}

function leaveForDetail(): void {
  rememberProfileGridScrollFromWindow();
  setArtworkBack();
}

export function LikedArtworkCard({ item, viewerId, removed, relation, onToggleLike, onSaveToBoard }: Props) {
  const router = useRouter();
  const { t, locale } = useT();
  const sizePref = useSizeUnitPref();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const art = item.artwork;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const images = [...(art.artwork_images ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const first = images[0];
  const imageUrl = first ? getArtworkImageUrl(first.storage_path, "thumb") : null;
  const title = pickLocalizedArtworkTitle(art, locale) || art.title || "";
  const sizeLabel = formatArtworkSizeOverlay(art.size, locale, art.size_unit ?? null, sizePref);
  const status = likedStatus(art);
  const price = priceView(art);
  const trade = cardTradeView(art);
  const cta = likedCta(item, viewerId);
  const change = latestChange(item);
  const detailHref = `/artwork/${art.id}`;

  function openDetail() {
    leaveForDetail();
    router.push(detailHref);
  }

  const statusLabel =
    status === "available" || status === "sold" || status === "owned" || status === "not_for_sale"
      ? t(`likes.state.${status}`)
      : null;
  const priceLine =
    status === "available" && price.kind === "listed"
      ? getArtworkPriceDisplay(art, t)
      : status === "available" && price.kind === "ask"
        ? t("likes.price.ask")
        : null;
  const gateLine = trade.gate
    ? getCardGateCopy({
        fieldKey: trade.gate.fieldKey,
        requiredAudience: trade.gate.audience,
        locale: locale === "ko" ? "ko" : "en",
      })
    : null;

  return (
    <article className={`flex h-full flex-col ${removed ? "opacity-60" : ""}`}>
      <div className="relative">
        <button
          type="button"
          onClick={openDetail}
          className="group block w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300"
        >
          <div className="relative aspect-square w-full overflow-hidden bg-zinc-100">
            {imageUrl ? (
              <CroppedArtworkImage
                src={imageUrl}
                alt={title}
                sizes="(max-width: 640px) 50vw, 320px"
                adjust={readDisplayAdjust(first?.display_adjust)}
                imgClassName="transition-transform duration-300 ease-out group-hover:scale-[1.01]"
              />
            ) : null}
            <ArtworkSizeCapsule label={sizeLabel} />
          </div>
        </button>
        <button
          type="button"
          onClick={() => onToggleLike(art.id)}
          aria-pressed={!removed}
          aria-label={removed ? t("likes.undo") : t("likes.unlike")}
          title={removed ? t("likes.undo") : t("likes.unlike")}
          className="absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/85 text-base shadow-sm backdrop-blur-sm hover:bg-white"
        >
          <span aria-hidden>{removed ? "♡" : "♥"}</span>
        </button>
      </div>

      <button type="button" onClick={openDetail} className="mt-2 min-w-0 text-left">
        <h3 className="truncate text-sm text-zinc-900">{title}</h3>
      </button>
      <p className="truncate text-xs text-zinc-500">
        {item.artistHref ? (
          <Link
            href={item.artistHref}
            onClick={() => rememberProfileGridScrollFromWindow()}
            className="font-medium text-zinc-800 hover:underline"
          >
            {item.artistName}
          </Link>
        ) : (
          <span className="font-medium text-zinc-800">{item.artistName}</span>
        )}
        <FollowRelationChip relation={relation} className="ml-1" />
        {art.year ? <span> · {art.year}</span> : null}
      </p>

      <div className="mt-1 space-y-0.5 text-xs">
        {trade.showStatus && statusLabel ? (
          <p className={status === "available" ? "font-medium text-zinc-800" : "text-zinc-500"}>
            {statusLabel}
            {priceLine ? <span className="font-normal text-zinc-600"> · {priceLine}</span> : null}
          </p>
        ) : null}
        {gateLine ? <p className="text-zinc-500">{gateLine}</p> : null}
        {item.exhibition ? <ShowLine show={item.exhibition} /> : null}
        {change ? <ChangeLine change={change} /> : null}
        {item.mine.inquiry || item.mine.in_board ? (
          <p className="text-zinc-400">
            {[
              item.mine.inquiry === "replied"
                ? t("likes.mine.inquiryReplied")
                : item.mine.inquiry === "open"
                  ? t("likes.mine.inquiryOpen")
                  : null,
              item.mine.in_board ? t("likes.mine.inBoard") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </div>

      <div className="mt-auto flex items-center gap-1.5 pt-2">
        {cta.kind === "none" ? (
          art.artist_id === viewerId ? (
            <span className="text-xs text-zinc-400">{t("likes.ownWork")}</span>
          ) : null
        ) : cta.kind === "more" ? (
          cta.href ? (
            <Link
              href={cta.href}
              onClick={() => rememberProfileGridScrollFromWindow()}
              className="truncate rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-500"
            >
              {cta.count > 0 ? t("likes.cta.moreCount").replace("{n}", String(cta.count)) : t("likes.cta.more")}
            </Link>
          ) : null
        ) : (
          <Link
            href={cta.href.includes("?") ? `${cta.href}&from=likes` : cta.href}
            onClick={leaveForDetail}
            className={
              cta.kind === "ask"
                ? "truncate rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800"
                : "truncate rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-500"
            }
          >
            {cta.kind === "ask" ? t("inquiry.cta") : t(`likes.cta.${cta.kind}`)}
          </Link>
        )}
        <div ref={menuRef} className="relative ml-auto">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={t("likes.menu.label")}
            aria-expanded={menuOpen}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          >
            <span aria-hidden>⋯</span>
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute bottom-8 right-0 z-10 w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 text-xs shadow-lg"
            >
              {(art.work_form ?? "flat_2d") === "flat_2d" ? (
                <Link
                  role="menuitem"
                  href={`${detailHref}?see_in_space=1`}
                  onClick={leaveForDetail}
                  className="block px-3 py-2 text-zinc-700 hover:bg-zinc-50"
                >
                  {t("likes.menu.space")}
                </Link>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onSaveToBoard(art.id);
                }}
                className="block w-full px-3 py-2 text-left text-zinc-700 hover:bg-zinc-50"
              >
                {t("likes.menu.board")}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ShowLine({ show }: { show: LikedShow }) {
  const { t, locale } = useT();
  const title = pickLocalizedTitle(show, locale) || show.title || "";
  const text =
    show.phase === "ongoing"
      ? show.end_date
        ? t("likes.show.ongoing").replace("{title}", title).replace("{date}", shortDate(show.end_date, locale))
        : t("likes.show.ongoingOpen").replace("{title}", title)
      : show.start_date
        ? t("likes.show.upcoming").replace("{title}", title).replace("{date}", shortDate(show.start_date, locale))
        : t("likes.show.upcomingOpen").replace("{title}", title);
  return (
    <p className="truncate">
      <Link
        href={`/e/${show.id}`}
        onClick={() => {
          rememberProfileGridScrollFromWindow();
          setExhibitionBack();
        }}
        className="text-zinc-700 underline-offset-2 hover:underline"
      >
        {text}
      </Link>
    </p>
  );
}

function ChangeLine({ change }: { change: LikedChange }) {
  const { t, locale } = useT();
  const title = pickLocalizedTitle(
    { title: change.title ?? null, title_ko: change.title_ko ?? null, title_en: change.title_en ?? null },
    locale,
  );
  const text = t(`likes.change.${change.kind}`).replace("{title}", title || "");
  const when = shortDate(change.at, locale);
  return (
    <p className="truncate font-medium text-zinc-900">
      <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-zinc-900 align-middle" />
      {text}
      {when ? <span className="text-zinc-400"> · {when}</span> : null}
    </p>
  );
}
