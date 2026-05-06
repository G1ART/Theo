"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import {
  getRoomByToken,
  getRoomItemsByToken,
  logRoomAction,
  type RoomItem,
  type RoomMeta,
} from "@/lib/supabase/shortlists";
import { useT } from "@/lib/i18n/useT";
import { setRoomSource } from "@/lib/room/source";

/**
 * Sprint 3 — Private Room v1.
 *
 * The public room is *not* a shopping cart and *not* a throwaway share
 * link. It is a private viewing room: a curated, premium surface for
 * one-to-one or small-group conversations about a body of work. The
 * visual upgrade here pulls Sprint 1's Living Salon vocabulary
 * (zinc-900 typography, 4:5 portrait tiles, contained max-width,
 * understated CTAs) and applies it to the share-by-link page.
 *
 * Source attribution: every artwork link from a room writes a
 * sessionStorage breadcrumb (`setRoomSource`) so a downstream inquiry
 * created from the artwork detail can be attributed to *this* room. The
 * room TOKEN never leaves the URL — only the resolved `room_id` is
 * persisted (see `lib/room/source.ts` for the privacy invariants).
 */
export default function RoomPage() {
  const params = useParams();
  const { t } = useT();
  const token = typeof params.token === "string" ? params.token : "";
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [items, setItems] = useState<RoomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const [{ data: m, error: me }, { data: it, error: ie }] = await Promise.all([
      getRoomByToken(token),
      getRoomItemsByToken(token),
    ]);
    if (me || ie || !m) setError(t("room.notFound"));
    setMeta(m);
    setItems(it);
    setLoading(false);
    if (m) logBetaEventSync("room_viewed", { shortlist_id: m.id, token });
  }, [token, t]);

  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(timer);
  }, [load]);

  const handleArtworkClick = useCallback(
    (artworkId: string) => {
      if (!meta) return;
      // Set the room source breadcrumb FIRST (synchronously) so that the
      // artwork page, which can mount before any of these promises resolve,
      // already has the resolved room id available via peekRoomSource().
      setRoomSource({ room_id: meta.id, artwork_id: artworkId });
      void logRoomAction(meta.id, "opened");
      logBetaEventSync("room_opened_artwork", {
        shortlist_id: meta.id,
        artwork_id: artworkId,
      });
    },
    [meta]
  );

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-16">
        <p className="text-center text-sm text-zinc-500">{t("room.loading")}</p>
      </main>
    );
  }

  if (error || !meta) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-zinc-700">{error ?? t("room.notFound")}</p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← {t("room.backToHome")}
        </Link>
      </main>
    );
  }

  const ownerLabel = meta.owner_display_name ?? meta.owner_username ?? "—";

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <header className="mb-10 text-center sm:mb-14">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
          {meta.title}
        </h1>
        {meta.description ? (
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-zinc-600 sm:text-base">
            {meta.description}
          </p>
        ) : null}
        <p className="mt-4 text-xs uppercase tracking-[0.18em] text-zinc-400">
          {t("room.curatedBy")} ·{" "}
          {meta.owner_username ? (
            <Link
              href={`/u/${meta.owner_username}`}
              className="text-zinc-600 hover:text-zinc-900"
            >
              {ownerLabel}
            </Link>
          ) : (
            <span className="text-zinc-600">{ownerLabel}</span>
          )}
        </p>
      </header>

      {items.length === 0 ? (
        <p className="text-center text-sm text-zinc-500">{t("room.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            if (item.artwork_id) {
              const href = `/artwork/${item.artwork_id}?fromRoom=${encodeURIComponent(token)}`;
              return (
                <article key={item.item_id} className="flex flex-col">
                  <Link
                    href={href}
                    onClick={() => handleArtworkClick(item.artwork_id!)}
                    className="group block"
                  >
                    {/* 4:5 portrait — same proportions as the salon
                        artwork tile. `object-contain` so artworks with
                        unusual ratios are NEVER cropped — this matters
                        more in a private room than in the public feed. */}
                    <div className="relative w-full overflow-hidden bg-zinc-100">
                      <div className="aspect-[4/5] w-full">
                        {item.artwork_image_path ? (
                          <img
                            src={getArtworkImageUrl(item.artwork_image_path, "medium")}
                            alt={item.artwork_title ?? ""}
                            className="h-full w-full object-contain transition-opacity duration-300 group-hover:opacity-95"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
                            —
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-3">
                      <p className="truncate text-[15px] font-medium text-zinc-900">
                        {item.artwork_title ?? t("room.untitledArtwork")}
                      </p>
                      {item.artwork_artist_name ? (
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          {item.artwork_artist_name}
                        </p>
                      ) : null}
                    </div>
                  </Link>
                  {item.note ? (
                    <p className="mt-2 text-xs italic leading-relaxed text-zinc-500">
                      {item.note}
                    </p>
                  ) : null}
                  <Link
                    href={href}
                    onClick={() => handleArtworkClick(item.artwork_id!)}
                    className="mt-3 inline-block self-start text-xs text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline"
                  >
                    {t("room.askAboutWork")}
                  </Link>
                </article>
              );
            }
            if (item.exhibition_id) {
              return (
                <article key={item.item_id} className="flex flex-col">
                  <Link
                    href={`/e/${item.exhibition_id}`}
                    className="group block"
                  >
                    <div className="aspect-[4/5] w-full bg-zinc-50 ring-1 ring-zinc-100">
                      <div className="flex h-full w-full items-center justify-center px-4 text-center">
                        <span className="text-xs uppercase tracking-[0.18em] text-zinc-400">
                          {t("room.viewExhibition")}
                        </span>
                      </div>
                    </div>
                    <p className="mt-3 truncate text-[15px] font-medium text-zinc-900 group-hover:underline">
                      {item.exhibition_title ?? t("room.untitledExhibition")}
                    </p>
                  </Link>
                  {item.note ? (
                    <p className="mt-2 text-xs italic leading-relaxed text-zinc-500">
                      {item.note}
                    </p>
                  ) : null}
                </article>
              );
            }
            return null;
          })}
        </div>
      )}
    </main>
  );
}
