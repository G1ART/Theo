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
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { GatedField } from "@/components/visibility/GatedField";
import {
  getViewerRelationshipContext,
  resolveVisibilityForViewer,
} from "@/lib/supabase/relationshipAccess";
import type {
  ViewerRelationshipContext,
  VisibilityResolution,
} from "@/lib/visibility/types";

/**
 * Sprint 4 — Private Room v1.1.
 *
 * The public room is *not* a shopping cart and *not* a throwaway share
 * link. It is a private viewing room: a curated, premium surface for
 * one-to-one or small-group conversations about a body of work.
 *
 * Sprint 4 tightens this further:
 *   - Wraps with `PageShell variant="studio"` for consistent rhythm with
 *     other operator surfaces, instead of a bespoke `mx-auto max-w-5xl`.
 *   - Header uses `PageHeader variant="editorial"` with a quiet
 *     `PRIVATE ROOM` kicker — one kicker per surface, no competing labels.
 *   - Each tile is one element with one subtle text CTA (no competing
 *     primary buttons inside the card grid).
 *   - Artwork notes clamp to 2 lines so a long curator note never
 *     dominates the visual rhythm.
 *   - Exhibition placeholder is a calm dashed frame, not a fake card.
 *
 * Source attribution: every artwork link from a room writes a
 * sessionStorage breadcrumb (`setRoomSource`) so a downstream inquiry
 * created from the artwork detail can be attributed to *this* room. The
 * room TOKEN never leaves the URL — only the resolved `room_id` is
 * persisted (see `lib/room/source.ts` for the privacy invariants).
 *
 * Sprint 4 P0-A: the room token is also intentionally absent from the
 * `room_viewed` analytics payload — the bearer-secret never enters
 * long-lived telemetry. `tests/privacy-token-audit.test.ts` pins this.
 */
export default function RoomPage() {
  const params = useParams();
  const { t } = useT();
  const token = typeof params.token === "string" ? params.token : "";
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [items, setItems] = useState<RoomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomResolution, setRoomResolution] =
    useState<VisibilityResolution | null>(null);
  const [viewerRelationship, setViewerRelationship] =
    useState<ViewerRelationshipContext | null>(null);

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
    if (m) {
      logBetaEventSync("room_viewed", {
        shortlist_id: m.id,
        item_count: it?.length ?? 0,
        has_description: Boolean(m.description),
      });
    }
  }, [token, t]);

  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(timer);
  }, [load]);

  // Sprint 5 — resolve room visibility server-side once we know the
  // owner. Token-bearing viewers still pass through whenever the owner's
  // policy resolves to a public-equivalent audience (default), so this
  // is a strict additive gate, not a regression.
  useEffect(() => {
    if (!meta?.owner_id || !meta?.id) return;
    let cancelled = false;
    (async () => {
      const [ctxRes, resRes] = await Promise.all([
        getViewerRelationshipContext(meta.owner_id),
        resolveVisibilityForViewer({
          ownerProfileId: meta.owner_id,
          subjectType: "room",
          subjectId: meta.id,
          fieldKey: "*",
        }),
      ]);
      if (cancelled) return;
      if (ctxRes.data) setViewerRelationship(ctxRes.data);
      if (resRes.data) setRoomResolution(resRes.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [meta?.owner_id, meta?.id]);

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
      <PageShell variant="studio">
        <p className="py-16 text-center text-sm text-zinc-500">{t("room.loading")}</p>
      </PageShell>
    );
  }

  if (error || !meta) {
    return (
      <PageShell variant="narrow">
        <div className="py-12 text-center">
          <p className="text-sm text-zinc-700">{error ?? t("room.notFound")}</p>
          <Link
            href="/"
            className="mt-6 inline-block text-sm text-zinc-500 hover:text-zinc-900"
          >
            ← {t("room.backToHome")}
          </Link>
        </div>
      </PageShell>
    );
  }

  const ownerLabel = meta.owner_display_name ?? meta.owner_username ?? "—";

  return (
    <PageShell variant="studio">
      {/* Kicker + title + lead — one kicker per surface, child sections
          must use `SectionLabel` instead of another kicker. */}
      <div className="mb-10 sm:mb-14">
        <PageHeader
          variant="editorial"
          kicker={t("room.privateRoom")}
          title={meta.title}
          lead={meta.description ?? null}
          density="default"
        />
        <p className="text-xs text-zinc-500">
          {t("room.curatedBy")}{" "}
          {meta.owner_username ? (
            <Link
              href={`/u/${meta.owner_username}`}
              className="text-zinc-700 underline-offset-4 hover:text-zinc-900 hover:underline"
            >
              {ownerLabel}
            </Link>
          ) : (
            <span className="text-zinc-700">{ownerLabel}</span>
          )}
        </p>
      </div>

      {roomResolution && !roomResolution.canView ? (
        <GatedField
          ownerProfileId={meta.owner_id}
          subjectType="room"
          subjectId={meta.id}
          fieldKey="*"
          resolution={roomResolution}
          viewerRelationship={viewerRelationship}
          ownerLabel={ownerLabel}
          surface="room"
        >
          <></>
        </GatedField>
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-zinc-500">{t("room.empty")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            if (item.artwork_id) {
              const href = `/artwork/${item.artwork_id}?fromRoom=${encodeURIComponent(token)}`;
              return (
                <li key={item.item_id}>
                  <article className="flex flex-col">
                    <Link
                      href={href}
                      onClick={() => handleArtworkClick(item.artwork_id!)}
                      className="group block"
                    >
                      {/* 4:5 portrait — same proportions as the salon
                          artwork tile. `object-contain` so artworks with
                          unusual ratios are NEVER cropped. */}
                      <div className="aspect-[4/5] w-full overflow-hidden bg-zinc-100">
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
                      // 2-line clamp so a long curator note can never
                      // dominate the visual rhythm of the grid.
                      <p
                        className="mt-2 overflow-hidden text-xs italic leading-relaxed text-zinc-500"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                      >
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
                </li>
              );
            }
            if (item.exhibition_id) {
              return (
                <li key={item.item_id}>
                  <article className="flex flex-col">
                    <Link href={`/e/${item.exhibition_id}`} className="group block">
                      {/* Calm dashed frame so an exhibition slot reads as
                          a placeholder for an external link, not a
                          broken artwork tile. */}
                      <div className="flex aspect-[4/5] w-full items-center justify-center border border-dashed border-zinc-200 bg-zinc-50/40 px-4 text-center">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                          {t("room.viewExhibition")}
                        </span>
                      </div>
                      <p className="mt-3 truncate text-[15px] font-medium text-zinc-900 group-hover:underline">
                        {item.exhibition_title ?? t("room.untitledExhibition")}
                      </p>
                    </Link>
                    {item.note ? (
                      <p
                        className="mt-2 overflow-hidden text-xs italic leading-relaxed text-zinc-500"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                      >
                        {item.note}
                      </p>
                    ) : null}
                  </article>
                </li>
              );
            }
            return null;
          })}
        </ul>
      )}
    </PageShell>
  );
}
