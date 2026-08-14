"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { ArtworkCard } from "@/components/ArtworkCard";
import { ConfirmActionDialog } from "@/components/ds/ConfirmActionDialog";
import { EmptyState } from "@/components/ds/EmptyState";
import { PageHeader } from "@/components/ds/PageHeader";
import { PageShell } from "@/components/ds/PageShell";
import { chipButton } from "@/components/ds/buttonStyles";
import { useT } from "@/lib/i18n/useT";
import { getSession } from "@/lib/supabase/auth";
import {
  deleteArtworksBatch,
  type ArtworkCursor,
  type ArtworkWithLikes,
  type MyLibrarySort,
  listMyArtworksForLibrary,
} from "@/lib/supabase/artworks";
import { generateCsv, downloadCsv } from "@/lib/csv/parse";
import { useActingAs } from "@/context/ActingAsContext";
import { ownershipStatusLabel } from "@/lib/artworks/labels";

const OWNERSHIP_VALUES = ["available", "owned", "sold", "not_for_sale"] as const;

function parseVisibilityParam(raw: string | null): "all" | "public" | "draft" {
  if (raw === "public" || raw === "draft") return raw;
  return "all";
}

export default function MyLibraryPage() {
  const { t } = useT();
  const searchParams = useSearchParams();
  const { actingAsProfileId } = useActingAs();
  const [items, setItems] = useState<ArtworkWithLikes[]>([]);
  const [nextCursor, setNextCursor] = useState<ArtworkCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [visibility, setVisibility] = useState<"all" | "public" | "draft">(() =>
    parseVisibilityParam(searchParams.get("visibility"))
  );
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [sort, setSort] = useState<MyLibrarySort>("created_at");
  const [ownershipStatus, setOwnershipStatus] = useState("");
  const [pricingMode, setPricingMode] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [createdByMe, setCreatedByMe] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const tmr = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(tmr);
  }, [search]);

  useEffect(() => {
    void getSession().then(({ data }) => setMyUserId(data.session?.user?.id ?? null));
  }, []);

  const loadPage = useCallback(
    async (cursor: ArtworkCursor | null, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      const { data, nextCursor: nc, error } = await listMyArtworksForLibrary({
        limit: 40,
        cursor,
        visibility,
        search: searchDebounced,
        sort,
        ownershipStatus: ownershipStatus || null,
        pricingMode: pricingMode || null,
        dateFrom: dateFrom || null,
        dateTo: dateTo ? `${dateTo}T23:59:59.999Z` : null,
        createdBy: createdByMe && myUserId ? myUserId : null,
        forProfileId: actingAsProfileId ?? null,
      });
      if (error) {
        if (append) setLoadingMore(false);
        else setLoading(false);
        return;
      }
      if (append) {
        setItems((prev) => {
          const seen = new Set(prev.map((a) => a.id));
          const add = (data ?? []).filter((a) => !seen.has(a.id));
          return [...prev, ...add];
        });
      } else {
        setItems(data ?? []);
      }
      setNextCursor(nc);
      if (append) setLoadingMore(false);
      else setLoading(false);
    },
    [
      visibility,
      searchDebounced,
      sort,
      ownershipStatus,
      pricingMode,
      dateFrom,
      dateTo,
      createdByMe,
      myUserId,
      actingAsProfileId,
    ]
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadPage(null, false);
    });
    return () => cancelAnimationFrame(frame);
  }, [loadPage]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    if (selectedIds.size >= items.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map((a) => a.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }
  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setDeleting(true);
    setShowDeleteConfirm(false);
    const { okIds, failed } = await deleteArtworksBatch(ids);
    setDeleting(false);
    setSelectMode(false);
    setSelectedIds(new Set());
    await loadPage(null, false);
    if (failed.length === 0)
      setToast(t("my.bulkDeleteSuccess").replace("{n}", String(okIds.length)));
    else if (okIds.length > 0)
      setToast(
        t("my.bulkDeletePartial")
          .replace("{ok}", String(okIds.length))
          .replace("{fail}", String(failed.length))
      );
    else setToast(t("my.bulkDeleteFailed"));
  }

  return (
    <AuthGate>
      <PageShell variant="library">
        <Link href="/my" className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900">
          ← {t("library.back")}
        </Link>
        <PageHeader
          variant="plain"
          title={t("library.title")}
          lead={t("library.hint")}
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/my/library/import" className={chipButton}>
                {t("library.importCsv")}
              </Link>
              <button
                type="button"
                onClick={() => {
                  const headers = [
                    "title",
                    "year",
                    "medium",
                    "size",
                    "size_unit",
                    "ownership_status",
                    "pricing_mode",
                    "visibility",
                  ];
                  const rows = items.map((a) => [
                    a.title ?? "",
                    String(a.year ?? ""),
                    a.medium ?? "",
                    a.size ?? "",
                    String((a as Record<string, unknown>).size_unit ?? ""),
                    a.ownership_status ?? "",
                    a.pricing_mode ?? "",
                    a.visibility ?? "",
                  ]);
                  downloadCsv("library_export.csv", generateCsv(headers, rows));
                }}
                disabled={items.length === 0}
                className={`${chipButton} disabled:opacity-50`}
              >
                {t("library.exportCsv")}
              </button>
            </div>
          }
        />

        {toast && (
          <p className="mb-4 text-sm text-zinc-600" role="status">
            {toast}
          </p>
        )}

        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
          <div className="flex flex-wrap gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("library.search")}
              className="min-w-[200px] flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
            />
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "all" | "public" | "draft")}
              className="rounded border border-zinc-300 px-3 py-2 text-sm"
            >
              <option value="all">{t("library.visibilityAll")}</option>
              <option value="public">{t("library.visibilityPublic")}</option>
              <option value="draft">{t("library.visibilityDraft")}</option>
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as MyLibrarySort)}
              className="rounded border border-zinc-300 px-3 py-2 text-sm"
            >
              <option value="created_at">{t("library.sortCreated")}</option>
              <option value="likes">{t("library.sortLikes")}</option>
              <option value="artist_sort">{t("library.sortArtistOrder")}</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-3">
            <select
              value={ownershipStatus}
              onChange={(e) => setOwnershipStatus(e.target.value)}
              className="rounded border border-zinc-300 px-3 py-2 text-sm"
            >
              <option value="">— {t("bulk.ownershipStatus")} —</option>
              {OWNERSHIP_VALUES.map((v) => (
                <option key={v} value={v}>
                  {ownershipStatusLabel(v, t) ?? v}
                </option>
              ))}
            </select>
            <select
              value={pricingMode}
              onChange={(e) => setPricingMode(e.target.value)}
              className="rounded border border-zinc-300 px-3 py-2 text-sm"
            >
              <option value="">— {t("bulk.pricingMode")} —</option>
              <option value="inquire">{t("bulk.inquire")}</option>
              <option value="fixed">{t("bulk.fixed")}</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={createdByMe}
                onChange={(e) => setCreatedByMe(e.target.checked)}
              />
              {t("library.createdByMe")}
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              {t("library.createdFrom")}
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded border border-zinc-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              {t("library.createdTo")}
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded border border-zinc-300 px-2 py-1 text-sm"
              />
            </label>
          </div>
        </div>

        {items.length > 0 && !loading && (
          <>
            {!selectMode ? (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectMode(true)}
                  aria-label={t("my.bulkSelect.select")}
                  className={chipButton}
                >
                  {t("my.bulkSelect.select")}
                </button>
              </div>
            ) : (
              <>
                <div className="mb-4 hidden flex-wrap items-center gap-2 md:flex">
                  <button type="button" onClick={selectAll} className={chipButton}>
                    {selectedIds.size >= items.length
                      ? t("my.bulkSelect.clear")
                      : t("my.bulkSelect.selectAll")}
                  </button>
                  <button type="button" onClick={clearSelection} className={chipButton}>
                    {t("my.bulkSelect.clear")}
                  </button>
                  <button
                    type="button"
                    disabled={selectedIds.size === 0 || deleting}
                    onClick={() => setShowDeleteConfirm(true)}
                    className={`${chipButton} border-red-400 text-red-700 hover:border-red-600 disabled:opacity-50`}
                  >
                    {t("my.bulkSelect.deleteSelected")} ({selectedIds.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectMode(false);
                      setSelectedIds(new Set());
                    }}
                    className={chipButton}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {loading ? (
          <p className="text-zinc-500">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <EmptyState
            title={t("empty.library.title")}
            description={`${t("empty.library.why")} ${t("empty.library.whatNext")}`}
            action={{ label: t("empty.library.cta"), href: "/upload" }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((a) => (
              <div key={a.id} className="relative">
                {selectMode && (
                  <label className="absolute left-1 top-1 z-10 flex p-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      className="h-5 w-5 rounded border-zinc-300"
                      aria-label={t("my.bulkSelect.select")}
                    />
                  </label>
                )}
                <ArtworkCard
                  artwork={a}
                  likesCount={a.likes_count ?? 0}
                  showEdit={!selectMode}
                  viewerId={myUserId}
                />
              </div>
            ))}
          </div>
        )}

        {nextCursor != null && !loading && (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadPage(nextCursor, true)}
              className={`${chipButton} disabled:opacity-50`}
            >
              {loadingMore ? t("common.loading") : t("library.loadMore")}
            </button>
          </div>
        )}

        {items.length > 0 && !loading && selectMode && (
          <div className="sticky bottom-0 z-20 -mx-4 mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6">
            <button type="button" onClick={selectAll} className={chipButton}>
              {selectedIds.size >= items.length
                ? t("my.bulkSelect.clear")
                : t("my.bulkSelect.selectAll")}
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || deleting}
              onClick={() => setShowDeleteConfirm(true)}
              className={`${chipButton} border-red-400 text-red-700 hover:border-red-600 disabled:opacity-50`}
            >
              {t("my.bulkSelect.deleteSelected")} ({selectedIds.size})
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectMode(false);
                setSelectedIds(new Set());
              }}
              className={chipButton}
            >
              {t("common.cancel")}
            </button>
          </div>
        )}

        <ConfirmActionDialog
          open={showDeleteConfirm}
          title={t("my.bulkSelect.deleteSelected")}
          description={t("my.bulkSelect.confirmMessage").replace(
            "{n}",
            String(selectedIds.size)
          )}
          confirmLabel={t("common.delete")}
          cancelLabel={t("common.cancel")}
          tone="destructive"
          busy={deleting}
          onConfirm={() => void handleBulkDelete()}
          onCancel={() => (deleting ? undefined : setShowDeleteConfirm(false))}
        />
      </PageShell>
    </AuthGate>
  );
}
