"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useActingAs } from "@/context/ActingAsContext";
import { useT } from "@/lib/i18n/useT";
import { pickLegacyTitleForSave, pickLegacyForSave } from "@/lib/i18n/pickLocalized";
import { BilingualFieldPair } from "@/components/i18n/BilingualFieldPair";
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
  const { t, locale } = useT();
  const [boardContext, setBoardContext] = useState<{ title: string; artworkCount: number } | null>(null);
  const { actingAsProfileId } = useActingAs();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  /**
   * QA 2026-07 Phase 4 (스코프 B) — bilingual titles with progressive
   * disclosure. Default: one input in the current UI language. The
   * operator can reveal the second language via `[+ 다른 언어 추가]`.
   *
   * Legacy `title` is kept in sync on save using pickLegacyTitleForSave
   * (KO wins on tie), so callers that haven't migrated to bilingual
   * fields still surface a usable string.
   */
  const [titleKo, setTitleKo] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [showOtherLangTitle, setShowOtherLangTitle] = useState(false);
  const primaryLang: "ko" | "en" = locale === "ko" ? "ko" : "en";
  const primaryTitle = primaryLang === "ko" ? titleKo : titleEn;
  const otherTitle = primaryLang === "ko" ? titleEn : titleKo;
  const setPrimaryTitle = (v: string) =>
    primaryLang === "ko" ? setTitleKo(v) : setTitleEn(v);
  const setOtherTitle = (v: string) =>
    primaryLang === "ko" ? setTitleEn(v) : setTitleKo(v);
  const hasAnyTitle = titleKo.trim().length > 0 || titleEn.trim().length > 0;
  /**
   * QA 2026-07-28 — 전시 서문(preface). Progressive disclosure mirrors
   * the title UX: primary-language textarea is always visible, other
   * language reveals on "다른 언어 추가" click (or auto-expands if
   * both are pre-filled). Persisted through createExhibition below.
   */
  const [prefaceKo, setPrefaceKo] = useState("");
  const [prefaceEn, setPrefaceEn] = useState("");
  const [showOtherLangPreface, setShowOtherLangPreface] = useState(false);
  const primaryPreface = primaryLang === "ko" ? prefaceKo : prefaceEn;
  const otherPreface = primaryLang === "ko" ? prefaceEn : prefaceKo;
  const setPrimaryPreface = (v: string) =>
    primaryLang === "ko" ? setPrefaceKo(v) : setPrefaceEn(v);
  const setOtherPreface = (v: string) =>
    primaryLang === "ko" ? setPrefaceEn(v) : setPrefaceKo(v);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<"planned" | "live" | "ended">("planned");
  const [curatorMe, setCuratorMe] = useState(true);
  const [curatorSearch, setCuratorSearch] = useState("");
  const [curatorResults, setCuratorResults] = useState<ProfileOption[]>([]);
  const [curatorSelected, setCuratorSelected] = useState<ProfileOption | null>(null);
  const [curatorSearching, setCuratorSearching] = useState(false);
  /**
   * QA 2026-07-28 — 주최명 KO/EN 이중언어 (240002 컬럼). 정의된 profile 을
   * 링크하는 경우엔 legacy hostName 필드로 텍스트를 남기지 않아도 되지만,
   * 자유 텍스트 입력 시 두 언어를 나란히 보이고 싶을 수 있다. legacy
   * `host_name` 은 240004 트리거가 KO 우선 sync 하며, 클라이언트에서는
   * pickLegacyForSave 로 계산해서 함께 저장한다.
   */
  const [hostName, setHostName] = useState("");
  const [hostNameKo, setHostNameKo] = useState("");
  const [hostNameEn, setHostNameEn] = useState("");
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
      // Seed the primary-language title only when no title has been typed
      // yet, so manual edits are never overwritten. Depend on `locale`
      // via primaryLang so an SSR-hydrated user opening in KO still gets
      // the seed in the right slot.
      if (primaryLang === "ko") {
        setTitleKo((prev) => (prev.trim().length > 0 ? prev : sl.title));
      } else {
        setTitleEn((prev) => (prev.trim().length > 0 ? prev : sl.title));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromBoardId, primaryLang]);

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
    const legacyTitle = pickLegacyTitleForSave({
      title_ko: titleKo,
      title_en: titleEn,
    });
    if (!legacyTitle) return;
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
    const legacyHost =
      pickLegacyForSave(hostNameKo || null, hostNameEn || null) ??
      hostName.trim() ??
      null;
    const { data, error: err } = await createExhibition({
      title: legacyTitle,
      title_ko: titleKo.trim() || null,
      title_en: titleEn.trim() || null,
      preface_ko: prefaceKo.trim() || null,
      preface_en: prefaceEn.trim() || null,
      start_date: startDate || null,
      end_date: endDate || null,
      status,
      curator_id: curatorId,
      host_name: legacyHost || hostName.trim() || null,
      host_name_ko: hostNameKo.trim() || null,
      host_name_en: hostNameEn.trim() || null,
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

        <div data-tour="exhibition-form-title" className="space-y-2">
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            {t("exhibition.title")} *
          </label>
          {/*
            Primary language input (matches current UI locale). Chip on the
            right marks which language this slot represents so it's clear
            once the secondary field is revealed.
          */}
          <div className="relative">
            <input
              type="text"
              value={primaryTitle}
              onChange={(e) => setPrimaryTitle(e.target.value)}
              placeholder={t("exhibition.titlePlaceholder")}
              className="w-full rounded border border-zinc-300 px-3 py-2 pr-14 text-sm"
              required
              lang={primaryLang}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              {primaryLang}
            </span>
          </div>
          {showOtherLangTitle ? (
            <div className="relative">
              <input
                type="text"
                value={otherTitle}
                onChange={(e) => setOtherTitle(e.target.value)}
                placeholder={t(
                  primaryLang === "ko"
                    ? "exhibition.titleOtherLangPlaceholderEn"
                    : "exhibition.titleOtherLangPlaceholderKo"
                )}
                className="w-full rounded border border-zinc-300 px-3 py-2 pr-14 text-sm"
                lang={primaryLang === "ko" ? "en" : "ko"}
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                {primaryLang === "ko" ? "en" : "ko"}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowOtherLangTitle(true)}
              className="text-xs text-zinc-500 underline hover:text-zinc-800"
            >
              {t("exhibition.titleAddOtherLang")}
            </button>
          )}
        </div>

        {/*
          QA 2026-07-28 — 서문(preface) textarea. Optional field; the
          curator can type or paste an AI-drafted intro. Mirrors the
          bilingual title pattern: primary slot in the current UI locale,
          "다른 언어 추가" reveals the secondary language.
        */}
        <div data-tour="exhibition-form-preface" className="space-y-2">
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            {t("exhibition.preface")}
          </label>
          <p className="mb-1 text-xs text-zinc-500">{t("exhibition.prefaceHint")}</p>
          <div className="relative">
            <textarea
              value={primaryPreface}
              onChange={(e) => setPrimaryPreface(e.target.value)}
              placeholder={t("exhibition.prefacePlaceholder")}
              className="min-h-[140px] w-full resize-y rounded border border-zinc-300 px-3 py-2 pr-14 text-sm leading-relaxed"
              lang={primaryLang}
            />
            <span className="pointer-events-none absolute right-2 top-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              {primaryLang}
            </span>
          </div>
          {showOtherLangPreface ? (
            <div className="relative">
              <textarea
                value={otherPreface}
                onChange={(e) => setOtherPreface(e.target.value)}
                placeholder={t(
                  primaryLang === "ko"
                    ? "exhibition.prefaceOtherLangPlaceholderEn"
                    : "exhibition.prefaceOtherLangPlaceholderKo"
                )}
                className="min-h-[140px] w-full resize-y rounded border border-zinc-300 px-3 py-2 pr-14 text-sm leading-relaxed"
                lang={primaryLang === "ko" ? "en" : "ko"}
              />
              <span className="pointer-events-none absolute right-2 top-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                {primaryLang === "ko" ? "en" : "ko"}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowOtherLangPreface(true)}
              className="text-xs text-zinc-500 underline hover:text-zinc-800"
            >
              {t("exhibition.prefaceAddOtherLang")}
            </button>
          )}
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
          {/*
            QA 2026-07-28 — 주최명 이중언어 (240002). 자유 텍스트 슬롯을 위해
            BilingualFieldPair 사용. legacy `hostName` 은 KO 우선으로 자동
            계산; 240004 트리거가 서버 측에서도 sync.
          */}
          <BilingualFieldPair
            label={t("exhibition.hostVenue")}
            hint={t("exhibition.hostName")}
            addKoKey="bilingual.addKoHost"
            addEnKey="bilingual.addEnHost"
            placeholderKo={t("exhibition.hostName")}
            placeholderEn={t("exhibition.hostName")}
            valueKo={hostNameKo}
            valueEn={hostNameEn}
            onChangeKo={(v) => {
              setHostNameKo(v);
              const legacy = pickLegacyForSave(v || null, hostNameEn || null) ?? "";
              setHostName(legacy);
            }}
            onChangeEn={(v) => {
              setHostNameEn(v);
              const legacy = pickLegacyForSave(hostNameKo || null, v || null) ?? "";
              setHostName(legacy);
            }}
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

        {hasAnyTitle && (
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
                  title={primaryTitle || otherTitle}
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
                  onApplyTitle={(text) => setPrimaryTitle(text)}
                  onApplyDescription={(text) => {
                    setPrimaryPreface(text);
                    if (!showOtherLangPreface && otherPreface.trim()) {
                      setShowOtherLangPreface(true);
                    }
                  }}
                  currentDescription={primaryPreface}
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
              !hasAnyTitle ||
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
