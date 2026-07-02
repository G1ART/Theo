"use client";

import { useCallback, useEffect, useState } from "react";
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
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { searchPeople } from "@/lib/supabase/artists";
import { AuthGate } from "@/components/AuthGate";
import { useActingAs } from "@/context/ActingAsContext";
import { ActingAsChip } from "@/components/ActingAsChip";
import { useT } from "@/lib/i18n/useT";
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
import { BetaFeedbackPrompt } from "@/components/beta";
import { formatBulkFileUploadFailure } from "@/lib/upload/formatUploadError";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { logSupabaseError } from "@/lib/supabase/errors";
import {
  BULK_MAX_FILES_PER_BATCH,
  BULK_MY_DRAFTS_QUERY_LIMIT,
  BULK_WEBSITE_STAGED_IDS_MAX,
  UPLOAD_MAX_IMAGE_BYTES,
  UPLOAD_MAX_IMAGE_MB_LABEL,
} from "@/lib/upload/limits";

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
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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
  const [artistResults, setArtistResults] = useState<ArtistOption[]>([]);
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
  const [externalArtistEmail, setExternalArtistEmail] = useState(preselectedExternalEmail ?? "");
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
    const { data } = await searchPeople({ q, roles: ["artist"], limit: 10 });
    setArtistResults((data ?? []).map((p) => ({ id: p.id, username: p.username, display_name: p.display_name })));
    setSearching(false);
  }, [artistSearch]);

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
      const ok = arr.filter((f) => f.size <= UPLOAD_MAX_IMAGE_BYTES);
      const skipped = arr.length - ok.length;
      if (skipped > 0) {
        setUploadError(
          t("bulk.filesSkippedOversized")
            .replace("{n}", String(skipped))
            .replace("{maxMb}", String(UPLOAD_MAX_IMAGE_MB_LABEL)),
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
    setPendingFiles((prev) => prev.filter((p) => p.id !== id));
  }

  function clearPendingFiles() {
    setPendingFiles([]);
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
      const { file } = slot;
      const title = deriveTitle(file.name);
      let artworkId: string | null = null;
      let storagePath: string | null = null;
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
        storagePath = await uploadArtworkImage(file, storageOwner);
        const { error: attachErr } = await attachArtworkImage(artworkId, storagePath);
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
        if (storagePath) {
          try { await removeStorageFile(storagePath); } catch {}
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
          externalArtistEmail: useExternalArtist ? externalArtistEmail.trim() || null : null,
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
          setToast(t("upload.inviteSent"));
          setTimeout(() => setToast(null), 3000);
          if (useExternalArtist && externalArtistEmail.trim()) {
            await sendArtistInviteEmailClient({
              toEmail: externalArtistEmail.trim(),
              artistName: externalArtistName.trim() || null,
              exhibitionTitle: null,
            });
          }
        } else if (inviteFailed) {
          setToast(t("upload.inviteSentFailed"));
          setTimeout(() => setToast(null), 3000);
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
        if (addToExhibitionId) {
          router.push(`/my/exhibitions/${addToExhibitionId}`);
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
                  }
                }}
                className="text-sm text-zinc-600 underline hover:text-zinc-900"
              >
                {useExternalArtist ? t("upload.searchArtist") : t("upload.inviteByEmail")}
              </button>
            </div>
            {useExternalArtist ? (
              <div className="space-y-3">
                <input
                  type="text"
                  value={externalArtistName}
                  onChange={(e) => setExternalArtistName(e.target.value)}
                  placeholder={t("upload.externalArtistNamePlaceholder")}
                  className="w-full max-w-md rounded border border-zinc-300 px-3 py-2 text-sm"
                />
                <input
                  type="email"
                  value={externalArtistEmail}
                  onChange={(e) => setExternalArtistEmail(e.target.value)}
                  placeholder={t("upload.externalArtistEmailPlaceholder")}
                  disabled={externalNoEmail}
                  className="w-full max-w-md rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-400"
                />
                <p className="text-xs text-zinc-500">{t("upload.externalArtistEmailHint")}</p>
                <label className="flex max-w-md items-start gap-2 text-xs text-zinc-600">
                  <input
                    type="checkbox"
                    checked={externalNoEmail}
                    onChange={(e) => setExternalNoEmail(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>{t("upload.externalArtistNoEmail")}</span>
                </label>
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
                  <ul className="max-w-md rounded border border-zinc-200 bg-white">
                    {artistResults.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedArtist(a);
                            setArtistResults([]);
                            setArtistSearch("");
                          }}
                          className="w-full px-4 py-2 text-left text-sm hover:bg-zinc-50"
                        >
                          {formatDisplayName(a)}
                          {a.username && <span className="ml-2 text-zinc-500">{formatUsername(a)}</span>}
                        </button>
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
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
          </div>
        )}

        {/* Main bulk UI */}
        {showMain && (
          <>
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
              .replace("{maxMb}", String(UPLOAD_MAX_IMAGE_MB_LABEL))}
          </p>
        </div>

        {/* Pending files */}
        {pendingFiles.length > 0 && !uploading && (
          <div className="mb-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <h3 className="mb-2 text-sm font-medium">{t("bulk.pendingFiles")} ({pendingFiles.length})</h3>
            <div className="mb-3 flex flex-wrap gap-2">
              {pendingFiles.map(({ id, file }) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-sm text-zinc-700"
                >
                  {file.name}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removePendingFile(id); }}
                    className="text-red-600 hover:text-red-800"
                    aria-label={t("bulk.removePending")}
                  >
                    ×
                  </button>
                </span>
              ))}
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
