"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useT } from "@/lib/i18n/useT";
import { ArtworkCard } from "@/components/ArtworkCard";
import {
  canEditArtwork,
  deleteArtworksBatch,
  getArtworkImageUrl,
  type ArtworkWithLikes,
} from "@/lib/supabase/artworks";
import {
  filterArtworksByPersona,
  getArtworksByAllBuckets,
  type PersonaTab,
} from "@/lib/provenance/personaTabs";
import { getExhibitionHostCuratorLabel } from "@/lib/exhibitionCredits";
import { pickLocalizedTitle } from "@/lib/i18n/pickLocalized";
import type { ExhibitionWithCredits } from "@/lib/supabase/exhibitions";
import { getProfileExhibitionOrders } from "@/lib/supabase/exhibitions";
import {
  defaultExhibitionSortMode,
  sortExhibitions,
  type ExhibitionSortMode,
} from "@/lib/exhibitions/sort";
import { ExhibitionSortDropdown } from "@/components/exhibitions/ExhibitionSortDropdown";
import { updateMyProfileDetails } from "@/lib/supabase/profileDetails";
import { EmptyState } from "@/components/ds/EmptyState";
import { StudioPortfolioManageModal } from "@/components/studio/StudioPortfolioManageModal";
import {
  assignArtworksToCustomTab,
  buildSavePayload,
  buildStudioStripTabs,
  type ActiveStudioTab,
  parseActiveTabParam,
  parseStudioPortfolio,
  serializeActiveTabParam,
  type StudioPortfolioV1,
  type StudioStripTab,
} from "@/lib/studio/studioPortfolioConfig";

type ProfileShape = {
  id: string;
  username: string | null;
  main_role: string | null;
  roles: string[] | null;
  profile_details?: Record<string, unknown> | null;
};

type Props = {
  profile: ProfileShape;
  artworks: ArtworkWithLikes[];
  exhibitions: ExhibitionWithCredits[];
  /** Raw `?tab=` value (e.g. `exhibitions`, `all`, `CREATED`, `custom-<uuid>`) */
  initialTabParam?: string | null;
  canSaveTabOrder: boolean;
  onRefresh: () => Promise<void> | void;
  onToast: (msg: string) => void;
};

function isActiveTab(row: StudioStripTab, active: ActiveStudioTab): boolean {
  if (active.kind === "persona") return row.kind === "persona" && row.personaTab === active.tab;
  return row.kind === "custom" && row.customId === active.id;
}

/**
 * Persona-aware portfolio panel used on `/my`. Bundles the persona tab row,
 * artwork/exhibition grids, bulk delete, tab reorder, custom tabs, and labels.
 */
export function StudioPortfolioPanel({
  profile,
  artworks,
  exhibitions,
  initialTabParam = null,
  canSaveTabOrder,
  onRefresh,
  onToast,
}: Props) {
  const { t, locale } = useT();
  const [active, setActive] = useState<ActiveStudioTab>({ kind: "persona", tab: "all" });
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tabReorderMode, setTabReorderMode] = useState(false);
  const [stripDraft, setStripDraft] = useState<StudioStripTab[]>([]);
  const [tabOrderSaving, setTabOrderSaving] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [moveSaving, setMoveSaving] = useState(false);
  const [exhibitionOrderMap, setExhibitionOrderMap] = useState<Map<string, number>>(
    new Map()
  );
  const [exhibitionSortMode, setExhibitionSortMode] = useState<ExhibitionSortMode>(
    "registered_desc"
  );

  useEffect(() => {
    let cancelled = false;
    const ids = exhibitions.map((e) => e.id);
    if (ids.length === 0) {
      setExhibitionOrderMap(new Map());
      return () => {
        cancelled = true;
      };
    }
    getProfileExhibitionOrders(profile.id, ids).then(({ data }) => {
      if (cancelled) return;
      const map = data ?? new Map<string, number>();
      setExhibitionOrderMap(map);
      setExhibitionSortMode((prev) =>
        prev === "registered_desc" ? defaultExhibitionSortMode(map) : prev
      );
    });
    return () => {
      cancelled = true;
    };
  }, [profile.id, exhibitions]);

  const roles = (profile.roles ?? []) as string[];
  const portfolio = useMemo(
    () => parseStudioPortfolio(profile.profile_details ?? null),
    [profile.profile_details]
  );

  const defaultTabLabels: Record<PersonaTab, string> = useMemo(
    () => ({
      all: t("profile.personaAll"),
      exhibitions: t("exhibition.myExhibitions"),
      CREATED: t("profile.personaWork"),
      OWNS: t("profile.personaCollected"),
      INVENTORY: t("profile.personaGallery"),
      CURATED: t("profile.personaCurated"),
    }),
    [t]
  );

  const stripRows = useMemo(
    () =>
      buildStudioStripTabs({
        profileId: profile.id,
        artworks,
        exhibitionsCount: exhibitions.length,
        mainRole: profile.main_role ?? null,
        roles,
        portfolio,
        rootProfileDetails: profile.profile_details ?? null,
        defaultTabLabels,
      }),
    [
      profile.id,
      profile.main_role,
      profile.profile_details,
      artworks,
      exhibitions.length,
      roles,
      portfolio,
      defaultTabLabels,
    ]
  );

  useEffect(() => {
    const p = parseActiveTabParam(initialTabParam);
    if (p) setActive(p);
  }, [initialTabParam]);

  useEffect(() => {
    if (active.kind === "custom") {
      const ok = stripRows.some((r) => r.kind === "custom" && r.customId === active.id);
      if (!ok) setActive({ kind: "persona", tab: "all" });
    }
  }, [active, stripRows]);

  const allBuckets = useMemo(
    () => getArtworksByAllBuckets(artworks, profile.id),
    [artworks, profile.id]
  );

  const displayedArtworks = useMemo<ArtworkWithLikes[]>(() => {
    if (active.kind === "persona") {
      const personaTab = active.tab;
      if (personaTab === "exhibitions") return [];
      if (personaTab === "all")
        return [
          ...allBuckets.created,
          ...allBuckets.curated,
          ...allBuckets.exhibited,
          ...allBuckets.owns,
        ];
      return filterArtworksByPersona(artworks, profile.id, personaTab);
    }
    const tab = (portfolio.custom_tabs ?? []).find((c) => c.id === active.id);
    if (!tab) return [];
    const byId = new Map(artworks.map((a) => [a.id, a]));
    const out: ArtworkWithLikes[] = [];
    for (const id of tab.artwork_ids) {
      const a = byId.get(id);
      if (a) out.push(a);
    }
    return out;
  }, [active, allBuckets, artworks, profile.id, portfolio.custom_tabs]);

  const showExhibitionsTab = exhibitions.length > 0;

  const activePersonaTab: PersonaTab | null = active.kind === "persona" ? active.tab : null;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    if (selectedIds.size >= displayedArtworks.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(displayedArtworks.map((a) => a.id)));
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
    await onRefresh();
    if (failed.length === 0)
      onToast(t("my.bulkDeleteSuccess").replace("{n}", String(okIds.length)));
    else if (okIds.length > 0)
      onToast(
        t("my.bulkDeletePartial")
          .replace("{ok}", String(okIds.length))
          .replace("{fail}", String(failed.length))
      );
    else onToast(t("my.bulkDeleteFailed"));
  }
  async function handleRowDelete(id: string) {
    const { okIds, failed } = await deleteArtworksBatch([id]);
    if (okIds.length > 0) {
      onToast(t("artwork.deleted"));
      await onRefresh();
    } else if (failed.length > 0) {
      onToast(t("my.bulkDeleteFailed"));
    }
  }

  const hasAnyContent = artworks.length > 0 || showExhibitionsTab;

  const sectionTitle = useMemo(() => {
    if (active.kind === "persona" && active.tab === "exhibitions") return t("exhibition.myExhibitions");
    if (active.kind === "custom") {
      const row = stripRows.find((r) => r.kind === "custom" && r.customId === active.id);
      return row?.label ?? t("me.myArtworks");
    }
    return t("me.myArtworks");
  }, [active, stripRows, t]);

  const persistPortfolio = useCallback(
    async (next: StudioPortfolioV1) => {
      const { error: err } = await updateMyProfileDetails(buildSavePayload(next), null);
      if (err) {
        onToast(t("common.tryAgain"));
        return false;
      }
      await onRefresh();
      return true;
    },
    [onRefresh, onToast, t]
  );

  const handleMoveToCustomTab = useCallback(
    async (targetCustomId: string | "") => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      setMoveSaving(true);
      const next = assignArtworksToCustomTab({
        portfolio,
        artworkIds: ids,
        targetCustomId: targetCustomId || null,
      });
      const ok = await persistPortfolio(next);
      setMoveSaving(false);
      if (ok) {
        clearSelection();
        onToast(t("studio.portfolio.moveToTabSaved"));
      }
    },
    [portfolio, selectedIds, persistPortfolio, onToast, t]
  );

  const visiblePersonaTabs = useMemo(
    () => stripRows.filter((r) => r.kind === "persona").map((r) => r.personaTab!),
    [stripRows]
  );

  const sortedExhibitions = useMemo(
    () => sortExhibitions(exhibitions, exhibitionSortMode, exhibitionOrderMap),
    [exhibitions, exhibitionSortMode, exhibitionOrderMap]
  );

  return (
    <section aria-label={t("studio.portfolio.title")} className="mb-6">
      {hasAnyContent && (
        <div
          className="mb-4 flex flex-wrap items-center gap-2 border-b border-zinc-200 pb-2"
          data-tour="studio-portfolio-tab-strip"
        >
          {tabReorderMode ? renderReorder() : renderTabs()}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-900">{sectionTitle}</h2>
        {activePersonaTab === "exhibitions" && exhibitions.length > 0
          ? renderExhibitionControls()
          : activePersonaTab !== "exhibitions" && artworks.length > 0 && renderBulkControls()}
      </div>

      {renderBody()}

      {canSaveTabOrder && (
        <StudioPortfolioManageModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          portfolio={portfolio}
          visiblePersonaTabs={visiblePersonaTabs}
          defaultTabLabels={defaultTabLabels}
          onSave={persistPortfolio}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-w-sm rounded-2xl bg-white p-6 shadow-lg">
            <p className="mb-4 text-zinc-800">
              {t("my.bulkSelect.confirmMessage").replace("{n}", String(selectedIds.size))}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? t("common.loading") : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );

  function renderTabs() {
    return (
      <>
        {stripRows.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => {
              if (row.kind === "persona") setActive({ kind: "persona", tab: row.personaTab! });
              else setActive({ kind: "custom", id: row.customId! });
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              isActiveTab(row, active)
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            {row.label} ({row.count})
          </button>
        ))}
        {canSaveTabOrder && hasAnyContent && (
          <>
            <button
              type="button"
              onClick={() => {
                setStripDraft(stripRows);
                setTabReorderMode(true);
              }}
              className="rounded-lg border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100"
              title={t("my.reorderTabs")}
            >
              ↕
            </button>
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="rounded-lg border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100"
              title={t("studio.portfolio.manageTabs")}
              aria-label={t("studio.portfolio.manageTabs")}
            >
              ⚙
            </button>
          </>
        )}
      </>
    );
  }

  function renderReorder() {
    const list = stripDraft.length > 0 ? stripDraft : stripRows;
    return (
      <>
        {list.map((row, idx) => (
          <span key={row.key} className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                if (idx <= 0) return;
                const next = [...list];
                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                setStripDraft(next);
              }}
              className="rounded border border-zinc-300 p-0.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40"
              disabled={idx === 0}
              aria-label={t("my.moveTabUp")}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => {
                if (idx >= list.length - 1) return;
                const next = [...list];
                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                setStripDraft(next);
              }}
              className="rounded border border-zinc-300 p-0.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40"
              disabled={idx === list.length - 1}
              aria-label={t("my.moveTabDown")}
            >
              ↓
            </button>
            <span className="rounded bg-zinc-100 px-2 py-1 text-sm text-zinc-700">
              {row.label} ({row.count})
            </span>
          </span>
        ))}
        <button
          type="button"
          disabled={tabOrderSaving}
          onClick={async () => {
            const draft = stripDraft.length > 0 ? stripDraft : stripRows;
            const tab_strip_order = draft.map((r) =>
              r.kind === "persona" ? r.personaTab! : `c:${r.customId!}`
            );
            setTabOrderSaving(true);
            const ok = await persistPortfolio({ ...portfolio, tab_strip_order });
            setTabOrderSaving(false);
            if (!ok) return;
            setTabReorderMode(false);
            setStripDraft([]);
          }}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {tabOrderSaving ? t("common.loading") : t("common.save")}
        </button>
        <button
          type="button"
          onClick={() => {
            setTabReorderMode(false);
            setStripDraft([]);
          }}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          {t("common.cancel")}
        </button>
      </>
    );
  }

  function renderExhibitionControls() {
    const reorderHref = profile.username
      ? `/u/${profile.username}?mode=reorder&tab=exhibitions`
      : null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ExhibitionSortDropdown
          value={exhibitionSortMode}
          onChange={setExhibitionSortMode}
          showManual={exhibitionOrderMap.size > 0}
        />
        {reorderHref && (
          <Link
            href={reorderHref}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 5h8M4 8h8M4 11h8" />
              <path d="M2 3l1.2 1.2M14 3l-1.2 1.2M2 13l1.2-1.2M14 13l-1.2-1.2" />
            </svg>
            {t("studio.portfolio.reorderOnPublic")}
          </Link>
        )}
      </div>
    );
  }

  function renderBulkControls() {
    const customTabs = portfolio.custom_tabs ?? [];
    if (!selectMode) {
      // "공개 프로필에서 순서 변경 →" 딥링크. 작품 reorder 의 SSOT 는 공개
      // 프로필(미리보기 = 편집)이고, /my 는 발견 경로만 제공해 인터랙션
      // 충돌(탭 reorder vs 작품 reorder vs bulk select)을 방지한다.
      // exhibitions 탭에서는 의미가 없으므로 숨김(상위에서 가드).
      const reorderHref =
        profile.username && activePersonaTab !== "exhibitions"
          ? `/u/${profile.username}?mode=reorder&tab=${encodeURIComponent(serializeActiveTabParam(active))}`
          : null;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectMode(true)}
            aria-label={t("my.bulkSelect.select")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
              <path d="M5.5 8.5l2 2 3.5-4" />
            </svg>
            {t("my.bulkSelect.select")}
          </button>
          {reorderHref && (
            <Link
              href={reorderHref}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <svg
                aria-hidden
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 5h8M4 8h8M4 11h8" />
                <path d="M2 3l1.2 1.2M14 3l-1.2 1.2M2 13l1.2-1.2M14 13l-1.2-1.2" />
              </svg>
              {t("studio.portfolio.reorderOnPublic")}
            </Link>
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={selectAll}
          className="text-sm text-zinc-600 hover:text-zinc-900"
        >
          {selectedIds.size >= displayedArtworks.length
            ? t("my.bulkSelect.clear")
            : t("my.bulkSelect.selectAll")}
        </button>
        <button
          type="button"
          onClick={clearSelection}
          className="text-sm text-zinc-600 hover:text-zinc-900"
        >
          {t("my.bulkSelect.clear")}
        </button>
        {canSaveTabOrder && customTabs.length > 0 && (
          <label className="flex items-center gap-1 text-sm text-zinc-700">
            <span className="hidden sm:inline">{t("studio.portfolio.moveToTab")}</span>
            <select
              disabled={selectedIds.size === 0 || moveSaving}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                e.target.value = "";
                if (v === "__noop") return;
                void handleMoveToCustomTab(v);
              }}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm"
            >
              <option value="__noop">{t("studio.portfolio.moveToTabPlaceholder")}</option>
              <option value="">{t("studio.portfolio.clearCustomTab")}</option>
              {customTabs.map((ct) => (
                <option key={ct.id} value={ct.id}>
                  {ct.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          disabled={selectedIds.size === 0 || deleting}
          onClick={() => setShowDeleteConfirm(true)}
          className="rounded-lg border border-red-500 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {t("my.bulkSelect.deleteSelected")} ({selectedIds.size})
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectMode(false);
            setSelectedIds(new Set());
          }}
          className="text-sm text-zinc-600 hover:text-zinc-900"
        >
          {t("common.cancel")}
        </button>
      </div>
    );
  }

  function renderBody() {
    if (active.kind === "persona" && active.tab === "exhibitions") {
      return (
        <ul className="space-y-2">
          {sortedExhibitions.map((ex) => {
            const firstCover = (ex.cover_image_paths ?? [])[0];
            return (
              <li key={ex.id}>
                <Link
                  href={`/my/exhibitions/${ex.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-2.5 shadow-sm transition hover:border-zinc-300 hover:shadow-md"
                >
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                    {firstCover ? (
                      <Image
                        src={getArtworkImageUrl(firstCover, "thumb")}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="56px"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-zinc-400">·</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-900">
                      {pickLocalizedTitle(ex, locale) || ex.title}
                    </p>
                    <p className="truncate text-xs text-zinc-500">
                      {ex.start_date && ex.end_date
                        ? `${ex.start_date} – ${ex.end_date}`
                        : ex.start_date ?? ex.status}
                      {" · "}
                      {getExhibitionHostCuratorLabel(ex, t, locale)}
                    </p>
                    <p className="text-[11px] text-zinc-400">{t("exhibition.works")} →</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      );
    }

    if (active.kind === "persona" && active.tab === "all") {
      const { created, curated, exhibited, owns } = allBuckets;
      const hasAny = created.length + curated.length + exhibited.length + owns.length > 0;
      if (!hasAny) {
        return (
          <EmptyState
            title={t("me.noWorks")}
            action={{ label: t("me.uploadFirst"), href: "/upload" }}
          />
        );
      }
      const sections = [
        { key: "created", list: created, label: t("profile.personaWork") },
        { key: "curated", list: curated, label: t("profile.personaCurated") },
        { key: "exhibited", list: exhibited, label: t("profile.bucketExhibited") },
        { key: "owns", list: owns, label: t("profile.personaCollected") },
      ].filter((s) => s.list.length > 0);
      return (
        <div className="space-y-8">
          {sections.map(({ key, list, label }) => (
            <section key={key}>
              <h3 className="mb-3 text-sm font-medium text-zinc-500">
                {label} ({list.length})
              </h3>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((a) => renderCard(a))}
              </div>
            </section>
          ))}
        </div>
      );
    }

    if (displayedArtworks.length === 0) {
      return (
        <EmptyState
          title={t("me.noWorks")}
          action={{ label: t("me.uploadFirst"), href: "/upload" }}
        />
      );
    }

    return (
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {displayedArtworks.map((a) => renderCard(a))}
      </div>
    );
  }

  function renderCard(artwork: ArtworkWithLikes) {
    return (
      <div key={artwork.id} className="relative">
        {selectMode && (
          <div className="absolute left-2 top-2 z-10">
            <input
              type="checkbox"
              checked={selectedIds.has(artwork.id)}
              onChange={() => toggleSelect(artwork.id)}
              className="h-5 w-5 rounded border-zinc-300"
              aria-label={t("my.bulkSelect.select")}
            />
          </div>
        )}
        <ArtworkCard
          artwork={artwork}
          likesCount={artwork.likes_count ?? 0}
          showEdit={!selectMode && canEditArtwork(artwork, profile.id)}
          showDelete={!selectMode}
          onDelete={handleRowDelete}
        />
      </div>
    );
  }
}
