"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BodyPortal } from "@/components/ui/BodyPortal";
import { layer } from "@/lib/ui/layers";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  appendArtworkDetailImages,
  attachArtworkImage,
  createDraftArtwork,
  deleteArtwork,
  deleteArtworkImage,
  deleteDraftArtworks,
  listMyDraftArtworks,
  mergeDraftImagesInto,
  publishArtworks,
  publishArtworksWithProvenance,
  updateArtwork,
  updateArtworkDimsIfMissing,
  updateArtworkImageViewType,
  validatePublish,
  type ArtworkImageViewType,
  type ArtworkWithLikes,
  type UpdateArtworkPayload,
} from "@/lib/supabase/artworks";
import { logBetaEvent } from "@/lib/beta/logEvent";
import { getSession } from "@/lib/supabase/auth";
import { removeStorageFile, uploadArtworkImage } from "@/lib/supabase/storage";
import { BulkEnhanceDialog } from "@/components/upload/BulkEnhanceDialog";
import { BulkGroupDialog, type GroupCard } from "@/components/upload/BulkGroupDialog";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { searchPeopleWithExternal, type SearchPeopleWithExternalResult } from "@/lib/supabase/artists";
import { externalArtistEmailExists } from "@/lib/provenance/externalArtists";
import { createExternalArtist } from "@/lib/provenance/rpc";
import { useActingAs } from "@/context/ActingAsContext";
import { ActingAsChip } from "@/components/ActingAsChip";
import { useT } from "@/lib/i18n/useT";
import { BilingualFieldPair } from "@/components/i18n/BilingualFieldPair";
import { RomanizationHintChip } from "@/components/i18n/RomanizationHintChip";
import {
  pickLegacyForSave,
  pickLocalizedDisplayName,
  pickLocalizedTitle,
} from "@/lib/i18n/pickLocalized";
import { sendArtistInviteEmailClient } from "@/lib/email/artistInvite";
import {
  addWorkToExhibition,
  listMyExhibitions,
  removeWorkFromExhibition,
  type ExhibitionWithCredits,
} from "@/lib/supabase/exhibitions";
import { getAndClearPendingExhibitionFiles } from "@/lib/pendingExhibitionUpload";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";
import { WebsiteImportPanel } from "@/components/upload/WebsiteImportPanel";
import { BulkUploadGuidance } from "@/components/upload/BulkUploadGuidance";
import { BulkDraftCard, UploadCloudMark } from "@/components/upload/BulkDraftCard";
import { TAXONOMY } from "@/lib/profile/taxonomy";
import { AttributionContextBanner } from "@/components/upload/AttributionContextBanner";
import { InviteResultCard } from "@/components/upload/InviteResultCard";
import { BetaFeedbackPrompt } from "@/components/beta";
import { formatBulkFileUploadFailure } from "@/lib/upload/formatUploadError";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { logSupabaseError } from "@/lib/supabase/errors";
import {
  BULK_MAX_FILES_PER_BATCH,
  BULK_MY_DRAFTS_QUERY_LIMIT,
  BULK_WEBSITE_STAGED_IDS_MAX,
  UPLOAD_MAX_COMPRESSIBLE_MB_LABEL,
  UPLOAD_MAX_IMAGE_MB_LABEL,
  getUploadCeilingBytes,
} from "@/lib/upload/limits";
import { isCompressibleMime } from "@/lib/image/compress";
import {
  buildCaptionPatch,
  isCaptionCsvFile,
  pairImagesWithHeldRows,
  parseArtworkCsv,
  planBulkCaptions,
  summarizeUnmatchedLabels,
  type ArtworkCsvRow,
} from "@/lib/csv/artworkCsv";
import {
  fileLooksLikeImage,
  summarizeBulkResult,
  type BulkFailure,
} from "@/lib/supabase/bulkUpload";

type IntentType = "CREATED" | "OWNS" | "INVENTORY" | "CURATED";

const INTENT_KEYS = [
  { value: "CREATED" as const, labelKey: "upload.claimCreated" },
  { value: "OWNS" as const, labelKey: "upload.claimOwned" },
  { value: "INVENTORY" as const, labelKey: "upload.claimInventory" },
  { value: "CURATED" as const, labelKey: "upload.claimCurated" },
] as const;

type ArtistOption = {
  id: string;
  username: string | null;
  display_name: string | null;
  display_name_ko?: string | null;
  display_name_en?: string | null;
};

const OWNERSHIP_OPTIONS = [
  { value: "available", labelKey: "upload.ownershipAvailable" },
  { value: "owned", labelKey: "upload.ownershipOwned" },
  { value: "sold", labelKey: "upload.ownershipSold" },
  { value: "not_for_sale", labelKey: "upload.ownershipNotForSale" },
] as const;

function deriveTitle(filename: string): string {
  const base = filename.includes(".") ? filename.slice(0, filename.lastIndexOf(".")) : filename;
  return base.replace(/[-_]/g, " ").trim() || "Untitled";
}

export default function BulkUploadPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const addToExhibitionId = searchParams.get("addToExhibition")?.trim() || null;
  const fromExhibition = searchParams.get("from") === "exhibition";
  const preselectedArtistId = searchParams.get("artistId");
  const preselectedArtistName = searchParams.get("artistName");
  const preselectedArtistUsername = searchParams.get("artistUsername");
  const preselectedExternalName = searchParams.get("externalName");
  const preselectedExternalEmail = searchParams.get("externalEmail");
  const preselectedExternalId = searchParams.get("externalId");
  const linkLaterFromExhibition = searchParams.get("linkLater") === "1";
  const externalEmailReady =
    !!preselectedExternalEmail &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(preselectedExternalEmail.trim());
  const exhibitionTitleParam = searchParams.get("exhibitionTitle");
  const preservedFromBoard = searchParams.get("fromBoard");

  const { t, locale } = useT();
  const { actingAsProfileId } = useActingAs();
  const [drafts, setDrafts] = useState<ArtworkWithLikes[]>([]);
  const [enhanceDraft, setEnhanceDraft] = useState<ArtworkWithLikes | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [dropOnId, setDropOnId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Session-only. Empty size stays required until the artist marks it not applicable. */
  const [sizeExempt, setSizeExempt] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadCurrent, setUploadCurrent] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Per-file failure log shown alongside the progress bar so a 100-image
  // batch where 3 files fail doesn't disappear into a single rolling toast.
  const [uploadFailures, setUploadFailures] = useState<{ name: string; message: string }[]>([]);
  const [uploadSucceeded, setUploadSucceeded] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  /** Local thumbs shown as cards while storage catches up. Not a filename queue. */
  const [placing, setPlacing] = useState<{ id: string; previewUrl: string }[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /**
   * Post-publish confirmation card for external-artist invites (QA 2026-07
   * Phase 2-2). Replaces the fleeting 3s toast so the operator has a
   * clear record of what happened and a direct action to /my/artists.
   * `null` = no card, `sent`/`failed` = show that variant.
   */
  const [inviteCard, setInviteCard] = useState<
    { kind: "sent" | "failed"; artistName: string } | null
  >(null);
  // Bumped after a *bulk* apply so the draft table rows remount and reflect
  // the newly saved values. Per-row onBlur edits deliberately do NOT bump
  // this (rows use uncontrolled defaultValue inputs) so typing keeps focus.
  const [bulkVersion, setBulkVersion] = useState(0);

  const [titleBulkMode, setTitleBulkMode] = useState<"none" | "set" | "prefix" | "suffix" | "replace">("set");
  const [titleBulkText, setTitleBulkText] = useState("");
  const [titleReplaceFrom, setTitleReplaceFrom] = useState("");
  const [titleReplaceTo, setTitleReplaceTo] = useState("");
  const [pendingBulk, setPendingBulk] = useState<null | { message: string; run: () => Promise<void> }>(null);
  const [bulkSize, setBulkSize] = useState("");
  // Default the batch size unit by locale (KO → cm, else in) so bulk-applied
  // sizes always carry an explicit unit instead of landing as "unit unknown".
  const [bulkSizeUnit, setBulkSizeUnit] = useState<"" | "cm" | "in">(
    locale.startsWith("ko") ? "cm" : "in"
  );
  const [bulkPriceAmount, setBulkPriceAmount] = useState("");
  const [bulkPriceCurrency, setBulkPriceCurrency] = useState("USD");
  const [bulkPricePublic, setBulkPricePublic] = useState(false);
  const [sharedOpen, setSharedOpen] = useState(false);
  const [sharedYear, setSharedYear] = useState("");
  const [sharedOwnership, setSharedOwnership] = useState("");
  const [sharedPricing, setSharedPricing] = useState<"" | "inquire" | "fixed">("");
  const [sharedMediums, setSharedMediums] = useState<string[]>([]);
  const [sharedMediumQuery, setSharedMediumQuery] = useState("");
  const [sharedH, setSharedH] = useState("");
  const [sharedW, setSharedW] = useState("");
  const [sharedD, setSharedD] = useState("");
  const [sharedSizeNa, setSharedSizeNa] = useState(false);
  const [cardExhibition, setCardExhibition] = useState<Record<string, string>>({});
  const [myExhibitions, setMyExhibitions] = useState<ExhibitionWithCredits[]>([]);
  const [linkExhibitionId, setLinkExhibitionId] = useState("");
  const [linkingExhibition, setLinkingExhibition] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  type BatchSlot = { pendingId: string; originalName: string; draftId: string | null };
  const batchSlotsRef = useRef<BatchSlot[]>([]);
  const pendingFilesRef = useRef<{ id: string; file: File }[]>([]);
  const startUploadRef = useRef<
    (opts?: { attachToDraftId?: Record<string, string> }) => Promise<
      { pendingId: string; draftId: string; name: string }[]
    >
  >(async () => []);
  const csvTextRef = useRef("");
  const heldRowsRef = useRef<{ draftId: string; rowIndex: number }[] | null>(null);
  const captionLockRef = useRef(false);
  const captionRerunRef = useRef(false);
  const captionScheduledRef = useRef(false);
  const applyDepthRef = useRef(0);
  const uploadingRef = useRef(false);
  const draftsRef = useRef(drafts);
  const scheduleCaptionRef = useRef<() => void>(() => {});
  const [stagedArtworkIds, setStagedArtworkIds] = useState<string[]>([]);

  // Persona / intent — from exhibition add: pre-fill CURATED + artist, skip intent/attribution steps
  const [intent, setIntent] = useState<IntentType | null>(
    fromExhibition && addToExhibitionId ? "CURATED" : "CREATED"
  );
  const [artistSearch, setArtistSearch] = useState("");
  // Unified search results (profiles + external), replacing the old
  // `ArtistOption[]` state. External rows carry works_count +
  // latest_cover_paths for the re-selection UX (Phase 3-3).
  const [artistResults, setArtistResults] = useState<SearchPeopleWithExternalResult[]>([]);
  const [selectedArtist, setSelectedArtist] = useState<ArtistOption | null>(
    fromExhibition && preselectedArtistId
      ? {
          id: preselectedArtistId,
          username: preselectedArtistUsername ?? null,
          display_name: preselectedArtistName ?? null,
        }
      : null
  );
  const [searching, setSearching] = useState(false);
  const [useExternalArtist, setUseExternalArtist] = useState(!!(fromExhibition && preselectedExternalName));
  const [externalArtistName, setExternalArtistName] = useState(preselectedExternalName ?? "");
  /**
   * QA 2026-07-28 — external_artists KO/EN 슬롯 (240005 SECTION 2/3).
   * URL query 는 legacy `externalName` 하나만 전달하므로 hangul 여부로
   * primary 슬롯을 seed. 두 언어 슬롯은 저장 시 함께 RPC 로 전달.
   */
  const preselectedExternalIsHangul = /[가-힯]/.test(preselectedExternalName ?? "");
  const [externalArtistNameKo, setExternalArtistNameKo] = useState(
    preselectedExternalIsHangul ? preselectedExternalName ?? "" : "",
  );
  const [externalArtistNameEn, setExternalArtistNameEn] = useState(
    preselectedExternalIsHangul ? "" : preselectedExternalName ?? "",
  );
  const [externalArtistEmail, setExternalArtistEmail] = useState(preselectedExternalEmail ?? "");
  // QA 2026-07-29 (Part A.5) — mirrors src/app/upload/page.tsx.
  const [notifyOnInquiryViaEmail, setNotifyOnInquiryViaEmail] = useState(false);
  /**
   * Phase 3 (QA 2026-07): id of the invited external artist that the
   * operator just re-selected from the unified search results. Non-null
   * means the publish flow should hand this id to the RPC directly
   * instead of dedupe-by-name. Cleared whenever the operator manually
   * edits `externalArtistName` (drift → we can no longer trust the id).
   */
  const [preselectedExternalArtistId, setPreselectedExternalArtistId] = useState<string | null>(
    preselectedExternalId,
  );
  /**
   * QA 2026-07-28 Phase B: PII-safe existence probe. Fires whenever the
   * operator has typed a valid email in the invite path AND has not just
   * re-selected an existing external artist (Phase 3). See src/lib/
   * provenance/externalArtists.ts `externalArtistEmailExists`.
   */
  const [pendingInviteForEmail, setPendingInviteForEmail] = useState(false);
  /** Snapshot of external re-selection metadata for the UI banner. */
  const [reselectedExternalMeta, setReselectedExternalMeta] = useState<
    { worksCount: number; latestCovers: string[] } | null
  >(null);
  // Soft-required email (2026-07-01) — opt out to link manually later via /my/artists.
  const [externalNoEmail, setExternalNoEmail] = useState(linkLaterFromExhibition);
  const [periodStatus, setPeriodStatus] = useState<"past" | "current" | "future">("current");
  /** Attribution 단계를 '다음' 버튼으로 완료했을 때만 true. 전시에서 진입 시 작가/외부 이미 선택됨 → 바로 업로드 단계. */
  const [attributionStepDone, setAttributionStepDone] = useState(
    !!(
      fromExhibition &&
      addToExhibitionId &&
      (preselectedArtistId ||
        (preselectedExternalName && (externalEmailReady || linkLaterFromExhibition)))
    ),
  );
  /**
   * Attribution stays inside the workspace. It opens for exhibition
   * hand-off that still needs an artist, or when the operator asks to
   * upload for someone else. It is not the first screen.
   */
  const [attributionOpen, setAttributionOpen] = useState(
    Boolean(
      fromExhibition &&
        addToExhibitionId &&
        !(
          preselectedArtistId ||
          (preselectedExternalName && (externalEmailReady || linkLaterFromExhibition))
        ),
    ),
  );

  const needsAttribution = intent !== null && intent !== "CREATED";

  const doSearchArtists = useCallback(async () => {
    const q = artistSearch.trim();
    if (!q || q.length < 2) {
      setArtistResults([]);
      return;
    }
    setSearching(true);
    // Phase 3-3: unified search — surface both onboarded artists and the
    // operator's own invited external artists. External rows come with
    // works_count + latest_cover_paths so the UI can render a
    // "이미 초대한 작가 · 작품 N점" hint mini-strip and let the operator
    // pick up where they left off instead of retyping.
    const { data } = await searchPeopleWithExternal({
      q,
      roles: ["artist"],
      limit: 10,
      includeExternal: true,
      inviterId: actingAsProfileId ?? null,
    });
    setArtistResults(data ?? []);
    setSearching(false);
  }, [artistSearch, actingAsProfileId]);

  useEffect(() => {
    const t = setTimeout(doSearchArtists, 300);
    return () => clearTimeout(t);
  }, [artistSearch, doSearchArtists]);

  const enqueuePendingImageFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;
      // QA 2026-08-12 (Windows) — Windows 탐색기에서 드래그된 파일은
      // `File.type` 이 종종 빈 문자열이다.  확장자가 이미지면 통과
      // 시켜야 사용자가 "파일이 사라지는" 회귀를 겪지 않는다.  실제
      // MIME 검증은 downstream (`compressArtworkImage` / storage) 이
      // 다시 한 번 수행하므로 안전.
      const arr = incoming.filter(fileLooksLikeImage);
      if (arr.length === 0) {
        setUploadError(t("bulk.pickImageTypes"));
        return;
      }
      // 2026-07-28 auto-compression: compressible formats ceiling raised
      // to 200 MB; uncompressible (HEIC/animated GIF) stay at 50 MB.
      // Split the skipped-message so users know whether the fix is
      // "even bigger files are welcome via auto-compress" (only if their
      // file was really over 200 MB) vs "convert HEIC/GIF to JPEG/PNG".
      const skippedFiles = arr.filter((f) => f.size > getUploadCeilingBytes(f));
      const ok = arr.filter((f) => f.size <= getUploadCeilingBytes(f));
      if (skippedFiles.length > 0) {
        const anyUnsupported = skippedFiles.some(
          (f) => !isCompressibleMime(f.type),
        );
        const key = anyUnsupported
          ? "bulk.filesSkippedUnsupported"
          : "bulk.filesSkippedCompressible";
        setUploadError(
          t(key)
            .replace("{n}", String(skippedFiles.length))
            .replace("{maxMb}", String(UPLOAD_MAX_COMPRESSIBLE_MB_LABEL)),
        );
      } else {
        setUploadError(null);
      }
      if (ok.length === 0) return;

      const prev = pendingFilesRef.current;
      const remaining = BULK_MAX_FILES_PER_BATCH - prev.length;
      if (remaining <= 0) {
        setToast(t("bulk.pendingQueueFull"));
        setTimeout(() => setToast(null), 4000);
        return;
      }
      const take = ok.slice(0, remaining);
      if (ok.length > remaining) {
        setToast(
          t("bulk.batchCapPartialAdd")
            .replace("{added}", String(take.length))
            .replace("{max}", String(BULK_MAX_FILES_PER_BATCH)),
        );
        setTimeout(() => setToast(null), 5000);
      }
      const added = take.map((file) => ({ id: crypto.randomUUID(), file }));
      const next = [...prev, ...added];
      pendingFilesRef.current = next;
      for (const item of added) {
        batchSlotsRef.current.push({
          pendingId: item.id,
          originalName: item.file.name,
          draftId: null,
        });
      }
      setPlacing((cards) => [
        ...cards,
        ...added.map((item) => ({
          id: item.id,
          previewUrl: URL.createObjectURL(item.file),
        })),
      ]);
      // Photos become draft cards immediately. A caption CSV already
      // on the page attaches as those cards are created.
      if (csvTextRef.current.trim()) scheduleCaptionRef.current();
      else void startUploadRef.current();
    },
    [t],
  );

  // QA 2026-06-26 (#7) — `silent` keeps the table mounted while we
  // refetch after per-row edits / bulk apply / website import. The old
  // behaviour toggled `loading` on every save → the `<table>` was
  // replaced by `<p>Loading…</p>` for one frame → page height collapsed,
  // uncontrolled inputs lost focus, and the scroll position jumped to
  // the top mid-typing. We still show the skeleton for the *first*
  // load and for user-initiated destructive flows (delete/publish).
  const fetchDrafts = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true;
      if (!silent) setLoading(true);
      const { data } = await listMyDraftArtworks({
        limit: BULK_MY_DRAFTS_QUERY_LIMIT,
        forProfileId: actingAsProfileId ?? undefined,
      });
      setDrafts(data ?? []);
      if (!silent) setLoading(false);
    },
    [actingAsProfileId],
  );

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  /**
   * QA 2026-07-28 Phase B: PII-safe email-existence probe. Debounced
   * on the invite email input. Skips when the operator has already
   * selected an existing external artist (Phase 3), since that case is
   * already conclusive.
   */
  useEffect(() => {
    if (!useExternalArtist || externalNoEmail || preselectedExternalArtistId) {
      setPendingInviteForEmail(false);
      return;
    }
    const raw = externalArtistEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
      setPendingInviteForEmail(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data } = await externalArtistEmailExists(raw);
      if (!cancelled) setPendingInviteForEmail(!!data);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [useExternalArtist, externalNoEmail, externalArtistEmail, preselectedExternalArtistId]);

  // When coming from exhibition add with dropped files, pre-fill pending files
  useEffect(() => {
    if (!fromExhibition || !addToExhibitionId) return;
    const pending = getAndClearPendingExhibitionFiles({
      exhibitionId: addToExhibitionId,
      artistId: preselectedArtistId ?? null,
      externalName: preselectedExternalName ?? null,
    });
    if (pending?.files.length) {
      enqueuePendingImageFiles(pending.files);
    }
  }, [fromExhibition, addToExhibitionId, preselectedArtistId, preselectedExternalName, enqueuePendingImageFiles]);

  function addIncomingFiles(files: FileList | File[] | null) {
    if (!files) return;
    const all = Array.from(files);
    if (all.length === 0) return;
    const csvs = all.filter((file) => isCaptionCsvFile(file));
    const images = all.filter((file) => !isCaptionCsvFile(file) && fileLooksLikeImage(file));
    if (images.length) enqueuePendingImageFiles(images);
    if (csvs.length) ingestCaptionFile(csvs[csvs.length - 1]!);
    if (images.length === 0 && csvs.length === 0) {
      setUploadError(t("bulk.pickImageTypes"));
    }
  }

  function ingestCaptionFile(file: File) {
    void file.text().then((text) => {
      const prevHeld = heldRowsRef.current;
      heldRowsRef.current = null;
      if (prevHeld?.length) {
        void deleteDraftArtworks(prevHeld.map((row) => row.draftId));
      }
      csvTextRef.current = text;
      scheduleCaptionRef.current();
    });
  }

  function addPendingFiles(files: FileList | null) {
    addIncomingFiles(files);
  }

  async function startUpload(opts?: {
    attachToDraftId?: Record<string, string>;
  }): Promise<{ pendingId: string; draftId: string; name: string }[]> {
    const queue = [...pendingFilesRef.current];
    if (queue.length === 0 || uploadingRef.current) return [];
    uploadingRef.current = true;
    pendingFilesRef.current = [];
    const { data: { session } } = await getSession();
    if (!session?.user?.id) {
      pendingFilesRef.current = [...queue, ...pendingFilesRef.current];
      uploadingRef.current = false;
      setUploadError(t("bulk.uploadNotAuthenticated"));
      return [];
    }
    const userId = session.user.id;
    setUploadError(null);
    setUploading(true);
    setUploadTotal(queue.length);
    setUploadCurrent(0);
    setUploadSucceeded(0);
    setUploadFailures([]);
    const uploadedIds: string[] = [];
    const failures: { name: string; message: string }[] = [];
    const results: ({ pendingId: string; draftId: string; name: string } | null)[] = new Array(queue.length).fill(null);

    // Bounded concurrency: 4 simultaneous uploads is a measured sweet spot
    // for our supabase storage tier — fast enough that 100 files takes
    // <1m, slow enough that the function stays well under any per-host
    // rate limits and we don't spike the user's network.
    const UPLOAD_CONCURRENCY = 4;
    let nextIdx = 0;
    let completed = 0;

    const runOne = async (idx: number) => {
      const slot = queue[idx];
      if (!slot) return;
      const { id: slotId, file } = slot;
      const title = deriveTitle(file.name);
      let artworkId: string | null = null;
      let createdHere = false;
      let uploadResult: Awaited<ReturnType<typeof uploadArtworkImage>> | null = null;
      // QA 2026-08-12 — payload sanity: file 이 실제로 존재하고 크기가
      // 있어야 upload 시도.  Windows 드래그-드롭에서 사용자가 폴더를
      // 통째로 놓으면 File.size === 0 인 유령 슬롯이 생길 수 있다.
      if (!file || typeof file.size !== "number" || file.size <= 0) {
        // eslint-disable-next-line no-console
        console.error("[bulk-upload] skipping empty payload", slotId, file?.name);
        const message = t("bulk.uploadFailedFileGeneric").replace("{name}", file?.name || t("bulk.uploadFailedUnnamedFile"));
        failures.push({ name: file?.name || "", message });
        setUploadFailures([...failures]);
        setUploadError(message);
        completed += 1;
        setUploadCurrent(completed);
        return;
      }
      try {
        const presetDraftId = opts?.attachToDraftId?.[slotId] ?? null;
        if (presetDraftId) {
          artworkId = presetDraftId;
        } else {
          const { data: id, error: createErr } = await createDraftArtwork(
            { title },
            { forProfileId: actingAsProfileId ?? undefined }
          );
          if (createErr || !id) {
            throw createErr instanceof Error ? createErr : new Error("Failed to create draft");
          }
          createdHere = true;
          artworkId = id;
        }
        // Route bulk uploads into the principal's storage folder when
        // acting-as, so lifecycle (delete/replace/cleanup) is rooted on
        // the principal even after the delegate is revoked. RLS allows
        // active account-scope writer delegates to upload here (see
        // 20260510000000_artworks_storage_account_delegate.sql).
        const storageOwner = actingAsProfileId ?? userId;
        // 2026-07-28 auto-compression — returns { displayPath, originalPath,
        // meta, bytes... }. Original is backed up under `{userId}/original/`.
        // 2026-08-05 Theo Image Enhance (Beta) — if the operator approved
        // an enhancement preview for this file, upload the enhanced
        // display copy (local pipeline) OR reuse the server-produced
        // enhanced path (photoroom hybrid) instead of running the default
        // compressor.
        uploadResult = await uploadArtworkImage(file, storageOwner);
        // DisplayAdjust stays null. Correction happens later, on the card.
        const displayAdjust: import("@/lib/image/displayAdjust").DisplayAdjust | null = null;
        const { error: attachErr } = await attachArtworkImage(
          artworkId,
          uploadResult.displayPath,
          {
            displayAdjust,
            originalStoragePath: uploadResult.originalPath,
            displayBytes: uploadResult.displayBytes,
            originalBytes: uploadResult.originalBytes,
            compressionMeta: uploadResult.compressionMeta,
          },
        );
        if (attachErr) throw attachErr;
        uploadedIds.push(artworkId);
        const batchSlot = batchSlotsRef.current.find((s) => s.pendingId === slotId);
        if (batchSlot) batchSlot.draftId = artworkId;
        results[idx] = { pendingId: slotId, draftId: artworkId, name: file.name };
        setUploadSucceeded((n) => n + 1);
      } catch (err) {
        const message = formatBulkFileUploadFailure(file.name, err, t);
        // Surface the latest failure prominently AND keep a per-file log
        // so the user can fix and retry exactly the failed entries.
        //
        // QA 2026-08-12 (Windows) — loud console.error 로 어떤 stage
        // 에서 튀었는지 F12 콘솔에서 즉시 파악 가능하도록.  각 stage
        // 는 uploadResult / artworkId 존재 여부로 유추한다:
        //   * artworkId === null  → createDraftArtwork 실패
        //   * uploadResult === null (artworkId 있음) → uploadArtworkImage 실패
        //   * 둘 다 있음  → attachArtworkImage 실패
        const stage = artworkId == null
          ? "createDraftArtwork"
          : uploadResult == null
            ? "uploadArtworkImage"
            : "attachArtworkImage";
        // eslint-disable-next-line no-console
        console.error("[bulk-upload] item failed", { slotId, name: file.name, stage, err });
        setUploadError(message);
        failures.push({ name: file.name, message });
        setUploadFailures([...failures]);
        if (uploadResult?.displayPath) {
          try { await removeStorageFile(uploadResult.displayPath); } catch {}
        }
        if (uploadResult?.originalPath) {
          try { await removeStorageFile(uploadResult.originalPath); } catch {}
        }
        if (artworkId && createdHere) {
          try { await deleteArtwork(artworkId); } catch {}
        }
      } finally {
        completed += 1;
        setUploadCurrent(completed);
      }
    };

    const worker = async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= queue.length) return;
        await runOne(idx);
      }
    };
    const workerCount = Math.min(UPLOAD_CONCURRENCY, queue.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const attempted = new Set(queue.map((item) => item.id));
    batchSlotsRef.current = batchSlotsRef.current.filter(
      (slot) => slot.draftId || !attempted.has(slot.pendingId),
    );

    uploadingRef.current = false;
    setUploading(false);
    if (uploadedIds.length > 0) {
      setStagedArtworkIds((prev) => [...uploadedIds, ...prev].slice(0, BULK_WEBSITE_STAGED_IDS_MAX));
    }
    // QA 2026-08-12 — all-failed 케이스 명시적 안내.  부분 실패는
    // 기존 "N개 중 K개 · X개 실패" 인디케이터를 유지하되, 아무 것도
    // 업로드되지 않았을 때는 사용자가 다음 액션을 알 수 있도록 재시도
    // 힌트를 담은 toast 를 띄운다.  summarizeBulkResult 는 향후 부분
    // 실패 카피를 이 UI 로 통합할 때 재사용되도록 순수 함수로 뽑아 둠.
    if (uploadedIds.length === 0 && failures.length > 0) {
      const bulkFailures: BulkFailure[] = failures.map((f, i) => ({
        itemId: String(i),
        error: f.message,
      }));
      const message = summarizeBulkResult(
        { succeeded: 0, failed: bulkFailures },
        {
          succeededOnly: t("bulk.uploadDone").replace("{total}", "{succeeded}"),
          failedOnly: t("bulk.uploadAllFailed"),
          partial: t("bulk.uploadDoneWithFailures")
            .replace("{ok}", "{succeeded}")
            .replace("{total}", "{total}"),
        },
      );
      setToast(message);
      setTimeout(() => setToast(null), 6000);
    }
    await fetchDrafts();
    const done = new Set(queue.map((item) => item.id));
    setPlacing((prev) => {
      const keep: { id: string; previewUrl: string }[] = [];
      for (const card of prev) {
        if (!done.has(card.id)) {
          keep.push(card);
          continue;
        }
        try {
          URL.revokeObjectURL(card.previewUrl);
        } catch {}
      }
      return keep;
    });
    if (applyDepthRef.current === 0 && csvTextRef.current.trim()) {
      scheduleCaptionRef.current();
    } else if (pendingFilesRef.current.length > 0) {
      void startUpload();
    }
    return results.filter((row): row is { pendingId: string; draftId: string; name: string } => !!row);
  }

  startUploadRef.current = startUpload;

  function orderedImages(d: ArtworkWithLikes) {
    return [...(d.artwork_images ?? [])]
      .filter((img) => {
        const view = img.view_type ?? "";
        return view !== "cutout" && view !== "cutout_alpha";
      })
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  async function addDetailsToDraft(artworkId: string, list: FileList | File[] | null) {
    const files = Array.from(list ?? []).filter(fileLooksLikeImage);
    if (files.length === 0) return;
    const { data: { session } } = await getSession();
    const ownerId = actingAsProfileId ?? session?.user?.id ?? null;
    if (!ownerId) return;
    setGroupBusy(true);
    let error: unknown = null;
    let added = 0;
    try {
      const result = await appendArtworkDetailImages({ artworkId, ownerId, files });
      error = result.error;
      added = result.added;
    } catch (err) {
      error = err;
    }
    setGroupBusy(false);
    if (error || added === 0) {
      setToast(t("bulk.group.addFailed"));
    } else {
      setToast(t("bulk.group.added").replace("{n}", String(added)));
    }
    setTimeout(() => setToast(null), 3200);
    void fetchDrafts({ silent: true });
  }

  async function setDetailView(artworkId: string, storagePath: string, viewType: ArtworkImageViewType) {
    const { error } = await updateArtworkImageViewType(artworkId, storagePath, viewType);
    if (error) {
      setToast(t("bulk.group.addFailed"));
      setTimeout(() => setToast(null), 2000);
      return;
    }
    void fetchDrafts({ silent: true });
  }

  async function removeDetailImage(artworkId: string, storagePath: string) {
    const { error } = await deleteArtworkImage(artworkId, storagePath);
    if (error) {
      setToast(t("bulk.group.addFailed"));
      setTimeout(() => setToast(null), 2000);
      return;
    }
    try { await removeStorageFile(storagePath); } catch { /* row is already gone */ }
    void fetchDrafts({ silent: true });
  }

  function draftReady(d: ArtworkWithLikes) {
    return validatePublish(d, { sizeNotApplicable: sizeExempt[d.id] === true });
  }

  function publishAllReady() {
    const ready = drafts.filter((d) => draftReady(d).ok).map((d) => d.id);
    if (ready.length === 0) {
      setToast(t("bulk.publishAllNone"));
      setTimeout(() => setToast(null), 2000);
      return;
    }
    void handlePublish(ready);
  }

  async function confirmGroups(groups: string[][]) {
    setGroupBusy(true);
    for (const ids of groups) {
      const [target, ...sources] = ids;
      if (!target || sources.length === 0) continue;
      const { error } = await mergeDraftImagesInto(target, sources);
      if (error) {
        setGroupBusy(false);
        setToast(t("bulk.group.addFailed"));
        setTimeout(() => setToast(null), 3200);
        void fetchDrafts({ silent: true });
        return;
      }
    }
    setGroupBusy(false);
    setGroupOpen(false);
    setSelected(new Set());
    setToast(t("bulk.group.saved"));
    setTimeout(() => setToast(null), 3200);
    void fetchDrafts({ silent: true });
  }

  async function handleDeleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeleting(true);
    await deleteDraftArtworks(ids);
    setDeleting(false);
    setSelected(new Set());
    await fetchDrafts();
    setToast(t("bulk.deleted"));
    setTimeout(() => setToast(null), 2000);
  }

  async function handleDeleteAll() {
    const ids = drafts.map((d) => d.id);
    if (ids.length === 0) return;
    setDeleting(true);
    await deleteDraftArtworks(ids);
    setDeleting(false);
    setSelected(new Set());
    await fetchDrafts();
    setToast(t("bulk.deleted"));
    setTimeout(() => setToast(null), 2000);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === drafts.length) setSelected(new Set());
    else setSelected(new Set(drafts.map((d) => d.id)));
  }

  async function applyToDrafts(ids: string[], partial: UpdateArtworkPayload) {
    for (const id of ids) {
      await updateArtwork(id, partial, {
        actingSubjectProfileId: actingAsProfileId ?? null,
        auditAction: "bulk.artwork.update",
      });
    }
    // QA 2026-06-26 (#7) — silent so the table doesn't flash through a
    // loading state while the user is still in the bulk-apply panel.
    await fetchDrafts({ silent: true });
    // QA 2026-07-01 — remount rows so bulk-applied values (e.g. size) show
    // in the draft confirmation table before publishing.
    setBulkVersion((v) => v + 1);
  }

  async function handleApply(field: string, value: unknown) {
    const ids = selected.size > 0 ? Array.from(selected) : drafts.map((d) => d.id);
    if (ids.length === 0) return;
    const payload: UpdateArtworkPayload = {};
    if (field === "year") payload.year = typeof value === "number" ? value : parseInt(String(value), 10) || null;
    else if (field === "medium") {
      payload.medium = String(value ?? "");
      if (locale === "ko") payload.medium_ko = String(value ?? "") || null;
      else payload.medium_en = String(value ?? "") || null;
    }
    else if (field === "ownership_status") payload.ownership_status = String(value ?? "");
    else if (field === "pricing_mode") payload.pricing_mode = value as "fixed" | "inquire";
    else if (field === "is_price_public") payload.is_price_public = Boolean(value);
    await applyToDrafts(ids, payload);
  }

  function targetDraftIds(): string[] {
    const ids = selected.size > 0 ? Array.from(selected) : drafts.map((d) => d.id);
    return ids;
  }

  function openBulkConfirm(message: string, run: () => Promise<void>) {
    setPendingBulk({ message, run });
  }

  async function runTitleBulk() {
    const ids = targetDraftIds();
    if (ids.length === 0 || titleBulkMode === "none") return;
    for (const id of ids) {
      const d = drafts.find((x) => x.id === id);
      const next = transformTitle(d?.title ?? null, titleBulkMode, titleBulkText, titleReplaceFrom, titleReplaceTo);
      const titlePatch: UpdateArtworkPayload = {
        title: next || d?.title || "Untitled",
      };
      if (locale === "ko") titlePatch.title_ko = next || d?.title || "Untitled";
      else titlePatch.title_en = next || d?.title || "Untitled";
      await updateArtwork(
        id,
        titlePatch,
        {
          actingSubjectProfileId: actingAsProfileId ?? null,
          auditAction: "bulk.artwork.update",
        }
      );
    }
    // QA 2026-06-26 (#7) — silent so the open bulk-apply panel does not
    // unmount the row inputs the user just edited.
    await fetchDrafts({ silent: true });
    setBulkVersion((v) => v + 1);
    setPendingBulk(null);
    setToast(t("bulk.applyTitleBulk"));
    setTimeout(() => setToast(null), 2000);
  }

  async function applySizeBulk() {
    const ids = targetDraftIds();
    if (ids.length === 0) return;
    const partial: UpdateArtworkPayload = {
      size: bulkSize.trim() || null,
      size_unit: bulkSizeUnit === "" ? null : bulkSizeUnit,
    };
    await applyToDrafts(ids, partial);
    setPendingBulk(null);
  }

  async function applyPriceBulk() {
    const ids = targetDraftIds();
    if (ids.length === 0) return;
    const n = parseFloat(bulkPriceAmount);
    const partial: UpdateArtworkPayload = {
      pricing_mode: "fixed",
      price_input_amount: Number.isFinite(n) ? n : null,
      price_input_currency: bulkPriceCurrency.trim() || null,
      is_price_public: bulkPricePublic,
    };
    await applyToDrafts(ids, partial);
    setPendingBulk(null);
  }

  async function linkSelectedToExhibition() {
    const ids = targetDraftIds();
    if (!linkExhibitionId || ids.length === 0) return;
    setLinkingExhibition(true);
    try {
      for (const workId of ids) {
        await addWorkToExhibition(linkExhibitionId, workId, {
          actingSubjectProfileId: actingAsProfileId ?? null,
        });
      }
      void logBetaEvent("exhibition_artwork_added", { exhibition_id: linkExhibitionId, count: ids.length });
      setToast(t("bulk.exhibitionLinked"));
      setTimeout(() => setToast(null), 2000);
    } finally {
      setLinkingExhibition(false);
      setPendingBulk(null);
    }
  }

  async function unlinkSelectedFromExhibition() {
    const ids = targetDraftIds();
    if (!linkExhibitionId || ids.length === 0) return;
    setLinkingExhibition(true);
    try {
      for (const workId of ids) {
        await removeWorkFromExhibition(linkExhibitionId, workId);
      }
    } finally {
      setLinkingExhibition(false);
      setPendingBulk(null);
    }
  }

  async function writeCaption(id: string, row: ArtworkCsvRow): Promise<string[]> {
    const lang = locale.startsWith("ko") ? "ko" : "en";
    const { patch, dims, issues } = buildCaptionPatch(row, lang);
    if (Object.keys(patch).length > 0) {
      await updateArtwork(id, patch, {
        actingSubjectProfileId: actingAsProfileId ?? null,
        auditAction: "bulk.artwork.update",
      });
    }
    if (dims) await updateArtworkDimsIfMissing(id, dims);
    return issues;
  }

  function showCaptionToast(photoFilled: number, unmatched: string[], waiting: number) {
    const parts: string[] = [];
    if (photoFilled > 0) parts.push(t("bulk.csvFilled").replace("{n}", String(photoFilled)));
    else if (waiting > 0) parts.push(t("bulk.csvWaiting").replace("{n}", String(waiting)));
    const names = summarizeUnmatchedLabels(unmatched);
    if (names) parts.push(t("bulk.csvUnmatched").replace("{names}", names));
    if (parts.length === 0) return;
    setToast(parts.join(" "));
    setTimeout(() => setToast(null), 4500);
  }

  function clearCaptionText() {
    csvTextRef.current = "";
  }

  async function applyCaptionsNow() {
    if (captionLockRef.current) {
      captionRerunRef.current = true;
      return;
    }
    if (uploadingRef.current) return;
    const text = csvTextRef.current.trim();
    if (!text) return;
    const parsed = parseArtworkCsv(text);
    if (parsed.rows.length === 0) {
      clearCaptionText();
      setToast(t("bulk.csvRequiredTitle"));
      setTimeout(() => setToast(null), 3000);
      return;
    }

    const pendingSlots = batchSlotsRef.current.filter((slot) => !slot.draftId);
    const uploadedSlots = batchSlotsRef.current.filter((slot) => slot.draftId);
    const targetSlots = pendingSlots.length > 0 ? pendingSlots : uploadedSlots;

    if (
      !parsed.hasFilename &&
      targetSlots.length > 0 &&
      targetSlots.length !== parsed.rows.length
    ) {
      setToast(
        t("bulk.csvCount")
          .replace("{rows}", String(parsed.rows.length))
          .replace("{images}", String(targetSlots.length)),
      );
      setTimeout(() => setToast(null), 4500);
      return;
    }

    if (targetSlots.length === 0 && heldRowsRef.current?.length) return;

    captionLockRef.current = true;
    applyDepthRef.current += 1;
    setCsvBusy(true);
    try {
      const held = heldRowsRef.current;
      if (pendingSlots.length > 0 && held && held.length > 0) {
        const pairing = pairImagesWithHeldRows({
          rows: parsed.rows,
          hasFilename: parsed.hasFilename,
          images: pendingSlots.map((slot) => ({ key: slot.pendingId, originalName: slot.originalName })),
          held,
        });
        const attach: Record<string, string> = {};
        for (const row of pairing.attachments) attach[row.imageKey] = row.draftId;
        const uploaded = await startUpload({ attachToDraftId: attach });
        const uploadedIds = new Set(uploaded.map((row) => row.draftId));
        const attached = pairing.attachments.filter((row) => uploadedIds.has(row.draftId));
        const issues: string[] = [];
        for (const row of attached) {
          const source = parsed.rows[row.rowIndex];
          if (!source) continue;
          issues.push(...(await writeCaption(row.draftId, source)));
        }
        if (pairing.unmatched.length > 0) {
          await deleteDraftArtworks(pairing.unmatched.map((row) => row.draftId));
        }
        const failed = pairing.attachments.filter((row) => !uploadedIds.has(row.draftId));
        heldRowsRef.current = failed.length
          ? failed.map((row) => ({ draftId: row.draftId, rowIndex: row.rowIndex }))
          : null;
        showCaptionToast(
          attached.length,
          [...pairing.unmatched.map((row) => row.label), ...issues],
          0,
        );
        if (!heldRowsRef.current?.length) clearCaptionText();
        await fetchDrafts();
        setBulkVersion((v) => v + 1);
        return;
      }

      const targetIds = new Set(targetSlots.map((slot) => slot.pendingId));
      if (pendingSlots.length > 0) {
        await startUpload();
      }

      const images = batchSlotsRef.current
        .filter((slot) => targetIds.has(slot.pendingId) && slot.draftId)
        .map((slot) => ({
          key: slot.pendingId,
          originalName: slot.originalName,
          draftId: slot.draftId,
        }));

      const plan = planBulkCaptions({
        rows: parsed.rows,
        hasFilename: parsed.hasFilename,
        images,
        drafts: draftsRef.current.map((draft) => ({
          id: draft.id,
          title: draft.title,
          hasPhoto: (draft.artwork_images?.length ?? 0) > 0,
          storagePaths: (draft.artwork_images ?? []).map((img) => img.storage_path),
          originalName: batchSlotsRef.current.find((slot) => slot.draftId === draft.id)?.originalName ?? null,
        })),
      });

      const issues: string[] = [];
      let photoFilled = 0;
      for (const fill of plan.fills) {
        const row = parsed.rows[fill.rowIndex];
        if (!row || !fill.draftId) continue;
        issues.push(...(await writeCaption(fill.draftId, row)));
        const onBatch = batchSlotsRef.current.some((slot) => slot.draftId === fill.draftId);
        const draft = draftsRef.current.find((item) => item.id === fill.draftId);
        if (onBatch || (draft?.artwork_images?.length ?? 0) > 0) photoFilled += 1;
      }

      const createdHeld: { draftId: string; rowIndex: number }[] = [];
      if (images.length === 0) {
        for (const rowIndex of plan.photoLess) {
          const row = parsed.rows[rowIndex];
          if (!row) continue;
          const title = row.title && row.title !== "Untitled" ? row.title : row.filename || "Untitled";
          const { data: id, error } = await createDraftArtwork(
            { title },
            { forProfileId: actingAsProfileId ?? undefined },
          );
          if (error || !id) continue;
          issues.push(...(await writeCaption(id, row)));
          createdHeld.push({ draftId: id, rowIndex });
        }
      }
      heldRowsRef.current = createdHeld.length > 0 ? createdHeld : null;

      const unmatchedLabels = [...plan.unmatched.map((row) => row.label), ...issues];
      if (photoFilled === 0 && createdHeld.length > 0) showCaptionToast(0, unmatchedLabels, createdHeld.length);
      else showCaptionToast(photoFilled, unmatchedLabels, 0);
      if (!heldRowsRef.current?.length) clearCaptionText();
      await fetchDrafts();
      setBulkVersion((v) => v + 1);
    } finally {
      applyDepthRef.current = Math.max(0, applyDepthRef.current - 1);
      captionLockRef.current = false;
      setCsvBusy(false);
      if (captionRerunRef.current) {
        captionRerunRef.current = false;
        scheduleCaptionApply();
      }
    }
  }

  function scheduleCaptionApply() {
    if (captionScheduledRef.current) return;
    captionScheduledRef.current = true;
    queueMicrotask(() => {
      captionScheduledRef.current = false;
      void applyCaptionsNow();
    });
  }
  scheduleCaptionRef.current = scheduleCaptionApply;

  async function handlePublish(idsOverride?: string[]) {
    const ids = idsOverride ?? Array.from(selected);
    if (ids.length === 0) return;
    const toPublish = drafts.filter((d) => ids.includes(d.id));
    const invalid = toPublish.filter((d) => !draftReady(d).ok);
    if (invalid.length > 0) return;
    if (needsAttribution) {
      if (useExternalArtist) {
        const name = externalArtistName.trim();
        if (!name || name.length < 2) {
          setToast(t("upload.externalArtistNamePlaceholder") || "Artist name required (min 2 characters)");
          setTimeout(() => setToast(null), 2000);
          return;
        }
        const email = externalArtistEmail.trim();
        if (!externalNoEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          setToast(t("upload.externalArtistEmailRequired"));
          setTimeout(() => setToast(null), 3500);
          return;
        }
      } else if (!selectedArtist) {
        setToast(t("upload.linkArtist") || "Please select an artist");
        setTimeout(() => setToast(null), 2000);
        return;
      }
    }
    setPublishing(true);
    try {
      // Per-work successes that should be linked to the exhibition + counted
      // toward "today's salon" refresh. Failures stay as drafts so the user
      // can fix and retry exactly the failed entries.
      let publishedIds: string[] = [];
      let failedCount = 0;
      let firstFailureReason: string | null = null;

      if (intent && needsAttribution) {
        let resolvedExternalArtistId = useExternalArtist
          ? preselectedExternalArtistId
          : null;
        if (useExternalArtist && !resolvedExternalArtistId) {
          const { data: extId, error: extErr } = await createExternalArtist({
            displayName: externalArtistName.trim(),
            displayNameKo: externalArtistNameKo.trim() || null,
            displayNameEn: externalArtistNameEn.trim() || null,
            inviteEmail: externalArtistEmail.trim() || null,
          });
          if (extErr || !extId) {
            logSupabaseError("createExternalArtist.bulkOnce", extErr);
            setToast(formatSupabaseError(extErr, t, "artwork.errors.failedAddArtist"));
            setTimeout(() => setToast(null), 4000);
            return;
          }
          resolvedExternalArtistId = extId;
        }
        const opts: Parameters<typeof publishArtworksWithProvenance>[1] = {
          intent,
          artistProfileId: selectedArtist?.id ?? null,
          externalArtistDisplayName: useExternalArtist ? externalArtistName.trim() : null,
          // QA 2026-07-28 (240005) — forward KO/EN slots so the RPC persists
          // the bilingual pair on the external_artists row and the signup
          // trigger inherits them into the new profile.
          externalArtistDisplayNameKo: useExternalArtist
            ? externalArtistNameKo.trim() || null
            : null,
          externalArtistDisplayNameEn: useExternalArtist
            ? externalArtistNameEn.trim() || null
            : null,
          externalArtistEmail: useExternalArtist ? externalArtistEmail.trim() || null : null,
          // Resolve/create the external artist once per publish, then reuse
          // that id on every work so we never mint one row per artwork.
          externalArtistId: useExternalArtist ? resolvedExternalArtistId : null,
          // QA 2026-07-29 (Part A.5) — forward opt-in email consent.
          notifyOnInquiryViaEmail: useExternalArtist ? notifyOnInquiryViaEmail : undefined,
          // Drafts were created on behalf of the principal when acting-as;
          // publish path must keep the same subject so claims/artist_id stay
          // consistent. RLS / RPC verify delegation rights server-side.
          onBehalfOfProfileId: actingAsProfileId ?? null,
        };
        if (intent === "INVENTORY" || intent === "CURATED") {
          opts.period_status = periodStatus;
        }
        // QA 2026-06-26 (#8) — DO NOT forward addToExhibitionId as a
        // projectId to the claim RPC; the server rejects work_id +
        // project_id together. Exhibition linking happens below via
        // addWorkToExhibition, but only for SUCCEEDED ids.
        const { results, firstError, error } =
          await publishArtworksWithProvenance(ids, opts);
        if (error) {
          logSupabaseError("publishArtworksWithProvenance.setup", error);
          setToast(formatSupabaseError(error, t, "upload.publishFallback"));
          setTimeout(() => setToast(null), 4000);
          return;
        }
        publishedIds = results.filter((r) => r.ok).map((r) => r.id);
        failedCount = results.length - publishedIds.length;
        if (firstError !== undefined) {
          logSupabaseError("publishArtworksWithProvenance.work", firstError);
          firstFailureReason = formatSupabaseError(
            firstError,
            t,
            "upload.publishFallback"
          );
        }
      } else {
        const { error } = await publishArtworks(ids, {
          forProfileId: actingAsProfileId ?? null,
        });
        if (error) {
          logSupabaseError("publishArtworks", error);
          setToast(formatSupabaseError(error, t, "upload.publishFallback"));
          setTimeout(() => setToast(null), 4000);
          return;
        }
        publishedIds = [...ids];
      }

      // Link only successful works to the exhibition. Linking a draft
      // (a failed publish) would surface a half-published work on the
      // exhibition page, which is exactly the "잘못 저장된 것 같다"
      // confusion QA reported.
      if (addToExhibitionId && publishedIds.length > 0 && intent === "CURATED") {
        for (const workId of publishedIds) {
          await addWorkToExhibition(addToExhibitionId, workId, {
            actingSubjectProfileId: actingAsProfileId ?? null,
          });
        }
      }

      // Surface a precise outcome. Three cases:
      //   1) all failed → friendly error toast (cause-aware).
      //   2) partial    → "N of M published, X failed: <cause>"
      //   3) all good   → silent success (caller already navigates /
      //                   refetches drafts).
      if (publishedIds.length === 0 && failedCount > 0) {
        const reason = firstFailureReason ?? t("upload.publishFallback");
        setToast(
          t("upload.publishAllFailed").replace("{reason}", reason)
        );
        setTimeout(() => setToast(null), 5000);
        return;
      }
      if (failedCount > 0) {
        const reason = firstFailureReason ?? t("upload.publishFallback");
        setToast(
          t("upload.publishPartial")
            .replace("{ok}", String(publishedIds.length))
            .replace("{total}", String(publishedIds.length + failedCount))
            .replace("{failed}", String(failedCount))
            .replace("{reason}", reason)
        );
        setTimeout(() => setToast(null), 6000);
      }

      if (useExternalArtist && externalArtistEmail.trim() && publishedIds.length > 0) {
        const artistName =
          externalArtistName.trim() || t("upload.externalArtistNamePlaceholder");
        const invite = await sendArtistInviteEmailClient({
          toEmail: externalArtistEmail.trim(),
          artistName: externalArtistName.trim() || null,
          exhibitionTitle: exhibitionTitleParam,
        });
        setInviteCard({ kind: invite.ok ? "sent" : "failed", artistName });
      }

      // Navigate / refetch ONLY when at least one work landed publicly.
      if (publishedIds.length > 0) {
        void logBetaEvent("bulk_publish_completed", {
          count: publishedIds.length,
        });
        // Partial failure — keep the user here so they can fix & retry the
        // failed rows (a cause-aware toast is already showing above).
        if (failedCount > 0) {
          setSelected(new Set());
          await fetchDrafts({ silent: true });
          return;
        }
        // All published — mirror single-upload navigation instead of
        // stranding the user on the draft table / add page (QA 2026-07-01).
        //
        // QA 2026-07-28: exhibition-context bulk upload now returns to
        // the /add page (not the detail page) so the curator can keep
        // adding participants/works without hunting for the "관리" link.
        // A sessionStorage flag lets /add surface a quiet toast.
        if (addToExhibitionId) {
          if (typeof window !== "undefined") {
            try {
              window.sessionStorage.setItem(
                "exhibitionAddReturnToast",
                "bulk.doneReturnToExhibition",
              );
            } catch {
              // sessionStorage disabled (Safari private mode etc.) — silent.
            }
          }
          const qs = new URLSearchParams();
          if (preservedFromBoard) qs.set("fromBoard", preservedFromBoard);
          const suffix = qs.toString() ? `?${qs.toString()}` : "";
          router.push(`/my/exhibitions/${addToExhibitionId}/add${suffix}`);
          return;
        }
        const { getMyProfile, getProfileById } = await import("@/lib/supabase/profiles");
        const { data: profile } = actingAsProfileId
          ? await getProfileById(actingAsProfileId)
          : await getMyProfile();
        const username = (profile as { username?: string | null } | null)?.username?.trim();
        if (username) {
          router.push(`/u/${username}`);
          return;
        }
        setSelected(new Set());
        await fetchDrafts({ silent: true });
      }
    } finally {
      setPublishing(false);
    }
  }

  async function updateDraftField(id: string, field: string, value: unknown) {
    const payload: Record<string, unknown> = {};
    if (field === "title") {
      payload.title = String(value ?? "");
      if (locale === "ko") payload.title_ko = String(value ?? "") || null;
      else payload.title_en = String(value ?? "") || null;
    } else if (field === "year") payload.year = typeof value === "number" ? value : (parseInt(String(value), 10) || null);
    else if (field === "medium") {
      payload.medium = String(value ?? "");
      if (locale === "ko") payload.medium_ko = String(value ?? "") || null;
      else payload.medium_en = String(value ?? "") || null;
    }
    else if (field === "size") payload.size = String(value ?? "").trim() || null;
    else if (field === "size_unit") payload.size_unit = value ? (String(value) as "cm" | "in") : null;
    else if (field === "ownership_status") payload.ownership_status = String(value ?? "");
    else     if (field === "pricing_mode") payload.pricing_mode = value as "fixed" | "inquire" | null;
    await updateArtwork(id, payload as Parameters<typeof updateArtwork>[1], {
      actingSubjectProfileId: actingAsProfileId ?? null,
      auditAction: "bulk.artwork.update",
    });
    // QA 2026-06-26 (#7) — silent refetch so the row keeps its DOM and
    // the focused input does not lose focus / push the page to top.
    await fetchDrafts({ silent: true });
  }

  const readyCount = drafts.filter((d) => draftReady(d).ok).length;
  const selectedIds = Array.from(selected);
  const selectedReady = drafts.filter((d) => selectedIds.includes(d.id) && draftReady(d).ok).length;
  const canPublishSelected = selectedIds.length > 0 && selectedReady === selectedIds.length;

  const externalNameValid = useExternalArtist && externalArtistName.trim().length >= 2;
  const externalEmailValid =
    externalNoEmail || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(externalArtistEmail.trim());
  const attributionValid =
    !needsAttribution || selectedArtist !== null || (externalNameValid && externalEmailValid);
  const showAttribution = attributionOpen && needsAttribution && !attributionStepDone;
  const showMain = true;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#upload-drafts") return;
    document.getElementById("upload-drafts")?.scrollIntoView({ block: "start" });
  }, []);

  useEffect(() => {
    if (!showMain) return;
    // Acting-as: scope the exhibition picker to the principal so a
    // delegated bulk publish can target their existing exhibitions.
    void listMyExhibitions({ forProfileId: actingAsProfileId ?? null }).then(
      ({ data }) => setMyExhibitions(data ?? [])
    );
  }, [showMain, actingAsProfileId]);

  // Refuse to silently lose in-flight uploads on tab close / navigation.
  // Browsers ignore custom strings now (use the standard prompt), but
  // returning a value still triggers the confirm dialog.
  useEffect(() => {
    if (!uploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t("bulk.uploadBeforeUnload");
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading, t]);

  function transformTitle(
    title: string | null,
    mode: typeof titleBulkMode,
    seg: string,
    from: string,
    to: string
  ): string {
    const base = title ?? "";
    if (mode === "set") return seg.trim();
    if (mode === "prefix") return (seg + base).trim();
    if (mode === "suffix") return (base + seg).trim();
    if (mode === "replace" && from) return base.split(from).join(to);
    return base;
  }

  async function saveDraftPatch(id: string, partial: UpdateArtworkPayload) {
    await updateArtwork(id, partial, {
      actingSubjectProfileId: actingAsProfileId ?? null,
      auditAction: "bulk.artwork.update",
    });
    await fetchDrafts({ silent: true });
  }

  async function linkOneExhibition(workId: string, exhibitionId: string) {
    if (!exhibitionId) return;
    const prev = cardExhibition[workId];
    if (prev && prev !== exhibitionId) {
      await removeWorkFromExhibition(prev, workId);
    }
    const { error } = await addWorkToExhibition(exhibitionId, workId, {
      actingSubjectProfileId: actingAsProfileId ?? null,
    });
    if (error) {
      setToast(t("bulk.group.addFailed"));
    } else {
      setCardExhibition((m) => ({ ...m, [workId]: exhibitionId }));
      setToast(t("bulk.exhibitionLinked"));
    }
    setTimeout(() => setToast(null), 2000);
  }

  function addSharedMedium(raw: string) {
    const value = raw.trim();
    if (!value) return;
    setSharedMediums((prev) =>
      prev.some((m) => m.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value],
    );
    setSharedMediumQuery("");
  }

  async function applySharedWorkspace() {
    const ids = (selected.size > 0 ? drafts.filter((d) => selected.has(d.id)) : drafts).map((d) => d.id);
    if (ids.length === 0) {
      setToast(t("bulk.noDrafts"));
      setTimeout(() => setToast(null), 2000);
      return;
    }
    const partial: UpdateArtworkPayload = {};
    const year = parseInt(sharedYear, 10);
    if (sharedYear.trim() && !Number.isNaN(year)) partial.year = year;
    if (sharedMediums.length > 0) {
      const medium = sharedMediums.join(", ");
      partial.medium = medium;
      if (locale === "ko") partial.medium_ko = medium;
      else partial.medium_en = medium;
    }
    if (sharedOwnership) partial.ownership_status = sharedOwnership;
    if (sharedPricing === "inquire" || sharedPricing === "fixed") {
      partial.pricing_mode = sharedPricing;
    }
    if (sharedPricing === "fixed") {
      const n = parseFloat(bulkPriceAmount);
      partial.price_input_amount = Number.isFinite(n) ? n : null;
      partial.price_input_currency = bulkPriceCurrency.trim() || null;
      partial.is_price_public = bulkPricePublic;
    }
    if (sharedSizeNa) {
      partial.size = null;
      partial.size_unit = null;
    } else if (sharedW.trim() || sharedH.trim() || sharedD.trim()) {
      const parts = [sharedW, sharedH, sharedD].map((s) => s.trim()).filter(Boolean);
      partial.size = parts.join(" × ");
      partial.size_unit = bulkSizeUnit === "" ? "cm" : bulkSizeUnit;
    }
    const sameTitle = titleBulkMode === "set" && titleBulkText.trim();
    if (sameTitle) {
      const title = titleBulkText.trim();
      partial.title = title;
      if (locale === "ko") partial.title_ko = title;
      else partial.title_en = title;
    }
    const reshapeTitle =
      (titleBulkMode === "prefix" || titleBulkMode === "suffix" || titleBulkMode === "replace") &&
      (titleBulkMode === "replace" ? titleReplaceFrom.trim() : titleBulkText.trim());
    if (Object.keys(partial).length === 0 && !linkExhibitionId && !reshapeTitle) {
      setToast(t("bulk.sharedNothing"));
      setTimeout(() => setToast(null), 2000);
      return;
    }
    if (Object.keys(partial).length > 0) {
      await applyToDrafts(ids, partial);
    }
    if (reshapeTitle) {
      for (const id of ids) {
        const d = drafts.find((x) => x.id === id);
        const next = transformTitle(
          d?.title ?? null,
          titleBulkMode,
          titleBulkText,
          titleReplaceFrom,
          titleReplaceTo,
        );
        const titlePatch: UpdateArtworkPayload = { title: next || d?.title || "" };
        if (locale === "ko") titlePatch.title_ko = titlePatch.title || null;
        else titlePatch.title_en = titlePatch.title || null;
        await updateArtwork(id, titlePatch, {
          actingSubjectProfileId: actingAsProfileId ?? null,
          auditAction: "bulk.artwork.update",
        });
      }
      await fetchDrafts({ silent: true });
      setBulkVersion((v) => v + 1);
    }
    if (linkExhibitionId) {
      setLinkingExhibition(true);
      try {
        for (const workId of ids) {
          await addWorkToExhibition(linkExhibitionId, workId, {
            actingSubjectProfileId: actingAsProfileId ?? null,
          });
        }
        setCardExhibition((prev) => {
          const next = { ...prev };
          for (const id of ids) next[id] = linkExhibitionId;
          return next;
        });
      } finally {
        setLinkingExhibition(false);
      }
    }
    setToast(selected.size > 0 ? t("bulk.applyToSelected") : t("bulk.applyToAll"));
    setTimeout(() => setToast(null), 2000);
  }

  const sharedMediumSuggestions = TAXONOMY.mediumOptions
    .map((opt) => t(opt.labelKey))
    .filter((name) => {
      const q = sharedMediumQuery.trim().toLowerCase();
      if (!q) return false;
      return name.toLowerCase().includes(q) && !sharedMediums.some((m) => m.toLowerCase() === name.toLowerCase());
    })
    .slice(0, 6);

  return (
      <div>
        {/*
          Post-publish confirmation card (QA 2026-07 Phase 2-2). Rendered
          at the layout root so it stays visible across the drafts table,
          exhibition picker, etc. Auto-dismisses in 10s or on user action.
        */}
        {inviteCard && (
          <InviteResultCard
            kind={inviteCard.kind}
            artistName={inviteCard.artistName}
            onDismiss={() => setInviteCard(null)}
          />
        )}
        {addToExhibitionId && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-3 text-sm">
            <span className="text-zinc-600">{t("exhibition.addingWorksContext")}</span>
            <Link
              href={`/my/exhibitions/${addToExhibitionId}/add`}
              className="text-zinc-700 hover:text-zinc-900"
            >
              ← {t("exhibition.backToExhibitionAdd")}
            </Link>
          </div>
        )}

        <ActingAsChip mode="posting" />

        {showAttribution && (
          <div className="mb-6 space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
            <label className="block text-sm font-medium text-zinc-900">
              {t("bulk.attributeSomeoneElse")}
              <select
                value={intent ?? "CURATED"}
                onChange={(e) => {
                  const next = e.target.value as IntentType;
                  setIntent(next);
                  if (next === "CREATED") {
                    setAttributionOpen(false);
                    setAttributionStepDone(false);
                    setSelectedArtist(null);
                    setUseExternalArtist(false);
                  }
                }}
                className="mt-1 w-full max-w-md rounded border border-zinc-300 bg-white px-3 py-2 text-sm"
              >
                {INTENT_KEYS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-zinc-600">{t("upload.linkArtist")}</p>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium">{t("upload.searchArtist")}</label>
              <button
                type="button"
                onClick={() => {
                  setUseExternalArtist(!useExternalArtist);
                  if (!useExternalArtist) {
                    setSelectedArtist(null);
                    setArtistSearch("");
                    setArtistResults([]);
                  } else {
                    setExternalArtistName("");
                    setExternalArtistEmail("");
                    setPreselectedExternalArtistId(null);
                    setReselectedExternalMeta(null);
                  }
                }}
                className="text-sm text-zinc-600 underline hover:text-zinc-900"
              >
                {useExternalArtist ? t("upload.searchArtist") : t("upload.inviteByEmail")}
              </button>
            </div>
            {useExternalArtist ? (
              <div className="space-y-3">
                {/*
                  Phase 3-3: re-selection banner. Signals "you're adding a
                  work to an artist you've already invited" so the operator
                  understands no new email will fire and the works pile onto
                  the existing shadow-account. `[Choose a different artist]`
                  clears the preselected id + form back to a blank slate.
                */}
                {preselectedExternalArtistId && reselectedExternalMeta && (
                  <div className="max-w-md rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    <div className="flex items-start justify-between gap-3">
                      <p>
                        {t("upload.externalReselect.addingToExisting")
                          .replace("{name}", externalArtistName.trim() || "—")
                          .replace("{n}", String(reselectedExternalMeta.worksCount))}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setPreselectedExternalArtistId(null);
                          setReselectedExternalMeta(null);
                          setExternalArtistName("");
                          setExternalArtistNameKo("");
                          setExternalArtistNameEn("");
                          setExternalArtistEmail("");
                        }}
                        className="shrink-0 whitespace-nowrap text-[11px] font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-900"
                      >
                        {t("upload.externalReselect.chooseDifferent")}
                      </button>
                    </div>
                  </div>
                )}
                {/*
                  QA 2026-07-28 — external_artists KO/EN 이중언어 (240005
                  SECTION 2/3). BilingualFieldPair 가 primary/secondary 슬롯을
                  관리하고 legacy `externalArtistName` 은 KO 우선으로 sync.
                  Publish 시 KO/EN 이 함께 RPC 로 전달되어 새 external_artists
                  행에 저장된다.
                */}
                <div className="max-w-md">
                  <BilingualFieldPair
                    label={null}
                    hint={t("bilingual.hintName")}
                    addKoKey="bilingual.addKoName"
                    addEnKey="bilingual.addEnName"
                    placeholderKo={t("upload.externalArtistNamePlaceholder")}
                    placeholderEn={t("upload.externalArtistNamePlaceholder")}
                    valueKo={externalArtistNameKo}
                    valueEn={externalArtistNameEn}
                    onChangeKo={(v) => {
                      setExternalArtistNameKo(v);
                      const legacy =
                        pickLegacyForSave(v || null, externalArtistNameEn || null) ??
                        "";
                      setExternalArtistName(legacy);
                      if (preselectedExternalArtistId) {
                        setPreselectedExternalArtistId(null);
                        setReselectedExternalMeta(null);
                      }
                    }}
                    onChangeEn={(v) => {
                      setExternalArtistNameEn(v);
                      const legacy =
                        pickLegacyForSave(externalArtistNameKo || null, v || null) ??
                        "";
                      setExternalArtistName(legacy);
                      if (preselectedExternalArtistId) {
                        setPreselectedExternalArtistId(null);
                        setReselectedExternalMeta(null);
                      }
                    }}
                    renderSecondaryAssist={({ secondaryLang }) =>
                      // 벌크 업로드에서도 외부 작가 이름은 사람 이름이므로
                      // AI 번역 대신 로마자 힌트만.
                      secondaryLang === "en" ? (
                        <RomanizationHintChip
                          sourceText={externalArtistNameKo}
                          currentTargetText={externalArtistNameEn}
                          onApply={(text) => {
                            setExternalArtistNameEn(text);
                            const legacy =
                              pickLegacyForSave(
                                externalArtistNameKo || null,
                                text || null,
                              ) ?? "";
                            setExternalArtistName(legacy);
                          }}
                          compact
                        />
                      ) : null
                    }
                  />
                </div>
                <input
                  type="email"
                  value={externalArtistEmail}
                  onChange={(e) => setExternalArtistEmail(e.target.value)}
                  placeholder={t("upload.externalArtistEmailPlaceholder")}
                  disabled={externalNoEmail}
                  className="w-full max-w-md rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-400"
                />
                <p className="text-xs text-zinc-500">{t("upload.externalArtistEmailHint")}</p>
                {!externalNoEmail && (
                  <label className="flex max-w-md items-start gap-2 text-xs text-zinc-600">
                    <input
                      type="checkbox"
                      checked={notifyOnInquiryViaEmail}
                      onChange={(e) => setNotifyOnInquiryViaEmail(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>{t("upload.notifyOnInquiryViaEmail")}</span>
                  </label>
                )}
                <label className="flex max-w-md items-start gap-2 text-xs text-zinc-600">
                  <input
                    type="checkbox"
                    checked={externalNoEmail}
                    onChange={(e) => {
                      setExternalNoEmail(e.target.checked);
                      if (e.target.checked) setNotifyOnInquiryViaEmail(false);
                    }}
                    className="mt-0.5"
                  />
                  <span>{t("upload.externalArtistNoEmail")}</span>
                </label>
                {/*
                  Phase C: no-email invites lose both cross-inviter dedupe
                  and auto-linking on onboarding. Warn unless the operator
                  is explicitly re-using an existing external artist row
                  (Phase 3) where the email is hidden for privacy reasons.
                */}
                {externalNoEmail && !preselectedExternalArtistId && (
                  <p className="max-w-md rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                    {t("upload.externalArtist.noEmailWarning")}
                  </p>
                )}
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={artistSearch}
                  onChange={(e) => setArtistSearch(e.target.value)}
                  placeholder={t("upload.artistSearchPlaceholder")}
                  className="w-full max-w-md rounded border border-zinc-300 px-3 py-2 text-sm"
                />
                {searching && <p className="text-sm text-zinc-500">{t("artists.loading")}</p>}
                {artistResults.length > 0 && (
                  <ul className="max-w-md divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
                    {artistResults.map((a) => (
                      <li key={`${a.kind}-${a.id}`}>
                        {a.kind === "profile" ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedArtist({
                                id: a.id,
                                username: a.username,
                                display_name: a.display_name,
                                display_name_ko: a.display_name_ko ?? null,
                                display_name_en: a.display_name_en ?? null,
                              });
                              setArtistResults([]);
                              setArtistSearch("");
                              // Auto-advance past the attribution step for
                              // onboarded artists — mirrors single upload
                              // (QA 2026-08-09). External artist path
                              // stays manual because it still needs email.
                              setAttributionStepDone(true);
                            }}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-zinc-50"
                          >
                            {formatDisplayName(
                              {
                                display_name: a.display_name,
                                display_name_ko: a.display_name_ko ?? null,
                                display_name_en: a.display_name_en ?? null,
                                username: a.username,
                              },
                              t,
                              locale,
                            )}
                            {a.username && (
                              <span className="ml-2 text-zinc-500">
                                {formatUsername({
                                  display_name: a.display_name,
                                  username: a.username,
                                })}
                              </span>
                            )}
                          </button>
                        ) : (
                          // Phase 3-3: external (invited) artist row. Selecting
                          // this switches attribution into external mode with
                          // the invited id preserved, so publish reuses the
                          // exact row instead of re-inviting (dedupe-safe).
                          <button
                            type="button"
                            onClick={() => {
                              setUseExternalArtist(true);
                              setSelectedArtist(null);
                              setExternalArtistName(a.display_name?.trim() ?? "");
                              // Email stays as-is (user can still edit); server
                              // will backfill it into the row on publish if
                              // supplied. We deliberately do NOT auto-fill it
                              // here because the RPC doesn't return PII.
                              setPreselectedExternalArtistId(a.id);
                              setReselectedExternalMeta({
                                worksCount: a.works_count ?? 0,
                                latestCovers: a.latest_cover_paths ?? [],
                              });
                              setArtistResults([]);
                              setArtistSearch("");
                            }}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-zinc-50"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-medium text-zinc-900">
                                  {pickLocalizedDisplayName(a, locale) ||
                                    a.display_name?.trim() ||
                                    "—"}
                                </p>
                                <p className="mt-0.5 text-[11px] text-zinc-500">
                                  {t("upload.externalReselect.badgePendingWorks")
                                    .replace("{n}", String(a.works_count ?? 0))}
                                </p>
                              </div>
                              {a.latest_cover_paths && a.latest_cover_paths.length > 0 && (
                                <div className="flex shrink-0 gap-1">
                                  {a.latest_cover_paths.slice(0, 3).map((p, i) => {
                                    const url = getArtworkImageUrl(p, "thumb");
                                    return (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        key={`${p}-${i}`}
                                        src={url}
                                        alt=""
                                        className="h-8 w-8 rounded object-cover"
                                      />
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {(intent === "INVENTORY" || intent === "CURATED") && (
              <div>
                <label className="mb-1 block text-sm font-medium">{t("artwork.periodLabel")} *</label>
                <select
                  value={periodStatus}
                  onChange={(e) => setPeriodStatus(e.target.value as "past" | "current" | "future")}
                  required
                  className="w-full max-w-md rounded border border-zinc-300 px-3 py-2 text-sm"
                >
                  <option value="past">{t("artwork.periodPast")}</option>
                  <option value="current">{t("artwork.periodCurrent")}</option>
                  <option value="future">{t("artwork.periodFuture")}</option>
                </select>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIntent("CREATED");
                  setAttributionOpen(false);
                  setAttributionStepDone(false);
                  setSelectedArtist(null);
                  setUseExternalArtist(false);
                  setExternalArtistName("");
                  setExternalArtistEmail("");
                  setArtistSearch("");
                  setArtistResults([]);
                  setPreselectedExternalArtistId(null);
                  setReselectedExternalMeta(null);
                }}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm"
              >
                {t("common.back")}
              </button>
              <button
                type="button"
                disabled={!attributionValid}
                onClick={() => {
                  if (!attributionValid) return;
                  if (useExternalArtist && externalArtistName.trim().length < 2) return;
                  if (useExternalArtist && !externalEmailValid) return;
                  setAttributionStepDone(true);
                  setAttributionOpen(false);
                }}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("upload.confirmAttribution")}
              </button>
            </div>
            {/*
              Explicit signal: "Next" reads as "send" for gallerists.
              When we know an external artist + email is set, tell the user
              exactly when the invite gets sent — at Publish, not at this
              confirm step. Keeps QA1's mental model correct without moving
              the actual send timing.
            */}
            {useExternalArtist && externalEmailValid && externalArtistEmail.trim() && (
              <p className="mt-2 text-xs text-zinc-500">
                {(preselectedExternalArtistId || pendingInviteForEmail)
                  ? t("upload.emailAlreadyInvitedHint")
                  : t("upload.inviteWillSendOnPublish")}
              </p>
            )}
          </div>
        )}

        {/* Main bulk UI */}
        {showMain && (
          <div className="flex flex-col">
        {/*
          Persistent attribution context bar (QA 2026-07 Phase 2-1). Keeps
          the "who am I uploading for?" answer visible once the operator
          leaves the attribution step. Only shown when attribution actually
          picked someone (i.e. intent needed attribution).
        */}
        {needsAttribution && (selectedArtist || (useExternalArtist && externalArtistName.trim().length >= 2)) && (
          <AttributionContextBanner
            artistName={
              useExternalArtist
                ? externalArtistName.trim()
                : formatDisplayName(selectedArtist, t, locale)
            }
            isExternal={useExternalArtist}
            externalEmail={useExternalArtist ? externalArtistEmail : null}
            hasPendingInviteForEmail={
              Boolean(preselectedExternalArtistId) || pendingInviteForEmail
            }
            onChange={() => {
              setAttributionStepDone(false);
              setAttributionOpen(true);
            }}
          />
        )}
        {intent === "CREATED" && !attributionOpen && (
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              data-tour="upload-intent-selector"
              onClick={() => {
                setIntent("CURATED");
                setAttributionOpen(true);
                setAttributionStepDone(false);
              }}
              className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800"
            >
              {t("bulk.attributeSomeoneElse")}
            </button>
          </div>
        )}

        <div
          className="mb-2 cursor-pointer rounded-md border border-zinc-300 bg-white px-6 py-10 text-center hover:border-zinc-400"
          onClick={() => document.getElementById("bulk-file-input")?.click()}
          onDrop={(e) => {
            e.preventDefault();
            addPendingFiles(e.dataTransfer.files);
          }}
          onDragOver={(e) => e.preventDefault()}
        >
          <input
            id="bulk-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,.csv,.tsv,text/csv,text/tab-separated-values"
            multiple
            className="hidden"
            onChange={(e) => {
              addPendingFiles(e.target.files);
              e.target.value = "";
            }}
            disabled={csvBusy}
          />
          <div className="mx-auto flex h-14 w-14 flex-col items-center justify-center rounded-lg border border-zinc-300 text-zinc-700">
            <UploadCloudMark className="h-6 w-6" />
            <span className="text-[10px] leading-none">{t("bulk.dropMark")}</span>
          </div>
          <p className="mx-auto mt-4 max-w-lg text-xs leading-relaxed text-zinc-500">
            {drafts.length > 0 || placing.length > 0 ? t("bulk.dropLineMore") : t("bulk.dropLine1")}
          </p>
          <p className="mx-auto max-w-lg text-xs leading-relaxed text-zinc-500">
            {t("bulk.dropLine2").replace("{maxMb}", String(UPLOAD_MAX_IMAGE_MB_LABEL))}
          </p>
        </div>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) ingestCaptionFile(file);
          }}
        />
        {drafts.length === 0 && placing.length === 0 && (
          <div className="mb-6 text-center">
            <button
              type="button"
              disabled={csvBusy}
              onClick={() => csvInputRef.current?.click()}
              className="text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-800 disabled:opacity-50"
            >
              {csvBusy ? "…" : t("bulk.csvOpen")}
            </button>
          </div>
        )}

        {uploading && (
          <p className="mb-4 text-sm text-zinc-600">
            {t("bulk.uploadProgress")
              .replace("{current}", String(uploadCurrent))
              .replace("{total}", String(uploadTotal))}
          </p>
        )}
        {uploadError && (
          <p className="mb-4 text-sm leading-relaxed text-red-600" role="alert">
            {t("bulk.uploadError").replace("{message}", uploadError)}
          </p>
        )}
        {!uploading && uploadTotal > 0 && uploadFailures.length === 0 && (
          <p className="mb-4 text-sm text-green-600">
            {t("bulk.uploadDone").replace("{total}", String(uploadTotal))}
          </p>
        )}
        {!uploading && uploadTotal > 0 && uploadFailures.length > 0 && (
          <p className="mb-2 text-sm text-amber-700">
            {t("bulk.uploadDoneWithFailures")
              .replace("{ok}", String(uploadSucceeded))
              .replace("{total}", String(uploadTotal))
              .replace("{failed}", String(uploadFailures.length))}
          </p>
        )}
        {uploadFailures.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="mb-2 text-sm font-medium text-amber-900">
              {t("bulk.uploadFailuresTitle").replace("{n}", String(uploadFailures.length))}
            </p>
            <ul className="space-y-1 text-xs text-amber-900">
              {uploadFailures.slice(0, 12).map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <span className="font-medium">{f.name}</span>
                  <span className="ml-1 text-amber-800">— {f.message}</span>
                </li>
              ))}
              {uploadFailures.length > 12 && (
                <li className="italic text-amber-800">
                  +{uploadFailures.length - 12} more
                </li>
              )}
            </ul>
          </div>
        )}

        <details data-tour="upload-website-import" className="order-last mt-8 rounded-lg border border-zinc-200">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-700">
              {t("bulk.moreTools")}
            </summary>
            <div className="space-y-4 border-t border-zinc-200 px-4 py-4">
            <BulkUploadGuidance t={t} pendingCount={0} draftCount={drafts.length} />
            <div>
              <WebsiteImportPanel
                t={t}
                actingAsProfileId={actingAsProfileId}
                drafts={drafts}
                stagedArtworkIds={stagedArtworkIds}
                onApplied={() => fetchDrafts({ silent: true })}
                onApplyToast={(n) => {
                  setToast(t("bulk.wi.appliedToast").replace("{n}", String(n)));
                  setTimeout(() => setToast(null), 3200);
                }}
                onSessionReset={() => setStagedArtworkIds([])}
              />
            </div>
            <div className="rounded-lg border border-zinc-200">
              <button
                type="button"
                onClick={() => setTipsOpen((o) => !o)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-zinc-900"
              >
                {t("bulk.tipsTitle")}
                <span className="text-zinc-500">{tipsOpen ? "−" : "+"}</span>
              </button>
              {tipsOpen && (
                <div className="space-y-1 border-t border-zinc-200 px-4 py-3 text-sm text-zinc-600">
                  <p>• {t("bulk.tip1")}</p>
                  <p>• {t("bulk.tip2")}</p>
                  <p>• {t("bulk.tip3")}</p>
                </div>
              )}
            </div>
            </div>
          </details>

        {groupOpen && (
          <BulkGroupDialog
            busy={groupBusy}
            cards={drafts.filter((d) => selected.has(d.id)).map((d): GroupCard => {
              const cover = orderedImages(d)[0];
              return {
                id: d.id,
                title: d.title?.trim() || t("bulk.group.untitled"),
                thumb: cover ? getArtworkImageUrl(cover.storage_path, "thumb") : null,
                imageCount: d.artwork_images?.length ?? 1,
              };
            })}
            onClose={() => setGroupOpen(false)}
            onConfirm={(groups) => void confirmGroups(groups)}
          />
        )}

        {enhanceDraft && orderedImages(enhanceDraft).length > 0 && (
          <BulkEnhanceDialog
            artworkId={enhanceDraft.id}
            artistProfileId={enhanceDraft.artist_id ?? null}
            storageOwnerId={actingAsProfileId}
            images={orderedImages(enhanceDraft)}
            artworkWidthCm={enhanceDraft.width_cm ?? null}
            artworkHeightCm={enhanceDraft.height_cm ?? null}
            onClose={() => setEnhanceDraft(null)}
            onSaved={() => {
              setEnhanceDraft(null);
              setToast(t("bulk.enhance.rowSaved"));
              setTimeout(() => setToast(null), 3200);
              void fetchDrafts({ silent: true });
            }}
          />
        )}

        {pendingBulk && (
          <BodyPortal>
          <div className={`fixed inset-0 ${layer.scrim} flex items-center justify-center bg-black/40 px-4`}>
            <div className="max-w-md rounded-lg bg-white p-6 shadow-lg">
              <p className="mb-4 text-sm text-zinc-800">{pendingBulk.message}</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingBulk(null)}
                  className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm"
                >
                  {t("bulk.confirmCancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void pendingBulk.run()}
                  className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm text-white"
                >
                  {t("bulk.confirmOk")}
                </button>
              </div>
            </div>
          </div>
          </BodyPortal>
        )}

        {toast && (
          <BodyPortal>
          <div className={`fixed bottom-4 right-4 ${layer.toast} rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg`}>
            {toast}
          </div>
          </BodyPortal>
        )}

        <div id="upload-drafts" className="space-y-4">
          {(drafts.length > 0 || placing.length > 0) && (
            <div>
              <p className="mb-2 text-sm text-zinc-800">{t("bulk.csvTheseHint")}</p>
              <button
                type="button"
                disabled={csvBusy}
                onClick={() => csvInputRef.current?.click()}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {csvBusy ? "…" : t("bulk.csvForThese")}
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={selectedIds.length === 0 || deleting}
              className="rounded-full border border-zinc-400 px-4 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-40"
            >
              {t("bulk.deleteSelected")}
            </button>
            <button
              type="button"
              onClick={handleDeleteAll}
              disabled={drafts.length === 0 || deleting}
              className="rounded-full border border-zinc-400 px-4 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-40"
            >
              {t("bulk.deleteAll")}
            </button>
            <button
              type="button"
              onClick={() => setSharedOpen((o) => !o)}
              aria-expanded={sharedOpen}
              className="ml-auto inline-flex items-center gap-1 text-sm text-zinc-800 hover:text-zinc-950"
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-400 text-[10px] text-zinc-500">
                ?
              </span>
              {t("bulk.setSharedInfo")}
              <span aria-hidden className="text-zinc-400">{sharedOpen ? "▴" : "▾"}</span>
            </button>
          </div>

          {sharedOpen && (
            <div className="rounded-md border border-zinc-300 bg-white p-4">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.4fr)_6.5rem_minmax(0,1.2fr)]">
                <div>
                  <p className="mb-1 text-xs text-zinc-800">{t("bulk.tableTitle")}</p>
                  <div className="flex gap-2">
                    <select
                      value={titleBulkMode === "none" ? "set" : titleBulkMode}
                      onChange={(e) => setTitleBulkMode(e.target.value as typeof titleBulkMode)}
                      aria-label={t("bulk.sharedTitlePlaceholder")}
                      className="w-36 shrink-0 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="set">{t("bulk.sharedTitlePlaceholder")}</option>
                      <option value="prefix">{t("bulk.titleModePrefix")}</option>
                      <option value="suffix">{t("bulk.titleModeSuffix")}</option>
                      <option value="replace">{t("bulk.titleModeReplace")}</option>
                    </select>
                    {titleBulkMode !== "replace" && (
                      <input
                        value={titleBulkText}
                        onChange={(e) => setTitleBulkText(e.target.value)}
                        placeholder={t("bulk.tableTitle")}
                        className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    )}
                  </div>
                  {titleBulkMode === "replace" && (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={titleReplaceFrom}
                        onChange={(e) => setTitleReplaceFrom(e.target.value)}
                        placeholder={t("bulk.titleReplaceFrom")}
                        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                      <input
                        value={titleReplaceTo}
                        onChange={(e) => setTitleReplaceTo(e.target.value)}
                        placeholder={t("bulk.titleReplaceTo")}
                        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                  )}
                </div>
                <label className="block text-xs text-zinc-800">
                  {t("bulk.year")}
                  <select
                    value={sharedYear}
                    onChange={(e) => setSharedYear(e.target.value)}
                    className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                  >
                    <option value=""> </option>
                    {Array.from({ length: 81 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </label>
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-800">
                    <span>{t("bulk.size")}</span>
                    <span className="inline-flex overflow-hidden rounded border border-zinc-300 text-[10px] leading-none">
                      {(["cm", "in"] as const).map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => {
                            setSharedSizeNa(false);
                            setBulkSizeUnit(u);
                          }}
                          className={`px-1.5 py-1 ${
                            !sharedSizeNa && (bulkSizeUnit || "cm") === u
                              ? "bg-zinc-800 text-white"
                              : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {u}
                        </button>
                      ))}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSharedSizeNa((v) => !v)}
                      className="inline-flex items-center gap-1 text-zinc-600"
                    >
                      <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${sharedSizeNa ? "border-zinc-800" : "border-zinc-400"}`}>
                        {sharedSizeNa && <span className="h-1.5 w-1.5 rounded-full bg-zinc-800" />}
                      </span>
                      {t("bulk.sizeNotApplicable")}
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <input value={sharedH} disabled={sharedSizeNa} onChange={(e) => setSharedH(e.target.value)} placeholder={t("bulk.dimHeight")} aria-label={t("bulk.dimHeight")} className="w-16 rounded border border-zinc-300 px-2 py-1.5 text-sm disabled:bg-zinc-50" />
                    <span className="text-xs text-zinc-400">×</span>
                    <input value={sharedW} disabled={sharedSizeNa} onChange={(e) => setSharedW(e.target.value)} placeholder={t("bulk.dimWidth")} aria-label={t("bulk.dimWidth")} className="w-16 rounded border border-zinc-300 px-2 py-1.5 text-sm disabled:bg-zinc-50" />
                    <span className="text-xs text-zinc-400">×</span>
                    <input value={sharedD} disabled={sharedSizeNa} onChange={(e) => setSharedD(e.target.value)} placeholder={t("bulk.dimDepth")} aria-label={t("bulk.dimDepth")} className="w-16 rounded border border-zinc-300 px-2 py-1.5 text-sm disabled:bg-zinc-50" />
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 border-b border-zinc-200 pb-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.35fr)]">
                <label className="block text-xs text-zinc-800">
                  {t("upload.tabExhibitionShort")}
                  <select
                    value={linkExhibitionId}
                    onChange={(e) => setLinkExhibitionId(e.target.value)}
                    className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                  >
                    <option value="">{t("bulk.exhibitionSelectorPlaceholder")}</option>
                    {myExhibitions.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {pickLocalizedTitle(ex, locale) || ex.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-zinc-800">
                  {t("bulk.ownershipStatus")}
                  <select
                    value={sharedOwnership}
                    onChange={(e) => setSharedOwnership(e.target.value)}
                    className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                  >
                    <option value=""> </option>
                    {OWNERSHIP_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                    ))}
                  </select>
                </label>
                <div>
                  <p className="mb-1 text-xs text-zinc-800">{t("bulk.pricingMode")}</p>
                  <div className="flex gap-2">
                    <select
                      value={sharedPricing}
                      onChange={(e) => setSharedPricing(e.target.value as "" | "inquire" | "fixed")}
                      aria-label={t("bulk.pricingMode")}
                      className="w-28 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value=""> </option>
                      <option value="inquire">{t("bulk.inquire")}</option>
                      <option value="fixed">{t("bulk.fixed")}</option>
                    </select>
                    <input
                      value={bulkPriceAmount}
                      onChange={(e) => {
                        setBulkPriceAmount(e.target.value);
                        if (e.target.value.trim()) setSharedPricing("fixed");
                      }}
                      disabled={sharedPricing === "inquire"}
                      placeholder={t("bulk.amount")}
                      aria-label={t("bulk.amount")}
                      className="w-24 rounded border border-zinc-300 px-2 py-1.5 text-sm disabled:bg-zinc-50"
                    />
                    <select
                      value={bulkPriceCurrency}
                      onChange={(e) => setBulkPriceCurrency(e.target.value)}
                      aria-label={t("bulk.currency")}
                      className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="USD">USD</option>
                      <option value="KRW">KRW</option>
                    </select>
                  </div>
                  {sharedPricing === "fixed" && (
                    <label className="mt-2 flex items-center gap-1.5 text-xs text-zinc-600">
                      <input
                        type="checkbox"
                        checked={bulkPricePublic}
                        onChange={(e) => setBulkPricePublic(e.target.checked)}
                      />
                      {t("bulk.pricePublic")}
                    </label>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <p className="mb-1 text-xs text-zinc-800">
                  {t("bulk.medium")}
                  <span className="ml-2 font-normal text-zinc-400">{t("bulk.mediumSearch")}</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex min-w-[14rem] flex-1 items-center rounded border border-zinc-300">
                    <input
                      value={sharedMediumQuery}
                      onChange={(e) => setSharedMediumQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addSharedMedium(sharedMediumQuery);
                        }
                      }}
                      placeholder={t("bulk.mediumSearch")}
                      className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => addSharedMedium(sharedMediumQuery)}
                      className="px-2 text-lg leading-none text-zinc-500"
                      aria-label={t("bulk.mediumAdd")}
                    >
                      +
                    </button>
                  </div>
                  {sharedMediums.map((chip) => (
                    <span key={chip} className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-1 text-xs text-zinc-800">
                      {chip}
                      <button type="button" className="text-zinc-400 hover:text-zinc-800" onClick={() => setSharedMediums((prev) => prev.filter((m) => m !== chip))}>×</button>
                    </span>
                  ))}
                </div>
                {sharedMediumSuggestions.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {sharedMediumSuggestions.map((name) => (
                      <button key={name} type="button" onClick={() => addSharedMedium(name)} className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-50">
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {linkExhibitionId && (
                <div className="mt-3 text-right">
                  <button
                    type="button"
                    disabled={linkingExhibition}
                    onClick={() => void unlinkSelectedFromExhibition()}
                    className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 disabled:opacity-40"
                  >
                    {t("bulk.unlinkFromExhibition")}
                  </button>
                </div>
              )}

              <div className="mt-5 text-center">
                <button
                  type="button"
                  onClick={() => void applySharedWorkspace()}
                  disabled={linkingExhibition}
                  className="rounded-full bg-zinc-900 px-5 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {selected.size > 0 ? t("bulk.applyToSelected") : t("bulk.applyToAll")}
                </button>
                {selected.size === 0 && (
                  <p className="mt-2 text-xs text-zinc-500">{t("bulk.sharedOverwrite")}</p>
                )}
              </div>
            </div>
          )}

          {placing.map((card) => (
            <article key={card.id} className="rounded-md border border-zinc-300 bg-white p-3">
              <div className="flex items-center gap-3">
                <div
                  className="h-[88px] w-[88px] shrink-0 bg-zinc-200 bg-cover bg-center"
                  style={{ backgroundImage: `url("${card.previewUrl}")` }}
                  role="img"
                  aria-label={t("bulk.cardPlacing")}
                />
                <p className="text-xs text-zinc-500">{t("bulk.cardPlacing")}</p>
              </div>
            </article>
          ))}

          {loading ? (
            <p className="text-zinc-600">{t("common.loading")}</p>
          ) : (
            drafts.map((d) => (
              <BulkDraftCard
                key={`${d.id}-${bulkVersion}`}
                draft={d}
                bulkVersion={bulkVersion}
                selected={selected.has(d.id)}
                dropActive={dropOnId === d.id}
                exhibitions={myExhibitions}
                exhibitionId={cardExhibition[d.id] ?? ""}
                onToggle={() => toggleSelect(d.id)}
                onEnhance={() => setEnhanceDraft(d)}
                onAddFiles={(files) => {
                  setDropOnId(null);
                  void addDetailsToDraft(d.id, files);
                }}
                onDragOver={() => setDropOnId(d.id)}
                onDragLeave={() => setDropOnId((id) => (id === d.id ? null : id))}
                sizeNotApplicable={sizeExempt[d.id] === true}
                onSizeNotApplicable={(na) =>
                  setSizeExempt((prev) => ({ ...prev, [d.id]: na }))
                }
                onSave={(patch) => void saveDraftPatch(d.id, patch)}
                onLinkExhibition={(exhibitionId) => void linkOneExhibition(d.id, exhibitionId)}
                onSetViewType={(storagePath, viewType) => void setDetailView(d.id, storagePath, viewType)}
                onRemoveDetail={(storagePath) => void removeDetailImage(d.id, storagePath)}
              />
            ))
          )}

          {selectedIds.length >= 2 && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setGroupOpen(true)}
                disabled={groupBusy}
                className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 disabled:opacity-40"
              >
                {t("bulk.group.open")}
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 pt-6">
            <button
              type="button"
              onClick={() => {
                setToast(t("bulk.savedDraft"));
                setTimeout(() => setToast(null), 2000);
              }}
              className="min-w-[10.5rem] rounded-full border border-zinc-800 px-5 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
            >
              {t("bulk.saveToDraft")}
            </button>
            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={!canPublishSelected || publishing}
              className="min-w-[10.5rem] rounded-full border border-zinc-800 px-5 py-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-40"
            >
              {t("bulk.publishSelected")}
            </button>
            <button
              type="button"
              onClick={publishAllReady}
              disabled={readyCount === 0 || publishing}
              className="min-w-[10.5rem] rounded-full border border-zinc-800 px-5 py-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-40"
            >
              {t("bulk.publishAll")}
            </button>
          </div>
        </div>

          </div>
        )}
        <BetaFeedbackPrompt pageKey="bulk_upload" />
      </div>
  );
}
