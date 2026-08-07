"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  attachArtworkImage,
  createDraftArtwork,
  deleteArtwork,
  deleteDraftArtworks,
  listMyDraftArtworks,
  publishArtworks,
  publishArtworksWithProvenance,
  updateArtwork,
  validatePublish,
  type ArtworkWithLikes,
  type UpdateArtworkPayload,
} from "@/lib/supabase/artworks";
import { logBetaEvent } from "@/lib/beta/logEvent";
import { getSession } from "@/lib/supabase/auth";
import { removeStorageFile, uploadArtworkImage } from "@/lib/supabase/storage";
import type { EnhancementDraft } from "@/components/upload/ImageStandardizeEditor";
import type { EnhancementMode } from "@/lib/image/enhancement/types";
import {
  runFlatEnhancement,
  flatBlobToFile,
} from "@/lib/image/enhancement/localFlatEngine";
import {
  cleanupEnhancedPath,
  cleanupStagingPath,
  requestObjectEnhancement,
  uploadStagingForEnhancement,
} from "@/lib/image/enhancement/objectClient";
import { ENHANCEMENT_META_SCHEMA_VERSION } from "@/lib/image/enhancement/types";
import { computeFileSha256 } from "@/lib/image/prepareArtworkImageForUpload";
import { analyzeImageFile } from "@/lib/image/analyze";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { searchPeopleWithExternal, type SearchPeopleWithExternalResult } from "@/lib/supabase/artists";
import { externalArtistEmailExists } from "@/lib/provenance/externalArtists";
import { AuthGate } from "@/components/AuthGate";
import { useActingAs } from "@/context/ActingAsContext";
import { ActingAsChip } from "@/components/ActingAsChip";
import { useT } from "@/lib/i18n/useT";
import { BilingualFieldPair } from "@/components/i18n/BilingualFieldPair";
import { RomanizationHintChip } from "@/components/i18n/RomanizationHintChip";
import { pickLegacyForSave } from "@/lib/i18n/pickLocalized";
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
  getUploadCeilingBytes,
} from "@/lib/upload/limits";
import { isCompressibleMime } from "@/lib/image/compress";

type IntentType = "CREATED" | "OWNS" | "INVENTORY" | "CURATED";

const INTENT_KEYS = [
  { value: "CREATED" as const, labelKey: "upload.claimCreated" },
  { value: "OWNS" as const, labelKey: "upload.claimOwned" },
  { value: "INVENTORY" as const, labelKey: "upload.claimInventory" },
  { value: "CURATED" as const, labelKey: "upload.claimCurated" },
] as const;

type ArtistOption = { id: string; username: string | null; display_name: string | null };

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
  const preservedFromBoard = searchParams.get("fromBoard");

  const { t, locale } = useT();
  const { actingAsProfileId } = useActingAs();
  const [drafts, setDrafts] = useState<ArtworkWithLikes[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadCurrent, setUploadCurrent] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Per-file failure log shown alongside the progress bar so a 100-image
  // batch where 3 files fail doesn't disappear into a single rolling toast.
  const [uploadFailures, setUploadFailures] = useState<{ name: string; message: string }[]>([]);
  const [uploadSucceeded, setUploadSucceeded] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<{ id: string; file: File }[]>([]);
  /**
   * Theo Image Enhance (Beta, 2026-08-05) — per-pending-file
   * enhancement state. Tracked as a Map so lookups stay O(1) as the
   * queue grows.
   */
  type EnhanceStatus =
    | { kind: "queued" }
    | { kind: "processing" }
    | { kind: "previewing"; draft: EnhancementDraft; enhancedPath?: string | null; exhibitionScoped?: boolean }
    | { kind: "approved"; draft: EnhancementDraft; enhancedPath?: string | null; exhibitionScoped?: boolean }
    | { kind: "rejected" }
    | { kind: "failed"; reason: string };
  const [pendingEnhance, setPendingEnhance] = useState<Record<string, EnhanceStatus>>({});
  const [pendingSelected, setPendingSelected] = useState<Set<string>>(new Set());
  const [bulkEnhanceMode, setBulkEnhanceMode] = useState<EnhancementMode>("auto");
  const [bulkEnhanceRunning, setBulkEnhanceRunning] = useState(false);
  /**
   * Theo Image Enhance (Beta, 2026-08-06) — per-row AbortController so
   * a user can hit "reject" or delete a row mid-enhance and cancel the
   * inflight staging upload + fetch + best-effort staging cleanup.
   * Refs (not state) since the controllers themselves aren't rendered.
   */
  const enhanceAbortRef = useRef<Record<string, AbortController>>({});
  /** 2026-08-06 — batch uniformity chip. OFF by default; requires all
   *  enhance previews to be complete before it can be applied. */
  const [bulkUniformity, setBulkUniformity] = useState(false);
  /** 2026-08-06 — artist portfolio coherence chip. Default ON when
   *  sample_count >= 3, hidden when sample_count < 3. */
  const [portfolioCoherence, setPortfolioCoherence] = useState(false);
  const meteringSourceForBulk = fromExhibition ? "exhibition_bulk" : "bulk";
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

  const [titleBulkMode, setTitleBulkMode] = useState<"none" | "set" | "prefix" | "suffix" | "replace">("none");
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
  const [myExhibitions, setMyExhibitions] = useState<ExhibitionWithCredits[]>([]);
  const [linkExhibitionId, setLinkExhibitionId] = useState("");
  const [linkingExhibition, setLinkingExhibition] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const [stagedArtworkIds, setStagedArtworkIds] = useState<string[]>([]);

  // Persona / intent — from exhibition add: pre-fill CURATED + artist, skip intent/attribution steps
  const [intent, setIntent] = useState<IntentType | null>(
    fromExhibition && addToExhibitionId ? "CURATED" : null
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
  const [preselectedExternalArtistId, setPreselectedExternalArtistId] = useState<string | null>(null);
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
  const [externalNoEmail, setExternalNoEmail] = useState(false);
  const [periodStatus, setPeriodStatus] = useState<"past" | "current" | "future">("current");
  /** Attribution 단계를 '다음' 버튼으로 완료했을 때만 true. 전시에서 진입 시 작가/외부 이미 선택됨 → 바로 업로드 단계. */
  const [attributionStepDone, setAttributionStepDone] = useState(
    !!(fromExhibition && addToExhibitionId && (preselectedArtistId || preselectedExternalName))
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
      const arr = incoming.filter((f) => f.type.startsWith("image/"));
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

      const toastHint = { full: false, partialAdded: null as number | null };
      setPendingFiles((prev) => {
        const remaining = BULK_MAX_FILES_PER_BATCH - prev.length;
        if (remaining <= 0) {
          toastHint.full = true;
          return prev;
        }
        const batch = ok.slice(0, remaining);
        if (ok.length > remaining) {
          toastHint.partialAdded = batch.length;
        }
        return [...prev, ...batch.map((file) => ({ id: crypto.randomUUID(), file }))];
      });

      if (toastHint.full) {
        setToast(t("bulk.pendingQueueFull"));
        setTimeout(() => setToast(null), 4000);
      } else if (toastHint.partialAdded != null) {
        setToast(
          t("bulk.batchCapPartialAdd")
            .replace("{added}", String(toastHint.partialAdded))
            .replace("{max}", String(BULK_MAX_FILES_PER_BATCH)),
        );
        setTimeout(() => setToast(null), 5000);
      }
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

  function addPendingFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    enqueuePendingImageFiles(Array.from(files));
  }

  function removePendingFile(id: string) {
    // 2026-08-06 — abort any inflight enhance on this row. The
    // processOne handler surfaces the abort as `rejected`, and the
    // objectClient does a best-effort `cleanupStagingPath` for us.
    const inflight = enhanceAbortRef.current[id];
    if (inflight) {
      try {
        inflight.abort();
      } catch {}
      delete enhanceAbortRef.current[id];
    }
    setPendingFiles((prev) => prev.filter((p) => p.id !== id));
    setPendingSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setPendingEnhance((prev) => {
      const existing = prev[id];
      if (!existing) return prev;
      if (existing.kind === "previewing" || existing.kind === "approved") {
        try {
          URL.revokeObjectURL(existing.draft.previewUrl);
        } catch {}
        if (existing.enhancedPath) {
          void cleanupEnhancedPath(existing.enhancedPath);
        }
      }
      const clone = { ...prev };
      delete clone[id];
      return clone;
    });
  }

  function clearPendingFiles() {
    // Best-effort cleanup of any inflight enhanced blobs / staged paths.
    for (const [, status] of Object.entries(pendingEnhance)) {
      if (status.kind === "previewing" || status.kind === "approved") {
        try {
          URL.revokeObjectURL(status.draft.previewUrl);
        } catch {}
        if (status.enhancedPath) {
          void cleanupEnhancedPath(status.enhancedPath);
        }
      }
    }
    setPendingFiles([]);
    setPendingSelected(new Set());
    setPendingEnhance({});
  }

  function togglePendingSelected(id: string) {
    setPendingSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllPending() {
    setPendingSelected(new Set(pendingFiles.map((p) => p.id)));
  }

  function clearPendingSelection() {
    setPendingSelected(new Set());
  }

  async function enhanceSelectedPending() {
    if (bulkEnhanceRunning) return;
    const ids = pendingFiles
      .filter((p) => pendingSelected.has(p.id))
      .map((p) => p.id);
    if (ids.length === 0) {
      setToast(t("bulk.enhance.selectFirst"));
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const { data: { session } } = await getSession();
    if (!session?.user?.id) {
      setUploadError(t("bulk.uploadNotAuthenticated"));
      return;
    }
    const userId = session.user.id;
    const exhibitionScopedId = addToExhibitionId ?? null;
    setBulkEnhanceRunning(true);
    setPendingEnhance((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { kind: "processing" };
      return next;
    });

    const queue = pendingFiles.filter((p) => ids.includes(p.id));
    const CONCURRENCY = 2;
    let nextIdx = 0;

    const processOne = async (slot: { id: string; file: File }) => {
      const { id, file } = slot;
      // 2026-08-06 — abort plumbing. One controller per pending file.
      // Reject / removePendingFile aborts it; the in-flight fetch is
      // cancelled and the server route sees `req.signal.aborted`.
      const controller = new AbortController();
      enhanceAbortRef.current[id] = controller;
      void recordUsageEvent({
        userId,
        key: USAGE_KEYS.AI_IMAGE_ENHANCE_REQUESTED,
        featureKey: "ai.image_enhance",
        metadata: {
          mode: bulkEnhanceMode,
          provider: "auto",
          source: meteringSourceForBulk,
          latency_ms: null,
        },
      });
      let resolvedMode: EnhancementMode = bulkEnhanceMode;
      if (bulkEnhanceMode === "auto") {
        try {
          const analysis = await analyzeImageFile(file);
          resolvedMode = analysis.mode === "flat" ? "flat" : "object";
        } catch {
          resolvedMode = "object";
        }
      }
      const startedAt = performance.now();
      try {
        if (resolvedMode === "flat") {
          // Bulk clamps `maxLongEdge` to 2560 to keep concurrency-2
          // enhance passes from OOMing mobile Safari on 4K captures.
          // Single upload still uses the full 4096 cap (one image at
          // a time is safe).
          const result = await runFlatEnhancement({
            file,
            maxLongEdge: 2560,
            signal: controller.signal,
          });
          if (!result.blob) {
            // See localFlatEngine.RunFlatResult.blob — null means the
            // pipeline bailed out and we must not wrap the raw source
            // bytes in a `.webp` File.
            throw new Error(result.stageError ?? "local_pipeline_error");
          }
          const displayFile = flatBlobToFile(file.name, result.blob);
          const url = URL.createObjectURL(displayFile);
          const sourceHash = await computeFileSha256(file);
          const draft: EnhancementDraft = {
            displayFile,
            previewUrl: url,
            meta: {
              provider: "local_opencv",
              mode: bulkEnhanceMode,
              recipe: { kind: "flat", params: result.recipe },
              confidence: result.confidence,
              sourceHashSha256: sourceHash,
              processedAtIso: new Date().toISOString(),
              latencyMs: result.latencyMs,
              versions: {
                schema: ENHANCEMENT_META_SCHEMA_VERSION,
                engine: "local_canvas_v1",
              },
            },
          };
          setPendingEnhance((prev) => ({
            ...prev,
            [id]: { kind: "previewing", draft },
          }));
          void recordUsageEvent({
            userId,
            key: USAGE_KEYS.AI_IMAGE_ENHANCE_COMPLETED,
            featureKey: "ai.image_enhance",
            metadata: {
              mode: bulkEnhanceMode,
              provider: "local_opencv",
              source: meteringSourceForBulk,
              latency_ms: Math.round(performance.now() - startedAt),
              stage_decode_ms: result.stageTimings.decodeMs,
              stage_tone_ms: result.stageTimings.toneMs,
              stage_sharpen_ms: result.stageTimings.sharpenMs,
              stage_encode_ms: result.stageTimings.encodeMs,
            },
          });
        } else {
          // Object hybrid — server route. Upload to per-user staging,
          // request enhancement, keep the server path in status so
          // reject/cleanup can nuke it.
          const scope = exhibitionScopedId
            ? { kind: "exhibition" as const, exhibitionId: exhibitionScopedId }
            : { kind: "user" as const, userId };
          const stagingPath = await uploadStagingForEnhancement(
            file,
            scope,
            controller.signal,
          );
          const result = await requestObjectEnhancement({
            inputStoragePath: stagingPath,
            exhibitionId: exhibitionScopedId,
            mode: bulkEnhanceMode,
            signal: controller.signal,
          });
          // The server returns a public path; render a preview via getPublicUrl.
          const { getPublicImageUrl } = await import("@/lib/supabase/storage");
          const url = getPublicImageUrl(result.enhancedPath);
          const draft: EnhancementDraft = {
            // Server pipeline — no local displayFile. We build a stub
            // File so downstream typing is preserved; the upload step
            // switches to preparedDisplayPath.
            displayFile: new File([], `${file.name}.enhanced.webp`, {
              type: "image/webp",
            }),
            previewUrl: url,
            meta: result.meta,
          };
          setPendingEnhance((prev) => ({
            ...prev,
            [id]: {
              kind: "previewing",
              draft,
              enhancedPath: result.enhancedPath,
              exhibitionScoped: !!exhibitionScopedId,
            },
          }));
          void recordUsageEvent({
            userId,
            key: USAGE_KEYS.AI_IMAGE_ENHANCE_COMPLETED,
            featureKey: "ai.image_enhance",
            metadata: {
              mode: bulkEnhanceMode,
              provider: "photoroom_hybrid",
              source: meteringSourceForBulk,
              latency_ms: result.latencyMs,
            },
          });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "error";
        // User-initiated abort → surface as "rejected", not "failed".
        const wasAborted = controller.signal.aborted || reason === "aborted";
        setPendingEnhance((prev) => ({
          ...prev,
          [id]: wasAborted ? { kind: "rejected" } : { kind: "failed", reason },
        }));
        void recordUsageEvent({
          userId,
          key: wasAborted
            ? USAGE_KEYS.AI_IMAGE_ENHANCE_REJECTED
            : USAGE_KEYS.AI_IMAGE_ENHANCE_FAILED,
          featureKey: "ai.image_enhance",
          metadata: {
            mode: bulkEnhanceMode,
            provider: resolvedMode === "flat" ? "local_opencv" : "photoroom_hybrid",
            source: meteringSourceForBulk,
            reason: wasAborted ? "aborted" : reason,
            latency_ms: Math.round(performance.now() - startedAt),
          },
        });
      } finally {
        delete enhanceAbortRef.current[id];
      }
    };

    const worker = async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= queue.length) return;
        await processOne(queue[idx]);
      }
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker());
    await Promise.all(workers);
    setBulkEnhanceRunning(false);
  }

  function approveEnhancement(id: string) {
    setPendingEnhance((prev) => {
      const current = prev[id];
      if (!current || current.kind !== "previewing") return prev;
      void recordUsageEvent({
        key: USAGE_KEYS.AI_IMAGE_ENHANCE_ACCEPTED,
        featureKey: "ai.image_enhance",
        metadata: {
          mode: current.draft.meta.mode,
          provider: current.draft.meta.provider,
          source: meteringSourceForBulk,
          latency_ms: current.draft.meta.latencyMs,
        },
      });
      return {
        ...prev,
        [id]: {
          kind: "approved",
          draft: current.draft,
          enhancedPath: current.enhancedPath,
          exhibitionScoped: current.exhibitionScoped,
        },
      };
    });
  }

  function rejectEnhancement(id: string) {
    // Abort any inflight fetch for this row before flipping state.
    const inflight = enhanceAbortRef.current[id];
    if (inflight) {
      try {
        inflight.abort();
      } catch {}
      delete enhanceAbortRef.current[id];
    }
    setPendingEnhance((prev) => {
      const current = prev[id];
      if (!current) return prev;
      if (current.kind === "previewing" || current.kind === "approved") {
        try {
          URL.revokeObjectURL(current.draft.previewUrl);
        } catch {}
        if (current.enhancedPath) {
          void cleanupEnhancedPath(current.enhancedPath);
        }
        void recordUsageEvent({
          key: USAGE_KEYS.AI_IMAGE_ENHANCE_REJECTED,
          featureKey: "ai.image_enhance",
          metadata: {
            mode: current.draft.meta.mode,
            provider: current.draft.meta.provider,
            source: meteringSourceForBulk,
            latency_ms: current.draft.meta.latencyMs,
          },
        });
      }
      return { ...prev, [id]: { kind: "rejected" } };
    });
    // Also make sure the staging path (if any) is cleaned. `enhancedPath` above
    // handles the server output; staging paths are cleaned by the server
    // route itself on completion (so no extra work required here).
    void cleanupStagingPath(null);
  }

  async function startUpload() {
    if (pendingFiles.length === 0) return;
    const { data: { session } } = await getSession();
    if (!session?.user?.id) {
      setUploadError(t("bulk.uploadNotAuthenticated"));
      return;
    }
    const userId = session.user.id;
    setUploadError(null);
    setUploading(true);
    setUploadTotal(pendingFiles.length);
    setUploadCurrent(0);
    setUploadSucceeded(0);
    setUploadFailures([]);
    const queue = [...pendingFiles];
    setPendingFiles([]);
    const uploadedIds: string[] = [];
    const failures: { name: string; message: string }[] = [];

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
      const enhanceStatus = pendingEnhance[slotId];
      const approvedEnhancement =
        enhanceStatus && enhanceStatus.kind === "approved" ? enhanceStatus : null;
      const title = deriveTitle(file.name);
      let artworkId: string | null = null;
      let uploadResult: Awaited<ReturnType<typeof uploadArtworkImage>> | null = null;
      try {
        const { data: id, error: createErr } = await createDraftArtwork(
          { title },
          { forProfileId: actingAsProfileId ?? undefined }
        );
        if (createErr || !id) {
          throw createErr instanceof Error ? createErr : new Error("Failed to create draft");
        }
        artworkId = id;
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
        uploadResult = await uploadArtworkImage(file, storageOwner, {
          preparedDisplayFile:
            approvedEnhancement && !approvedEnhancement.enhancedPath
              ? approvedEnhancement.draft.displayFile
              : null,
          preparedDisplayPath: approvedEnhancement?.enhancedPath ?? null,
          enhancementMeta: approvedEnhancement?.draft.meta ?? null,
        });
        // QA 2026-07-28: bulk uploads never silently auto-apply tone or
        // crop; DisplayAdjust stays null. Enhancement, when approved,
        // flows through `enhancement_meta` instead.
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
            enhancementMeta: approvedEnhancement?.draft.meta ?? null,
          },
        );
        if (attachErr) throw attachErr;
        uploadedIds.push(artworkId);
        setUploadSucceeded((n) => n + 1);
      } catch (err) {
        const message = formatBulkFileUploadFailure(file.name, err, t);
        // Surface the latest failure prominently AND keep a per-file log
        // so the user can fix and retry exactly the failed entries.
        setUploadError(message);
        failures.push({ name: file.name, message });
        setUploadFailures([...failures]);
        if (uploadResult?.displayPath) {
          try { await removeStorageFile(uploadResult.displayPath); } catch {}
        }
        if (uploadResult?.originalPath) {
          try { await removeStorageFile(uploadResult.originalPath); } catch {}
        }
        if (artworkId) {
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

    setUploading(false);
    if (uploadedIds.length > 0) {
      setStagedArtworkIds((prev) => [...uploadedIds, ...prev].slice(0, BULK_WEBSITE_STAGED_IDS_MAX));
    }
    await fetchDrafts();
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
    else if (field === "medium") payload.medium = String(value ?? "");
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
      await updateArtwork(
        id,
        { title: next || d?.title || "Untitled" },
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

  function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQ = !inQ;
        continue;
      }
      if (!inQ && c === ",") {
        out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += c;
    }
    out.push(cur.trim());
    return out;
  }

  async function importCsvDrafts() {
    const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      setToast(t("bulk.csvRequiredTitle"));
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const ti = header.findIndex((h) => h === "title" || h === "name");
    if (ti < 0) {
      setToast(t("bulk.csvRequiredTitle"));
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const yi = header.findIndex((h) => h === "year");
    const mi = header.findIndex((h) => h === "medium");
    setCsvBusy(true);
    try {
      let ok = 0;
      for (let r = 1; r < lines.length; r++) {
        const cells = parseCsvLine(lines[r]);
        const title = (cells[ti] ?? "").trim() || "Untitled";
        const yearRaw = yi >= 0 ? cells[yi] : "";
        const year = yearRaw ? parseInt(yearRaw, 10) : null;
        const medium = mi >= 0 ? (cells[mi] ?? "").trim() || null : null;
        const { data: id, error } = await createDraftArtwork(
          { title },
          { forProfileId: actingAsProfileId ?? undefined }
        );
        if (!error && id) {
          const patch: UpdateArtworkPayload = {};
          if (Number.isFinite(year as number)) patch.year = year as number;
          if (medium) patch.medium = medium;
          if (Object.keys(patch).length > 0) {
            await updateArtwork(id, patch, {
              actingSubjectProfileId: actingAsProfileId ?? null,
              auditAction: "bulk.artwork.update",
            });
          }
          ok += 1;
        }
      }
      setCsvText("");
      await fetchDrafts();
      setToast(t("bulk.csvImported").replace("{n}", String(ok)));
      setTimeout(() => setToast(null), 3000);
    } finally {
      setCsvBusy(false);
    }
  }

  async function handlePublish() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const toPublish = drafts.filter((d) => ids.includes(d.id));
    const invalid = toPublish.filter((d) => !validatePublish(d).ok);
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
          // Phase 3-4 (QA 2026-07): when the operator re-selected an
          // already-invited external artist from unified search, pass the
          // id straight through so the server RPC skips name-dedupe and
          // guarantees the exact same external_artists row is reused.
          externalArtistId: useExternalArtist ? preselectedExternalArtistId : null,
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
        const { results, firstError, error, inviteSent, inviteFailed } =
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
        if (inviteSent) {
          // QA 2026-07 Phase 2-2: replace fleeting 3s toast with a
          // dismissible confirmation card so the operator has a clear
          // record + one-click path to /my/artists.
          setInviteCard({
            kind: "sent",
            artistName: (useExternalArtist ? externalArtistName : "").trim() || t("upload.externalArtistNamePlaceholder"),
          });
          if (useExternalArtist && externalArtistEmail.trim()) {
            await sendArtistInviteEmailClient({
              toEmail: externalArtistEmail.trim(),
              artistName: externalArtistName.trim() || null,
              exhibitionTitle: null,
            });
          }
        } else if (inviteFailed) {
          setInviteCard({
            kind: "failed",
            artistName: (useExternalArtist ? externalArtistName : "").trim() || t("upload.externalArtistNamePlaceholder"),
          });
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
    if (field === "title") payload.title = String(value ?? "");
    else if (field === "year") payload.year = typeof value === "number" ? value : (parseInt(String(value), 10) || null);
    else if (field === "medium") payload.medium = String(value ?? "");
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

  const readyCount = drafts.filter((d) => validatePublish(d).ok).length;
  const selectedIds = Array.from(selected);
  const selectedReady = drafts.filter((d) => selectedIds.includes(d.id) && validatePublish(d).ok).length;
  const canPublishSelected = selectedIds.length > 0 && selectedReady === selectedIds.length;

  const externalNameValid = useExternalArtist && externalArtistName.trim().length >= 2;
  const externalEmailValid =
    externalNoEmail || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(externalArtistEmail.trim());
  const attributionValid =
    !needsAttribution || selectedArtist !== null || (externalNameValid && externalEmailValid);
  const showIntent = intent === null;
  const showAttribution = intent !== null && needsAttribution && !attributionStepDone;
  const showMain = intent !== null && (!needsAttribution || attributionStepDone);

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

  return (
    <AuthGate>
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

        {(showIntent || showAttribution) && (
          <div>
        {showIntent && (
          <div className="mb-8 space-y-4">
            <p className="text-sm text-zinc-600">{t("bulk.intentHint")}</p>
            <div className="grid gap-3">
              {INTENT_KEYS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setIntent(opt.value)}
                  className="group flex w-full items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white px-5 py-4 text-left font-medium text-zinc-900 transition-colors hover:border-zinc-300 hover:bg-zinc-50/70"
                >
                  <span>{t(opt.labelKey)}</span>
                  <span
                    aria-hidden
                    className="text-zinc-400 transition-colors group-hover:text-zinc-600"
                  >
                    →
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: Attribution (OWNS, INVENTORY, CURATED) */}
        {showAttribution && (
          <div className="mb-8 space-y-4">
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
                              });
                              setArtistResults([]);
                              setArtistSearch("");
                            }}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-zinc-50"
                          >
                            {formatDisplayName({
                              display_name: a.display_name,
                              username: a.username,
                            })}
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
                                  {a.display_name?.trim() || "—"}
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
                  setIntent(null);
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
          </div>
        )}

        {/* Main bulk UI */}
        {showMain && (
          <>
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
                : formatDisplayName(selectedArtist)
            }
            isExternal={useExternalArtist}
            externalEmail={useExternalArtist ? externalArtistEmail : null}
            hasPendingInviteForEmail={
              Boolean(preselectedExternalArtistId) || pendingInviteForEmail
            }
            onChange={() => {
              // Reset back to attribution step. Mirror the "back" button
              // in the attribution step to keep state hygiene consistent.
              setAttributionStepDone(false);
            }}
          />
        )}
        <BulkUploadGuidance t={t} pendingCount={pendingFiles.length} draftCount={drafts.length} />

        <div data-tour="upload-website-import">
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

        {/* Tips accordion */}
        <div className="mb-6 rounded-lg border border-zinc-200">
          <button
            type="button"
            onClick={() => setTipsOpen((o) => !o)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-zinc-900"
          >
            {t("bulk.tipsTitle")}
            <span className="text-zinc-500">{tipsOpen ? "−" : "+"}</span>
          </button>
          {tipsOpen && (
            <div className="border-t border-zinc-200 px-4 py-3 text-sm text-zinc-600 space-y-1">
              <p>• {t("bulk.tip1")}</p>
              <p>• {t("bulk.tip2")}</p>
              <p>• {t("bulk.tip3")}</p>
            </div>
          )}
        </div>

        {/* Dropzone */}
        <div
          className="mb-6 cursor-pointer rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50/70 px-6 py-12 text-center hover:border-zinc-400"
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
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => addPendingFiles(e.target.files)}
            disabled={uploading}
          />
          <p className="text-sm text-zinc-600">{t("bulk.dropzone")}</p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            {t("bulk.dropzoneHint")
              .replace("{batch}", String(BULK_MAX_FILES_PER_BATCH))
              .replace("{maxMb}", String(UPLOAD_MAX_COMPRESSIBLE_MB_LABEL))}
          </p>
        </div>

        {/* Pending files */}
        {pendingFiles.length > 0 && !uploading && (
          <div className="mb-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <h3 className="mb-2 text-sm font-medium">{t("bulk.pendingFiles")} ({pendingFiles.length})</h3>

            {/* Theo Image Enhance (Beta) — selection + mode + run bar */}
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2 text-xs">
              <button
                type="button"
                onClick={selectAllPending}
                className="rounded-full border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-50"
              >
                {t("bulk.enhance.selectAll")}
              </button>
              <button
                type="button"
                onClick={clearPendingSelection}
                className="rounded-full border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-50"
              >
                {t("bulk.enhance.clearSelection")}
              </button>
              <span className="text-zinc-500">
                {t("bulk.enhance.selectedCount").replace("{n}", String(pendingSelected.size))}
              </span>
              <div className="ml-2 flex items-center gap-1">
                {(["auto", "flat", "object"] as EnhancementMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setBulkEnhanceMode(m)}
                    className={`rounded-full border px-2 py-1 ${
                      bulkEnhanceMode === m
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                    }`}
                  >
                    {t(`upload.imageEnhance.mode.${m}`)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={enhanceSelectedPending}
                disabled={bulkEnhanceRunning || pendingSelected.size === 0}
                className="ml-auto rounded-full bg-zinc-900 px-3 py-1 font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {bulkEnhanceRunning
                  ? t("bulk.enhance.running")
                  : t("bulk.enhance.action")}
              </button>
            </div>

            {/* 2026-08-06 — Batch uniformity + portfolio coherence chips.
                Both are opt-in nudges applied to the final enhancement
                meta. Clamped to ±5 % / ±4 % respectively so the artist's
                creative intent is preserved.
                UI wired minimally in this patch — the deltas are stored
                on `enhancement_meta.batchNormalization` /
                `enhancement_meta.portfolioCoherence` when applied.
                Larger UI (per-row deltas panel) tracked in follow-up. */}
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2 text-xs">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={bulkUniformity}
                  onChange={(e) => setBulkUniformity(e.target.checked)}
                  className="h-3.5 w-3.5 accent-zinc-900"
                />
                <span className="font-medium text-zinc-800">
                  {t("bulk.enhance.uniformity")}
                </span>
                <span
                  className="text-zinc-500"
                  title={t("bulk.enhance.uniformityHint")}
                >
                  ({t("bulk.enhance.uniformityHint")})
                </span>
              </label>
              <label className="ml-3 flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={portfolioCoherence}
                  onChange={(e) => setPortfolioCoherence(e.target.checked)}
                  className="h-3.5 w-3.5 accent-zinc-900"
                />
                <span className="font-medium text-zinc-800">
                  {t("bulk.enhance.portfolioCoherence")}
                </span>
                <span
                  className="text-zinc-500"
                  title={t("bulk.enhance.portfolioCoherenceHint")}
                >
                  ({t("bulk.enhance.portfolioCoherenceHint")})
                </span>
              </label>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {pendingFiles.map(({ id, file }) => {
                // 2026-07-28 auto-compression — quiet chip: show the
                // pre-upload size so the operator can eyeball what's
                // about to happen. For compressible formats above ~5 MB
                // we hint that auto-compression will run, without being
                // preachy about it.
                const mb = file.size / (1024 * 1024);
                const compressible = isCompressibleMime(file.type);
                const willCompress = compressible && file.size > 5 * 1024 * 1024;
                const selected = pendingSelected.has(id);
                const enhance = pendingEnhance[id];
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 rounded bg-white px-2 py-1 text-sm text-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => togglePendingSelected(id)}
                      className="h-3.5 w-3.5 accent-zinc-900"
                      aria-label={t("bulk.enhance.selectFile")}
                    />
                    <span className="min-w-0 truncate">{file.name}</span>
                    <span className="text-[11px] text-zinc-400">
                      {mb < 0.1 ? "<0.1" : mb.toFixed(1)} MB
                    </span>
                    {willCompress && (
                      <span
                        className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                        title={t("upload.autoCompressHint")}
                      >
                        {t("upload.autoCompressChip")}
                      </span>
                    )}
                    {enhance?.kind === "processing" && (
                      <>
                        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                          {t("bulk.enhance.status.processing")}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const inflight = enhanceAbortRef.current[id];
                            if (inflight) {
                              try {
                                inflight.abort();
                              } catch {}
                            }
                          }}
                          className="rounded-full border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-50"
                          title={t("bulk.enhance.cancelRow")}
                          aria-label={t("bulk.enhance.cancelRow")}
                        >
                          ×
                        </button>
                      </>
                    )}
                    {enhance?.kind === "previewing" && (
                      <>
                        <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                          {t("bulk.enhance.status.previewing")}
                        </span>
                        <button
                          type="button"
                          onClick={() => approveEnhancement(id)}
                          className="rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-zinc-800"
                        >
                          {t("bulk.enhance.approve")}
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectEnhancement(id)}
                          className="rounded-full border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50"
                        >
                          {t("bulk.enhance.reject")}
                        </button>
                      </>
                    )}
                    {enhance?.kind === "approved" && (
                      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        {t("bulk.enhance.status.approved")}
                      </span>
                    )}
                    {enhance?.kind === "rejected" && (
                      <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                        {t("bulk.enhance.status.rejected")}
                      </span>
                    )}
                    {enhance?.kind === "failed" && (
                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title={enhance.reason}>
                        {t("bulk.enhance.status.failed")}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removePendingFile(id); }}
                      className="text-red-600 hover:text-red-800"
                      aria-label={t("bulk.removePending")}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={startUpload}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                {t("bulk.startUpload")} ({pendingFiles.length})
              </button>
              <button
                type="button"
                onClick={clearPendingFiles}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                {t("bulk.clear")}
              </button>
            </div>
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

        {/* Apply-to-all */}
        {drafts.length > 0 && (
          <div className="mb-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <h3 className="mb-3 text-sm font-medium">{t("bulk.applyToSelected")} / {t("bulk.applyToAll")}</h3>
            <div className="flex flex-wrap gap-3">
              <input
                type="number"
                placeholder={t("bulk.year")}
                className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm"
                onBlur={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) handleApply("year", v);
                }}
              />
              <input
                type="text"
                placeholder={t("bulk.medium")}
                className="w-40 rounded border border-zinc-300 px-2 py-1 text-sm"
                onBlur={(e) => handleApply("medium", e.target.value)}
              />
              <select
                className="rounded border border-zinc-300 px-2 py-1 text-sm"
                onChange={(e) => handleApply("ownership_status", e.target.value)}
              >
                <option value="">{t("bulk.ownershipStatus")}</option>
                {OWNERSHIP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                ))}
              </select>
              <select
                className="rounded border border-zinc-300 px-2 py-1 text-sm"
                onChange={(e) => handleApply("pricing_mode", e.target.value as "fixed" | "inquire")}
              >
                <option value="">{t("bulk.pricingMode")}</option>
                <option value="inquire">{t("bulk.inquire")}</option>
                <option value="fixed">{t("bulk.fixed")}</option>
              </select>
              <label className="flex items-center gap-1 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  onChange={(e) => handleApply("is_price_public", e.target.checked)}
                />
                {t("bulk.pricePublic")}
              </label>
            </div>
            <div className="mt-4 space-y-2 border-t border-zinc-200 pt-3">
              <p className="text-xs font-medium text-zinc-600">{t("bulk.applyTitleBulk")}</p>
              <div className="flex flex-wrap gap-2">
                <select
                  value={titleBulkMode}
                  onChange={(e) => setTitleBulkMode(e.target.value as typeof titleBulkMode)}
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                >
                  <option value="none">{t("bulk.titleModeNone")}</option>
                  <option value="set">{t("bulk.titleModeSet")}</option>
                  <option value="prefix">{t("bulk.titleModePrefix")}</option>
                  <option value="suffix">{t("bulk.titleModeSuffix")}</option>
                  <option value="replace">{t("bulk.titleModeReplace")}</option>
                </select>
                {titleBulkMode !== "replace" && titleBulkMode !== "none" && (
                  <input
                    value={titleBulkText}
                    onChange={(e) => setTitleBulkText(e.target.value)}
                    placeholder={titleBulkMode === "set" ? t("bulk.titleSetPlaceholder") : t("bulk.titleNewSegment")}
                    className="w-48 rounded border border-zinc-300 px-2 py-1 text-sm"
                  />
                )}
                {titleBulkMode === "replace" && (
                  <>
                    <input
                      value={titleReplaceFrom}
                      onChange={(e) => setTitleReplaceFrom(e.target.value)}
                      placeholder={t("bulk.titleReplaceFrom")}
                      className="w-36 rounded border border-zinc-300 px-2 py-1 text-sm"
                    />
                    <input
                      value={titleReplaceTo}
                      onChange={(e) => setTitleReplaceTo(e.target.value)}
                      placeholder={t("bulk.titleReplaceTo")}
                      className="w-36 rounded border border-zinc-300 px-2 py-1 text-sm"
                    />
                  </>
                )}
                <button
                  type="button"
                  disabled={titleBulkMode === "none"}
                  onClick={() =>
                    openBulkConfirm(
                      t("bulk.confirmDestructive").replace("{n}", String(targetDraftIds().length)),
                      runTitleBulk
                    )
                  }
                  className="rounded-full bg-zinc-800 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  {t("bulk.applyTitleBulk")}
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-200 pt-3">
              <input
                value={bulkSize}
                onChange={(e) => setBulkSize(e.target.value)}
                placeholder={t("bulk.size")}
                className="w-28 rounded border border-zinc-300 px-2 py-1 text-sm"
              />
              <select
                value={bulkSizeUnit}
                onChange={(e) => setBulkSizeUnit(e.target.value as "" | "cm" | "in")}
                className="rounded border border-zinc-300 px-2 py-1 text-sm"
              >
                <option value="">{t("bulk.sizeUnit")}</option>
                <option value="cm">cm</option>
                <option value="in">in</option>
              </select>
              <button
                type="button"
                onClick={() =>
                  openBulkConfirm(
                    t("bulk.confirmDestructive").replace("{n}", String(targetDraftIds().length)),
                    applySizeBulk
                  )
                }
                className="rounded-full border border-zinc-300 px-3 py-1 text-sm"
              >
                {t("bulk.applySize")}
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-200 pt-3">
              <input
                type="number"
                value={bulkPriceAmount}
                onChange={(e) => setBulkPriceAmount(e.target.value)}
                placeholder={t("bulk.fixedPrice")}
                className="w-32 rounded border border-zinc-300 px-2 py-1 text-sm"
              />
              <input
                value={bulkPriceCurrency}
                onChange={(e) => setBulkPriceCurrency(e.target.value)}
                placeholder={t("bulk.priceCurrency")}
                className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm"
              />
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={bulkPricePublic}
                  onChange={(e) => setBulkPricePublic(e.target.checked)}
                />
                {t("bulk.pricePublic")}
              </label>
              <button
                type="button"
                onClick={() =>
                  openBulkConfirm(
                    t("bulk.confirmDestructive").replace("{n}", String(targetDraftIds().length)),
                    applyPriceBulk
                  )
                }
                className="rounded-full border border-zinc-300 px-3 py-1 text-sm"
              >
                {t("bulk.applyPrice")}
              </button>
            </div>
            {myExhibitions.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3">
                <select
                  value={linkExhibitionId}
                  onChange={(e) => setLinkExhibitionId(e.target.value)}
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                >
                  <option value="">{t("bulk.exhibitionSelectorPlaceholder")}</option>
                  {myExhibitions.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!linkExhibitionId || linkingExhibition}
                  onClick={() =>
                    openBulkConfirm(
                      t("bulk.confirmDestructive").replace("{n}", String(targetDraftIds().length)),
                      linkSelectedToExhibition
                    )
                  }
                  className="rounded-full bg-zinc-800 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  {t("bulk.linkToExhibition")}
                </button>
                <button
                  type="button"
                  disabled={!linkExhibitionId || linkingExhibition}
                  onClick={() =>
                    openBulkConfirm(
                      t("bulk.confirmDestructive").replace("{n}", String(targetDraftIds().length)),
                      unlinkSelectedFromExhibition
                    )
                  }
                  className="rounded-full border border-red-200 px-3 py-1 text-sm text-red-800 disabled:opacity-50"
                >
                  {t("bulk.unlinkFromExhibition")}
                </button>
              </div>
            )}
            <div className="mt-4 border-t border-zinc-200 pt-3">
              <p className="mb-2 text-xs font-medium text-zinc-700">{t("bulk.csvTitle")}</p>
              <p className="mb-2 text-xs text-zinc-500">{t("bulk.csvHint")}</p>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={t("bulk.csvPlaceholder")}
                rows={5}
                className="mb-2 w-full rounded border border-zinc-300 px-2 py-1 font-mono text-xs"
              />
              <button
                type="button"
                disabled={csvBusy}
                onClick={() => void importCsvDrafts()}
                className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {csvBusy ? "…" : t("bulk.csvImport")}
              </button>
            </div>
          </div>
        )}

        {pendingBulk && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
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
        )}

        {/* Publish + Delete panel */}
        {drafts.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3">
            <span className="text-sm">
              {t("bulk.readyToPublish")
                .replace("{ready}", String(selectedIds.length > 0 ? selectedReady : readyCount))
                .replace("{total}", String(selectedIds.length > 0 ? selectedIds.length : drafts.length))}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={selectedIds.length === 0 || deleting}
                className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {t("bulk.deleteSelected")}
              </button>
              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={deleting}
                className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {t("bulk.deleteAll")}
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={!canPublishSelected || publishing}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {t("bulk.publishSelected")}
              </button>
            </div>
          </div>
        )}

        {toast && (
          <div className="fixed bottom-4 right-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        )}

        {/* Draft list */}
        {loading ? (
          <p className="text-zinc-600">{t("common.loading")}</p>
        ) : drafts.length === 0 ? (
          <p className="py-12 text-center text-zinc-600">{t("bulk.noDrafts")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="p-2 text-left">
                    <input
                      type="checkbox"
                      checked={drafts.length > 0 && selected.size === drafts.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="p-2 text-left"> </th>
                  <th className="min-w-[220px] p-2 text-left">{t("bulk.tableTitle")}</th>
                  <th className="p-2 text-left">{t("bulk.year")}</th>
                  <th className="p-2 text-left">{t("bulk.medium")}</th>
                  <th className="p-2 text-left">{t("bulk.size")}</th>
                  <th className="p-2 text-left">{t("bulk.ownershipStatus")}</th>
                  <th className="p-2 text-left">{t("bulk.pricingMode")}</th>
                  <th className="p-2 text-left">{t("bulk.status")}</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => {
                  const val = validatePublish(d);
                  const img = (d.artwork_images ?? [])[0];
                  const thumb = img ? getArtworkImageUrl(img.storage_path, "thumb") : null;
                  return (
                    <tr key={`${d.id}-${bulkVersion}`} className="border-b border-zinc-100">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selected.has(d.id)}
                          onChange={() => toggleSelect(d.id)}
                        />
                      </td>
                      <td className="p-2">
                        <div className="h-12 w-12 overflow-hidden rounded bg-zinc-200">
                          {thumb ? (
                            <Image src={thumb} alt="" width={48} height={48} sizes="48px" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-zinc-400 text-xs">—</div>
                          )}
                        </div>
                      </td>
                      <td className="min-w-[220px] p-2">
                        <input
                          type="text"
                          defaultValue={d.title ?? ""}
                          className="w-full min-w-[200px] rounded border border-zinc-300 px-2 py-1"
                          onBlur={(e) => updateDraftField(d.id, "title", e.target.value)}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          defaultValue={d.year ?? ""}
                          placeholder="—"
                          className="w-20 rounded border border-zinc-300 px-2 py-1"
                          onBlur={(e) => updateDraftField(d.id, "year", e.target.value ? parseInt(e.target.value, 10) : null)}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          defaultValue={d.medium ?? ""}
                          placeholder="—"
                          className="w-32 rounded border border-zinc-300 px-2 py-1"
                          onBlur={(e) => updateDraftField(d.id, "medium", e.target.value)}
                        />
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            defaultValue={d.size ?? ""}
                            placeholder="—"
                            className="w-24 rounded border border-zinc-300 px-2 py-1"
                            onBlur={(e) => updateDraftField(d.id, "size", e.target.value)}
                          />
                          <select
                            defaultValue={d.size_unit ?? ""}
                            className="rounded border border-zinc-300 px-1 py-1"
                            onChange={(e) => updateDraftField(d.id, "size_unit", e.target.value || null)}
                          >
                            <option value="">—</option>
                            <option value="cm">cm</option>
                            <option value="in">in</option>
                          </select>
                        </div>
                      </td>
                      <td className="p-2">
                        <select
                          defaultValue={d.ownership_status ?? ""}
                          className="rounded border border-zinc-300 px-2 py-1"
                          onChange={(e) => updateDraftField(d.id, "ownership_status", e.target.value || null)}
                        >
                          <option value="">—</option>
                          {OWNERSHIP_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <select
                          defaultValue={d.pricing_mode ?? ""}
                          className="rounded border border-zinc-300 px-2 py-1"
                          onChange={(e) => updateDraftField(d.id, "pricing_mode", e.target.value || null)}
                        >
                          <option value="">—</option>
                          <option value="inquire">{t("bulk.inquire")}</option>
                          <option value="fixed">{t("bulk.fixed")}</option>
                        </select>
                      </td>
                      <td className="p-2">
                        {val.ok ? (
                          <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">{t("bulk.statusReady")}</span>
                        ) : (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800" title={val.missing.join(", ")}>
                            {t("bulk.missing")}: {val.missing.join(", ")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </>
        )}
        <BetaFeedbackPrompt pageKey="bulk_upload" />
      </div>
    </AuthGate>
  );
}
