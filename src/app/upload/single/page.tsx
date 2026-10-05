"use client";

import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession } from "@/lib/supabase/auth";
import {
  assignArtworkArtist,
  attachArtworkImage,
  createArtwork,
  deleteArtwork,
  getArtworkImageUrl,
  type ArtworkImageViewType,
  type CreateArtworkPayload,
} from "@/lib/supabase/artworks";
import { resolveUploadedArtworkArtist } from "@/lib/upload/artworkOwner";
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
import { addWorkToExhibition, listMyExhibitions, type ExhibitionWithCredits } from "@/lib/supabase/exhibitions";
import { logSupabaseError } from "@/lib/supabase/errors";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { useActingAs } from "@/context/ActingAsContext";
import { ActingAsChip } from "@/components/ActingAsChip";
import { PageShellSkeleton } from "@/components/ds/PageShellSkeleton";
import { type EnhancementDraft } from "@/components/upload/ImageStandardizeEditor";
import { BulkEnhanceDialog } from "@/components/upload/BulkEnhanceDialog";
import { uploadGapLabelKey, uploadGaps } from "@/lib/upload/readiness";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import { AttributionContextBanner } from "@/components/upload/AttributionContextBanner";
import { UploadCloudMark } from "@/components/upload/BulkDraftCard";
import { InviteResultCard } from "@/components/upload/InviteResultCard";
import type { DisplayAdjust } from "@/lib/image/displayAdjust";
import { useT } from "@/lib/i18n/useT";
import { BilingualFieldPair } from "@/components/i18n/BilingualFieldPair";
import { RomanizationHintChip } from "@/components/i18n/RomanizationHintChip";
import { AiTranslationDraftButton } from "@/components/i18n/AiTranslationDraftButton";
import { pickLegacyForSave, pickLocalizedDisplayName, pickLocalizedTitle } from "@/lib/i18n/pickLocalized";
import { sendArtistInviteEmailClient } from "@/lib/email/artistInvite";
import { findHosuSize } from "@/lib/size/hosu";
import { convertSizeString, parseSizeWithUnit, type SizeUnit } from "@/lib/size/format";
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

type ArtistOption = {
  id: string;
  username: string | null;
  display_name: string | null;
  display_name_ko?: string | null;
  display_name_en?: string | null;
};

function dimToCm(raw: string, unit: SizeUnit): number | null {
  const n = Number.parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return unit === "in" ? Math.round(n * 2.54 * 10) / 10 : n;
}

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
  const preselectedExternalId = searchParams.get("externalId");
  const linkLaterFromExhibition = searchParams.get("linkLater") === "1";
  const externalEmailReady =
    !!preselectedExternalEmail &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(preselectedExternalEmail.trim());
  const preservedFromBoard = searchParams.get("fromBoard");
  const { t, locale } = useT();
  const { actingAsProfileId } = useActingAs();
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState<UploadStep>(() => {
    if (!fromExhibition) return "form";
    if (preselectedArtistId) return "form";
    if (preselectedExternalName && (externalEmailReady || linkLaterFromExhibition)) {
      return "form";
    }
    if (preselectedExternalName) return "attribution";
    return "form";
  });
  const [intent, setIntent] = useState<IntentType | null>(fromExhibition ? "CURATED" : "CREATED");

  // Attribution (non-CREATED)
  const [artistSearch, setArtistSearch] = useState("");
  // Phase 3 (QA 2026-07): unified search results (profile + external).
  const [artistResults, setArtistResults] = useState<SearchPeopleWithExternalResult[]>([]);
  /**
   * Phase 3-4: preselected external artist id when the operator re-selected
   * an already-invited artist. Forwarded straight to the create claim RPC
   * so the same external_artists row is reused (no duplicate email).
   */
  const [preselectedExternalArtistId, setPreselectedExternalArtistId] = useState<string | null>(
    preselectedExternalId,
  );
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
  const [externalNoEmail, setExternalNoEmail] = useState(linkLaterFromExhibition);

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
  const [pricingMode, setPricingMode] = useState<"fixed" | "inquire">("inquire");
  const [priceCurrency, setPriceCurrency] = useState("USD");
  const [priceAmount, setPriceAmount] = useState("");
  const [isPricePublic, setIsPricePublic] = useState(false);
  const [myExhibitions, setMyExhibitions] = useState<ExhibitionWithCredits[]>([]);
  const [exhibitionPick, setExhibitionPick] = useState(addToExhibitionId ?? "");
  const [mediumQuery, setMediumQuery] = useState("");
  const [sizeNa, setSizeNa] = useState(false);
  const [dimH, setDimH] = useState("");
  const [dimW, setDimW] = useState("");
  const [dimD, setDimD] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [enhanceTargetId, setEnhanceTargetId] = useState<string | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
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

  useEffect(() => {
    void listMyExhibitions({ forProfileId: actingAsProfileId ?? null }).then(({ data }) => {
      setMyExhibitions(data ?? []);
    });
  }, [actingAsProfileId]);

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

  function currentGaps() {
    return uploadGaps({
      title,
      year,
      medium,
      size,
      sizeNotApplicable: sizeNa,
      pricingMode,
      priceAmount,
      imageCount: images.length,
    });
  }

  function handleFormNext(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const gaps = currentGaps();
    if (gaps.length > 0) {
      setError(gaps.map((gap) => t(uploadGapLabelKey(gap))).join(", "));
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
    };
    const selectedOnboardedId =
      needsAttribution(intent) && selectedArtist && !isExternal ? selectedArtist.id : null;
    const owner = resolveUploadedArtworkArtist({
      sessionUserId: userId,
      actingAsProfileId,
      selectedArtistId: selectedOnboardedId,
    });
    // Insert under the account that can attach images (self, or the
    // principal a delegate is acting for). The chosen artist becomes
    // artist_id after the claim and files exist.
    const holderId = actingAsProfileId ?? userId;
    payload.artist_id = holderId;

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
          const invite = await sendArtistInviteEmailClient({
            toEmail: email,
            artistName: externalArtistName.trim() || null,
            exhibitionTitle: searchParams.get("exhibitionTitle"),
          });
          inviteSent = invite.ok;
          if (!invite.ok) inviteSendFailed = true;
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

      if (owner.artistId !== holderId) {
        const { error: ownerErr } = await assignArtworkArtist(artworkId, owner.artistId);
        if (ownerErr) {
          await rollback();
          logSupabaseError("assignArtworkArtist", ownerErr);
          setError(formatSupabaseError(ownerErr, t, "errors.failedCreateArtwork"));
          setIsSubmitting(false);
          return;
        }
      }

      const linkedExhibitionId = (exhibitionPick || addToExhibitionId || "").trim();
      if (linkedExhibitionId) {
        const { error: addExErr } = await addWorkToExhibition(
          linkedExhibitionId,
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

  function ingestFiles(list: FileList | null, mode: "primary" | "details") {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const oversize = files.find((f) => f.size > getUploadCeilingBytes(f));
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
    const make = (file: File, viewType: ArtworkImageViewType): PendingImage => ({
      id: crypto.randomUUID(),
      file,
      viewType,
      previewUrl: URL.createObjectURL(file),
      displayAdjust: null,
      standardizeOpen: false,
      enhancement: null,
    });
    setImages((prev) => {
      const next = [...prev];
      if (mode === "details") {
        const incoming = [...files];
        if (next.length === 0 && incoming.length > 0) {
          const cover = incoming.shift();
          if (cover) next.push(make(cover, "wall_mounted"));
        }
        for (const file of incoming) next.push(make(file, "detail"));
        return next;
      }
      const [first, ...rest] = files;
      if (!first) return next;
      if (next.length === 0) next.push(make(first, "wall_mounted"));
      else {
        const old = next[0];
        try { URL.revokeObjectURL(old.previewUrl); } catch { /* already revoked */ }
        if (old.enhancement?.previewUrl) {
          try { URL.revokeObjectURL(old.enhancement.previewUrl); } catch { /* already revoked */ }
        }
        next[0] = {
          ...old,
          file: first,
          viewType: "wall_mounted",
          previewUrl: URL.createObjectURL(first),
          displayAdjust: null,
          enhancement: null,
          standardizeOpen: false,
        };
      }
      for (const file of rest) next.push(make(file, "detail"));
      return next;
    });
  }

  const mediumChips = (locale === "ko" ? mediumKo || medium : mediumEn || medium)
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  function setMediumChips(next: string[]) {
    const joined = next.join(", ");
    setMedium(joined);
    if (locale === "ko") setMediumKo(joined);
    else setMediumEn(joined);
  }
  function addMediumChip(raw: string) {
    const value = raw.trim();
    if (!value) return;
    if (mediumChips.some((m) => m.toLowerCase() === value.toLowerCase())) {
      setMediumQuery("");
      return;
    }
    setMediumQuery("");
    setMediumChips([...mediumChips, value]);
  }
  const mediumSuggestions = TAXONOMY.mediumOptions
    .map((opt) => t(opt.labelKey))
    .filter((name) => {
      const q = mediumQuery.trim().toLowerCase();
      if (!q) return false;
      return name.toLowerCase().includes(q) && !mediumChips.some((m) => m.toLowerCase() === name.toLowerCase());
    })
    .slice(0, 6);
  const yearOptions = Array.from({ length: 81 }, (_, i) => String(new Date().getFullYear() - i));
  const coverImage = images[0];
  const detailImages = images.slice(1);
  const formGapText = currentGaps().map((gap) => t(uploadGapLabelKey(gap))).join(", ");
  const coverBlocked = formGapText.length > 0;

  return (
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

        {/* Step: Attribution (OWNS, INVENTORY, CURATED) */}
        {step === "attribution" && needsAttribution(intent) && (
          <div className="space-y-4">
            <label className="block text-sm font-medium text-zinc-900">
              {t("bulk.attributeSomeoneElse")}
              <select
                value={intent ?? "CURATED"}
                onChange={(e) => setIntent(e.target.value as IntentType)}
                className="mt-1 w-full max-w-md rounded border border-zinc-300 bg-white px-3 py-2 text-sm"
              >
                {INTENTS.filter((opt) => opt.value !== "CREATED").map((opt) => (
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
                        const opt: ArtistOption = {
                          id: a.id,
                          username: a.username,
                          display_name: a.display_name,
                          display_name_ko: a.display_name_ko ?? null,
                          display_name_en: a.display_name_en ?? null,
                        };
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
                                // Auto-advance: for onboarded artists the
                                // dropdown already shows the @handle so the
                                // operator has enough context to identify
                                // the right person. Requiring an extra
                                // "Confirm" click was rated confusing in
                                // QA 2026-08-09. External-artist path stays
                                // manual because it still needs name/email.
                                setError(null);
                                setStep("form");
                              }}
                              className={`w-full px-4 py-2 text-left text-sm hover:bg-zinc-50 ${
                                selectedArtist?.id === a.id ? "bg-zinc-100 font-medium" : ""
                              }`}
                            >
                              {formatDisplayName(opt, t, locale)}
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
                              <span>
                                {pickLocalizedDisplayName(a, locale) || a.display_name}
                              </span>
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
                    {t("upload.selectedArtist")}: {formatDisplayName(selectedArtist, t, locale)}
                  </p>
                )}
              </>
            )}
            {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setIntent("CREATED");
                  setSelectedArtist(null);
                  setUseExternalArtist(false);
                  setStep("form");
                }}
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
                    : formatDisplayName(selectedArtist, t, locale)
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
            {intent === "CREATED" && (
              <div className="flex justify-end">
                <button
                  type="button"
                  data-tour="upload-intent-selector"
                  onClick={() => {
                    setIntent("CURATED");
                    setStep("attribution");
                  }}
                  className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800"
                >
                  {t("bulk.attributeSomeoneElse")}
                </button>
              </div>
            )}
            <article className="rounded-md border border-zinc-300 bg-white p-3">
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="w-[88px] shrink-0">
                  <div className="relative h-[88px] w-[88px]">
                    <button
                      type="button"
                      onClick={() => document.getElementById("single-cover-input")?.click()}
                      className="block h-full w-full bg-zinc-200"
                    >
                      {coverImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={coverImage.enhancement?.previewUrl ?? coverImage.previewUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex h-full items-center justify-center text-3xl font-light text-zinc-400">×</span>
                      )}
                    </button>
                    {coverImage && (
                      <button
                        type="button"
                        onClick={() =>
                          setEnhanceTargetId((cur) => (cur === coverImage.id ? null : coverImage.id))
                        }
                        className="absolute bottom-0 left-1/2 z-10 flex -translate-x-1/2 translate-y-1/2 items-center gap-0.5 whitespace-nowrap rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] text-zinc-800 shadow-sm"
                      >
                        {t("bulk.enhance.row")}
                      </button>
                    )}
                  </div>
                  <input
                    id="single-cover-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      ingestFiles(e.target.files, "primary");
                      e.target.value = "";
                    }}
                  />
                  {coverImage && (
                    <p className="mt-4 flex justify-center">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${
                          coverBlocked
                            ? "border-red-400 text-red-500"
                            : "border-emerald-500 text-emerald-600"
                        }`}
                      >
                        {coverBlocked ? t("bulk.statusBlocked") : t("bulk.statusReady")}
                      </span>
                      {coverBlocked && formGapText ? (
                        <span className="mt-1 block text-center text-[10px] leading-snug text-red-600">
                          {formGapText}
                        </span>
                      ) : null}
                    </p>
                  )}
                  <input
                    id="single-detail-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      ingestFiles(e.target.files, "details");
                      e.target.value = "";
                      setDetailsOpen(true);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setDetailsOpen((open) => !open)}
                    aria-expanded={detailsOpen}
                    className="mt-1.5 flex w-full items-center justify-center gap-1 text-[11px] text-zinc-700 underline decoration-zinc-300 underline-offset-2"
                  >
                    <UploadCloudMark className="h-3.5 w-3.5" />
                    {detailsOpen ? t("bulk.details") : t("bulk.cardUpload")}
                    <span aria-hidden>{detailsOpen ? "▴" : "▾"}</span>
                  </button>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_5.25rem_minmax(0,1.35fr)]">
                    <label className="block text-xs text-zinc-800">
                      {t("bulk.tableTitle")}
                      <input
                        value={locale === "ko" ? titleKo || title : titleEn || title}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTitle(v);
                          if (locale === "ko") setTitleKo(v);
                          else setTitleEn(v);
                        }}
                        className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-zinc-800">
                      {t("bulk.year")}
                      <select
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                        required
                        className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                      >
                        <option value=""> </option>
                        {yearOptions.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-800">
                        <span>{t("bulk.size")} *</span>
                        <span className="inline-flex overflow-hidden rounded border border-zinc-300 text-[10px] leading-none">
                          {(["cm", "in"] as const).map((u) => (
                            <button
                              key={u}
                              type="button"
                              onClick={() => {
                                setSizeNa(false);
                                setSizeUnit(u);
                                setSize((prev) => convertSizeString(prev, u));
                              }}
                              className={`px-1.5 py-1 ${
                                !sizeNa && sizeUnit === u ? "bg-zinc-800 text-white" : "bg-zinc-100 text-zinc-500"
                              }`}
                            >
                              {u}
                            </button>
                          ))}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = !sizeNa;
                            setSizeNa(next);
                            if (next) {
                              setSize("");
                              setDimH("");
                              setDimW("");
                              setDimD("");
                            }
                          }}
                          className="inline-flex items-center gap-1 text-zinc-600"
                        >
                          <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${sizeNa ? "border-zinc-800" : "border-zinc-400"}`}>
                            {sizeNa && <span className="h-1.5 w-1.5 rounded-full bg-zinc-800" />}
                          </span>
                          {t("bulk.sizeNotApplicable")}
                        </button>
                      </div>
                      <div className="flex min-w-0 items-center gap-1">
                        <input
                          value={dimH}
                          disabled={sizeNa}
                          inputMode="decimal"
                          placeholder={t("bulk.dimHeight")}
                          aria-label={t("bulk.dimHeight")}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDimH(v);
                            setSizeNa(false);
                            setSize([dimW, v, dimD].map((s) => s.trim()).filter(Boolean).join(" × "));
                          }}
                          className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm disabled:bg-zinc-50 md:w-[4.5rem] md:flex-none"
                        />
                        <span className="text-xs text-zinc-400">×</span>
                        <input
                          value={dimW}
                          disabled={sizeNa}
                          inputMode="decimal"
                          placeholder={t("bulk.dimWidth")}
                          aria-label={t("bulk.dimWidth")}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDimW(v);
                            setSizeNa(false);
                            setSize([v, dimH, dimD].map((s) => s.trim()).filter(Boolean).join(" × "));
                          }}
                          className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm disabled:bg-zinc-50 md:w-[4.5rem] md:flex-none"
                        />
                        <span className="text-xs text-zinc-400">×</span>
                        <input
                          value={dimD}
                          disabled={sizeNa}
                          inputMode="decimal"
                          placeholder={t("bulk.dimDepth")}
                          aria-label={t("bulk.dimDepth")}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDimD(v);
                            setSizeNa(false);
                            setSize([dimW, dimH, v].map((s) => s.trim()).filter(Boolean).join(" × "));
                          }}
                          className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm disabled:bg-zinc-50 md:w-[4.5rem] md:flex-none"
                        />
                      </div>
                      {locale === "ko" && !sizeNa && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-zinc-500">{t("size.hosuLabel")}</span>
                          <input
                            type="number"
                            min={0}
                            value={hosuNumber}
                            onChange={(e) => setHosuNumber(e.target.value)}
                            placeholder={t("size.hosuPlaceholder")}
                            className="h-7 w-14 rounded border border-zinc-300 px-1.5 text-xs"
                          />
                          {(["F", "P", "M"] as const).map((kind) => (
                            <button
                              key={kind}
                              type="button"
                              onClick={() => setHosuType(kind)}
                              className={`rounded-full px-2 py-0.5 text-[11px] ${
                                hosuType === kind ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"
                              }`}
                            >
                              {kind}
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
                              setSize(`${n}${hosuType} (${h.widthCm.toFixed(1)} x ${h.heightCm.toFixed(1)} cm)`);
                              setSizeUnit("cm");
                              setDimH(String(h.heightCm));
                              setDimW(String(h.widthCm));
                              setDimD("");
                              setSizeNa(false);
                              setHosuWarning(null);
                            }}
                            className="rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-700"
                          >
                            {t("size.hosuApply")}
                          </button>
                          {hosuWarning && <p className="text-[11px] text-amber-700">{hosuWarning}</p>}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.35fr)]">
                    <div>
                      <p className="mb-1 text-xs text-zinc-800">
                        {t("bulk.medium")} *
                        <span className="ml-2 font-normal text-zinc-400">{t("bulk.mediumSearch")}</span>
                      </p>
                      <div className="flex items-center rounded border border-zinc-300">
                        <input
                          value={mediumQuery}
                          onChange={(e) => setMediumQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addMediumChip(mediumQuery);
                            }
                          }}
                          placeholder={t("bulk.mediumSearch")}
                          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => addMediumChip(mediumQuery)}
                          className="px-2 text-lg leading-none text-zinc-500"
                          aria-label={t("bulk.mediumAdd")}
                        >
                          +
                        </button>
                      </div>
                      {mediumSuggestions.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {mediumSuggestions.map((name) => (
                            <button
                              key={name}
                              type="button"
                              onClick={() => addMediumChip(name)}
                              className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600"
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      )}
                      {mediumChips.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {mediumChips.map((chip) => (
                            <span key={chip} className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-xs">
                              {chip}
                              <button
                                type="button"
                                aria-label={chip}
                                onClick={() => setMediumChips(mediumChips.filter((m) => m !== chip))}
                                className="text-zinc-400"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <label className="block text-xs text-zinc-800">
                        {t("upload.tabExhibitionShort")}
                        <select
                          value={exhibitionPick}
                          onChange={(e) => setExhibitionPick(e.target.value)}
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
                          value={ownershipStatus}
                          onChange={(e) => setOwnershipStatus(e.target.value)}
                          required
                          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                        >
                          {OWNERSHIP_STATUSES.map((o) => (
                            <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs text-zinc-800">
                        {t("bulk.pricingMode")}
                        <select
                          value={pricingMode}
                          onChange={(e) => setPricingMode(e.target.value as "fixed" | "inquire")}
                          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                        >
                          {PRICING_MODES.map((p) => (
                            <option key={p.value} value={p.value}>{t(p.labelKey)}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  {pricingMode === "fixed" && (
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                      <input
                        type="number"
                        value={priceAmount}
                        onChange={(e) => setPriceAmount(e.target.value)}
                        required
                        min={0}
                        step="any"
                        placeholder={t("bulk.amount")}
                        aria-label={t("bulk.amount")}
                        className="w-28 rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                      <select
                        value={priceCurrency}
                        onChange={(e) => setPriceCurrency(e.target.value)}
                        aria-label={t("bulk.currency")}
                        className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      >
                        {PRICE_CURRENCIES.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-xs text-zinc-600">
                        <input
                          type="checkbox"
                          checked={isPricePublic}
                          onChange={(e) => setIsPricePublic(e.target.checked)}
                        />
                        {t("bulk.pricePublic")}
                      </label>
                    </div>
                  )}
                  {(intent === "INVENTORY" || intent === "CURATED") && (
                    <label className="mt-3 block text-xs text-zinc-800">
                      {t("artwork.periodLabel")} *
                      <select
                        value={periodStatus}
                        onChange={(e) => setPeriodStatus(e.target.value as "past" | "current" | "future")}
                        required
                        className="mt-1 w-full max-w-xs rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                      >
                        <option value="past">{t("artwork.periodPast")}</option>
                        <option value="current">{t("artwork.periodCurrent")}</option>
                        <option value="future">{t("artwork.periodFuture")}</option>
                      </select>
                    </label>
                  )}
                </div>
              </div>

              {detailsOpen && (
                <div className="mt-4">
                  {detailImages.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => document.getElementById("single-detail-input")?.click()}
                      className="flex w-full flex-col items-center rounded border border-zinc-300 px-4 py-8 text-center hover:bg-zinc-50"
                    >
                      <UploadCloudMark className="h-8 w-8 text-zinc-500" />
                      <p className="mt-2 text-xs text-zinc-500">{t("bulk.detailsEmptyLine1")}</p>
                      <p className="text-xs text-zinc-500">
                        {t("bulk.detailsEmptyLine2").replace("{maxMb}", String(UPLOAD_MAX_IMAGE_MB_LABEL))}
                      </p>
                    </button>
                  ) : (
                    <div className="flex items-end gap-3 rounded border border-zinc-300 px-3 py-3">
                      <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
                        {detailImages.map((img) => (
                          <div key={img.id} className="w-16">
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => {
                                  setImages((prev) => {
                                    const removed = prev.find((p) => p.id === img.id);
                                    if (removed) {
                                      try { URL.revokeObjectURL(removed.previewUrl); } catch { /* gone */ }
                                      if (removed.enhancement?.previewUrl) {
                                        try { URL.revokeObjectURL(removed.enhancement.previewUrl); } catch { /* gone */ }
                                      }
                                    }
                                    return prev.filter((p) => p.id !== img.id);
                                  });
                                }}
                                className="absolute -right-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 bg-white text-[10px]"
                                aria-label={t("upload.imageRemove")}
                              >
                                ×
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setEnhanceTargetId((cur) => (cur === img.id ? null : img.id))
                                }
                                className="block h-16 w-16 overflow-hidden border border-zinc-200 bg-zinc-200"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={img.enhancement?.previewUrl ?? img.previewUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              </button>
                              <div className={`h-1 ${coverBlocked ? "bg-red-500" : "bg-emerald-500"}`} />
                            </div>
                            <select
                              value={img.viewType === "wall_mounted" ? "detail" : img.viewType}
                              onChange={(e) => {
                                const v = e.target.value as ArtworkImageViewType;
                                setImages((prev) => prev.map((p) => (p.id === img.id ? { ...p, viewType: v } : p)));
                              }}
                              aria-label={t("upload.imageViewTypeLabel")}
                              className="mt-1 w-full rounded-full border border-zinc-300 bg-white px-1 py-0.5 text-[10px]"
                            >
                              <option value="detail">{t("bulk.view.detail")}</option>
                              <option value="angle">{t("bulk.view.angle")}</option>
                              <option value="in_situ">{t("bulk.view.inSitu")}</option>
                              <option value="other">{t("bulk.view.other")}</option>
                            </select>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => document.getElementById("single-detail-input")?.click()}
                        className="mb-5 flex shrink-0 flex-col items-center gap-1 text-zinc-500"
                      >
                        <UploadCloudMark className="h-8 w-8" />
                        <span className="text-[11px]">{t("bulk.detailsMore")}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </article>

            {(() => {
              const target = images.find((img) => img.id === enhanceTargetId);
              if (!target) return null;
              const widthCm = sizeNa ? null : dimToCm(dimW, sizeUnit);
              const heightCm = sizeNa ? null : dimToCm(dimH, sizeUnit);
              return (
                <BulkEnhanceDialog
                  key={`${target.id}-${target.file.name}-${target.file.size}-${target.file.lastModified}`}
                  artworkId=""
                  artistProfileId={selectedArtist?.id ?? actingAsProfileId ?? null}
                  images={[]}
                  storageOwnerId={null}
                  localFile={target.file}
                  meteringSource={fromExhibition ? "exhibition_single" : "single"}
                  artworkWidthCm={widthCm}
                  artworkHeightCm={heightCm}
                  onCommit={(draft) => {
                    setImages((prev) =>
                      prev.map((p) => {
                        if (p.id !== target.id) return p;
                        if (p.enhancement?.previewUrl && p.enhancement.previewUrl !== draft.previewUrl) {
                          try { URL.revokeObjectURL(p.enhancement.previewUrl); } catch { /* gone */ }
                        }
                        return { ...p, enhancement: draft };
                      }),
                    );
                  }}
                  onClose={() => setEnhanceTargetId(null)}
                  onSaved={() => setEnhanceTargetId(null)}
                />
              );
            })()}

            <div className="rounded-md border border-zinc-200">
              <button
                type="button"
                onClick={() => setStoryOpen((open) => !open)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-zinc-600"
                aria-expanded={storyOpen}
              >
                {t("upload.labelStory")}
                <span>{storyOpen ? "▴" : "▾"}</span>
              </button>
              {storyOpen && (
                <div className="border-t border-zinc-200 px-3 py-3">
                  <BilingualFieldPair
                    label={null}
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
                  <div className="mt-3">
                    <p className="mb-1 text-xs text-zinc-500">{t("bilingual.addEnTitle")}</p>
                    <input
                      value={locale === "ko" ? titleEn : titleKo}
                      onChange={(e) => {
                        if (locale === "ko") setTitleEn(e.target.value);
                        else setTitleKo(e.target.value);
                      }}
                      placeholder={t("upload.placeholderTitle")}
                      className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            {coverImage && formGapText ? (
              <p className="text-sm text-red-700" role="status">{formGapText}</p>
            ) : null}
            {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="flex justify-center pt-2">
              <button
                type="submit"
                className="min-w-[10.5rem] rounded-full border border-zinc-800 px-5 py-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-40"
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
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={<PageShellSkeleton variant="narrow" />}>
      <UploadPageContent />
    </Suspense>
  );
}
