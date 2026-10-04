"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ConfirmActionDialog } from "@/components/ds/ConfirmActionDialog";
import { EmptyState } from "@/components/ds/EmptyState";
import { BodyPortal } from "@/components/ui/BodyPortal";
import { layer } from "@/lib/ui/layers";
import { useT } from "@/lib/i18n/useT";
import {
  createShortlist,
  deleteShortlist,
  listMyShortlists,
  type ShortlistRow,
} from "@/lib/supabase/shortlists";
import { useActingAs } from "@/context/ActingAsContext";

function ShortlistsContent() {
  const { t } = useT();
  const router = useRouter();
  const { actingAsProfileId } = useActingAs();
  const [lists, setLists] = useState<ShortlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copiedTokenForId, setCopiedTokenForId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await listMyShortlists({ forProfileId: actingAsProfileId ?? null });
    setLists(data);
    setLoading(false);
  }, [actingAsProfileId]);

  useEffect(() => {
    const t = requestAnimationFrame(() => {
      void refresh();
    });
    return () => cancelAnimationFrame(t);
  }, [refresh]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    setCreateError(null);
    const { data, error } = await createShortlist(title, undefined, {
      forProfileId: actingAsProfileId ?? null,
    });
    setCreating(false);
    if (error || !data) {
      setCreateError(t("boards.createFailed"));
      if (process.env.NODE_ENV === "development") {
        console.warn("[boards] create failed:", error);
      }
      return;
    }
    setNewTitle("");
    setToast(t("boards.createSuccess"));
    // Optimistic: prepend the new board so the list reflects it immediately,
    // then navigate into the detail where the user will do their next action.
    setLists((prev) => [data, ...prev]);
    // Short delay so the user perceives the success toast before navigation.
    setTimeout(() => {
      router.push(`/my/shortlists/${data.id}`);
    }, 300);
  }, [newTitle, creating, router, t]);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteId || deleting) return;
    setDeleting(true);
    await deleteShortlist(pendingDeleteId);
    setDeleting(false);
    setPendingDeleteId(null);
    void refresh();
  }, [pendingDeleteId, deleting, refresh]);

  const copyShareLink = useCallback((id: string, token: string) => {
    const url = `${window.location.origin}/room/${token}`;
    navigator.clipboard.writeText(url).then(
      () => {
        setCopiedTokenForId(id);
        setToast(t("boards.share.copied"));
        setTimeout(() => setCopiedTokenForId((curr) => (curr === id ? null : curr)), 1800);
      },
      () => {
        setToast(t("boards.save.failed"));
      },
    );
  }, [t]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/my" className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900">
        ← {t("library.back")}
      </Link>
      <h1 className="text-xl font-semibold text-zinc-900">{t("boards.title")}</h1>
      <p className="mt-1 text-sm text-zinc-500">{t("boards.subtitle")}</p>

      <div className="mt-5">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={t("boards.createTitlePlaceholder")}
            value={newTitle}
            onChange={(e) => {
              setNewTitle(e.target.value);
              if (createError) setCreateError(null);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={!newTitle.trim() || creating}
            onClick={() => void handleCreate()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {creating ? t("boards.creating") : t("boards.createSubmit")}
          </button>
        </div>
        {createError && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">
            {createError}
          </p>
        )}
      </div>

      {loading ? (
        <p className="mt-8 text-zinc-500">{t("common.loading")}</p>
      ) : lists.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={t("empty.shortlists.title")}
            description={`${t("empty.shortlists.why")} ${t("empty.shortlists.whatNext")}`}
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {lists.map((sl) => {
            const itemCount = sl.item_count ?? 0;
            const itemLabel =
              itemCount === 1
                ? t("boards.itemCountOne")
                : t("boards.itemCount").replace("{n}", String(itemCount));
            return (
              <li key={sl.id} className="rounded-xl border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/my/shortlists/${sl.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {sl.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {itemLabel} · {sl.is_private ? t("boards.private") : t("boards.shared")} · {new Date(sl.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => copyShareLink(sl.id, sl.share_token)}
                      className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      title={t("boards.share.copy")}
                    >
                      {copiedTokenForId === sl.id ? t("boards.share.copied") : t("boards.share")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(sl.id)}
                      className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmActionDialog
        open={pendingDeleteId !== null}
        title={t("shortlist.deleteConfirm.title")}
        description={t("shortlist.deleteConfirm.desc")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        tone="destructive"
        busy={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDeleteId(null)}
      />

      {toast && (
        <BodyPortal>
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 ${layer.toast} -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-lg`}
        >
          {toast}
        </div>
        </BodyPortal>
      )}
    </main>
  );
}

export default function ShortlistsPage() {
  return (
    <AuthGate>
      <ShortlistsContent />
    </AuthGate>
  );
}
