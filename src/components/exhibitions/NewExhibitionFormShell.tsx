"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useActingAs } from "@/context/ActingAsContext";
import { useT } from "@/lib/i18n/useT";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import { createExhibition } from "@/lib/supabase/exhibitions";
import { logSupabaseError } from "@/lib/supabase/errors";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { getMyProfile } from "@/lib/supabase/me";
import { searchPeople } from "@/lib/supabase/artists";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";
import { ExhibitionDraftAssist } from "@/components/ai/ExhibitionDraftAssist";
import { getShortlist, listShortlistItems } from "@/lib/supabase/shortlists";
import { TourTrigger, TourHelpButton } from "@/components/tour";
import { TOUR_IDS } from "@/lib/tours/tourRegistry";
import { ActingAsChip } from "@/components/ActingAsChip";
import { PageHeader } from "@/components/ds/PageHeader";

const STATUS_OPTIONS = [
  { value: "planned", labelKey: "exhibition.statusPlanned" },
  { value: "live", labelKey: "exhibition.statusLive" },
  { value: "ended", labelKey: "exhibition.statusEnded" },
] as const;

type ProfileOption = { id: string; username: string | null; display_name: string | null };

type NewExhibitionFormShellProps = {
  /**
   * `false` when the parent surface already owns the page H1 (e.g. the
   * Upload layout's "업로드" header sits above the LaneChips). Drops the
   * inner `PageHeader` + tour wiring to keep a single H1 per surface,
   * and renders the createSubtitle as a quiet lead instead.
   */
  showHeader?: boolean;
  /**
   * Standalone surfaces (e.g. `/my/exhibitions/new`) typically link
   * back to a list. The Upload tab variant of this surface relies on
   * the upload `LaneChips` for cross-navigation, so the cancel CTA is
   * hidden by default when this prop is `false`.
   */
  showCancelLink?: boolean;
  cancelHref?: string;
};

export function NewExhibitionFormShell({
  showHeader = true,
  showCancelLink = true,
  cancelHref = "/my/exhibitions",
}: NewExhibitionFormShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromBoardId = searchParams.get("fromBoard");
  const { t } = useT();
  const [boardContext, setBoardContext] = useState<{ title: string; artworkCount: number } | null>(null);
  const { actingAsProfileId } = useActingAs();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<"planned" | "live" | "ended">("planned");
  const [curatorMe, setCuratorMe] = useState(true);
  const [curatorSearch, setCuratorSearch] = useState("");
  const [curatorResults, setCuratorResults] = useState<ProfileOption[]>([]);
  const [curatorSelected, setCuratorSelected] = useState<ProfileOption | null>(null);
  const [curatorSearching, setCuratorSearching] = useState(false);
  const [hostName, setHostName] = useState("");
  const [hostProfileMode, setHostProfileMode] = useState<"text" | "me" | "search">("text");
  const [hostSearch, setHostSearch] = useState("");
  const [hostResults, setHostResults] = useState<ProfileOption[]>([]);
  const [hostSelected, setHostSelected] = useState<ProfileOption | null>(null);
  const [hostSearching, setHostSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDraftAssist, setShowDraftAssist] = useState(false);

  const effectiveProfileId = actingAsProfileId ?? myProfileId;

  useEffect(() => {
    getMyProfile().then(({ data }) => {
      const id = (data as { id?: string } | null)?.id ?? null;
      setMyProfileId(id);
    });
  }, []);

  // Seed title + context when promoting from a board. Only runs once per
  // fromBoardId; manual edits to title after mount are not overwritten.
  useEffect(() => {
    if (!fromBoardId) return;
    let cancelled = false;
    (async () => {
      const [{ data: sl }, { data: items }] = await Promise.all([
        getShortlist(fromBoardId),
        listShortlistItems(fromBoardId),
      ]);
      if (cancelled || !sl) return;
      const artworkCount = items.filter((i) => i.artwork_id).length;
      setBoardContext({ title: sl.title, artworkCount });
      setTitle((prev) => (prev.trim().length > 0 ? prev : sl.title));
    })();
    return () => {
      cancelled = true;
    };
  }, [fromBoardId]);

  const runCuratorSearch = useCallback(async () => {
    const q = curatorSearch.trim();
    if (!q || q.length < 2) {
      setCuratorResults([]);
      return;
    }
    setCuratorSearching(true);
    const { data } = await searchPeople({ q, limit: 10 });
    setCuratorResults(
      (data ?? []).map((p) => ({ id: p.id, username: p.username, display_name: p.display_name }))
    );
    setCuratorSearching(false);
  }, [curatorSearch]);

  const runHostSearch = useCallback(async () => {
    const q = hostSearch.trim();
    if (!q || q.length < 2) {
      setHostResults([]);
      return;
    }
    setHostSearching(true);
    const { data } = await searchPeople({ q, limit: 10 });
    setHostResults(
      (data ?? []).map((p) => ({ id: p.id, username: p.username, display_name: p.display_name }))
    );
    setHostSearching(false);
  }, [hostSearch]);

  useEffect(() => {
    const tmr = setTimeout(runCuratorSearch, 300);
    return () => clearTimeout(tmr);
  }, [curatorSearch, runCuratorSearch]);

  useEffect(() => {
    const tmr = setTimeout(runHostSearch, 300);
    return () => clearTimeout(tmr);
  }, [hostSearch, runHostSearch]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (!curatorMe && !curatorSelected) {
      setError(t("common.pleaseSelectArtist") ?? "Please select or search for a curator.");
      return;
    }
    if (curatorMe && !effectiveProfileId) {
      setError(t("common.loading") ?? "Loading...");
      return;
    }
    setSubmitting(true);
    setError(null);
    const curatorId = curatorMe ? effectiveProfileId! : curatorSelected!.id;
    const hostProfileId =
      hostProfileMode === "me"
        ? effectiveProfileId ?? null
        : hostProfileMode === "search"
          ? hostSelected?.id ?? null
          : null;
    const { data, error: err } = await createExhibition({
      title: title.trim(),
      start_date: startDate || null,
      end_date: endDate || null,
      status,
      curator_id: curatorId,
      host_name: hostName.trim() || null,
      host_profile_id: hostProfileId,
    });
    setSubmitting(false);
    if (err) {
      logSupabaseError("createExhibition", err);
      setError(formatSupabaseError(err, t, "errors.failedCreateExhibition"));
      return;
    }
    if (data?.id) {
      logBetaEventSync("exhibition_created", {
        exhibition_id: data.id,
        from_board: fromBoardId ?? undefined,
      });
      // QA 2026-07 Phase 2-3: hand off a one-shot "just created" flag so
      // the destination page can surface "저장됨 · 아직 공개되지 않았어요"
      // without a fragile router param. sessionStorage clears itself on
      // read (see readAndClearJustCreatedFlag in exhibition [id]/add page).
      try {
        window.sessionStorage.setItem(
          `theo:exhibition-just-created:${data.id}`,
          "1"
        );
      } catch {
        // Ignore quota / private mode; toast is nice-to-have not required.
      }
      const nextPath = fromBoardId
        ? `/my/exhibitions/${data.id}/add?fromBoard=${fromBoardId}`
        : `/my/exhibitions/${data.id}/add`;
      router.push(nextPath);
    }
  }

  return (
    <>
      {showHeader ? (
        <>
          <TourTrigger tourId={TOUR_IDS.exhibitionCreate} />
          <PageHeader
            variant="plain"
            title={t("exhibition.create")}
            lead={t("exhibition.createSubtitle")}
            actions={<TourHelpButton tourId={TOUR_IDS.exhibitionCreate} />}
          />
        </>
      ) : (
        <p className="mb-6 text-sm leading-relaxed text-zinc-500">
          {t("exhibition.createSubtitle")}
        </p>
      )}

      {boardContext && (
        <div className="mb-5 rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-3 text-xs text-zinc-600">
          {t("boards.promote.fromBoardBanner")
            .replace("{title}", boardContext.title)
            .replace("{n}", String(boardContext.artworkCount))}
        </div>
      )}

      <ActingAsChip mode="posting" />

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div data-tour="exhibition-form-title">
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            {t("exhibition.title")} *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("exhibition.titlePlaceholder")}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            required
          />
        </div>

        <div data-tour="exhibition-form-dates" className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              {t("exhibition.startDate")}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              {t("exhibition.endDate")}
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div data-tour="exhibition-form-status">
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            {t("exhibition.status")}
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "planned" | "live" | "ended")}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div data-tour="exhibition-form-curator">
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            {t("exhibition.curator")}
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="curator"
                checked={curatorMe}
                onChange={() => {
                  setCuratorMe(true);
                  setCuratorSelected(null);
                  setCuratorSearch("");
                  setCuratorResults([]);
                }}
                className="rounded border-zinc-300"
              />
              <span className="text-sm">{t("exhibition.curatorMe")}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="curator"
                checked={!curatorMe}
                onChange={() => setCuratorMe(false)}
                className="rounded border-zinc-300"
              />
              <span className="text-sm">{t("exhibition.searchCurator")}</span>
            </label>
          </div>
          {!curatorMe && (
            <div className="mt-2">
              <input
                type="text"
                value={curatorSearch}
                onChange={(e) => setCuratorSearch(e.target.value)}
                placeholder={t("exhibition.searchCurator")}
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              {curatorSearching && (
                <p className="mt-1 text-xs text-zinc-500">{t("common.loading")}</p>
              )}
              {curatorResults.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-auto rounded border border-zinc-200 bg-white text-sm">
                  {curatorResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setCuratorSelected(p);
                          setCuratorSearch("");
                          setCuratorResults([]);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50"
                      >
                        {formatDisplayName(p)}
                        {p.username && (
                          <span className="ml-1 text-xs text-zinc-500">{formatUsername(p)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {curatorSelected && (
                <p className="mt-1 text-xs text-zinc-600">
                  {t("common.selected")}: {formatDisplayName(curatorSelected)}
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            {t("exhibition.hostVenue")}
          </label>
          <p className="mb-2 text-xs text-zinc-500">{t("exhibition.hostName")}</p>
          <input
            type="text"
            value={hostName}
            onChange={(e) => setHostName(e.target.value)}
            placeholder={t("exhibition.hostName")}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-3">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="host_profile"
                checked={hostProfileMode === "text"}
                onChange={() => {
                  setHostProfileMode("text");
                  setHostSelected(null);
                  setHostSearch("");
                  setHostResults([]);
                }}
                className="rounded border-zinc-300"
              />
              <span className="text-sm text-zinc-600">{t("common.textOnly")}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="host_profile"
                checked={hostProfileMode === "me"}
                onChange={() => {
                  setHostProfileMode("me");
                  setHostSelected(null);
                  setHostSearch("");
                  setHostResults([]);
                }}
                className="rounded border-zinc-300"
              />
              <span className="text-sm">{t("exhibition.hostVenueMe")}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="host_profile"
                checked={hostProfileMode === "search"}
                onChange={() => {
                  setHostProfileMode("search");
                  setHostSelected(null);
                }}
                className="rounded border-zinc-300"
              />
              <span className="text-sm text-zinc-600">{t("exhibition.searchHost")}</span>
            </label>
          </div>
          {hostProfileMode === "search" && (
            <div className="mt-2">
              <input
                type="text"
                value={hostSearch}
                onChange={(e) => setHostSearch(e.target.value)}
                placeholder={t("exhibition.searchHost")}
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              {hostSearching && (
                <p className="mt-1 text-xs text-zinc-500">{t("common.loading")}</p>
              )}
              {hostResults.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-auto rounded border border-zinc-200 bg-white text-sm">
                  {hostResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setHostSelected(p);
                          setHostSearch("");
                          setHostResults([]);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50"
                      >
                        {formatDisplayName(p)}
                        {p.username && (
                          <span className="ml-1 text-xs text-zinc-500">{formatUsername(p)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {hostSelected && (
            <p className="mt-1 text-xs text-zinc-600">
              {t("common.selected")}: {formatDisplayName(hostSelected)}
            </p>
          )}
        </div>

        {title.trim().length > 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70">
            <button
              type="button"
              onClick={() => setShowDraftAssist((v) => !v)}
              aria-expanded={showDraftAssist}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-zinc-700 hover:text-zinc-900"
            >
              <span>
                <span className="font-medium">{t("ai.assist.introLabel")}</span>
                <span className="ml-2 text-xs text-zinc-500">
                  {t("ai.assist.optional")}
                </span>
              </span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 12 12"
                fill="none"
                className={`transition-transform ${showDraftAssist ? "rotate-180" : ""}`}
                aria-hidden="true"
              >
                <path
                  d="M2.5 4.5L6 8l3.5-3.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {showDraftAssist && (
              <div className="border-t border-zinc-200 px-4 py-3">
                <ExhibitionDraftAssist
                  title={title}
                  startDate={startDate}
                  endDate={endDate}
                  curatorLabel={
                    curatorMe
                      ? t("exhibition.curatorMe")
                      : curatorSelected
                        ? formatDisplayName(curatorSelected)
                        : null
                  }
                  hostLabel={
                    hostSelected
                      ? formatDisplayName(hostSelected)
                      : hostName || null
                  }
                  works={[]}
                  onApplyTitle={(text) => setTitle(text)}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={
              submitting ||
              !title.trim() ||
              (curatorMe ? !effectiveProfileId : !curatorSelected)
            }
            className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {submitting ? t("common.loading") : t("exhibition.create")}
          </button>
          {showCancelLink && (
            <Link
              href={cancelHref}
              className="inline-flex items-center rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {t("common.cancel")}
            </Link>
          )}
        </div>
      </form>
    </>
  );
}
