"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import {
  addArtworkToShortlist,
  addExhibitionToShortlist,
  createShortlist,
  listMyShortlists,
  removeArtworkFromShortlist,
  removeExhibitionFromShortlist,
  getShortlistIdsForArtwork,
  getShortlistIdsForExhibition,
  type ShortlistRow,
} from "@/lib/supabase/shortlists";
import { useActingAs } from "@/context/ActingAsContext";
import { BodyPortal } from "@/components/ui/BodyPortal";
import { layer } from "@/lib/ui/layers";

type Props = {
  artworkId?: string;
  exhibitionId?: string;
  open: boolean;
  onClose: () => void;
};

/**
 * "Save to board" modal — the primary learning surface for the boards
 * feature. The mental model this modal has to teach is:
 *
 *   1. Works/exhibitions can be saved into named boards.
 *   2. Boards exist across visits; you can revisit and share them.
 *   3. If you try to save the same thing twice, nothing happens twice —
 *      the item is simply present ("담음" / "Saved").
 *
 * Because this is the discovery surface, all strings are now i18n'd and
 * duplicate-handling is symmetric for artworks AND exhibitions (previously
 * exhibitions silently re-inserted on repeat saves).
 */
export function SaveToShortlistModal({ artworkId, exhibitionId, open, onClose }: Props) {
  const { t } = useT();
  const { actingAsProfileId } = useActingAs();
  const [lists, setLists] = useState<ShortlistRow[]>([]);
  const [savedIn, setSavedIn] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    // Acting-as: scope the picker to the principal's boards so that
    // "save to board" lands on the principal's collection rather than
    // the operator's. Solo path falls back to session.user.id.
    const ownerScope = { forProfileId: actingAsProfileId ?? null };
    const { data } = await listMyShortlists(ownerScope);
    setLists(data);
    if (artworkId) {
      const { data: ids } = await getShortlistIdsForArtwork(artworkId, ownerScope);
      setSavedIn(new Set(ids));
    } else if (exhibitionId) {
      const { data: ids } = await getShortlistIdsForExhibition(exhibitionId, ownerScope);
      setSavedIn(new Set(ids));
    } else {
      setSavedIn(new Set());
    }
    setLoading(false);
  }, [artworkId, exhibitionId, actingAsProfileId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(id);
  }, [toast]);

  const handleToggle = useCallback(
    async (slId: string) => {
      setBusy(slId);
      try {
        if (savedIn.has(slId)) {
          // Already in this board — treat the click as "remove".
          let error: unknown = null;
          if (artworkId) {
            ({ error } = await removeArtworkFromShortlist(slId, artworkId));
          } else if (exhibitionId) {
            ({ error } = await removeExhibitionFromShortlist(slId, exhibitionId));
          }
          if (!error) {
            setSavedIn((prev) => {
              const n = new Set(prev);
              n.delete(slId);
              return n;
            });
            logBetaEventSync("shortlist_item_removed", {
              shortlist_id: slId,
              ...(artworkId ? { artwork_id: artworkId } : { exhibition_id: exhibitionId }),
            });
          } else {
            setToast(t("boards.save.failed"));
          }
        } else {
          let error: unknown = null;
          if (artworkId) {
            ({ error } = await addArtworkToShortlist(slId, artworkId));
          } else if (exhibitionId) {
            ({ error } = await addExhibitionToShortlist(slId, exhibitionId));
          }
          if (!error) {
            setSavedIn((prev) => new Set(prev).add(slId));
            setToast(t("boards.save.success"));
            logBetaEventSync("shortlist_item_added", {
              shortlist_id: slId,
              ...(artworkId ? { artwork_id: artworkId } : { exhibition_id: exhibitionId }),
            });
          } else {
            setToast(t("boards.save.failed"));
          }
        }
      } finally {
        setBusy(null);
      }
    },
    [artworkId, exhibitionId, savedIn, t]
  );

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    setCreateError(null);
    const { data: sl, error } = await createShortlist(title, undefined, {
      forProfileId: actingAsProfileId ?? null,
    });
    if (error || !sl) {
      setCreating(false);
      setCreateError(t("boards.createFailed"));
      return;
    }
    setLists((prev) => [sl, ...prev]);
    if (artworkId) {
      const { error: addErr } = await addArtworkToShortlist(sl.id, artworkId);
      if (!addErr) {
        setSavedIn((prev) => new Set(prev).add(sl.id));
        logBetaEventSync("shortlist_item_added", { shortlist_id: sl.id, artwork_id: artworkId });
      }
    } else if (exhibitionId) {
      const { error: addErr } = await addExhibitionToShortlist(sl.id, exhibitionId);
      if (!addErr) {
        setSavedIn((prev) => new Set(prev).add(sl.id));
        logBetaEventSync("shortlist_item_added", {
          shortlist_id: sl.id,
          exhibition_id: exhibitionId,
        });
      }
    }
    setNewTitle("");
    setCreating(false);
    setToast(t("boards.save.success"));
  }, [newTitle, creating, artworkId, exhibitionId, t]);

  if (!open) return null;

  return (
    <BodyPortal>
    <div
      className={`fixed inset-0 ${layer.scrim} flex items-center justify-center bg-black/30`}
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("boards.save.title")}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900">
            {t("boards.save.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600"
            aria-label={t("common.close") || "Close"}
          >
            ×
          </button>
        </div>

        {loading ? (
          <p className="py-4 text-center text-sm text-zinc-500">{t("common.loading")}</p>
        ) : (
          <>
            <div className="mb-1">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {t("boards.save.createNewLabel")}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t("boards.save.createNewPlaceholder")}
                  value={newTitle}
                  onChange={(e) => {
                    setNewTitle(e.target.value);
                    if (createError) setCreateError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreate();
                  }}
                  className="flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!newTitle.trim() || creating}
                  onClick={() => void handleCreate()}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {creating ? t("boards.creating") : t("boards.save.createNewSubmit")}
                </button>
              </div>
              {createError && (
                <p className="mt-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">
                  {createError}
                </p>
              )}
            </div>

            <div className="mt-4">
              {lists.length === 0 ? (
                <p className="py-2 text-center text-sm text-zinc-500">
                  {t("boards.save.noBoards")}
                </p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto">
                  {lists.map((sl) => {
                    const inList = savedIn.has(sl.id);
                    const busyHere = busy === sl.id;
                    return (
                      <li key={sl.id}>
                        <button
                          type="button"
                          disabled={busyHere}
                          onClick={() => void handleToggle(sl.id)}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                            inList
                              ? "bg-zinc-100 font-medium text-zinc-900"
                              : "text-zinc-700 hover:bg-zinc-50"
                          } disabled:opacity-50`}
                          title={inList ? t("boards.save.already") : undefined}
                        >
                          <span className="truncate">{sl.title}</span>
                          <span className="ml-2 shrink-0 text-xs">
                            {busyHere
                              ? "…"
                              : inList
                                ? `✓ ${t("boards.save.saved")}`
                                : t("boards.save.addTo")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-3 flex items-center justify-end">
              <Link
                href="/my/shortlists"
                onClick={onClose}
                className="text-xs text-zinc-500 hover:text-zinc-800 hover:underline"
              >
                {t("studio.sections.seeAll")} →
              </Link>
            </div>
          </>
        )}

        {toast && (
          <div
            role="status"
            className="pointer-events-none mt-3 rounded-md bg-zinc-900 px-3 py-1.5 text-center text-xs font-medium text-white"
          >
            {toast}
          </div>
        )}
      </div>
    </div>
    </BodyPortal>
  );
}
