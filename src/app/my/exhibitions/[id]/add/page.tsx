"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";
import { backToLabel } from "@/lib/i18n/back";
import {
  addWorkToExhibition,
  listWorksInExhibition,
} from "@/lib/supabase/exhibitions";
import {
  listMyArtworks,
  listPublicArtworksByArtistId,
  listPublicArtworksListedByProfileId,
  getArtworkImageUrl,
  type ArtworkWithLikes,
} from "@/lib/supabase/artworks";
import { getMyProfile } from "@/lib/supabase/me";
import { searchPeople } from "@/lib/supabase/artists";
import { logSupabaseError } from "@/lib/supabase/errors";
import { formatSupabaseError } from "@/lib/errors/supabase";
import {
  createClaimForExistingArtist,
  createExternalArtistAndClaim,
} from "@/lib/provenance/rpc";
import { getExhibitionById } from "@/lib/supabase/exhibitions";
import { getSession } from "@/lib/supabase/auth";
import { setPendingExhibitionFiles } from "@/lib/pendingExhibitionUpload";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";
import { listShortlistItems } from "@/lib/supabase/shortlists";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import { CreateDelegationWizard } from "@/components/delegation/CreateDelegationWizard";
import { useActingAs } from "@/context/ActingAsContext";
import { getProfileById } from "@/lib/supabase/profiles";
import { ActingAsChip } from "@/components/ActingAsChip";

type Participant = {
  id: string;
  username: string | null;
  display_name: string | null;
};

export default function AddWorkToExhibitionPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useT();
  const id = typeof params.id === "string" ? params.id : "";
  const fromBoardId = searchParams.get("fromBoard");
  const { actingAsProfileId } = useActingAs();
  const [boardArtworkIds, setBoardArtworkIds] = useState<string[]>([]);
  const [boardBulkAdding, setBoardBulkAdding] = useState(false);
  const [boardBulkToast, setBoardBulkToast] = useState<string | null>(null);
  const [dragOverBucketKey, setDragOverBucketKey] = useState<string | null>(null);
  const [artworks, setArtworks] = useState<ArtworkWithLikes[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  // Step state: 1) 참여 작가 선택, 2) 작품 선택
  const [step, setStep] = useState<"artists" | "works">("artists");

  // 참여 작가 (온보딩된 프로필)
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [artistSearch, setArtistSearch] = useState("");
  const [artistResults, setArtistResults] = useState<Participant[]>([]);
  const [searchingArtists, setSearchingArtists] = useState(false);

  // 외부 작가 초대 (아직 온보딩되지 않은 작가)
  const [useExternalInvite, setUseExternalInvite] = useState(false);
  const [externalRows, setExternalRows] = useState<{ name: string; email: string }[]>([
    { name: "", email: "" },
  ]);
  const [invitingExternal, setInvitingExternal] = useState(false);

  // 작품 검색 (제목/설명/매체/키워드 기반 텍스트 검색; 자연어 검색의 1차 버전)
  const [workQuery, setWorkQuery] = useState("");

  // 전시 권한 공유 위자드
  const [shareWizardOpen, setShareWizardOpen] = useState(false);
  const [shareToast, setShareToast] = useState<"sent" | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [exhibitionTitle, setExhibitionTitle] = useState<string | null>(null);

  const fetchArtworks = useCallback(async () => {
    if (!id) return;
    const inExhibitionRes = await listWorksInExhibition(id);
    const inExhibition = new Set((inExhibitionRes.data ?? []).map((w) => w.work_id));
    setDoneIds(inExhibition);

    if (participants.length > 0) {
      const results = await Promise.all(
        participants.map((p) => listPublicArtworksByArtistId(p.id, { limit: 100 }))
      );
      const byId = new Map<string, ArtworkWithLikes>();
      for (const res of results) {
        for (const a of res.data ?? []) {
          if (!byId.has(a.id)) byId.set(a.id, a);
        }
      }
      const merged = Array.from(byId.values()).sort(
        (a, b) =>
          new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
      );
      setArtworks(merged);
      return;
    }

    // Acting-as: scope the "my works" pool to the principal's library so
    // a delegate adding pieces to the principal's exhibition can pick from
    // the principal's catalogue, not the operator's. The "listed by"
    // fallback also uses the principal's profile id to surface works the
    // principal had previously listed (collected/curated/inventory).
    const { data: profile } = actingAsProfileId
      ? await getProfileById(actingAsProfileId)
      : await getMyProfile();
    const profileId = (profile as { id?: string } | null)?.id;
    const [myRes, listedRes] = await Promise.all([
      // Only published works are addable to an exhibition. Bulk-uploaded but
      // not-yet-published drafts must be published first — otherwise abandoned
      // drafts leak into the exhibition add picker (QA 2026-07-01).
      listMyArtworks({
        limit: 100,
        publicOnly: true,
        forProfileId: actingAsProfileId ?? null,
      }),
      profileId
        ? listPublicArtworksListedByProfileId(profileId, { limit: 100 })
        : { data: [] as ArtworkWithLikes[], error: null },
    ]);
    const myList = myRes.data ?? [];
    const listedList = listedRes.data ?? [];
    const byId = new Map<string, ArtworkWithLikes>();
    for (const a of myList) byId.set(a.id, a);
    for (const a of listedList) if (!byId.has(a.id)) byId.set(a.id, a);
    const merged = Array.from(byId.values()).sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    );
    setArtworks(merged);
  }, [id, participants, actingAsProfileId]);

  useEffect(() => {
    setLoading(true);
    fetchArtworks().finally(() => setLoading(false));
  }, [fetchArtworks]);

  useEffect(() => {
    if (!id) return;
    getExhibitionById(id).then(({ data }) => setExhibitionTitle(data?.title ?? null));
  }, [id]);

  useEffect(() => {
    getSession().then(({ data: { session } }) => {
      if (session?.user?.id) setMyId(session.user.id);
    });
  }, []);

  // When promoting from a board, pre-fetch the artwork ids so we can
  // offer a single bulk-add CTA instead of making the user hunt each one.
  useEffect(() => {
    if (!fromBoardId) return;
    let cancelled = false;
    listShortlistItems(fromBoardId).then(({ data }) => {
      if (cancelled) return;
      const ids = data
        .map((it) => it.artwork_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      setBoardArtworkIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [fromBoardId]);

  useEffect(() => {
    if (!boardBulkToast) return;
    const tmr = setTimeout(() => setBoardBulkToast(null), 2800);
    return () => clearTimeout(tmr);
  }, [boardBulkToast]);

  const handleBulkAddFromBoard = useCallback(async () => {
    if (boardBulkAdding || boardArtworkIds.length === 0) return;
    setBoardBulkAdding(true);
    let added = 0;
    let failed = 0;
    for (const workId of boardArtworkIds) {
      // Skip if already in exhibition; duplicate insert would violate uniqueness.
      if (doneIds.has(workId)) continue;
      const { error } = await addWorkToExhibition(id, workId, {
        actingSubjectProfileId: actingAsProfileId ?? null,
      });
      if (error) {
        failed += 1;
      } else {
        added += 1;
        setDoneIds((prev) => {
          const next = new Set(prev);
          next.add(workId);
          return next;
        });
      }
    }
    setBoardBulkAdding(false);
    if (added > 0) {
      logBetaEventSync("board_promote_bulk_added", {
        exhibition_id: id,
        board_id: fromBoardId ?? undefined,
        added,
        total: boardArtworkIds.length,
      });
    }
    if (failed === 0 && added > 0) {
      setBoardBulkToast(t("boards.promote.addedToast").replace("{n}", String(added)));
    } else if (added > 0) {
      setBoardBulkToast(
        t("boards.promote.partialToast")
          .replace("{added}", String(added))
          .replace("{total}", String(boardArtworkIds.length)),
      );
    } else if (failed > 0) {
      setBoardBulkToast(t("boards.promote.failedToast"));
    }
  }, [boardBulkAdding, boardArtworkIds, doneIds, id, t, fromBoardId]);

  // 참여 작가 검색 (온보딩된 유저)
  useEffect(() => {
    const q = artistSearch.trim();
    if (!q) {
      setArtistResults([]);
      return;
    }
    let cancelled = false;
    setSearchingArtists(true);
    searchPeople({ q, limit: 10 })
      .then(({ data }) => {
        if (cancelled) return;
        const list = (data ?? []).map((p) => ({
          id: p.id,
          username: p.username,
          display_name: p.display_name,
        }));
        setArtistResults(list);
      })
      .finally(() => {
        if (!cancelled) setSearchingArtists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artistSearch]);

  const filteredArtworks = useMemo(() => {
    const q = workQuery.trim().toLowerCase();
    const hasParticipants = participants.length > 0;
    return artworks.filter((art) => {
      const matchesParticipant = !hasParticipants
        ? true
        : participants.some((p) => {
            if (p.id === art.artist_id) return true;
            const claims = art.claims ?? [];
            return claims.some((c) => c.subject_profile_id === p.id);
          });
      if (!matchesParticipant) return false;

      if (!q) return true;
      const title = (art.title ?? "").toLowerCase();
      const medium = (art.medium ?? "").toLowerCase();
      const story = (art.story ?? "").toLowerCase();
      const keywords = Array.isArray((art as any).keywords)
        ? ((art as any).keywords as string[]).join(" ").toLowerCase()
        : "";
      return (
        title.includes(q) ||
        medium.includes(q) ||
        story.includes(q) ||
        keywords.includes(q)
      );
    });
  }, [artworks, participants, workQuery]);

  async function handleAdd(workId: string) {
    if (!id) return;
    setAddingId(workId);
    setError(null);
    const { error: err } = await addWorkToExhibition(id, workId, {
      actingSubjectProfileId: actingAsProfileId ?? null,
    });
    if (err) {
      setAddingId(null);
      logSupabaseError("addWorkToExhibition", err);
      setError(formatSupabaseError(err, t, "common.errorSave"));
      return;
    }
    // Align provenance: create CURATED claim so "this work in this exhibition" has gallery–curator provenance.
    const art = artworks.find((a) => a.id === workId);
    if (art?.artist_id) {
      const { error: claimErr } = await createClaimForExistingArtist({
        artistProfileId: art.artist_id,
        claimType: "CURATED",
        workId,
        projectId: id,
        visibility: "public",
        period_status: "current",
      });
      if (claimErr) {
        logSupabaseError("createClaimForExistingArtist (after add to exhibition)", claimErr);
        // Don't block UI: work is already in exhibition; claim may already exist.
      }
    }
    setAddingId(null);
    setDoneIds((prev) => new Set(prev).add(workId));
  }

  if (!id) {
    return (
      <AuthGate>
        <main className="mx-auto max-w-4xl px-4 py-8">
          <p className="text-zinc-600">{t("exhibition.invalidExhibition")}</p>
        </main>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <Link href={`/my/exhibitions/${id}`} className="text-sm text-zinc-600 hover:text-zinc-900">
            ← {backToLabel(t("exhibition.myExhibitions"), locale)}
          </Link>
        </div>

        <h1 className="mb-2 text-xl font-semibold text-zinc-900">{t("exhibition.addWork")}</h1>
        <p className="mb-4 text-sm text-zinc-500">
          {t("exhibition.addExistingWork")}
        </p>

        <ActingAsChip mode="editing" />

        {/* Step indicator */}
        <div className="mb-6 inline-flex rounded-full border border-zinc-200 bg-zinc-50 p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setStep("artists")}
            className={`rounded-full px-3 py-1 ${
              step === "artists" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
            }`}
          >
            1. {t("exhibition.stepArtists")}
          </button>
          <button
            type="button"
            onClick={() => setStep("works")}
            className={`ml-1 rounded-full px-3 py-1 ${
              step === "works" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
            }`}
          >
            2. {t("exhibition.stepWorks")}
          </button>
        </div>

        {/* 전시 권한 공유 (in-context CTA) */}
        <div id="invite" className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3">
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

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {step === "artists" ? (
          <section className="space-y-6">
            <div>
              <h2 className="mb-2 text-sm font-medium text-zinc-800">
                {t("exhibition.participants")}
              </h2>
              <p className="mb-3 text-xs text-zinc-500">
                {t("exhibition.participantsHint")}
              </p>

              {/* 검색으로 참여 작가 추가 */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-700">
                  {t("upload.searchArtist")}
                </label>
                <input
                  type="text"
                  value={artistSearch}
                  onChange={(e) => setArtistSearch(e.target.value)}
                  placeholder={t("upload.artistSearchPlaceholder")}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                />
                {searchingArtists && (
                  <p className="text-xs text-zinc-500">{t("artists.loading")}</p>
                )}
                {artistResults.length > 0 && (
                  <ul className="max-h-52 overflow-auto rounded border border-zinc-200 bg-white text-sm">
                    {artistResults.map((p) => {
                      const selected = participants.some((x) => x.id === p.id);
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setParticipants((prev) =>
                                selected ? prev.filter((x) => x.id !== p.id) : [...prev, p]
                              );
                            }}
                            className={`flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50 ${
                              selected ? "bg-zinc-100" : ""
                            }`}
                          >
                            <span className="truncate">
                              {formatDisplayName(p)}
                              {p.username && (
                                <span className="ml-1 text-xs text-zinc-500">{formatUsername(p)}</span>
                              )}
                            </span>
                            {selected && (
                              <span className="ml-2 text-[10px] uppercase text-zinc-500">
                                {t("common.selected")}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* 선택된 참여 작가 칩 */}
              {participants.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {participants.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        setParticipants((prev) => prev.filter((x) => x.id !== p.id))
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200"
                    >
                      <span>{formatDisplayName(p)}</span>
                      <span className="text-[10px] text-zinc-500">×</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 외부 작가 초대 (온보딩 안 된 작가) */}
            <div className="border-t border-zinc-200 pt-4">
              <button
                type="button"
                onClick={() => setUseExternalInvite((v) => !v)}
                className="text-xs font-medium text-zinc-700 hover:text-zinc-900"
              >
                {useExternalInvite
                  ? t("exhibition.toggleExternalOff")
                  : t("exhibition.toggleExternalOn")}
              </button>
              {useExternalInvite && (
                <div className="mt-3 space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-xs text-zinc-500">
                    {t("exhibition.externalArtistsHint")}
                  </p>
                  {externalRows.map((row, idx) => (
                    <div key={idx} className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => {
                          const v = e.target.value;
                          setExternalRows((prev) => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], name: v };
                            return next;
                          });
                        }}
                        placeholder={t("upload.externalArtistNamePlaceholder")}
                        className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
                      />
                      <input
                        type="email"
                        value={row.email}
                        onChange={(e) => {
                          const v = e.target.value;
                          setExternalRows((prev) => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], email: v };
                            return next;
                          });
                        }}
                        placeholder={t("upload.externalArtistEmailPlaceholder")}
                        className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
                      />
                      {externalRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setExternalRows((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-xs text-zinc-500 hover:text-zinc-800"
                        >
                          {t("common.remove")}
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() =>
                        setExternalRows((prev) => [...prev, { name: "", email: "" }])
                      }
                      className="text-xs text-zinc-700 hover:text-zinc-900"
                    >
                      + {t("exhibition.addExternalRow")}
                    </button>
                    {invitingExternal && (
                      <p className="text-xs text-zinc-500">
                        {t("exhibition.sendingInvites")}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={async () => {
                  // 외부 작가 초대 처리 (이름 있는 행만)
                  if (useExternalInvite) {
                    const rows = externalRows
                      .map((r) => ({
                        name: r.name.trim(),
                        email: r.email.trim(),
                      }))
                      .filter((r) => r.name);
                    if (rows.length > 0) {
                      try {
                        setInvitingExternal(true);
                        for (const row of rows) {
                          const { error: extErr } = await createExternalArtistAndClaim({
                            displayName: row.name,
                            inviteEmail: row.email || null,
                            claimType: "CURATED",
                            workId: null,
                            projectId: id,
                            visibility: "public",
                            period_status: "current",
                          });
                          if (extErr) {
                            logSupabaseError(
                              "createExternalArtistAndClaim (exhibition participants)",
                              extErr
                            );
                          }
                        }
                      } finally {
                        setInvitingExternal(false);
                      }
                    }
                  }
                  setStep("works");
                }}
                className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                {t("exhibition.gotoWorksStep")}
              </button>
            </div>
          </section>
        ) : (
          <section>
            {fromBoardId && boardArtworkIds.length > 0 && (() => {
              const pendingCount = boardArtworkIds.filter((w) => !doneIds.has(w)).length;
              const allDone = pendingCount === 0;
              return (
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="text-xs text-zinc-600">
                    {t("boards.promote.hint")}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleBulkAddFromBoard()}
                    disabled={boardBulkAdding || allDone}
                    className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {boardBulkAdding
                      ? t("boards.promote.adding")
                      : t("boards.promote.addAllFromBoard").replace("{n}", String(pendingCount))}
                  </button>
                </div>
              );
            })()}
            {boardBulkToast && (
              <div role="status" className="mb-4 rounded bg-zinc-900 px-3 py-1.5 text-xs text-white">
                {boardBulkToast}
              </div>
            )}
            {/* 작가 단위 버킷: 드롭 존 + 단일/일괄 버튼 */}
            <div className="mb-6 space-y-4">
              <p className="text-sm font-semibold text-zinc-800">{t("exhibition.addWorksByArtist")}</p>
              {(participants.length > 0 || externalRows.some((r) => r.name.trim())) ? (
                <ul className="grid gap-4 sm:grid-cols-2">
                  {participants.map((p) => {
                    const bucketKey = p.id;
                    const singleQs = new URLSearchParams({
                      addToExhibition: id,
                      from: "exhibition",
                      artistId: p.id,
                    });
                    if (p.display_name) singleQs.set("artistName", p.display_name);
                    if (p.username) singleQs.set("artistUsername", p.username);
                    const bulkQs = new URLSearchParams({
                      addToExhibition: id,
                      from: "exhibition",
                      artistId: p.id,
                    });
                    if (p.username) bulkQs.set("artistUsername", p.username);
                    if (p.display_name) bulkQs.set("artistName", p.display_name);
                    const label = formatDisplayName(p);
                    return (
                      <li key={bucketKey} className="rounded-xl border-2 border-zinc-200 bg-white p-4">
                        <p className="mb-3 font-medium text-zinc-900">{label}</p>
                        <div
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverBucketKey(bucketKey);
                          }}
                          onDragLeave={() => setDragOverBucketKey(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOverBucketKey(null);
                            const files = Array.from(e.dataTransfer.files).filter((f) =>
                              ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.type)
                            );
                            if (files.length === 0) return;
                            setPendingExhibitionFiles({
                              exhibitionId: id,
                              artistId: p.id,
                              artistName: p.display_name ?? undefined,
                              artistUsername: p.username ?? undefined,
                              files,
                            });
                            if (files.length === 1) {
                              router.push(`/upload?${singleQs.toString()}`);
                            } else {
                              router.push(`/upload/bulk?${bulkQs.toString()}`);
                            }
                          }}
                          className={`mb-3 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${
                            dragOverBucketKey === bucketKey
                              ? "border-zinc-900 bg-zinc-100"
                              : "border-zinc-300 bg-zinc-50/70 hover:border-zinc-400"
                          }`}
                        >
                          {t("exhibition.dropImagesHere")}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/upload?${singleQs.toString()}`}
                            className="inline-flex items-center rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                          >
                            {t("exhibition.uploadSingleWork")}
                          </Link>
                          <Link
                            href={`/upload/bulk?${bulkQs.toString()}`}
                            className="inline-flex items-center rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                          >
                            {t("exhibition.uploadBulkWorks")}
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                  {externalRows
                    .map((r) => ({ name: r.name.trim(), email: r.email.trim() }))
                    .filter((r) => r.name)
                    .map((r, idx) => {
                      const bucketKey = `ext-${idx}`;
                      const singleQs = new URLSearchParams({
                        addToExhibition: id,
                        from: "exhibition",
                        externalName: r.name,
                      });
                      if (r.email) singleQs.set("externalEmail", r.email);
                      const bulkQs = new URLSearchParams({
                        addToExhibition: id,
                        from: "exhibition",
                        externalName: r.name,
                      });
                      if (r.email) bulkQs.set("externalEmail", r.email);
                      return (
                        <li key={bucketKey} className="rounded-xl border-2 border-zinc-200 bg-white p-4">
                          <p className="mb-3 font-medium text-zinc-900">{r.name}</p>
                          <div
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragOverBucketKey(bucketKey);
                            }}
                            onDragLeave={() => setDragOverBucketKey(null)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setDragOverBucketKey(null);
                              const files = Array.from(e.dataTransfer.files).filter((f) =>
                                ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.type)
                              );
                              if (files.length === 0) return;
                              setPendingExhibitionFiles({
                                exhibitionId: id,
                                externalName: r.name,
                                externalEmail: r.email || undefined,
                                files,
                              });
                              if (files.length === 1) {
                                router.push(`/upload?${singleQs.toString()}`);
                              } else {
                                router.push(`/upload/bulk?${bulkQs.toString()}`);
                              }
                            }}
                            className={`mb-3 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${
                              dragOverBucketKey === bucketKey
                                ? "border-zinc-900 bg-zinc-100"
                                : "border-zinc-300 bg-zinc-50/70 hover:border-zinc-400"
                            }`}
                          >
                            {t("exhibition.dropImagesHere")}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/upload?${singleQs.toString()}`}
                              className="inline-flex items-center rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                            >
                              {t("exhibition.uploadSingleWork")}
                            </Link>
                            <Link
                              href={`/upload/bulk?${bulkQs.toString()}`}
                              className="inline-flex items-center rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                            >
                              {t("exhibition.uploadBulkWorks")}
                            </Link>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              ) : (
                <div className="rounded-xl border-2 border-zinc-200 bg-zinc-50/80 p-4">
                  <p className="mb-3 text-xs text-zinc-500">{t("exhibition.addArtistsFirst")}</p>
                  <button
                    type="button"
                    onClick={() => setStep("artists")}
                    className="text-sm font-medium text-zinc-700 underline hover:text-zinc-900"
                  >
                    {t("exhibition.stepArtists")} ←
                  </button>
                </div>
              )}
            </div>

            {participants.length > 0 && (
              <p className="mb-2 text-xs text-zinc-500">{t("exhibition.selectedArtistsWorksOnly")}</p>
            )}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-medium text-zinc-600">
                  {t("exhibition.filterByArtist")}
                </span>
                <button
                  type="button"
                  onClick={() => setParticipants([])}
                  className={`rounded-full px-3 py-1 text-xs ${
                    participants.length === 0
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                  }`}
                >
                  {t("common.all")}
                </button>
                {participants.map((p) => (
                  <span
                    key={p.id}
                    className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700"
                  >
                    {formatDisplayName(p)}
                  </span>
                ))}
              </div>
              <div className="flex flex-1 justify-end gap-2">
                <input
                  type="text"
                  value={workQuery}
                  onChange={(e) => setWorkQuery(e.target.value)}
                  placeholder={t("exhibition.searchWorksPlaceholder")}
                  className="w-full max-w-xs rounded border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            {loading ? (
              <p className="text-sm text-zinc-500">{t("common.loading")}</p>
            ) : filteredArtworks.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 py-8 text-center">
                <p className="mb-4 text-sm text-zinc-600">
                  {t("exhibition.noWorksForFilter")}
                </p>
                <Link
                  href={`/upload?addToExhibition=${id}`}
                  className="inline-block rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  {t("exhibition.uploadNewWork")}
                </Link>
              </div>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredArtworks.map((art) => {
                  const img = art.artwork_images?.[0]?.storage_path;
                  const added = doneIds.has(art.id);
                  return (
                    <li
                      key={art.id}
                      className="overflow-hidden rounded-lg border border-zinc-200 bg-white"
                    >
                      <Link href={`/artwork/${art.id}`} className="block">
                        {img ? (
                          <div className="relative aspect-[4/3] bg-zinc-100">
                            <Image
                              src={getArtworkImageUrl(img, "thumb")}
                              alt={art.title ?? ""}
                              fill
                              className="object-cover"
                              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                            />
                          </div>
                        ) : (
                          <div className="flex aspect-[4/3] items-center justify-center bg-zinc-100 text-sm text-zinc-400">
                            {t("common.noImage")}
                          </div>
                        )}
                        <div className="p-3">
                          <p className="font-medium text-zinc-900">
                            {art.title ?? t("common.untitled")}
                          </p>
                          <p className="text-xs text-zinc-500">{art.year ?? ""}</p>
                        </div>
                      </Link>
                      <div className="border-t border-zinc-100 px-3 py-2">
                        {added ? (
                          <span className="text-xs font-medium text-green-600">
                            {t("common.saved")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAdd(art.id)}
                            disabled={addingId === art.id}
                            className="text-xs font-medium text-zinc-700 hover:text-zinc-900 disabled:opacity-50"
                          >
                            {addingId === art.id ? "..." : t("exhibition.addWork")}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
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
          initialProjectTitle={exhibitionTitle ?? undefined}
          initialPreset="project_co_edit"
        />
      )}
    </AuthGate>
  );
}
