"use client";

import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, sendMagicLink } from "@/lib/supabase/auth";
import {
  attachArtworkImage,
  createArtwork,
  deleteArtwork,
  type CreateArtworkPayload,
} from "@/lib/supabase/artworks";
import { removeStorageFile, uploadArtworkImage } from "@/lib/supabase/storage";
import { searchPeople } from "@/lib/supabase/artists";
import {
  createClaimForExistingArtist,
  createExternalArtistAndClaim,
  searchWorksForDedup,
} from "@/lib/provenance/rpc";
import type { ClaimType } from "@/lib/provenance/types";
import { setArtworkBack } from "@/lib/artworkBack";
import { addWorkToExhibition } from "@/lib/supabase/exhibitions";
import { logSupabaseError } from "@/lib/supabase/errors";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { AuthGate } from "@/components/AuthGate";
import { useActingAs } from "@/context/ActingAsContext";
import { ActingAsChip } from "@/components/ActingAsChip";
import { PageShellSkeleton } from "@/components/ds/PageShellSkeleton";
import { useT } from "@/lib/i18n/useT";
import { sendArtistInviteEmailClient } from "@/lib/email/artistInvite";
import { findHosuSize } from "@/lib/size/hosu";
import { parseSizeWithUnit } from "@/lib/size/format";
import { getAndClearPendingExhibitionFiles } from "@/lib/pendingExhibitionUpload";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";
import { UPLOAD_MAX_IMAGE_BYTES, UPLOAD_MAX_IMAGE_MB_LABEL } from "@/lib/upload/limits";
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
  const { t, locale } = useT();
  const { actingAsProfileId } = useActingAs();
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState<UploadStep>(fromExhibition ? "form" : "intent");
  const [intent, setIntent] = useState<IntentType | null>(fromExhibition ? "CURATED" : null);

  // Attribution (non-CREATED)
  const [artistSearch, setArtistSearch] = useState("");
  const [artistResults, setArtistResults] = useState<ArtistOption[]>([]);
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
  const [externalArtistEmail, setExternalArtistEmail] = useState(preselectedExternalEmail ?? "");

  // Form
  const [image, setImage] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [medium, setMedium] = useState("");
  const [size, setSize] = useState("");
  const [hosuNumber, setHosuNumber] = useState("");
  const [hosuType, setHosuType] = useState<"F" | "P" | "M" | "S" | "">("");
  const [hosuWarning, setHosuWarning] = useState<string | null>(null);
  const [story, setStory] = useState("");
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
      setImage(pending.files[0]);
      setStep("form");
    }
  }, [fromExhibition, addToExhibitionId, preselectedArtistId, preselectedExternalName]);

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
    if (!image || !title.trim() || !year || !medium.trim() || !size.trim()) {
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

    if (!image || !userId) {
      setError(!userId ? t("common.notAuthenticated") : t("common.pleaseSelectImage"));
      return;
    }

    const yearNum = parseInt(year, 10);
    if (isNaN(yearNum) || yearNum < 1000 || yearNum > 9999) {
      setError(t("common.pleaseEnterValidYear"));
      return;
    }

    const sizeTrimmed = size.trim();
    const sizeWithUnit = sizeTrimmed ? parseSizeWithUnit(sizeTrimmed) : null;
    const isExternal = needsAttribution(intent) && useExternalArtist;
    const payload: CreateArtworkPayload = {
      title: title.trim(),
      year: yearNum,
      medium: medium.trim(),
      size: sizeTrimmed,
      size_unit: sizeWithUnit?.unit ?? null,
      story: story.trim() || null,
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
          inviteEmail: externalArtistEmail.trim() || null,
          claimType,
          workId: artworkId,
          visibility: "public",
          ...claimPayload,
          // Acting-as: when delegate uploads on behalf of the principal,
          // the claim must be filed under the principal so the artwork
          // surfaces on their profile (not the operator's). RPC enforces
          // the delegation writer check before honouring this override.
          subjectProfileId: actingAsProfileId ?? undefined,
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

      let storagePath: string | null = null;
      try {
        // When acting-as, route the image into the *principal's* folder
        // so lifecycle (delete/replace/cleanup) stays principal-rooted
        // even if the operator's delegation is later revoked. Storage
        // RLS allows account-scope writer delegates to upload into the
        // principal's folder (see 20260510000000_artworks_storage_account_delegate.sql).
        const storageOwner = actingAsProfileId ?? userId;
        storagePath = await uploadArtworkImage(image, storageOwner);
      } catch (uploadErr) {
        await deleteArtwork(artworkId);
        setError(formatSingleUploadFailure(uploadErr, t));
        setIsSubmitting(false);
        return;
      }

      const { error: attachErr } = await attachArtworkImage(artworkId, storagePath);
      if (attachErr) {
        await removeStorageFile(storagePath);
        await deleteArtwork(artworkId);
        logSupabaseError("attachArtworkImage", attachErr);
        setError(formatSupabaseError(attachErr, t, "errors.failedAttachImage"));
        setIsSubmitting(false);
        return;
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
      if (inviteSent || inviteSendFailed) {
        setInviteToast(inviteSent ? "sent" : "failed");
        setTimeout(() => {
          if (addToExhibitionId?.trim()) {
            router.push(`/my/exhibitions/${addToExhibitionId.trim()}`);
          } else if (username) {
            router.push(`/u/${username}`);
          } else {
            setArtworkBack("/upload");
            router.push(`/artwork/${artworkId}`);
          }
        }, 2000);
      } else {
        if (addToExhibitionId?.trim()) {
          router.push(`/my/exhibitions/${addToExhibitionId.trim()}`);
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
        {inviteToast && (
          <div
            className={`fixed bottom-4 right-4 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
              inviteToast === "sent" ? "bg-zinc-900" : "bg-amber-600"
            }`}
          >
            {inviteToast === "sent" ? t("upload.inviteSent") : t("upload.inviteSentFailed")}
          </div>
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
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                />
                <input
                  type="email"
                  value={externalArtistEmail}
                  onChange={(e) => setExternalArtistEmail(e.target.value)}
                  placeholder={t("upload.externalArtistEmailPlaceholder")}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                />
                <p className="text-xs text-zinc-500">{t("upload.externalArtistEmailHint")}</p>
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
                    {artistResults.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedArtist(a);
                            setArtistResults([]);
                            setArtistSearch("");
                          }}
                          className={`w-full px-4 py-2 text-left text-sm hover:bg-zinc-50 ${
                            selectedArtist?.id === a.id ? "bg-zinc-100 font-medium" : ""
                          }`}
                        >
                          {formatDisplayName(a)}
                          {a.username && (
                            <span className="ml-2 text-zinc-500">{formatUsername(a)}</span>
                          )}
                        </button>
                      </li>
                    ))}
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
                {t("common.next")}
              </button>
            </div>
          </div>
        )}

        {/* Step: Form */}
        {step === "form" && (
          <form onSubmit={handleFormNext} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">{t("common.imageLabel")}</label>
              <input
                type="file"
                accept="image/*"
                required
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && f.size > UPLOAD_MAX_IMAGE_BYTES) {
                    setError(
                      t("upload.fileTooLarge").replace("{maxMb}", String(UPLOAD_MAX_IMAGE_MB_LABEL)),
                    );
                    setImage(null);
                    e.target.value = "";
                    return;
                  }
                  setError(null);
                  setImage(f);
                }}
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                {t("upload.screenSizeHint").replace("{maxMb}", String(UPLOAD_MAX_IMAGE_MB_LABEL))}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("upload.labelTitle")}</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder={t("upload.placeholderTitle")}
                className="w-full rounded border border-zinc-300 px-3 py-2"
              />
            </div>
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
              <label className="mb-1 block text-sm font-medium">{t("upload.labelMedium")}</label>
              <input
                type="text"
                value={medium}
                onChange={(e) => setMedium(e.target.value)}
                required
                placeholder={t("upload.placeholderMedium")}
                className="w-full rounded border border-zinc-300 px-3 py-2"
              />
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
              <input
                type="text"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                required
                placeholder={t("upload.placeholderSize")}
                className="w-full rounded border border-zinc-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("upload.labelStory")}</label>
              <textarea
                value={story}
                onChange={(e) => {
                  const next = e.target.value;
                  setStory(next.length > 2000 ? next.slice(0, 2000) : next);
                }}
                placeholder={t("artwork.field.storyPlaceholder")}
                rows={4}
                maxLength={2000}
                className="w-full rounded border border-zinc-300 px-3 py-2"
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
