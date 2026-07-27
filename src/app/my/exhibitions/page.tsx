"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";
import { getExhibitionHostCuratorLabel } from "@/lib/exhibitionCredits";
import { listMyExhibitions, type ExhibitionWithCredits } from "@/lib/supabase/exhibitions";
import { ExhibitionThumbStack } from "@/components/ExhibitionThumbStack";
import { useActingAs } from "@/context/ActingAsContext";

/**
 * Derived exhibition state used for badge + filter.
 *
 * Rules (approved in QA plan Phase 1-3):
 * - `draft`: status === "planned" && works_count === 0
 *   Not visible on public feed. Owner sees an "임시 저장" badge and a hint
 *   that adding a work will make it publish-ready.
 * - `planned`: status === "planned" && works_count ≥ 1
 *   The exhibition has works but the owner hasn't flipped it to live yet.
 * - `live`: status === "live"
 * - `ended`: status === "ended"
 *
 * NOTE: `works_count === null` means "not fetched yet" (e.g. optimistic).
 * We conservatively treat null as ≥1 for "planned" rows so we don't flash
 * the "임시 저장" badge on hydration.
 */
type ExhibitionUiState = "draft" | "planned" | "live" | "ended";

function deriveState(ex: ExhibitionWithCredits): ExhibitionUiState {
  if (ex.status === "live") return "live";
  if (ex.status === "ended") return "ended";
  const count = ex.works_count;
  if (typeof count === "number" && count === 0) return "draft";
  return "planned";
}

const FILTER_ORDER: Array<"all" | ExhibitionUiState> = [
  "all",
  "draft",
  "planned",
  "live",
  "ended",
];

function filterLabelKey(f: "all" | ExhibitionUiState): string {
  switch (f) {
    case "all": return "exhibition.filterAll";
    case "draft": return "exhibition.filterDraft";
    case "planned": return "exhibition.filterPlanned";
    case "live": return "exhibition.filterLive";
    case "ended": return "exhibition.filterEnded";
  }
}

function stateLabelKey(s: ExhibitionUiState): string {
  switch (s) {
    case "draft": return "exhibition.statusDraft";
    case "planned": return "exhibition.statusPlanned";
    case "live": return "exhibition.statusLive";
    case "ended": return "exhibition.statusEnded";
  }
}

function stateBadgeClasses(s: ExhibitionUiState): string {
  switch (s) {
    case "draft":
      return "bg-amber-50 text-amber-800 border border-amber-200";
    case "planned":
      return "bg-sky-50 text-sky-800 border border-sky-200";
    case "live":
      return "bg-emerald-50 text-emerald-800 border border-emerald-200";
    case "ended":
      return "bg-zinc-100 text-zinc-600 border border-zinc-200";
  }
}

export default function MyExhibitionsPage() {
  const { t } = useT();
  const { actingAsProfileId } = useActingAs();
  const [list, setList] = useState<ExhibitionWithCredits[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | ExhibitionUiState>("all");

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await listMyExhibitions({
      forProfileId: actingAsProfileId ?? null,
    });
    setLoading(false);
    if (err) {
      setError(err instanceof Error ? err.message : t("exhibition.failedToLoad"));
      return;
    }
    setList(data ?? []);
  }, [t, actingAsProfileId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Per-state counts drive the filter chip labels and let us skip empty tabs.
  const counts = useMemo(() => {
    const c: Record<ExhibitionUiState | "all", number> = {
      all: list.length,
      draft: 0,
      planned: 0,
      live: 0,
      ended: 0,
    };
    for (const ex of list) c[deriveState(ex)] += 1;
    return c;
  }, [list]);

  const visible = useMemo(() => {
    if (filter === "all") return list;
    return list.filter((ex) => deriveState(ex) === filter);
  }, [list, filter]);

  return (
    <AuthGate>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <Link href="/my" className="text-sm text-zinc-600 hover:text-zinc-900">
            ← {t("profile.privateBackToMy")}
          </Link>
          <Link
            href="/my/exhibitions/new"
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            {t("exhibition.create")}
          </Link>
        </div>

        <h1 className="mb-4 text-xl font-semibold text-zinc-900">
          {t("exhibition.myExhibitions")}
        </h1>

        {/*
          Filter tabs. Rendered even during load so the layout doesn't jump.
          "all" is always visible; other tabs show a count in parentheses so
          the owner can see at a glance if they have drafts sitting around.
        */}
        {!loading && list.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {FILTER_ORDER.map((f) => {
              const active = filter === f;
              const count = counts[f];
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                  }`}
                >
                  {t(filterLabelKey(f))}
                  {f !== "all" && count > 0 && (
                    <span className={`ml-1 ${active ? "text-zinc-300" : "text-zinc-400"}`}>
                      · {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <p className="mb-4 text-sm text-red-600">{error}</p>
        )}

        {loading ? (
          <p className="text-sm text-zinc-500">{t("common.loading")}</p>
        ) : list.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 py-12 text-center">
            <p className="mb-4 text-zinc-600">{t("exhibition.emptyList")}</p>
            <Link
              href="/my/exhibitions/new"
              className="inline-block rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              {t("exhibition.create")}
            </Link>
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-zinc-500">{t("exhibition.emptyList")}</p>
        ) : (
          <ul className="space-y-3">
            {visible.map((ex) => {
              const state = deriveState(ex);
              const showDraftHint = state === "draft";
              return (
                <li key={ex.id}>
                  <Link
                    href={`/my/exhibitions/${ex.id}`}
                    className="block rounded-lg border border-zinc-200 bg-white p-4 hover:bg-zinc-50"
                  >
                    <ExhibitionThumbStack paths={ex.cover_image_paths} className="mb-3" />
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 font-medium text-zinc-900">{ex.title}</p>
                      {/*
                        Badge + tooltip. Draft badge uses `title` attr so the
                        hover message ("작품을 추가하면…") is discoverable but
                        doesn't consume vertical space.
                      */}
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${stateBadgeClasses(state)}`}
                        title={showDraftHint ? t("exhibition.statusDraftHint") : undefined}
                      >
                        {t(stateLabelKey(state))}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      {ex.start_date && ex.end_date
                        ? `${ex.start_date} – ${ex.end_date}`
                        : ex.start_date
                          ? ex.start_date
                          : ex.status}
                      {" · "}
                      {getExhibitionHostCuratorLabel(ex, t)}
                      {typeof ex.works_count === "number" && (
                        <>
                          {" · "}
                          {t("exhibition.worksCountShort").replace("{n}", String(ex.works_count))}
                        </>
                      )}
                    </p>
                    {showDraftHint && (
                      <p className="mt-2 text-xs text-amber-700">
                        {t("exhibition.notPublicYet")} · {t("exhibition.statusDraftHint")}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </AuthGate>
  );
}
