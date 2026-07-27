"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useActingAs } from "@/context/ActingAsContext";
import { useT } from "@/lib/i18n/useT";
import { backToLabel } from "@/lib/i18n/back";
import {
  deleteExhibitionKeepWorks,
  deleteExhibitionWithArtworks,
  getExhibitionById,
  updateExhibition,
  type ExhibitionRow,
} from "@/lib/supabase/exhibitions";
import type { ExhibitionWithCredits } from "@/lib/exhibitionCredits";
import { logSupabaseError } from "@/lib/supabase/errors";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { getMyProfile } from "@/lib/supabase/me";
import { searchPeople } from "@/lib/supabase/artists";
import { listWorksInExhibition } from "@/lib/supabase/exhibitions";
import { supabase as supabaseClient } from "@/lib/supabase/client";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";
import { ExhibitionDraftAssist } from "@/components/ai/ExhibitionDraftAssist";
import { ExhibitionReviewPanel } from "@/components/exhibition/ExhibitionReviewPanel";
import { CreateDelegationWizard } from "@/components/delegation/CreateDelegationWizard";
import { ExhibitionDraftBanner } from "@/components/exhibitions/ExhibitionDraftBanner";
import { ActingAsChip } from "@/components/ActingAsChip";

const STATUS_OPTIONS = [
  { value: "planned", labelKey: "exhibition.statusPlanned" },
  { value: "live", labelKey: "exhibition.statusLive" },
  { value: "ended", labelKey: "exhibition.statusEnded" },
] as const;

type ProfileOption = { id: string; username: string | null; display_name: string | null };

export default function EditExhibitionPage() {
  const params = useParams();
  const router = useRouter();
  const { t, locale } = useT();
  const { actingAsProfileId } = useActingAs();
  const id = typeof params.id === "string" ? params.id : "";
  const [exhibition, setExhibition] = useState<ExhibitionWithCredits | null>(null);
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
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"keep_works" | "delete_all">("keep_works");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shareWizardOpen, setShareWizardOpen] = useState(false);
  const [shareToast, setShareToast] = useState<"sent" | null>(null);
  const [exhibitionWorks, setExhibitionWorks] = useState<
    Array<{ id: string; title?: string | null; year?: string | number | null; medium?: string | null }>
  >([]);

  const effectiveProfileId = actingAsProfileId ?? myProfileId;

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      const { data } = await listWorksInExhibition(id);
      const ids = (data ?? []).map((r) => r.work_id).filter(Boolean);
      if (ids.length === 0) {
        if (alive) setExhibitionWorks([]);
        return;
      }
      const { data: arts } = await supabaseClient
        .from("artworks")
        .select("id, title, year, medium")
        .in("id", ids);
      if (alive) setExhibitionWorks((arts ?? []) as typeof exhibitionWorks);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    getMyProfile().then(({ data }) => {
      setMyProfileId((data as { id?: string } | null)?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    Promise.all([getExhibitionById(id), getMyProfile()]).then(
      ([{ data: exData, error: exErr }, { data: profileData }]) => {
        setLoading(false);
        const myId = (profileData as { id?: string } | null)?.id ?? null;
        setMyProfileId(myId);
        if (exErr || !exData) {
          setError(
            exErr ? (exErr instanceof Error ? exErr.message : t("common.notFound")) : t("common.notFound")
          );
          return;
        }
        const data = exData as ExhibitionWithCredits;
        setExhibition(data);
        setTitle(data.title);
        setStartDate(data.start_date ?? "");
        setEndDate(data.end_date ?? "");
        setStatus((data.status as "planned" | "live" | "ended") || "planned");
        setHostName(data.host_name ?? "");
        const effId = actingAsProfileId ?? myId;
        if (data.curator_id === effId) {
          setCuratorMe(true);
          setCuratorSelected(null);
        } else {
          setCuratorMe(false);
          setCuratorSelected({
            id: data.curator_id,
            display_name: data.curator?.display_name ?? null,
            username: data.curator?.username ?? null,
          });
        }
        if (data.host_profile_id == null || data.host_profile_id === "") {
          setHostProfileMode("text");
          setHostSelected(null);
        } else if (data.host_profile_id === effId) {
          setHostProfileMode("me");
          setHostSelected(null);
        } else {
          setHostProfileMode("search");
          setHostSelected({
            id: data.host_profile_id,
            display_name: data.host?.display_name ?? null,
            username: data.host?.username ?? null,
          });
        }
      }
    );
  }, [id, actingAsProfileId]);

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
    if (!id || !title.trim()) return;
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
    const { error: err } = await updateExhibition(
      id,
      {
        title: title.trim(),
        start_date: startDate || null,
        end_date: endDate || null,
        status,
        curator_id: curatorId,
        host_name: hostName.trim() || null,
        host_profile_id: hostProfileId,
      },
      { actingSubjectProfileId: actingAsProfileId ?? null }
    );
    setSubmitting(false);
    if (err) {
      logSupabaseError("updateExhibition", err);
      setError(formatSupabaseError(err, t, "common.errorUpdate"));
      return;
    }
    router.push(`/my/exhibitions/${id}`);
  }

  async function handleDeleteExhibition() {
    if (!id || deleteConfirm !== "DELETE") return;
    setDeleting(true);
    setError(null);
    const result =
      deleteMode === "delete_all"
        ? await deleteExhibitionWithArtworks(id)
        : await deleteExhibitionKeepWorks(id);
    setDeleting(false);
    if (result.error) {
      const failed = (result as { failedArtworkIds?: string[] }).failedArtworkIds;
      const base = formatSupabaseError(result.error, t, "errors.failedDeleteExhibition");
      const suffix = failed && failed.length > 0
        ? ` ${t("exhibition.deletePartialFailureSuffix").replace("{count}", String(failed.length))}`
        : "";
      setError(`${base}${suffix}`);
      return;
    }
    router.push("/my/exhibitions");
  }

  if (!id) {
    return (
      <AuthGate>
        <main className="mx-auto max-w-2xl px-4 py-8">
          <p className="text-zinc-600">{t("exhibition.invalidExhibition")}</p>
        </main>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6">
          <Link href={`/my/exhibitions/${id}`} className="text-sm text-zinc-600 hover:text-zinc-900">
            ← {backToLabel(t("exhibition.myExhibitions"), locale)}
          </Link>
        </div>

        <h1 className="mb-6 text-xl font-semibold text-zinc-900">
          {t("common.edit")} {t("exhibition.myExhibitions")}
        </h1>

        {/*
          QA 2026-07 Phase 2-3: draft banner. Rendered as soon as we know
          the current status + works — for planned + 0 works the owner
          sees a positive prompt to add works before publishing.
          Uses exhibitionWorks.length that's already loaded on this page.
        */}
        {exhibition && (
          <ExhibitionDraftBanner
            exhibitionId={id}
            status={status}
            worksCount={exhibitionWorks.length}
            className="mb-6"
          />
        )}

        <ActingAsChip mode="editing" />

        {loading ? (
          <p className="text-sm text-zinc-500">{t("common.loading")}</p>
        ) : !exhibition ? (
          <p className="text-zinc-600">{error ?? t("common.notFound")}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-sm text-red-600">{error}</p>}

            <ExhibitionReviewPanel exhibitionId={id} />

            <div>
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
              <div className="mt-3">
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
                  works={exhibitionWorks}
                  onApplyTitle={(text) => setTitle(text)}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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

            <div>
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

            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                {t("exhibition.curator")}
              </label>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="curator_edit"
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
                    name="curator_edit"
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
                    name="host_profile_edit"
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
                    name="host_profile_edit"
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
                    name="host_profile_edit"
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

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={
                  submitting ||
                  !title.trim() ||
                  (curatorMe ? !effectiveProfileId : !curatorSelected)
                }
                className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {submitting ? "..." : t("common.save")}
              </button>
              <Link
                href={`/my/exhibitions/${id}`}
                className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {t("common.cancel")}
              </Link>
            </div>

            <div className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-700">{t("delegation.shareExhibitionAccess")}</p>
                  <p className="mt-1 text-xs text-zinc-500">{t("delegation.shareExhibitionAccessHint")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShareToast(null);
                    setShareWizardOpen(true);
                  }}
                  className="shrink-0 rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  {t("delegation.shareExhibitionAccessCta")}
                </button>
              </div>
              {shareToast === "sent" && (
                <p className="mt-3 text-xs text-zinc-600" role="status">
                  {t("delegation.inviteSentToUser")}
                </p>
              )}
            </div>

            <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="mb-2 text-sm font-semibold text-red-700">전시 전체 삭제</p>
              <div className="space-y-2 text-xs text-red-700">
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="delete_mode"
                    checked={deleteMode === "keep_works"}
                    onChange={() => setDeleteMode("keep_works")}
                  />
                  <span>전시 이력만 삭제 (작품/프로비넌스는 유지)</span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="delete_mode"
                    checked={deleteMode === "delete_all"}
                    onChange={() => setDeleteMode("delete_all")}
                  />
                  <span>업로드된 작품 모두 + 프로비넌스 히스토리 삭제</span>
                </label>
              </div>
              <p className="mt-3 text-xs text-red-600">확인을 위해 아래에 DELETE를 입력하세요.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  className="rounded border border-red-300 bg-white px-2 py-1.5 text-sm"
                  placeholder="DELETE"
                />
                <button
                  type="button"
                  onClick={handleDeleteExhibition}
                  disabled={deleting || deleteConfirm !== "DELETE"}
                  className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? "..." : "전시 전체 삭제"}
                </button>
              </div>
            </div>
          </form>
        )}
      </main>
      {shareWizardOpen && (
        <CreateDelegationWizard
          open={shareWizardOpen}
          onClose={() => setShareWizardOpen(false)}
          onCreated={() => {
            setShareWizardOpen(false);
            setShareToast("sent");
          }}
          initialScope="project"
          initialProjectId={id}
          initialProjectTitle={title || exhibition?.title || undefined}
          initialPreset="project_co_edit"
          titleOverride={t("delegation.wizard.titleShareExhibition")}
        />
      )}
    </AuthGate>
  );
}
