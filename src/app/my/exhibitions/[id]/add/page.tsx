"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  listExhibitionParticipants,
  removeExhibitionParticipant,
} from "@/lib/supabase/exhibitionParticipants";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";
import { listShortlistItems } from "@/lib/supabase/shortlists";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import { CreateDelegationWizard } from "@/components/delegation/CreateDelegationWizard";
import { ExhibitionDraftBanner } from "@/components/exhibitions/ExhibitionDraftBanner";
import { useActingAs } from "@/context/ActingAsContext";
import { getProfileById } from "@/lib/supabase/profiles";
import { ActingAsChip } from "@/components/ActingAsChip";

type Participant = {
  id: string;
  username: string | null;
  display_name: string | null;
  /**
   * `claimId` is the id of the project-scope CURATED claim that pins
   * this profile to the exhibition. Non-null once the addition has
   * round-tripped through the server (either just now, or hydrated on
   * mount). When null, we treat the row as "unsaved" and DO NOT allow
   * remove (× hides the row locally only).
   */
  claimId: string | null;
  worksCount?: number;
};

/**
 * External (invited but not-yet-onboarded) artist row on `/add`.
 *
 * QA 2026-07-28: participant rows are now the DB's project-scope CURATED
 * claims (see `20260728220000_exhibition_participant_dedupe.sql`). Every
 * blur-save round-trip fills `claimId` + `externalArtistId`, and the
 * `saveStatus` chip surfaces "saving / saved / duplicate absorbed / error"
 * inline without shouting. `savedSnapshot` records the fields we last
 * successfully persisted so idle keystrokes don't retrigger writes.
 */
type ExternalRow = {
  clientId: string;
  claimId: string | null;
  externalArtistId: string | null;
  name_ko: string;
  name_en: string;
  email: string;
  showOther: boolean;
  saveStatus: "idle" | "saving" | "saved" | "duplicate" | "error";
  saveError: string | null;
  removeBlockedCount: number | null;
  worksCount: number;
  savedSnapshot: { name_ko: string; name_en: string; email: string } | null;
};

function emptyExternalRow(): ExternalRow {
  return {
    clientId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `row-${Math.random().toString(36).slice(2)}`,
    claimId: null,
    externalArtistId: null,
    name_ko: "",
    name_en: "",
    email: "",
    showOther: false,
    saveStatus: "idle",
    saveError: null,
    removeBlockedCount: null,
    worksCount: 0,
    savedSnapshot: null,
  };
}

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

  // 외부 작가 초대 (아직 온보딩되지 않은 작가).
  //
  // QA 2026-07-28: 외부 작가 명단은 이제 서버(project-scope CURATED
  // claim)를 진실원으로 삼고, blur 마다 개별 upsert. `useExternalInvite`
  // 는 순수 UI 토글이며, 기존 참여자가 있으면 자동으로 켜진다.
  const [useExternalInvite, setUseExternalInvite] = useState(false);
  const [externalRows, setExternalRows] = useState<ExternalRow[]>([
    emptyExternalRow(),
  ]);
  const [participantsHydrated, setParticipantsHydrated] = useState(false);
  const [participantsError, setParticipantsError] = useState<string | null>(null);
  const [participantRemoveToast, setParticipantRemoveToast] = useState<string | null>(null);
  const [landingToast, setLandingToast] = useState<string | null>(null);
  const externalPrimaryLang: "ko" | "en" = locale === "ko" ? "ko" : "en";

  // 작품 검색 (제목/설명/매체/키워드 기반 텍스트 검색; 자연어 검색의 1차 버전)
  const [workQuery, setWorkQuery] = useState("");

  // 전시 권한 공유 위자드
  const [shareWizardOpen, setShareWizardOpen] = useState(false);
  const [shareToast, setShareToast] = useState<"sent" | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [exhibitionTitle, setExhibitionTitle] = useState<string | null>(null);
  const [exhibitionStatus, setExhibitionStatus] = useState<string | null>(null);

  /**
   * QA 2026-07-28 — participant hydration.
   *
   * Rehydrates both `participants` (kind='profile') and `externalRows`
   * (kind='external') from the DB's project-scope CURATED claims. Called
   * on mount, on `id`/`actingAsProfileId` change, and whenever the tab
   * regains focus so multi-device / cross-tab edits reconcile without a
   * hard reload.
   *
   * The trailing blank external row is always ensured so the operator can
   * keep adding without a manual "+ 작가 추가" click.
   */
  const hydrateParticipants = useCallback(async () => {
    if (!id) return;
    const { data, error: err } = await listExhibitionParticipants(id);
    if (err) {
      logSupabaseError("listExhibitionParticipants", err);
      setParticipantsError(formatSupabaseError(err, t, "common.errorLoad"));
      setParticipantsHydrated(true);
      return;
    }
    setParticipantsError(null);
    const profileRows: Participant[] = [];
    const externals: ExternalRow[] = [];
    let hadExternals = false;
    for (const p of data) {
      if (p.kind === "profile" && p.profileId) {
        profileRows.push({
          id: p.profileId,
          username: p.username,
          display_name: p.displayName,
          claimId: p.claimId,
          worksCount: p.worksCount,
        });
      } else if (p.kind === "external" && p.externalArtistId) {
        hadExternals = true;
        externals.push({
          clientId:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `hyd-${p.claimId}`,
          claimId: p.claimId,
          externalArtistId: p.externalArtistId,
          name_ko: p.displayNameKo ?? "",
          name_en: p.displayNameEn ?? "",
          email: p.inviteEmail ?? "",
          showOther: !!(p.displayNameKo && p.displayNameEn),
          saveStatus: "saved",
          saveError: null,
          removeBlockedCount: null,
          worksCount: p.worksCount,
          savedSnapshot: {
            name_ko: p.displayNameKo ?? "",
            name_en: p.displayNameEn ?? "",
            email: p.inviteEmail ?? "",
          },
        });
      }
    }
    setParticipants(profileRows);
    setExternalRows((prev) => {
      // Preserve any locally-typed unsaved trailing row so we don't wipe
      // an in-flight input during a focus-driven refresh.
      const unsavedTail = prev.filter(
        (r) =>
          r.claimId == null &&
          (r.name_ko.trim().length > 0 ||
            r.name_en.trim().length > 0 ||
            r.email.trim().length > 0),
      );
      const merged = [...externals, ...unsavedTail];
      // Always keep exactly one trailing blank for continued editing.
      if (merged.length === 0 || merged[merged.length - 1].claimId != null || merged[merged.length - 1].savedSnapshot != null) {
        merged.push(emptyExternalRow());
      }
      return merged;
    });
    if (hadExternals) setUseExternalInvite(true);
    setParticipantsHydrated(true);
  }, [id, t]);

  useEffect(() => {
    setParticipantsHydrated(false);
    void hydrateParticipants();
  }, [hydrateParticipants, actingAsProfileId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = () => {
      void hydrateParticipants();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [hydrateParticipants]);

  useEffect(() => {
    if (!participantRemoveToast) return;
    const tmr = setTimeout(() => setParticipantRemoveToast(null), 3200);
    return () => clearTimeout(tmr);
  }, [participantRemoveToast]);

  // QA 2026-07-28: quiet "돌아왔어요" toast after a successful bulk /
  // single upload that started from /add. Consumes the sessionStorage
  // flag so a hard reload won't re-show it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let key: string | null = null;
    try {
      key = window.sessionStorage.getItem("exhibitionAddReturnToast");
      if (key) window.sessionStorage.removeItem("exhibitionAddReturnToast");
    } catch {
      key = null;
    }
    if (key === "bulk.doneReturnToExhibition") {
      setLandingToast(t("exhibition.participants.bulkDoneReturnToast"));
    }
  }, [t]);

  useEffect(() => {
    if (!landingToast) return;
    const tmr = setTimeout(() => setLandingToast(null), 3200);
    return () => clearTimeout(tmr);
  }, [landingToast]);

  /**
   * QA 2026-07-28 — external row upsert.
   *
   * Called from `onBlur` handlers via a per-row debounce. Skips when the
   * row is empty (no name in either language) or when the fields match
   * the last saved snapshot (no-op edit). Server response's claim id
   * either matches an existing sibling row (dedupe absorbed) or claims
   * the row's own new identity. Bilingual columns are patched via a
   * follow-up UPDATE the same way Phase 4 did (RLS: invited_by).
   *
   * The ref-mirror of `externalRows` sidesteps a stale-closure trap:
   * timers scheduled from `onBlur` fire ~500ms later, well after further
   * keystrokes may have mutated state. Reading through the ref always
   * yields the freshest row snapshot.
   */
  const saveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const externalRowsRef = useRef<ExternalRow[]>(externalRows);
  useEffect(() => {
    externalRowsRef.current = externalRows;
  }, [externalRows]);

  useEffect(() => {
    return () => {
      saveTimersRef.current.forEach((t) => clearTimeout(t));
      saveTimersRef.current.clear();
    };
  }, []);

  const persistExternalRow = useCallback(
    async (clientId: string) => {
      const row = externalRowsRef.current.find((r) => r.clientId === clientId);
      if (!row) return;
      const ko = row.name_ko.trim();
      const en = row.name_en.trim();
      const primary = externalPrimaryLang === "ko" ? ko : en;
      const nameForLegacy = primary || ko || en;
      const emailTrimmed = row.email.trim();
      if (!nameForLegacy || nameForLegacy.length < 2) return;
      if (
        row.savedSnapshot &&
        row.savedSnapshot.name_ko === ko &&
        row.savedSnapshot.name_en === en &&
        row.savedSnapshot.email === emailTrimmed
      ) {
        return;
      }
      setExternalRows((prev) =>
        prev.map((r) =>
          r.clientId === clientId
            ? { ...r, saveStatus: "saving", saveError: null }
            : r,
        ),
      );

      const { data: extData, error: extErr } = await createExternalArtistAndClaim({
        displayName: nameForLegacy,
        // QA 2026-07-28 (240005 SECTION 2/3): pass KO/EN natively; the RPC
        // now backfills external_artists.display_name_ko/en itself and the
        // signup trigger (240005 SECTION 5) inherits them into new profiles.
        // The previous post-RPC client UPDATE workaround is retired — clients
        // no longer need write access to external_artists.
        displayNameKo: ko || null,
        displayNameEn: en || null,
        inviteEmail: emailTrimmed || null,
        claimType: "CURATED",
        workId: null,
        projectId: id,
        visibility: "public",
        period_status: "current",
        // Acting-as: file the claim under the principal so the exhibition
        // shows the principal as curator/host source. RPC enforces the
        // delegation check.
        subjectProfileId: actingAsProfileId ?? undefined,
        // Phase 3-4 re-selection continues to work for external buckets.
        externalArtistId: row.externalArtistId ?? undefined,
      });
      if (extErr) {
        logSupabaseError("persistExternalRow.createExternalArtistAndClaim", extErr);
        setExternalRows((prev) =>
          prev.map((r) =>
            r.clientId === clientId
              ? {
                  ...r,
                  saveStatus: "error",
                  saveError: formatSupabaseError(extErr, t, "common.errorSave"),
                }
              : r,
          ),
        );
        return;
      }
      const returnedExtId = extData?.external_artist?.id as string | undefined;
      const returnedClaimId = extData?.claim?.id as string | undefined;

      // Detect "duplicate absorbed": if the returned claim id already
      // lives on a *different* row (typically a hydrated sibling), mark
      // this row as duplicate rather than saved. The UI hides the chip
      // when we merge into the sibling via a subsequent focus refresh.
      setExternalRows((prev) => {
        const siblingWithSameClaim = prev.find(
          (r) => r.clientId !== clientId && r.claimId === returnedClaimId,
        );
        return prev.map((r) => {
          if (r.clientId !== clientId) return r;
          const next: ExternalRow = {
            ...r,
            claimId: returnedClaimId ?? r.claimId,
            externalArtistId: returnedExtId ?? r.externalArtistId,
            saveStatus: siblingWithSameClaim ? "duplicate" : "saved",
            saveError: null,
            savedSnapshot: {
              name_ko: ko,
              name_en: en,
              email: emailTrimmed,
            },
          };
          return next;
        });
      });
    },
    [externalPrimaryLang, id, actingAsProfileId, t],
  );

  const scheduleExternalRowSave = useCallback(
    (clientId: string, delay = 500) => {
      const existing = saveTimersRef.current.get(clientId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        saveTimersRef.current.delete(clientId);
        void persistExternalRow(clientId);
      }, delay);
      saveTimersRef.current.set(clientId, timer);
    },
    [persistExternalRow],
  );

  const removeExternalRowLocally = useCallback((clientId: string) => {
    const existing = saveTimersRef.current.get(clientId);
    if (existing) clearTimeout(existing);
    saveTimersRef.current.delete(clientId);
    setExternalRows((prev) => {
      const filtered = prev.filter((r) => r.clientId !== clientId);
      if (filtered.length === 0) return [emptyExternalRow()];
      const last = filtered[filtered.length - 1];
      if (last.claimId != null || last.savedSnapshot != null) {
        filtered.push(emptyExternalRow());
      }
      return filtered;
    });
  }, []);

  const handleRemoveExternalRow = useCallback(
    async (clientId: string) => {
      const row = externalRowsRef.current.find((r) => r.clientId === clientId);
      if (!row) return;
      if (!row.claimId) {
        removeExternalRowLocally(clientId);
        return;
      }
      const outcome = await removeExhibitionParticipant(row.claimId, {
        deleteExternal: false,
      });
      if (outcome.ok) {
        removeExternalRowLocally(clientId);
        return;
      }
      if (outcome.kind === "works_present") {
        setExternalRows((prev) =>
          prev.map((r) =>
            r.clientId === clientId
              ? { ...r, removeBlockedCount: outcome.worksCount }
              : r,
          ),
        );
        setParticipantRemoveToast(
          t("exhibition.participants.removeBlocked").replace(
            "{n}",
            String(outcome.worksCount),
          ),
        );
        return;
      }
      logSupabaseError("removeExhibitionParticipant.external", outcome.error);
      setExternalRows((prev) =>
        prev.map((r) =>
          r.clientId === clientId
            ? {
                ...r,
                saveStatus: "error",
                saveError: formatSupabaseError(outcome.error, t, "common.errorSave"),
              }
            : r,
        ),
      );
    },
    [removeExternalRowLocally, t],
  );

  const handleAddProfileParticipant = useCallback(
    async (p: Participant) => {
      // Optimistic add: paint the chip immediately, then reconcile with
      // the server. Idempotent RPC + partial unique index guarantees the
      // second click on the same person doesn't double-write. We also
      // dedupe inside the functional updater so back-to-back clicks don't
      // race two identical chips into the list.
      const optimistic: Participant = {
        id: p.id,
        username: p.username,
        display_name: p.display_name,
        claimId: null,
      };
      let alreadyPresent = false;
      setParticipants((prev) => {
        if (prev.some((x) => x.id === p.id)) {
          alreadyPresent = true;
          return prev;
        }
        return [...prev, optimistic];
      });
      if (alreadyPresent) return;
      const { data, error: err } = await createClaimForExistingArtist({
        artistProfileId: p.id,
        claimType: "CURATED",
        workId: null,
        projectId: id,
        visibility: "public",
        period_status: "current",
        subjectProfileId: actingAsProfileId ?? undefined,
      });
      if (err) {
        logSupabaseError("handleAddProfileParticipant", err);
        setParticipants((prev) => prev.filter((x) => x.id !== p.id));
        setParticipantsError(formatSupabaseError(err, t, "common.errorSave"));
        return;
      }
      const claimId = (data?.claim?.id as string | undefined) ?? null;
      setParticipants((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, claimId } : x)),
      );
    },
    [id, actingAsProfileId, t],
  );

  const handleRemoveProfileParticipant = useCallback(
    async (participantId: string) => {
      let claimId: string | null = null;
      let found = false;
      setParticipants((prev) => {
        const t2 = prev.find((x) => x.id === participantId);
        if (t2) {
          found = true;
          claimId = t2.claimId;
        }
        return prev;
      });
      if (!found) return;
      if (!claimId) {
        // Never saved server-side (optimistic add still in flight or
        // failed). Just drop locally.
        setParticipants((prev) => prev.filter((x) => x.id !== participantId));
        return;
      }
      const outcome = await removeExhibitionParticipant(claimId, {
        deleteExternal: false,
      });
      if (outcome.ok) {
        setParticipants((prev) => prev.filter((x) => x.id !== participantId));
        return;
      }
      if (outcome.kind === "works_present") {
        setParticipantRemoveToast(
          t("exhibition.participants.removeBlocked").replace(
            "{n}",
            String(outcome.worksCount),
          ),
        );
        return;
      }
      logSupabaseError("removeExhibitionParticipant.profile", outcome.error);
      setParticipantsError(formatSupabaseError(outcome.error, t, "common.errorSave"));
    },
    [t],
  );

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
    getExhibitionById(id).then(({ data }) => {
      setExhibitionTitle(data?.title ?? null);
      setExhibitionStatus(data?.status ?? null);
    });
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
        const list: Participant[] = (data ?? []).map((p) => ({
          id: p.id,
          username: p.username,
          display_name: p.display_name,
          claimId: null,
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

        {/*
          QA 2026-07 Phase 2-3: draft banner + "just created" toast. The
          /add page is exactly where the owner lands after creating a new
          exhibition, so this is the most valuable spot for the "saved,
          not public yet" message.

          Wait until we have both status and works loaded to avoid
          flashing the amber banner on a fully-loaded live exhibition.
        */}
        {exhibitionStatus !== null && (
          <ExhibitionDraftBanner
            exhibitionId={id}
            status={exhibitionStatus}
            worksCount={doneIds.size}
            addWorkHref="#works"
            className="mb-4"
          />
        )}

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
        {landingToast && (
          <div role="status" className="mb-4 rounded bg-zinc-900 px-3 py-1.5 text-xs text-white">
            {landingToast}
          </div>
        )}

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
                              if (selected) {
                                void handleRemoveProfileParticipant(p.id);
                              } else {
                                void handleAddProfileParticipant({
                                  id: p.id,
                                  username: p.username,
                                  display_name: p.display_name,
                                  claimId: null,
                                });
                              }
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
                      onClick={() => void handleRemoveProfileParticipant(p.id)}
                      className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200"
                      title={
                        p.claimId == null
                          ? t("exhibition.participants.savingInline")
                          : t("exhibition.participants.removeCta")
                      }
                    >
                      <span>{formatDisplayName(p)}</span>
                      {p.claimId == null && (
                        <span className="text-[10px] text-zinc-400">
                          {t("exhibition.participants.savingInline")}
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-500">×</span>
                    </button>
                  ))}
                </div>
              )}
              {participantsError && (
                <p className="mt-2 text-xs text-red-600" role="status">
                  {participantsError}
                </p>
              )}
              {participantRemoveToast && (
                <p className="mt-2 text-xs text-amber-700" role="status">
                  {participantRemoveToast}
                </p>
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
                  <p className="text-[11px] text-zinc-400">
                    {t("exhibition.participants.autoSaved")}
                  </p>
                  {externalRows.map((row) => {
                    const primaryValue =
                      externalPrimaryLang === "ko" ? row.name_ko : row.name_en;
                    const otherValue =
                      externalPrimaryLang === "ko" ? row.name_en : row.name_ko;
                    const setField = (patch: Partial<ExternalRow>) =>
                      setExternalRows((prev) =>
                        prev.map((r) =>
                          r.clientId === row.clientId
                            ? { ...r, ...patch, saveStatus: r.saveStatus === "saved" ? "saved" : r.saveStatus }
                            : r,
                        ),
                      );
                    const setPrimary = (v: string) =>
                      setField(
                        externalPrimaryLang === "ko" ? { name_ko: v } : { name_en: v },
                      );
                    const setOther = (v: string) =>
                      setField(
                        externalPrimaryLang === "ko" ? { name_en: v } : { name_ko: v },
                      );
                    const isRemovable =
                      externalRows.length > 1 ||
                      !!row.claimId ||
                      row.name_ko.trim() ||
                      row.name_en.trim() ||
                      row.email.trim();
                    return (
                      <div
                        key={row.clientId}
                        className={`space-y-2 rounded border bg-white p-3 ${
                          row.saveStatus === "error"
                            ? "border-red-300"
                            : "border-zinc-200"
                        }`}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <div className="relative flex-1">
                            <input
                              type="text"
                              value={primaryValue}
                              onChange={(e) => setPrimary(e.target.value)}
                              onBlur={() => scheduleExternalRowSave(row.clientId, 0)}
                              placeholder={t("upload.externalArtistNamePlaceholder")}
                              className="w-full rounded border border-zinc-300 px-3 py-2 pr-14 text-sm"
                              lang={externalPrimaryLang}
                            />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              {externalPrimaryLang}
                            </span>
                          </div>
                          <input
                            type="email"
                            value={row.email}
                            onChange={(e) => setField({ email: e.target.value })}
                            onBlur={() => scheduleExternalRowSave(row.clientId, 0)}
                            placeholder={t("upload.externalArtistEmailPlaceholder")}
                            className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
                          />
                          {isRemovable && (
                            <button
                              type="button"
                              onClick={() => void handleRemoveExternalRow(row.clientId)}
                              className="text-xs text-zinc-500 hover:text-zinc-800"
                              title={t("exhibition.participants.removeCta")}
                            >
                              {t("common.remove")}
                            </button>
                          )}
                        </div>
                        {row.showOther ? (
                          <div className="relative">
                            <input
                              type="text"
                              value={otherValue}
                              onChange={(e) => setOther(e.target.value)}
                              onBlur={() => scheduleExternalRowSave(row.clientId, 0)}
                              placeholder={t(
                                externalPrimaryLang === "ko"
                                  ? "exhibition.titleOtherLangPlaceholderEn"
                                  : "exhibition.titleOtherLangPlaceholderKo"
                              )}
                              className="w-full rounded border border-zinc-300 px-3 py-2 pr-14 text-sm"
                              lang={externalPrimaryLang === "ko" ? "en" : "ko"}
                            />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              {externalPrimaryLang === "ko" ? "en" : "ko"}
                            </span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setField({ showOther: true })}
                            className="text-xs text-zinc-500 underline hover:text-zinc-800"
                          >
                            {t("exhibition.titleAddOtherLang")}
                          </button>
                        )}
                        {/* Inline save-status ribbon: silent when saved, chatty only when
                             we have something useful to say (saving / duplicate / error). */}
                        <div className="min-h-[16px] text-[11px]">
                          {row.saveStatus === "saving" && (
                            <span className="text-zinc-400">
                              {t("exhibition.participants.savingInline")}
                            </span>
                          )}
                          {row.saveStatus === "duplicate" && (
                            <span className="text-amber-700">
                              {t("exhibition.participants.duplicateAbsorbed")}
                            </span>
                          )}
                          {row.saveStatus === "error" && row.saveError && (
                            <span className="text-red-600">{row.saveError}</span>
                          )}
                          {row.saveStatus === "saved" && row.worksCount > 0 && (
                            <span className="text-zinc-400">
                              {t("exhibition.participants.savedInline")}
                            </span>
                          )}
                          {row.removeBlockedCount != null && (
                            <span className="ml-2 text-amber-700">
                              {t("exhibition.participants.removeBlocked").replace(
                                "{n}",
                                String(row.removeBlockedCount),
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() =>
                        setExternalRows((prev) => [...prev, emptyExternalRow()])
                      }
                      className="text-xs text-zinc-700 hover:text-zinc-900"
                    >
                      + {t("exhibition.addExternalRow")}
                    </button>
                    {participantsHydrated ? null : (
                      <p className="text-xs text-zinc-400">
                        {t("artists.loading")}
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
                  // QA 2026-07-28: 참여자 명단은 이미 blur 마다 서버로
                  // 저장됨. 여기서는 미저장 dirty 행만 flush 후 step 전환.
                  const pending = externalRowsRef.current.filter((r) => {
                    if (r.claimId != null) return false;
                    if (!r.name_ko.trim() && !r.name_en.trim()) return false;
                    return true;
                  });
                  if (pending.length > 0) {
                    saveTimersRef.current.forEach((tmr) => clearTimeout(tmr));
                    saveTimersRef.current.clear();
                    await Promise.all(pending.map((r) => persistExternalRow(r.clientId)));
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
              {(participants.length > 0 ||
                externalRows.some((r) => r.name_ko.trim() || r.name_en.trim())) ? (
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
                    .map((r) => {
                      // Phase 4: bucket label prefers the current locale;
                      // falls back to the other language so a KO-only row
                      // still displays a name in an EN session (and vice
                      // versa). URL params keep using the display name so
                      // downstream upload matching remains stable.
                      const primary =
                        externalPrimaryLang === "ko"
                          ? r.name_ko.trim()
                          : r.name_en.trim();
                      const fallback =
                        externalPrimaryLang === "ko"
                          ? r.name_en.trim()
                          : r.name_ko.trim();
                      return {
                        name: primary || fallback,
                        email: r.email.trim(),
                      };
                    })
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
          titleOverride={t("delegation.wizard.titleShareExhibition")}
        />
      )}
    </AuthGate>
  );
}
