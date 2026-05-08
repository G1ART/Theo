"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { BoardPitchPackPanel } from "@/components/board/BoardPitchPackPanel";
import { ConfirmActionDialog } from "@/components/ds/ConfirmActionDialog";
import { TourTrigger, TourHelpButton } from "@/components/tour";
import { TOUR_IDS } from "@/lib/tours/tourRegistry";
import { BetaFeedbackPrompt } from "@/components/beta";
import { useT } from "@/lib/i18n/useT";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import {
  getShortlist,
  listShortlistItems,
  listShortlistCollaborators,
  removeShortlistItem,
  updateShortlist,
  addCollaborator,
  removeCollaborator,
  searchProfilesForCollab,
  rotateShareToken,
  toggleRoomActive,
  type ShortlistRow,
  type ShortlistItemRow,
  type ShortlistCollaboratorRow,
} from "@/lib/supabase/shortlists";
import { RoomVisibilityPill } from "@/components/visibility/RoomVisibilityPill";

function ShortlistDetailContent() {
  const { t } = useT();
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [shortlist, setShortlist] = useState<ShortlistRow | null>(null);
  const [items, setItems] = useState<ShortlistItemRow[]>([]);
  const [collaborators, setCollaborators] = useState<ShortlistCollaboratorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [collabSearch, setCollabSearch] = useState("");
  const [collabResults, setCollabResults] = useState<{ id: string; username: string | null; display_name: string | null }[]>([]);
  const [collabRole, setCollabRole] = useState<"viewer" | "editor">("viewer");
  const [showCollabPanel, setShowCollabPanel] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [pendingRotate, setPendingRotate] = useState(false);
  const [pendingRemoveItemId, setPendingRemoveItemId] = useState<string | null>(null);
  const [pendingRemoveCollabId, setPendingRemoveCollabId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [{ data: sl }, { data: it }, { data: co }] = await Promise.all([
      getShortlist(id),
      listShortlistItems(id),
      listShortlistCollaborators(id),
    ]);
    setShortlist(sl);
    setItems(it);
    setCollaborators(co);
    if (sl) { setTitleDraft(sl.title); setDescDraft(sl.description ?? ""); }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    const t = requestAnimationFrame(() => { void refresh(); });
    return () => cancelAnimationFrame(t);
  }, [refresh]);

  const handleSaveTitle = useCallback(async () => {
    if (!id || !titleDraft.trim()) return;
    await updateShortlist(id, { title: titleDraft.trim(), description: descDraft.trim() || null });
    setEditingTitle(false);
    void refresh();
  }, [id, titleDraft, descDraft, refresh]);

  const handleConfirmRemoveItem = useCallback(async () => {
    if (!pendingRemoveItemId) return;
    const target = pendingRemoveItemId;
    setPendingRemoveItemId(null);
    await removeShortlistItem(target);
    setItems((prev) => prev.filter((i) => i.id !== target));
  }, [pendingRemoveItemId]);

  const copyShareLink = useCallback(() => {
    if (!shortlist) return;
    const url = `${window.location.origin}/room/${shortlist.share_token}`;
    navigator.clipboard.writeText(url);
    logBetaEventSync("room_copy_link", { shortlist_id: id });
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [shortlist, id]);

  const handleConfirmRotateToken = useCallback(async () => {
    if (!id) return;
    setPendingRotate(false);
    const { data: newToken } = await rotateShareToken(id);
    if (newToken) {
      setShortlist((prev) => prev ? { ...prev, share_token: newToken } : prev);
    }
  }, [id]);

  const handleToggleRoom = useCallback(async () => {
    if (!shortlist) return;
    const newVal = !(shortlist.room_active ?? true);
    await toggleRoomActive(id, newVal);
    setShortlist((prev) => prev ? { ...prev, room_active: newVal } : prev);
  }, [shortlist, id]);

  const handleCollabSearch = useCallback(async (q: string) => {
    setCollabSearch(q);
    if (q.trim().length < 2) { setCollabResults([]); return; }
    const { data } = await searchProfilesForCollab(q);
    const existingIds = new Set(collaborators.map((c) => c.profile_id));
    setCollabResults(data.filter((p) => !existingIds.has(p.id)));
  }, [collaborators]);

  const handleAddCollaborator = useCallback(async (profileId: string) => {
    const { error } = await addCollaborator(id, profileId, collabRole);
    if (!error) {
      logBetaEventSync("shortlist_collaborator_added", { shortlist_id: id, profile_id: profileId, role: collabRole });
      setCollabSearch("");
      setCollabResults([]);
      void refresh();
    }
  }, [id, collabRole, refresh]);

  const handleConfirmRemoveCollaborator = useCallback(async () => {
    if (!pendingRemoveCollabId) return;
    const target = pendingRemoveCollabId;
    setPendingRemoveCollabId(null);
    await removeCollaborator(target);
    setCollaborators((prev) => prev.filter((c) => c.id !== target));
  }, [pendingRemoveCollabId]);

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-zinc-500">{t("common.loading")}</p>
      </main>
    );
  }

  if (!shortlist) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-red-600">{t("boards.empty")}</p>
      </main>
    );
  }

  const roomActive = shortlist.room_active ?? true;
  const itemsLabel =
    items.length === 1
      ? t("boards.itemCountOne")
      : t("boards.itemCount").replace("{n}", String(items.length));

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <TourTrigger tourId={TOUR_IDS.boardDetail} />
      <div className="mb-6 flex items-center justify-between gap-2">
        <Link href="/my/shortlists" className="inline-block text-sm text-zinc-600 hover:text-zinc-900">
          ← {t("boards.title")}
        </Link>
        <TourHelpButton tourId={TOUR_IDS.boardDetail} />
      </div>

      {/* Title / Description */}
      {editingTitle ? (
        <div className="mb-6 space-y-2">
          <input type="text" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} className="w-full rounded border border-zinc-300 px-3 py-2 text-lg font-semibold" />
          <textarea value={descDraft} onChange={(e) => setDescDraft(e.target.value)} placeholder={t("boards.createTitlePlaceholder")} rows={2} className="w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button type="button" onClick={() => void handleSaveTitle()} className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800">{t("common.save")}</button>
            <button type="button" onClick={() => setEditingTitle(false)} className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">{t("common.cancel")}</button>
          </div>
        </div>
      ) : (
        <div data-tour="board-detail-header" className="mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-zinc-900">{shortlist.title}</h1>
            <button type="button" onClick={() => setEditingTitle(true)} className="text-xs text-zinc-500 hover:text-zinc-800">{t("common.edit")}</button>
          </div>
          {shortlist.description && <p className="mt-1 text-sm text-zinc-600">{shortlist.description}</p>}
          <p className="mt-1 text-xs text-zinc-400">
            {itemsLabel}
            {collaborators.length > 0 ? ` · ${collaborators.length}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <RoomVisibilityPill
              ownerProfileId={shortlist.owner_id}
              roomId={shortlist.id}
            />
            {/* Sprint 6 Phase D — calm cross-link into the Relationship
                Desk so the operator can pivot from "this room" to
                "the people connected to this room" without leaving
                the studio. */}
            <Link
              href="/my/network?tab=relationships"
              className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline"
            >
              {t("nav.relationships")}
            </Link>
          </div>
        </div>
      )}

      {/* Promote to exhibition post */}
      {(() => {
        const artworkCount = items.filter((i) => i.artwork_id).length;
        const canPromote = artworkCount > 0;
        return (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-gradient-to-b from-white to-zinc-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900">{t("boards.promote.cta")}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {canPromote ? t("boards.promote.hint") : t("boards.promote.disabledHint")}
                </p>
              </div>
              <Link
                href={canPromote ? `/my/exhibitions/new?fromBoard=${id}` : "#"}
                aria-disabled={!canPromote}
                tabIndex={canPromote ? 0 : -1}
                onClick={(e) => {
                  if (!canPromote) {
                    e.preventDefault();
                    return;
                  }
                  logBetaEventSync("board_promote_started", {
                    shortlist_id: id,
                    artwork_count: artworkCount,
                  });
                }}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  canPromote
                    ? "bg-zinc-900 text-white hover:bg-zinc-800"
                    : "cursor-not-allowed bg-zinc-100 text-zinc-400"
                }`}
              >
                {t("exhibition.create")}
              </Link>
            </div>
          </div>
        );
      })()}

      {/* Share */}
      <div data-tour="board-detail-share" className="mb-6 flex flex-wrap items-center gap-2">
        <button type="button" onClick={copyShareLink} className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
          {linkCopied ? t("boards.share.copied") : t("boards.share.copy")}
        </button>
        <button type="button" onClick={() => void handleToggleRoom()} className={`rounded border px-3 py-1.5 text-sm ${roomActive ? "border-zinc-300 text-zinc-700" : "border-zinc-200 text-zinc-400"}`}>
          {roomActive ? t("boards.share.linkActive") : t("boards.share.linkDisabled")}
        </button>
        <button type="button" onClick={() => setPendingRotate(true)} className="text-xs text-zinc-400 hover:text-zinc-600">
          {t("boards.share.resetLink")}
        </button>
      </div>

      <div data-tour="board-detail-pitch-pack">
        <BoardPitchPackPanel boardId={id} itemCount={items.length} />
      </div>

      {/* People */}
      <div className="mb-6">
        <button type="button" onClick={() => setShowCollabPanel(!showCollabPanel)} className="mb-2 text-sm text-zinc-500 hover:text-zinc-700">
          {t("boards.collab.title")}
          {collaborators.length > 0 ? ` · ${collaborators.length}` : ""}
          {" "}
          {showCollabPanel ? "▲" : "▼"}
        </button>
        {showCollabPanel && (
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="mb-3 flex gap-2">
              <input type="text" value={collabSearch} onChange={(e) => void handleCollabSearch(e.target.value)} placeholder={t("boards.collab.searchPlaceholder")} className="flex-1 rounded border border-zinc-300 px-3 py-1.5 text-sm" />
              <select value={collabRole} onChange={(e) => setCollabRole(e.target.value as "viewer" | "editor")} className="rounded border border-zinc-300 px-2 py-1.5 text-sm">
                <option value="viewer">{t("boards.collab.role.viewer")}</option>
                <option value="editor">{t("boards.collab.role.editor")}</option>
              </select>
            </div>
            {collabResults.length > 0 && (
              <ul className="mb-3 space-y-1">
                {collabResults.map((p) => (
                  <li key={p.id} className="flex items-center justify-between rounded bg-zinc-50 px-3 py-1.5 text-sm">
                    <span>{p.display_name ?? p.username ?? p.id.slice(0, 8)}</span>
                    <button type="button" onClick={() => void handleAddCollaborator(p.id)} className="text-xs font-medium text-zinc-700 hover:text-zinc-900">{t("boards.collab.add")}</button>
                  </li>
                ))}
              </ul>
            )}
            {collaborators.length === 0 ? (
              <p className="text-sm text-zinc-500">{t("boards.collab.empty")}</p>
            ) : (
              <ul className="space-y-1">
                {collaborators.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded px-3 py-1.5 text-sm hover:bg-zinc-50">
                    <span>
                      {c.profile?.display_name ?? c.profile?.username ?? c.profile_id.slice(0, 8)}
                      <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
                        {c.role === "editor" ? t("boards.collab.role.editor") : t("boards.collab.role.viewer")}
                      </span>
                    </span>
                    <button type="button" onClick={() => setPendingRemoveCollabId(c.id)} className="text-xs text-red-500 hover:text-red-700">{t("boards.collab.remove")}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Items grid */}
      {items.length === 0 ? (
        <div data-tour="board-detail-items" className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 p-6 text-center">
          <p className="text-sm text-zinc-600">{t("boards.empty")}</p>
          <p className="mt-1 text-xs text-zinc-500">{t("boards.emptyHint")}</p>
        </div>
      ) : (
        <div data-tour="board-detail-items" className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className="group relative rounded-lg border border-zinc-200 bg-white p-2">
              {item.artwork_id && item.artwork ? (
                <Link href={`/artwork/${item.artwork_id}`}>
                  <div className="aspect-square overflow-hidden rounded bg-zinc-100">
                    {item.artwork.image_path ? (
                      <img
                        src={getArtworkImageUrl(item.artwork.image_path, "thumb")}
                        alt={item.artwork.title ?? ""}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
                        {item.artwork.title ?? "—"}
                      </div>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-zinc-800">{item.artwork.title ?? "Untitled"}</p>
                </Link>
              ) : item.exhibition_id && item.exhibition ? (
                <Link href={`/e/${item.exhibition_id}`}>
                  <p className="text-sm font-medium text-zinc-800">{item.exhibition.title ?? "Exhibition"}</p>
                </Link>
              ) : null}
              {item.note && <p className="mt-0.5 text-xs text-zinc-500">{item.note}</p>}
              <button type="button" onClick={() => setPendingRemoveItemId(item.id)} className="absolute right-1 top-1 hidden rounded bg-white/80 px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50 group-hover:block">×</button>
            </div>
          ))}
        </div>
      )}
      <ConfirmActionDialog
        open={pendingRotate}
        title={t("shortlist.rotate.title")}
        description={t("shortlist.rotate.desc")}
        confirmLabel={t("shortlist.rotate.confirm")}
        cancelLabel={t("common.cancel")}
        tone="destructive"
        onConfirm={() => void handleConfirmRotateToken()}
        onCancel={() => setPendingRotate(false)}
      />
      <ConfirmActionDialog
        open={pendingRemoveItemId !== null}
        title={t("shortlist.removeItem.title")}
        description={t("shortlist.removeItem.desc")}
        confirmLabel={t("shortlist.removeItem.confirm")}
        cancelLabel={t("common.cancel")}
        tone="destructive"
        onConfirm={() => void handleConfirmRemoveItem()}
        onCancel={() => setPendingRemoveItemId(null)}
      />
      <ConfirmActionDialog
        open={pendingRemoveCollabId !== null}
        title={t("shortlist.removeCollab.title")}
        description={t("shortlist.removeCollab.desc")}
        confirmLabel={t("shortlist.removeCollab.confirm")}
        cancelLabel={t("common.cancel")}
        tone="destructive"
        onConfirm={() => void handleConfirmRemoveCollaborator()}
        onCancel={() => setPendingRemoveCollabId(null)}
      />
      <BetaFeedbackPrompt
        pageKey="board_detail"
        contextType="shortlist"
        contextId={id}
      />
    </main>
  );
}

export default function ShortlistDetailPage() {
  return (
    <AuthGate>
      <ShortlistDetailContent />
    </AuthGate>
  );
}
