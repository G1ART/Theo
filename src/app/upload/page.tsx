"use client";

import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, sendMagicLink } from "@/lib/supabase/auth";
import {
  attachArtworkImage,
  createArtwork,
  deleteArtwork,
  getArtworkImageUrl,
  type ArtworkImageViewType,
  type CreateArtworkPayload,
} from "@/lib/supabase/artworks";
import { removeStorageFile, uploadArtworkImage } from "@/lib/supabase/storage";
import { searchPeopleWithExternal, type SearchPeopleWithExternalResult } from "@/lib/supabase/artists";
import {
  createClaimForExistingArtist,
  createExternalArtistAndClaim,
  searchWorksForDedup,
} from "@/lib/provenance/rpc";
import { externalArtistEmailExists } from "@/lib/provenance/externalArtists";
import type { ClaimType } from "@/lib/provenance/types";
import { setArtworkBack } from "@/lib/artworkBack";
import { addWorkToExhibition } from "@/lib/supabase/exhibitions";
import { logSupabaseError } from "@/lib/supabase/errors";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { AuthGate } from "@/components/AuthGate";
import { useActingAs } from "@/context/ActingAsContext";
import { ActingAsChip } from "@/components/ActingAsChip";
import { PageShellSkeleton } from "@/components/ds/PageShellSkeleton";
import {
  ImageStandardizeEditor,
  type EnhancementDraft,
} from "@/components/upload/ImageStandardizeEditor";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import { AttributionContextBanner } from "@/components/upload/AttributionContextBanner";
import { InviteResultCard } from "@/components/upload/InviteResultCard";
import type { DisplayAdjust } from "@/lib/image/displayAdjust";
import { useT } from "@/lib/i18n/useT";
import { BilingualFieldPair } from "@/components/i18n/BilingualFieldPair";
import { RomanizationHintChip } from "@/components/i18n/RomanizationHintChip";
import { AiTranslationDraftButton } from "@/components/i18n/AiTranslationDraftButton";
import { pickLegacyForSave } from "@/lib/i18n/pickLocalized";
import { sendArtistInviteEmailClient } from "@/lib/email/artistInvite";
import { findHosuSize } from "@/lib/size/hosu";
import { parseSizeWithUnit, setSizeUnitSuffix, type SizeUnit } from "@/lib/size/format";
import { TAXONOMY } from "@/lib/profile/taxonomy";
import { getAndClearPendingExhibitionFiles } from "@/lib/pendingExhibitionUpload";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";
import {
  UPLOAD_MAX_IMAGE_MB_LABEL,
  UPLOAD_MAX_COMPRESSIBLE_MB_LABEL,
  getUploadCeilingBytes,
} from "@/lib/upload/limits";
import { isCompressibleMime } from "@/lib/image/compress";
import { formatSingleUploadFailure } from "@/lib/upload/formatUploadError";

type UploadStep = "intent" | "attribution" | "form" | "dedup";

type IntentType = "CREATED" | "OWNS" | "INVENTORY" | "CURATED";

const INTENTS: { value: IntentType; labelKey: string }[] = [
  { value: "CREATED", labelKey: "upload.claimCreated" },
  { value: "OWNS", labelKey: "upload.claimOwned" },
  { value: "INVENTORY", labelKey: "upload.claimInventory" },
  { value: "CURATED", labelKey: "upload.claimCurated" },
];

const OWNERSHIP_STATUSES = [
  { value: "available", labelKey: "upload.ownershipAvailable" },
  { value: "owned", labelKey: "upload.ownershipOwned" },
  { value: "sold", labelKey: "upload.ownershipSold" },
  { value: "not_for_sale", labelKey: "upload.ownershipNotForSale" },
] as const;

const PRICING_MODES = [
  { value: "fixed", labelKey: "bulk.fixed" },
  { value: "inquire", labelKey: "bulk.inquire" },
] as const;

const PRICE_CURRENCIES = [
  { value: "USD", label: "USD" },
  { value: "KRW", label: "KRW" },
] as const;

type ArtistOption = { id: string; username: string | null; display_name: string | null };

function UploadPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const addToExhibitionId = searchParams.get("addToExhibition");
  const fromExhibition = searchParams.get("from") === "exhibition";
  const preselectedArtistId = searchParams.get("artistId");
  const preselectedArtistName = searchParams.get("artistName");
  const preselectedArtistUsername = searchParams.get("artistUsername");
  const preselectedExternalName = searchParams.get("externalName");
  const preselectedExternalEmail = searchParams.get("externalEmail");
  const preservedFromBoard = searchParams.get("fromBoard");
  const { t, locale } = useT();
  const { actingAsProfileId } = useActingAs();
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState<UploadStep>(fromExhibition ? "form" : "intent");
  const [intent, setIntent] = useState<IntentType | null>(fromExhibition ? "CURATED" : null);

  // Attribution (non-CREATED)
  const [artistSearch, setArtistSearch] = useState("");
  // Phase 3 (QA 2026-07): unified search results (profile + external).
  const [artistResults, setArtistResults] = useState<SearchPeopleWithExternalResult[]>([]);
  /**
   * Phase 3-4: preselected external artist id when the operator re-selected
   * an already-invited artist. Forwarded straight to the create claim RPC
   * so the same external_artists row is reused (no duplicate email).
   */
  const [preselectedExternalArtistId, setPreselectedExternalArtistId] = useState<string | null>(null);
  const [reselectedExternalMeta, setReselectedExternalMeta] = useState<
    { worksCount: number; latestCovers: string[] } | null
  >(null);
  /**
   * QA 2026-07-28 Phase B: PII-safe "이 이메일로 이미 초대된 외부 작가가
   * 있어요" 감지. 배너 chip 으로 노출해 큐레이터가 새 초대장이 발송된다고
   * 오해하지 않고 기존 계정에 연결된다는 사실을 이해하게 함.
   */
  const [pendingInviteForEmail, setPendingInviteForEmail] = useState(false);
  const [selectedArtist, setSelectedArtist] = useState<ArtistOption | null>(
    preselectedArtistId
      ? {
          id: preselectedArtistId,
          username: preselectedArtistUsername,
          display_name: preselectedArtistName,
        }
      : null
  );
  const [searching, setSearching] = useState(false);
  const [useExternalArtist, setUseExternalArtist] = useState(
    !!preselectedExternalName && !preselectedArtistId
  );
  const [externalArtistName, setExternalArtistName] = useState(preselectedExternalName ?? "");
  /**
   * QA 2026-07-28 — external_artists KO/EN 슬롯 (240005 SECTION 2/3).
   * 큐레이터/기획자가 두 언어를 모두 남기면 온보딩 시 profile.display_name_ko/en
   * 으로도 상속된다 (240005 SECTION 5). URL query 는 legacy `externalName`
   * 하나만 실어 나르므로 primary 언어 슬롯에 seed 하고, 사용자가 필요하면
   * 다른 언어를 추가한다.
   */
  const preselectedIsHangul = /[가-힯]/.test(preselectedExternalName ?? "");
  const [externalArtistNameKo, setExternalArtistNameKo] = useState(
    preselectedIsHangul ? preselectedExternalName ?? "" : "",
  );
  const [externalArtistNameEn, setExternalArtistNameEn] = useState(
    preselectedIsHangul ? "" : preselectedExternalName ?? "",
  );
  const [externalArtistEmail, setExternalArtistEmail] = useState(preselectedExternalEmail ?? "");
  // QA 2026-07-29 (Part A.5) — opt-in consent for Theo to email this
  // address about incoming price inquiries. Defaults unchecked; the RPC
  // only ever flips false→true, never reverts a prior explicit consent.
  const [notifyOnInquiryViaEmail, setNotifyOnInquiryViaEmail] = useState(false);
  // QA 2026-07-29 (PART D.2) — sibling opt-in, independent of the price-
  // inquiry consent above: allows Theo to email this address when someone
  // shows explicit/aggregated interest in the artist's *profile* (not a
  // specific inquiry). Defaults unchecked.
  const [notifyOnProfileInterestViaEmail, setNotifyOnProfileInterestViaEmail] = useState(false);
  // Soft-required email (2026-07-01): default we ask for the artist's email so
  // they auto-link their works on signup. The owner can opt out explicitly
  // ("no email / link later"), in which case linking happens via /my/artists.
  const [externalNoEmail, setExternalNoEmail] = useState(false);

  // Form — QA 2026-06-26 (#2/#5): support multiple images per work,
  // each tagged with a `view_type`. Order in the array becomes the
  // carousel order on the artwork detail page. The first image is the
  // primary canvas (the one that surfaces in feeds, profiles, etc).
  type PendingImage = {
    /** Stable client-side id so React keys survive re-orders. */
    id: string;
    file: File;
    viewType: ArtworkImageViewType;
    /** Object URL for preview thumbnails — revoked on remove/unmount. */
    previewUrl: string;
    /**
     * 2026-07-20 (feed image standardization) — non-destructive per-image
     * display tune (brightness/contrast/saturation/crop) applied on
     * grid/feed surfaces only. Null = render original.
     */
    displayAdjust: DisplayAdjust | null;
    /** Whether the standardize editor is expanded for this row. */
    standardizeOpen: boolean;
    /**
     * 2026-08-05 (Theo Image Enhance Beta) — user-approved enhancement
     * draft. When present the publish flow uploads the draft's
     * `displayFile` as the display copy and persists
     * `draft.meta` to `artwork_images.enhancement_meta`.
     */
    enhancement: EnhancementDraft | null;
  };
  const [images, setImages] = useState<PendingImage[]>([]);
  const [title, setTitle] = useState("");
  /**
   * QA 2026-07-28 — 이중언어 title/medium/story 슬롯. 두 언어를 나란히
   * 쓰고 싶은 작가는 두 슬롯을 모두 채운다. legacy 컬럼 (`title`, `medium`,
   * `story`) 은 240004 트리거가 KO 우선으로 sync 하지만, 여기서는 클라이언트
   * 완결성을 위해 pickLegacyForSave 로 함께 보낸다.
   */
  const [titleKo, setTitleKo] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [year, setYear] = useState("");
  const [medium, setMedium] = useState("");
  const [mediumKo, setMediumKo] = useState("");
  const [mediumEn, setMediumEn] = useState("");
  const [size, setSize] = useState("");
  // Explicit unit the artist declares for the dimensions (source of truth
  // for the size_unit column). Defaults by locale; auto-syncs when the
  // typed value already carries an explicit unit (e.g. "24 x 24 inch").
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>(locale.startsWith("ko") ? "cm" : "in");
  const [hosuNumber, setHosuNumber] = useState("");
  const [hosuType, setHosuType] = useState<"F" | "P" | "M" | "S" | "">("");
  const [hosuWarning, setHosuWarning] = useState<string | null>(null);
  const [story, setStory] = useState("");
  const [storyKo, setStoryKo] = useState("");
  const [storyEn, setStoryEn] = useState("");
  const [ownershipStatus, setOwnershipStatus] = useState("available");
  const [pricingMode, setPricingMode] = useState<"fixed" | "inquire">("fixed");
  const [priceCurrency, setPriceCurrency] = useState("USD");
  const [priceAmount, setPriceAmount] = useState("");
  const [isPricePublic, setIsPricePublic] = useState(false);
  const [periodStatus, setPeriodStatus] = useState<"past" | "current" | "future">("current");

  // Dedup
  const [similarWorks, setSimilarWorks] = useState<{ id: string; title: string | null }[]>([]);
  const [dedupLoading, setDedupLoading] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteToast, setInviteToast] = useState<"sent" | "failed" | null>(null);

  useEffect(() => {
    getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
  }, []);

  // When coming from exhibition add with dropped file(s), pre-fill image (single) so user goes straight to form
  useEffect(() => {
    if (!fromExhibition || !addToExhibitionId?.trim()) return;
    const pending = getAndClearPendingExhibitionFiles({
      exhibitionId: addToExhibitionId.trim(),
      artistId: preselectedArtistId ?? null,
      externalName: preselectedExternalName ?? null,
    });
    if (pending?.files.length === 1) {
      setImages([
        {
          id: crypto.randomUUID(),
          file: pending.files[0],
          viewType: "wall_mounted",
          previewUrl: URL.createObjectURL(pending.files[0]),
          displayAdjust: null,
          standardizeOpen: false,
          enhancement: null,
        },
      ]);
      setStep("form");
    }
  }, [fromExhibition, addToExhibitionId, preselectedArtistId, preselectedExternalName]);

  // Object-URL hygiene: release blobs when the user removes an image
  // (handled per-action) and on unmount (handled here). Without this
  // the page leaks one allocation per file across navigations.
  useEffect(() => {
    return () => {
      images.forEach((img) => {
        try {
          URL.revokeObjectURL(img.previewUrl);
        } catch {}
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSearchArtists = useCallback(async () => {
    const q = artistSearch.trim();
    if (!q || q.length < 2) {
      setArtistResults([]);
      return;
    }
    setSearching(true);
    // Phase 3-3 (QA 2026-07): unified search — surface both onboarded
    // artists AND already-invited external artists so the operator can
    // pile new works on the same shadow-account instead of re-inviting.
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

  /**
   * QA 2026-07-28 Phase B: debounced existence probe. Only queries when
   * the operator is in "invite by email" mode and the input parses as an
   * email. Reselected (Phase 3) rows already carry `pendingInviteForEmail`
   * implicitly via `preselectedExternalArtistId`, so this probe defers to
   * them and does not fire on those cases.
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

  const needsAttribution = (v: IntentType | null) => v !== "CREATED";

  function handleIntentSelect(value: IntentType) {
    setIntent(value);
    setError(null);
    if (value === "CREATED") {
      setStep("form");
    } else {
      setStep("attribution");
      setSelectedArtist(null);
    }
  }

  function handleAttributionNext() {
    if (needsAttribution(intent)) {
      if (useExternalArtist) {
        const name = externalArtistName.trim();
        if (!name || name.length < 2) {
          setError(t("common.pleaseEnterArtistName"));
          return;
        }
        const email = externalArtistEmail.trim();
        if (!externalNoEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          setError(t("upload.externalArtistEmailRequired"));
          return;
        }
      } else if (!selectedArtist) {
        setError(t("common.pleaseSelectArtist"));
        return;
      }
    }
    setError(null);
    setStep("form");
  }

  function handleFormNext(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (images.length === 0 || !title.trim() || !year || !medium.trim() || !size.trim()) {
      setError(t("common.pleaseFillRequired"));
      return;
    }
    const yearNum = parseInt(year, 10);
    if (isNaN(yearNum) || yearNum < 1000 || yearNum > 9999) {
      setError(t("common.pleaseEnterValidYear"));
      return;
    }
    if (pricingMode === "fixed" && (!priceAmount || parseFloat(priceAmount) <= 0)) {
      setError(t("common.pleaseEnterValidPrice"));
      return;
    }
    setStep("dedup");
    fetchSimilarWorks();
  }

  async function fetchSimilarWorks() {
    setDedupLoading(true);
    const { data } = await searchWorksForDedup({
      artistProfileId: needsAttribution(intent) && selectedArtist ? selectedArtist.id : userId ?? undefined,
      q: title.trim(),
      limit: 5,
    });
    setSimilarWorks((data ?? []).map((w) => ({ id: w.id, title: w.title })));
    setDedupLoading(false);
  }

  async function handleSubmit() {
    if (isSubmitting) return;
    setError(null);

    if (images.length === 0 || !userId) {
      setError(!userId ? t("common.notAuthenticated") : t("common.pleaseSelectImage"));
      return;
    }

    const yearNum = parseInt(year, 10);
    if (isNaN(yearNum) || yearNum < 1000 || yearNum > 9999) {
      setError(t("common.pleaseEnterValidYear"));
      return;
    }

    const sizeTrimmed = size.trim();
    const isExternal = needsAttribution(intent) && useExternalArtist;
    // QA 2026-07-28 bilingual — legacy 슬롯은 KO 우선. 240004 트리거가 서버
    // 측에서도 KO 우선 sync 하므로 클라이언트 값과 트리거 결과가 일치한다.
    const legacyTitle =
      pickLegacyForSave(titleKo || null, titleEn || null) ?? title.trim() ?? "";
    const legacyMedium =
      pickLegacyForSave(mediumKo || null, mediumEn || null) ??
      medium.trim() ??
      "";
    const legacyStory =
      pickLegacyForSave(storyKo || null, storyEn || null) ??
      (story.trim() || null);
    const payload: CreateArtworkPayload = {
      title: legacyTitle || title.trim(),
      title_ko: titleKo.trim() || null,
      title_en: titleEn.trim() || null,
      year: yearNum,
      medium: legacyMedium || medium.trim(),
      medium_ko: mediumKo.trim() || null,
      medium_en: mediumEn.trim() || null,
      size: sizeTrimmed,
      size_unit: sizeTrimmed ? sizeUnit : null,
      story: legacyStory || story.trim() || null,
      story_ko: storyKo.trim() || null,
      story_en: storyEn.trim() || null,
      ownership_status: ownershipStatus,
      pricing_mode: pricingMode,
      is_price_public: pricingMode === "fixed" ? isPricePublic : false,
      price_input_amount: pricingMode === "fixed" && priceAmount ? parseFloat(priceAmount) : undefined,
      price_input_currency: pricingMode === "fixed" ? priceCurrency : undefined,
      artist_id:
        actingAsProfileId ??
        (needsAttribution(intent) && selectedArtist && !isExternal ? selectedArtist.id : undefined),
    };

    setIsSubmitting(true);

    let inviteSent = false;
    let inviteSendFailed = false;
    try {
      const { data: artworkId, error: createErr } = await createArtwork(payload);
      if (createErr) {
        logSupabaseError("createArtwork", createErr);
        setError(formatSupabaseError(createErr, t, "errors.failedCreateArtwork"));
        setIsSubmitting(false);
        return;
      }
      if (!artworkId) {
        setError(t("errors.failedCreateArtwork"));
        setIsSubmitting(false);
        return;
      }

      // Create claim BEFORE attaching image (RLS: artwork_images INSERT needs claim for lister)
      const claimType: ClaimType = intent === "CREATED" ? "CREATED" : (intent ?? "OWNS");
      const claimPayload: { period_status?: "past" | "current" | "future" } = {};
      if (claimType === "INVENTORY" || claimType === "CURATED") {
        claimPayload.period_status = periodStatus;
      }
      if (isExternal) {
        const { error: claimErr } = await createExternalArtistAndClaim({
          displayName: externalArtistName.trim(),
          // QA 2026-07-28 bilingual (240005 SECTION 2/3) — 큐레이터가 남긴
          // KO/EN 이름을 external_artists 에 함께 저장. 온보딩 시 새 프로필로
          // 자동 상속 (240005 SECTION 5). 두 슬롯이 비어 있으면 legacy 만.
          displayNameKo: externalArtistNameKo.trim() || null,
          displayNameEn: externalArtistNameEn.trim() || null,
          inviteEmail: externalArtistEmail.trim() || null,
          claimType,
          workId: artworkId,
          visibility: "public",
          ...claimPayload,
          // QA 2026-07-29 (Part A.5) — forward opt-in email consent.
          notifyOnInquiryViaEmail,
          // QA 2026-07-29 (PART D.2) — sibling opt-in for profile-interest emails.
          notifyOnProfileInterestViaEmail,
          // Acting-as: when delegate uploads on behalf of the principal,
          // the claim must be filed under the principal so the artwork
          // surfaces on their profile (not the operator's). RPC enforces
          // the delegation writer check before honouring this override.
          subjectProfileId: actingAsProfileId ?? undefined,
          // Phase 3-4: bypass name/email dedupe in the RPC when the
          // operator explicitly picked an existing external artist card.
          externalArtistId: preselectedExternalArtistId,
        });
        if (claimErr) {
          await deleteArtwork(artworkId);
          logSupabaseError("createExternalArtistAndClaim", claimErr);
          setError(formatSupabaseError(claimErr, t, "errors.failedClaimDuringUpload"));
          setIsSubmitting(false);
          return;
        }
        if (externalArtistEmail?.trim()) {
          const email = externalArtistEmail.trim();
          const { error: inviteErr } = await sendMagicLink(email);
          inviteSent = !inviteErr;
          if (inviteErr) inviteSendFailed = true;
          if (!inviteErr) {
            await sendArtistInviteEmailClient({
              toEmail: email,
              artistName: externalArtistName.trim() || null,
              exhibitionTitle: null,
            });
          }
        }
      } else {
        // CREATED intent ≡ "I made this work". When acting-as a principal,
        // the principal IS the artist of the new work, so both the artwork's
        // artist_id (already routed via `actingAsProfileId` in the payload
        // above) and the claim's artist_profile_id must point to them.
        // Without this, the claim's artist link pointed at the operator and
        // the artwork de-facto belonged to the wrong profile.
        const artistProfileId =
          intent === "CREATED"
            ? actingAsProfileId ?? userId
            : selectedArtist!.id;
        // QA 2026-06-26 (#8) — file the claim work-scoped only.
        // Passing both workId and projectId hits the DB invariant
        // `exactly one of work_id, project_id required` and the entire
        // upload silently failed. Exhibition wiring is handled below
        // by the separate `addWorkToExhibition` call, mirroring the
        // external-artist branch above.
        const { error: claimErr } = await createClaimForExistingArtist({
          artistProfileId,
          claimType,
          workId: artworkId,
          visibility: "public",
          ...claimPayload,
          subjectProfileId: actingAsProfileId ?? undefined,
        });
        if (claimErr) {
          await deleteArtwork(artworkId);
          logSupabaseError("createClaimForExistingArtist", claimErr);
          setError(formatSupabaseError(claimErr, t, "errors.failedClaimDuringUpload"));
          setIsSubmitting(false);
          return;
        }
      }

      // QA 2026-06-26 (#2/#5) — multi-image upload. We upload + attach
      // images in input order; each gets `sort_order = i` so the
      // detail page carousel renders them in the user's chosen order.
      // The first image is the "primary" canvas (the one feeds /
      // profile thumbnails pick up). When acting-as, storage path is
      // rooted on the principal so lifecycle stays principal-rooted.
      const storageOwner = actingAsProfileId ?? userId;
      const uploadedPaths: string[] = [];
      const rollback = async () => {
        for (const p of uploadedPaths) {
          try { await removeStorageFile(p); } catch {}
        }
        try { await deleteArtwork(artworkId); } catch {}
      };

      for (let i = 0; i < images.length; i++) {
        const pending = images[i];
        let upload: Awaited<ReturnType<typeof uploadArtworkImage>> | null = null;
        try {
          upload = await uploadArtworkImage(pending.file, storageOwner, {
            preparedDisplayFile: pending.enhancement?.displayFile ?? null,
            enhancementMeta: pending.enhancement?.meta ?? null,
          });
          uploadedPaths.push(upload.displayPath);
          if (upload.originalPath) uploadedPaths.push(upload.originalPath);
        } catch (uploadErr) {
          await rollback();
          setError(formatSingleUploadFailure(uploadErr, t));
          setIsSubmitting(false);
          return;
        }
        const { error: attachErr } = await attachArtworkImage(
          artworkId,
          upload.displayPath,
          {
            sortOrder: i,
            viewType: pending.viewType,
            displayAdjust: pending.displayAdjust,
            originalStoragePath: upload.originalPath,
            displayBytes: upload.displayBytes,
            originalBytes: upload.originalBytes,
            compressionMeta: upload.compressionMeta,
            enhancementMeta: pending.enhancement?.meta ?? null,
          },
        );
        if (attachErr) {
          await rollback();
          logSupabaseError("attachArtworkImage", attachErr);
          setError(formatSupabaseError(attachErr, t, "errors.failedAttachImage"));
          setIsSubmitting(false);
          return;
        }
        // 2026-08-07 — Publish-time `.completed` for approved
        // enhancements. Fires ONLY when the enhancement actually
        // landed in a published storage row. See `metering/types.ts`
        // for the `.previewed` vs `.completed` semantic split.
        if (pending.enhancement) {
          const meta = pending.enhancement.meta;
          void recordUsageEvent({
            userId: userId ?? undefined,
            key: USAGE_KEYS.AI_IMAGE_ENHANCE_COMPLETED,
            featureKey: "ai.image_enhance",
            metadata: {
              mode: meta.mode,
              provider: meta.provider,
              source: fromExhibition ? "exhibition_single" : "single",
              latency_ms: meta.latencyMs,
              batch_normalization_applied: !!meta.batchNormalization,
              portfolio_coherence_applied: !!meta.portfolioCoherence,
            },
          });
        }
      }

      if (addToExhibitionId?.trim()) {
        const { error: addExErr } = await addWorkToExhibition(
          addToExhibitionId.trim(),
          artworkId,
          { actingSubjectProfileId: actingAsProfileId ?? null }
        );
        if (addExErr) {
          logSupabaseError("addWorkToExhibition", addExErr);
        }
      }

      // Redirect target. When acting-as, route to the principal's public
      // profile so the operator visually confirms the new work surfaces on
      // the right account; otherwise route to the operator's own profile.
      const { getMyProfile, getProfileById } = await import("@/lib/supabase/profiles");
      const { data: profile } = actingAsProfileId
        ? await getProfileById(actingAsProfileId)
        : await getMyProfile();
      const username = (profile as { username?: string | null } | null)?.username?.trim();
      // QA 2026-07-28: exhibition-context uploads now return to the
      // `/add` page (not the detail page) so the curator lands back on
      // the participant/works console without having to hunt for the
      // manage link. A lightweight sessionStorage flag lets the /add
      // page surface a quiet "돌아왔어요" toast.
      const exhibitionReturnUrl = addToExhibitionId?.trim()
        ? (() => {
            const qs = new URLSearchParams();
            if (preservedFromBoard) qs.set("fromBoard", preservedFromBoard);
            const suffix = qs.toString() ? `?${qs.toString()}` : "";
            return `/my/exhibitions/${addToExhibitionId.trim()}/add${suffix}`;
          })()
        : null;
      if (exhibitionReturnUrl && typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(
            "exhibitionAddReturnToast",
            "bulk.doneReturnToExhibition",
          );
        } catch {
          // sessionStorage disabled (Safari private mode etc.) — silent.
        }
      }
      if (inviteSent || inviteSendFailed) {
        setInviteToast(inviteSent ? "sent" : "failed");
        setTimeout(() => {
          if (exhibitionReturnUrl) {
            router.push(exhibitionReturnUrl);
          } else if (username) {
            router.push(`/u/${username}`);
          } else {
            setArtworkBack("/upload");
            router.push(`/artwork/${artworkId}`);
          }
        }, 2000);
      } else {
        if (exhibitionReturnUrl) {
          router.push(exhibitionReturnUrl);
        } else if (username) {
          router.push(`/u/${username}`);
        } else {
          setArtworkBack("/upload");
          router.push(`/artwork/${artworkId}`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.unknownError"));
      setIsSubmitting(false);
    }
  }

  return (
    <AuthGate>
      <div>
        {/*
          QA 2026-07 Phase 2-2: dismissible confirmation card that replaces
          the fleeting 3s toast for external-artist invite outcomes. Same
          card component the bulk flow uses — single source of truth.
        */}
        {inviteToast && (
          <InviteResultCard
            kind={inviteToast === "sent" ? "sent" : "failed"}
            artistName={
              (useExternalArtist ? externalArtistName : "").trim() ||
              t("upload.externalArtistNamePlaceholder")
            }
            onDismiss={() => setInviteToast(null)}
          />
        )}

        <ActingAsChip mode="posting" />

        {/* Step: Intent */}
        {step === "intent" && (
          <div className="space-y-4" data-tour="upload-intent-selector">
            <p className="text-sm text-zinc-600">{t("upload.whatUploading")}</p>
            <div className="grid gap-3">
              {INTENTS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleIntentSelect(opt.value)}
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
        {step === "attribution" && needsAttribution(intent) && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600">{t("upload.linkArtist")}</p>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium">{t("upload.searchArtist")}</label>
              <button
                type="button"
                onClick={() => {
                  const next = !useExternalArtist;
                  setUseExternalArtist(next);
                  setPreselectedExternalArtistId(null);
                  setReselectedExternalMeta(null);
                  if (next) {
                    setSelectedArtist(null);
                    setArtistSearch("");
                    setArtistResults([]);
                  } else {
                    setExternalArtistName("");
                    setExternalArtistNameKo("");
                    setExternalArtistNameEn("");
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
                {reselectedExternalMeta && preselectedExternalArtistId && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    <p>
                      {t("upload.externalReselect.addingToExisting")
                        .replace("{name}", externalArtistName)
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
                        setUseExternalArtist(false);
                      }}
                      className="mt-1 text-emerald-700 underline hover:text-emerald-900"
                    >
                      {t("upload.externalReselect.chooseDifferent")}
                    </button>
                  </div>
                )}
                {/*
                  QA 2026-07-28 — 외부 작가 이름 이중언어. 큐레이터가 두
                  언어를 나란히 남기면 (240005 SECTION 2/3) external_artists
                  행에 KO/EN 이 저장되고, 온보딩 시 새 profile.display_name_ko/en
                  으로도 상속된다 (240005 SECTION 5). BilingualFieldPair 가
                  primary/secondary 슬롯을 함께 관리하고 legacy
                  `externalArtistName` 슬롯은 KO 우선으로 sync 한다.
                */}
                <BilingualFieldPair
                  hint={t("bilingual.hintName")}
                  label={null}
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
                    // 외부 작가 이름도 사람 이름이므로 AI 번역 금지 —
                    // 한글 원문이 있고 EN 슬롯이 비어 있을 때만
                    // 로마자 힌트를 제안한다.
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
                <input
                  type="email"
                  value={externalArtistEmail}
                  onChange={(e) => {
                    setExternalArtistEmail(e.target.value);
                    if (preselectedExternalArtistId) {
                      setPreselectedExternalArtistId(null);
                      setReselectedExternalMeta(null);
                    }
                  }}
                  placeholder={t("upload.externalArtistEmailPlaceholder")}
                  disabled={externalNoEmail}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-400"
                />
                <p className="text-xs text-zinc-500">{t("upload.externalArtistEmailHint")}</p>
                {!externalNoEmail && (
                  <label className="flex items-start gap-2 text-xs text-zinc-600">
                    <input
                      type="checkbox"
                      checked={notifyOnInquiryViaEmail}
                      onChange={(e) => setNotifyOnInquiryViaEmail(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>{t("upload.notifyOnInquiryViaEmail")}</span>
                  </label>
                )}
                {!externalNoEmail && (
                  <label className="flex items-start gap-2 text-xs text-zinc-600">
                    <input
                      type="checkbox"
                      checked={notifyOnProfileInterestViaEmail}
                      onChange={(e) => setNotifyOnProfileInterestViaEmail(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>{t("upload.notifyOnProfileInterestViaEmail")}</span>
                  </label>
                )}
                <label className="flex items-start gap-2 text-xs text-zinc-600">
                  <input
                    type="checkbox"
                    checked={externalNoEmail}
                    onChange={(e) => {
                      setExternalNoEmail(e.target.checked);
                      if (e.target.checked) {
                        setNotifyOnInquiryViaEmail(false);
                        setNotifyOnProfileInterestViaEmail(false);
                      }
                    }}
                    className="mt-0.5"
                  />
                  <span>{t("upload.externalArtistNoEmail")}</span>
                </label>
                {/*
                  QA 2026-07-28 Phase C: no-email invites bypass all
                  dedupe + auto-onboarding-link. Flag this explicitly so
                  the operator understands the trade-off. Reselected
                  external artists (Phase 3) legitimately hide their email
                  for privacy, so the warning is suppressed there.
                */}
                {externalNoEmail && !preselectedExternalArtistId && (
                  <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
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
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                />
                {searching && <p className="text-sm text-zinc-500">{t("artists.loading")}</p>}
                {artistResults.length > 0 && (
                  <ul className="rounded border border-zinc-200 bg-white">
                    {artistResults.map((a) => {
                      if (a.kind === "profile") {
                        const opt: ArtistOption = { id: a.id, username: a.username, display_name: a.display_name };
                        return (
                          <li key={`p-${a.id}`}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedArtist(opt);
                                setPreselectedExternalArtistId(null);
                                setReselectedExternalMeta(null);
                                setUseExternalArtist(false);
                                setArtistResults([]);
                                setArtistSearch("");
                              }}
                              className={`w-full px-4 py-2 text-left text-sm hover:bg-zinc-50 ${
                                selectedArtist?.id === a.id ? "bg-zinc-100 font-medium" : ""
                              }`}
                            >
                              {formatDisplayName(opt)}
                              {a.username && (
                                <span className="ml-2 text-zinc-500">{formatUsername(opt)}</span>
                              )}
                            </button>
                          </li>
                        );
                      }
                      // Phase 3-3: previously-invited external artist row.
                      // Selecting jumps the operator into the "external"
                      // branch pre-filled and captures the external_artist_id
                      // so we later reuse the same shadow account instead of
                      // spawning a duplicate row on publish.
                      return (
                        <li key={`e-${a.id}`}>
                          <button
                            type="button"
                            onClick={() => {
                              // Phase 3-4: don't reveal invite_email — RPC
                              // withholds it for privacy. Enable "no email"
                              // so client-side validation passes; the server
                              // reuses the existing external_artists row
                              // (including its stored email) via
                              // p_external_artist_id and does NOT send a new
                              // invite from this branch.
                              setUseExternalArtist(true);
                              setSelectedArtist(null);
                              setExternalArtistName(a.display_name ?? "");
                              setExternalArtistEmail("");
                              setExternalNoEmail(true);
                              setPreselectedExternalArtistId(a.id);
                              setReselectedExternalMeta({
                                worksCount: a.works_count,
                                latestCovers: a.latest_cover_paths ?? [],
                              });
                              setArtistResults([]);
                              setArtistSearch("");
                            }}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-zinc-50"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span>{a.display_name}</span>
                              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                                {t("upload.externalReselect.badgePendingWorks").replace("{n}", String(a.works_count))}
                              </span>
                            </div>
                            {a.latest_cover_paths && a.latest_cover_paths.length > 0 && (
                              <div className="mt-2 flex gap-1">
                                {a.latest_cover_paths.slice(0, 3).map((p) => (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    key={p}
                                    src={getArtworkImageUrl(p, "thumb")}
                                    alt=""
                                    className="h-8 w-8 rounded object-cover"
                                  />
                                ))}
                              </div>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {selectedArtist && (
                  <p className="text-sm text-zinc-600">
                    {t("upload.selectedArtist")}: {formatDisplayName(selectedArtist)}
                  </p>
                )}
              </>
            )}
            {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep("intent")}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                {t("common.back")}
              </button>
              <button
                type="button"
                onClick={handleAttributionNext}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800"
              >
                {t("upload.confirmAttribution")}
              </button>
            </div>
            {/*
              Same as bulk/page: reveal invite timing hint when we know an
              email will actually flow. Reduces surprise between the confirm
              step and the actual send on publish (QA1).
            */}
            {needsAttribution(intent) && useExternalArtist && !externalNoEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(externalArtistEmail.trim()) && (
              <p className="mt-2 text-xs text-zinc-500">
                {(preselectedExternalArtistId || pendingInviteForEmail)
                  ? t("upload.emailAlreadyInvitedHint")
                  : t("upload.inviteWillSendOnPublish")}
              </p>
            )}
          </div>
        )}

        {/* Step: Form */}
        {step === "form" && (
          <form onSubmit={handleFormNext} className="space-y-4">
            {/*
              QA 2026-07 Phase 2-1: keep "who am I uploading for?" visible
              during the (often lengthy) form step. Only rendered when
              attribution was actually needed for this intent.
            */}
            {needsAttribution(intent) && (selectedArtist || (useExternalArtist && externalArtistName.trim().length >= 2)) && (
              <AttributionContextBanner
                artistName={
                  useExternalArtist
                    ? externalArtistName.trim()
                    : formatDisplayName(selectedArtist)
                }
                isExternal={useExternalArtist}
                externalEmail={useExternalArtist ? externalArtistEmail : null}
                hasPendingInviteForEmail={
                  // Phase 3 재선택은 이미 기존 초대장을 재사용하는 것이
                  // 확정. Phase B 의 email 존재 probe 도 같은 사실을 알린다.
                  Boolean(preselectedExternalArtistId) || pendingInviteForEmail
                }
                onChange={() => setStep("attribution")}
              />
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">{t("common.imageLabel")}</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  // 2026-07-28 auto-compression: compressible formats
                  // now have a 200 MB ceiling (compressor guarantees the
                  // display file lands ≤ 50 MiB); uncompressible formats
                  // (HEIC/animated GIF) still use the 50 MB legacy cap.
                  // Split messaging by case so the guidance is accurate:
                  // "auto-compress covers this" vs "convert to a
                  // supported format".
                  const oversize = files.find(
                    (f) => f.size > getUploadCeilingBytes(f),
                  );
                  if (oversize) {
                    const compressible = isCompressibleMime(oversize.type);
                    const ceilingMb = compressible
                      ? UPLOAD_MAX_COMPRESSIBLE_MB_LABEL
                      : UPLOAD_MAX_IMAGE_MB_LABEL;
                    const key = compressible
                      ? "upload.fileTooLargeCompressible"
                      : "upload.fileTooLargeUnsupported";
                    setError(t(key).replace("{maxMb}", String(ceilingMb)));
                    return;
                  }
                  setError(null);
                  // First added image keeps view_type = wall_mounted
                  // (primary canvas); subsequent ones default to
                  // `detail` since users overwhelmingly add detail
                  // shots as the second slide. They can change it
                  // per-image inline.
                  setImages((prev) => {
                    const startedEmpty = prev.length === 0;
                    const next = [...prev];
                    files.forEach((f, idx) => {
                      next.push({
                        id: crypto.randomUUID(),
                        file: f,
                        viewType:
                          startedEmpty && idx === 0
                            ? "wall_mounted"
                            : "detail",
                        previewUrl: URL.createObjectURL(f),
                        displayAdjust: null,
                        standardizeOpen: false,
                        enhancement: null,
                      });
                    });
                    return next;
                  });
                }}
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                {t("upload.multiImageHint").replace(
                  "{maxMb}",
                  String(UPLOAD_MAX_IMAGE_MB_LABEL),
                )}
              </p>
              {images.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {images.map((img, idx) => (
                    <li
                      key={img.id}
                      className="rounded-md border border-zinc-200 bg-white px-2 py-2"
                    >
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.previewUrl}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 truncate text-xs text-zinc-700">
                          {idx === 0 && (
                            <span className="mr-1 rounded bg-zinc-900 px-1 py-0.5 text-[10px] font-medium text-white">
                              {t("upload.imagePrimaryChip")}
                            </span>
                          )}
                          <span className="truncate">{img.file.name}</span>
                          {/*
                            2026-07-28 auto-compression quiet chip.
                            Only rendered when the file is a compressible
                            format AND above 5 MB, so it doesn't clutter
                            small file rows.
                          */}
                          <span className="shrink-0 text-[10px] text-zinc-400">
                            {(img.file.size / (1024 * 1024)).toFixed(1)} MB
                          </span>
                          {isCompressibleMime(img.file.type) && img.file.size > 5 * 1024 * 1024 && (
                            <span
                              className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                              title={t("upload.autoCompressHint")}
                            >
                              {t("upload.autoCompressChip")}
                            </span>
                          )}
                        </div>
                        <label className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                          <span>{t("upload.imageViewTypeLabel")}</span>
                          <select
                            value={img.viewType}
                            onChange={(e) => {
                              const v = e.target.value as ArtworkImageViewType;
                              setImages((prev) =>
                                prev.map((p) =>
                                  p.id === img.id ? { ...p, viewType: v } : p,
                                ),
                              );
                            }}
                            className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-800"
                          >
                            <option value="wall_mounted">
                              {t("upload.viewType.wall_mounted")}
                            </option>
                            <option value="detail">
                              {t("upload.viewType.detail")}
                            </option>
                            <option value="angle">
                              {t("upload.viewType.angle")}
                            </option>
                            <option value="in_situ">
                              {t("upload.viewType.in_situ")}
                            </option>
                            <option value="other">
                              {t("upload.viewType.other")}
                            </option>
                          </select>
                        </label>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => {
                            setImages((prev) => {
                              if (idx === 0) return prev;
                              const next = [...prev];
                              const [moved] = next.splice(idx, 1);
                              next.splice(idx - 1, 0, moved);
                              return next;
                            });
                          }}
                          className="rounded px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-30"
                          aria-label={t("upload.imageMoveUp")}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={idx === images.length - 1}
                          onClick={() => {
                            setImages((prev) => {
                              if (idx === prev.length - 1) return prev;
                              const next = [...prev];
                              const [moved] = next.splice(idx, 1);
                              next.splice(idx + 1, 0, moved);
                              return next;
                            });
                          }}
                          className="rounded px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-30"
                          aria-label={t("upload.imageMoveDown")}
                        >
                          ↓
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setImages((prev) => {
                            const removed = prev.find((p) => p.id === img.id);
                            if (removed) {
                              try { URL.revokeObjectURL(removed.previewUrl); } catch {}
                            }
                            return prev.filter((p) => p.id !== img.id);
                          });
                        }}
                        className="rounded px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50"
                        aria-label={t("upload.imageRemove")}
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-1 flex items-center gap-2 pl-[68px] text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          setImages((prev) =>
                            prev.map((p) =>
                              p.id === img.id
                                ? { ...p, standardizeOpen: !p.standardizeOpen }
                                : p,
                            ),
                          );
                        }}
                        className="rounded-full border border-zinc-300 px-2.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
                      >
                        {img.standardizeOpen
                          ? t("upload.imageStandardize.hide")
                          : t("upload.imageStandardize.edit")}
                      </button>
                      {img.displayAdjust && !img.standardizeOpen && (
                        <span className="text-[11px] text-zinc-500">
                          {t("upload.imageStandardize.appliedChip")}
                        </span>
                      )}
                    </div>
                    {img.standardizeOpen && (
                      <div className="mt-2">
                        <ImageStandardizeEditor
                          file={img.file}
                          value={img.displayAdjust}
                          onChange={(next) => {
                            setImages((prev) =>
                              prev.map((p) =>
                                p.id === img.id
                                  ? { ...p, displayAdjust: next }
                                  : p,
                              ),
                            );
                          }}
                          enhancement={img.enhancement}
                          onEnhance={(next) => {
                            setImages((prev) =>
                              prev.map((p) =>
                                p.id === img.id
                                  ? { ...p, enhancement: next }
                                  : p,
                              ),
                            );
                          }}
                          meteringSource={fromExhibition ? "exhibition_single" : "single"}
                          artistProfileId={selectedArtist?.id ?? actingAsProfileId ?? null}
                        />
                      </div>
                    )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <BilingualFieldPair
              label={t("upload.labelTitle")}
              hint={t("bilingual.hintTitle")}
              addKoKey="bilingual.addKoTitle"
              addEnKey="bilingual.addEnTitle"
              placeholderKo={t("upload.placeholderTitle")}
              placeholderEn={t("upload.placeholderTitle")}
              valueKo={titleKo}
              valueEn={titleEn}
              onChangeKo={(v) => {
                setTitleKo(v);
                if (locale === "ko") setTitle(v);
              }}
              onChangeEn={(v) => {
                setTitleEn(v);
                if (locale !== "ko") setTitle(v);
              }}
              renderSecondaryAssist={({ secondaryLang }) => {
                const primaryLang: "ko" | "en" = secondaryLang === "ko" ? "en" : "ko";
                const src = primaryLang === "ko" ? titleKo : titleEn;
                return (
                  <AiTranslationDraftButton
                    sourceText={src}
                    sourceLocale={primaryLang}
                    targetLocale={secondaryLang}
                    fieldKind="title"
                    onDraft={(text) => {
                      if (secondaryLang === "ko") {
                        setTitleKo(text);
                        if (locale === "ko") setTitle(text);
                      } else {
                        setTitleEn(text);
                        if (locale !== "ko") setTitle(text);
                      }
                    }}
                    compact
                  />
                );
              }}
            />
            <div>
              <label className="mb-1 block text-sm font-medium">{t("upload.labelYear")}</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                required
                min={1000}
                max={9999}
                placeholder={t("upload.placeholderYear")}
                className="w-full rounded border border-zinc-300 px-3 py-2"
              />
            </div>
            <div>
              {/* QA 2026-06-26 (#4) — datalist of canonical mediums
                  so the user gets one-click pick from the taxonomy
                  the rest of the app already knows about (filters,
                  AI categorisation, etc.), while still allowing
                  free-form text for niche or hybrid materials.
                  QA 2026-07-28 — 이중언어 (KO/EN) 슬롯이 열려도 datalist
                  suggestions 는 primary 슬롯에만 붙는다. BilingualFieldPair
                  의 primary input 에는 datalist 를 직접 붙일 수 없으므로
                  약간 더 넓게 캡슐화한다. */}
              <BilingualFieldPair
                label={t("upload.labelMedium")}
                addKoKey="bilingual.addKoMedium"
                addEnKey="bilingual.addEnMedium"
                placeholderKo={t("upload.placeholderMedium")}
                placeholderEn={t("upload.placeholderMedium")}
                valueKo={mediumKo}
                valueEn={mediumEn}
                onChangeKo={(v) => {
                  setMediumKo(v);
                  if (locale === "ko") setMedium(v);
                }}
                onChangeEn={(v) => {
                  setMediumEn(v);
                  if (locale !== "ko") setMedium(v);
                }}
                renderSecondaryAssist={({ secondaryLang }) => {
                  const primaryLang: "ko" | "en" = secondaryLang === "ko" ? "en" : "ko";
                  const src = primaryLang === "ko" ? mediumKo : mediumEn;
                  return (
                    <AiTranslationDraftButton
                      sourceText={src}
                      sourceLocale={primaryLang}
                      targetLocale={secondaryLang}
                      fieldKind="medium"
                      onDraft={(text) => {
                        if (secondaryLang === "ko") {
                          setMediumKo(text);
                          if (locale === "ko") setMedium(text);
                        } else {
                          setMediumEn(text);
                          if (locale !== "ko") setMedium(text);
                        }
                      }}
                      compact
                    />
                  );
                }}
              />
              <datalist id="upload-medium-suggestions">
                {TAXONOMY.mediumOptions.map((opt) => (
                  <option key={opt.value} value={t(opt.labelKey)} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("upload.labelSize")}</label>
              {locale === "ko" && (
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <span className="text-xs text-zinc-500">{t("size.hosuLabel")}</span>
                  <input
                    type="number"
                    min={0}
                    className="h-8 w-16 rounded border border-zinc-300 px-2 text-xs"
                    placeholder={t("size.hosuPlaceholder")}
                    value={hosuNumber}
                    onChange={(e) => setHosuNumber(e.target.value)}
                  />
                  {(["F", "P", "M"] as const).map((tType) => (
                    <button
                      key={tType}
                      type="button"
                      onClick={() => setHosuType(tType)}
                      className={`rounded-full px-2 py-1 text-xs ${
                        hosuType === tType
                          ? "bg-zinc-900 text-white"
                          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                      }`}
                    >
                      {tType}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const n = parseInt(hosuNumber, 10);
                      if (!Number.isFinite(n) || !hosuType) return;
                      const h = findHosuSize(n, hosuType);
                      if (!h) {
                        setHosuWarning(t("size.hosuNotFound"));
                        return;
                      }
                      setSize(
                        `${n}${hosuType} (${h.widthCm.toFixed(1)} x ${h.heightCm.toFixed(1)} cm)`
                      );
                      setSizeUnit("cm"); // hosu is a cm standard
                      setHosuWarning(null);
                    }}
                    className="rounded-full border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                  >
                    {t("size.hosuApply")}
                  </button>
                  {hosuWarning && (
                    <p className="mt-1 text-xs text-amber-700">{hosuWarning}</p>
                  )}
                </div>
              )}
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={size}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSize(val);
                    // If the artist typed an explicit unit, keep the
                    // selector in sync so the stored size_unit matches.
                    const declared = parseSizeWithUnit(val)?.unit;
                    if (declared) setSizeUnit(declared);
                  }}
                  required
                  placeholder={t("upload.placeholderSize")}
                  className="flex-1 rounded border border-zinc-300 px-3 py-2"
                />
                {/* Explicit cm / in selector — the artist declares the
                    unit; it is stored verbatim in size_unit. Toggling also
                    re-anchors the suffix on the visible string for clarity. */}
                {(["cm", "in"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    aria-pressed={sizeUnit === u}
                    onClick={() => {
                      setSizeUnit(u);
                      setSize((prev) => setSizeUnitSuffix(prev, u));
                    }}
                    className={`rounded border px-3 text-xs font-medium ${
                      sizeUnit === u
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <BilingualFieldPair
                label={t("upload.labelStory")}
                hint={t("bilingual.hintProse")}
                addKoKey="bilingual.addKoStory"
                addEnKey="bilingual.addEnStory"
                placeholderKo={t("artwork.field.storyPlaceholder")}
                placeholderEn={t("artwork.field.storyPlaceholder")}
                valueKo={storyKo}
                valueEn={storyEn}
                onChangeKo={(v) => {
                  const trimmed = v.length > 2000 ? v.slice(0, 2000) : v;
                  setStoryKo(trimmed);
                  if (locale === "ko") setStory(trimmed);
                }}
                onChangeEn={(v) => {
                  const trimmed = v.length > 2000 ? v.slice(0, 2000) : v;
                  setStoryEn(trimmed);
                  if (locale !== "ko") setStory(trimmed);
                }}
                renderSecondaryAssist={({ secondaryLang }) => {
                  const primaryLang: "ko" | "en" = secondaryLang === "ko" ? "en" : "ko";
                  const src = primaryLang === "ko" ? storyKo : storyEn;
                  return (
                    <AiTranslationDraftButton
                      sourceText={src}
                      sourceLocale={primaryLang}
                      targetLocale={secondaryLang}
                      fieldKind="story"
                      onDraft={(text) => {
                        if (secondaryLang === "ko") {
                          setStoryKo(text);
                          if (locale === "ko") setStory(text);
                        } else {
                          setStoryEn(text);
                          if (locale !== "ko") setStory(text);
                        }
                      }}
                      compact
                    />
                  );
                }}
                as="textarea"
                rows={4}
                maxLength={2000}
              />
              <p className="mt-1 text-right text-xs text-zinc-500">
                {t("artwork.story.charCount").replace("{count}", String(story.length))}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("upload.labelOwnership")}</label>
              <select
                value={ownershipStatus}
                onChange={(e) => setOwnershipStatus(e.target.value)}
                required
                className="w-full rounded border border-zinc-300 px-3 py-2"
              >
                {OWNERSHIP_STATUSES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            {(intent === "INVENTORY" || intent === "CURATED") && (
              <div>
                <label className="mb-1 block text-sm font-medium">{t("artwork.periodLabel")} *</label>
                <select
                  value={periodStatus}
                  onChange={(e) => setPeriodStatus(e.target.value as "past" | "current" | "future")}
                  required
                  className="w-full rounded border border-zinc-300 px-3 py-2"
                >
                  <option value="past">{t("artwork.periodPast")}</option>
                  <option value="current">{t("artwork.periodCurrent")}</option>
                  <option value="future">{t("artwork.periodFuture")}</option>
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">{t("upload.labelPricingMode")}</label>
              <select
                value={pricingMode}
                onChange={(e) => setPricingMode(e.target.value as "fixed" | "inquire")}
                className="w-full rounded border border-zinc-300 px-3 py-2"
              >
                {PRICING_MODES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {t(p.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            {pricingMode === "fixed" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">{t("upload.labelCurrency")}</label>
                    <select
                      value={priceCurrency}
                      onChange={(e) => setPriceCurrency(e.target.value)}
                      className="w-full rounded border border-zinc-300 px-3 py-2"
                    >
                      {PRICE_CURRENCIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">{t("upload.labelAmount")}</label>
                    <input
                      type="number"
                      value={priceAmount}
                      onChange={(e) => setPriceAmount(e.target.value)}
                      required={pricingMode === "fixed"}
                      min={0}
                      step="any"
                      placeholder={t("upload.placeholderAmount")}
                      className="w-full rounded border border-zinc-300 px-3 py-2"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="pricePublic"
                    checked={isPricePublic}
                    onChange={(e) => setIsPricePublic(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="pricePublic" className="text-sm">
                    {t("upload.showPricePublicly")}
                  </label>
                </div>
              </>
            )}
            {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => (needsAttribution(intent) ? setStep("attribution") : setStep("intent"))}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                {t("common.back")}
              </button>
              <button
                type="submit"
                className="flex-1 rounded-full bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-800"
              >
                {t("upload.nextCheckDedup")}
              </button>
            </div>
          </form>
        )}

        {/* Step: Dedup */}
        {step === "dedup" && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600">{t("upload.similarWorksFound")}</p>
            {dedupLoading && <p className="text-sm text-zinc-500">{t("upload.searching")}</p>}
            {!dedupLoading && similarWorks.length > 0 && (
              <ul className="rounded border border-zinc-200 bg-white">
                {similarWorks.map((w) => (
                  <li key={w.id} className="border-b border-zinc-100 px-4 py-2 last:border-0">
                    <Link
                      href={`/artwork/${w.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-zinc-900 hover:underline"
                    >
                      {w.title ?? t("common.untitled")}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {!dedupLoading && similarWorks.length === 0 && (
              <p className="text-sm text-zinc-500">{t("upload.noSimilarWorksFound")}</p>
            )}
            {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep("form")}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                {t("common.back")}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex-1 rounded-full bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {isSubmitting ? t("upload.uploading") : t("nav.upload")}
              </button>
            </div>
          </div>
        )}
      </div>
    </AuthGate>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={<PageShellSkeleton variant="narrow" />}>
      <UploadPageContent />
    </Suspense>
  );
}
