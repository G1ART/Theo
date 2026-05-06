"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getSession, sendMagicLink } from "@/lib/supabase/auth";
import {
  type ArtworkWithLikes,
  canEditArtwork,
  getArtworkById,
  getMyClaim,
  updateArtwork,
  type UpdateArtworkPayload,
} from "@/lib/supabase/artworks";
import { searchPeople } from "@/lib/supabase/artists";
import {
  createClaimForExistingArtist,
  createExternalArtist,
  createExternalArtistAndClaim,
  updateClaim,
} from "@/lib/provenance/rpc";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";
import { sendArtistInviteEmailClient } from "@/lib/email/artistInvite";
import { findHosuSize } from "@/lib/size/hosu";
import { parseSizeWithUnit } from "@/lib/size/format";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";
import { useActingAs } from "@/context/ActingAsContext";
import { ActingAsChip } from "@/components/ActingAsChip";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { ArtworkFieldVisibilityPanel } from "@/components/visibility/ArtworkFieldVisibilityPanel";

type IntentType = "CREATED" | "OWNS" | "INVENTORY" | "CURATED";

const INTENTS: { value: IntentType; labelKey: string }[] = [
  { value: "CREATED", labelKey: "artwork.intent.created" },
  { value: "OWNS", labelKey: "artwork.intent.owns" },
  { value: "INVENTORY", labelKey: "artwork.intent.inventory" },
  { value: "CURATED", labelKey: "artwork.intent.curated" },
];

const OWNERSHIP_STATUSES = [
  { value: "available", labelKey: "upload.ownershipAvailable" },
  { value: "owned", labelKey: "upload.ownershipOwned" },
  { value: "sold", labelKey: "upload.ownershipSold" },
  { value: "not_for_sale", labelKey: "upload.ownershipNotForSale" },
] as const;

const PRICING_MODES = [
  { value: "fixed", labelKey: "artwork.pricing.fixed" },
  { value: "inquire", labelKey: "artwork.pricing.inquire" },
] as const;

const PRICE_CURRENCIES = [
  { value: "USD", label: "USD" },
  { value: "KRW", label: "KRW" },
] as const;

// Soft cap on the artwork "story" textarea — long enough for a paragraph,
// short enough to prevent accidental dumps. Surfaced as a counter beneath
// the textarea (see artwork.story.charCount).
const STORY_MAX_LEN = 2000;

type ArtistOption = { id: string; username: string | null; display_name: string | null };

function EditArtworkContent() {
  const params = useParams();
  const router = useRouter();
  const { t } = useT();
  const id = typeof params.id === "string" ? params.id : "";
  const { actingAsProfileId } = useActingAs();

  const [artwork, setArtwork] = useState<ArtworkWithLikes | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inviteToast, setInviteToast] = useState<"sent" | "failed" | null>(null);

  // Base form
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
  const [provenanceVisible, setProvenanceVisible] = useState(true);

  // Provenance
  const [claimType, setClaimType] = useState<IntentType>("CREATED");
  const [artistSearch, setArtistSearch] = useState("");
  const [artistResults, setArtistResults] = useState<ArtistOption[]>([]);
  const [selectedArtist, setSelectedArtist] = useState<ArtistOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [useExternalArtist, setUseExternalArtist] = useState(false);
  const [externalArtistName, setExternalArtistName] = useState("");
  const [externalArtistEmail, setExternalArtistEmail] = useState("");

  // Effective edit-permission identity: principal first (so the principal's
  // claim wins on edit-screen rehydration when an account-scope delegate
  // is acting on behalf), then the operator's session uid as fallback.
  const effectiveIds = useMemo<string[]>(() => {
    const out: string[] = [];
    if (actingAsProfileId) out.push(actingAsProfileId);
    if (userId && !out.includes(userId)) out.push(userId);
    return out;
  }, [actingAsProfileId, userId]);
  const myClaim = artwork && effectiveIds.length > 0 ? getMyClaim(artwork, effectiveIds) : null;
  // Subject of any claim writes when acting-as is active. RPCs guard this
  // server-side via is_active_account_delegate_writer; passing undefined
  // when there is no acting-as keeps the historical (subject = caller)
  // behaviour intact for solo users.
  const claimSubjectOverride = actingAsProfileId ?? undefined;
  const needsArtistLink = claimType !== "CREATED";

  const doSearchArtists = useCallback(async () => {
    const q = artistSearch.trim();
    if (!q || q.length < 2) {
      setArtistResults([]);
      return;
    }
    setSearching(true);
    const { data } = await searchPeople({ q, roles: ["artist"], limit: 10 });
    setArtistResults(
      (data ?? []).map((p) => ({
        id: p.id,
        username: p.username,
        display_name: p.display_name,
      }))
    );
    setSearching(false);
  }, [artistSearch]);

  useEffect(() => {
    const tm = setTimeout(doSearchArtists, 300);
    return () => clearTimeout(tm);
  }, [artistSearch, doSearchArtists]);

  useEffect(() => {
    if (!id) return;
    getArtworkById(id).then(({ data, error: err }) => {
      setLoading(false);
      if (err) {
        setError(formatSupabaseError(err, t, "errors.failedLoadArtwork"));
        return;
      }
      const a = data as ArtworkWithLikes | null;
      setArtwork(a);
      if (a) {
        setTitle(a.title ?? "");
        setYear(String(a.year ?? ""));
        setMedium(a.medium ?? "");
        setSize(a.size ?? "");
        setStory(a.story ?? "");
        setOwnershipStatus(a.ownership_status ?? "available");
        setPricingMode((a.pricing_mode as "fixed" | "inquire") ?? "fixed");
        setPriceCurrency(a.price_input_currency ?? "USD");
        setPriceAmount(
          a.price_input_amount != null ? String(a.price_input_amount) : ""
        );
        setIsPricePublic(a.is_price_public ?? false);
        setProvenanceVisible((a as { provenance_visible?: boolean | null }).provenance_visible !== false);
      }
    });
  }, [id]);

  useEffect(() => {
    if (!artwork || effectiveIds.length === 0) return;
    const claim = getMyClaim(artwork, effectiveIds);
    if (claim) {
      setClaimType(claim.claim_type as IntentType);
      if (claim.external_artist_id && claim.external_artists) {
        setUseExternalArtist(true);
        setExternalArtistName(claim.external_artists.display_name ?? "");
        setExternalArtistEmail(claim.external_artists.invite_email ?? "");
      }
    } else if (effectiveIds.includes(artwork.artist_id)) {
      setClaimType("CREATED");
    }
    const isCreatedByEffective =
      claim?.claim_type === "CREATED" && effectiveIds.includes(artwork.artist_id);
    const needsArtist = !isCreatedByEffective;
    if (artwork.profiles && needsArtist && !claim?.external_artist_id) {
      setSelectedArtist({
        id: artwork.artist_id,
        username: artwork.profiles.username ?? null,
        display_name: artwork.profiles.display_name ?? null,
      });
    }
  }, [artwork, effectiveIds]);

  useEffect(() => {
    getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (artwork && effectiveIds.length > 0 && !canEditArtwork(artwork, effectiveIds)) {
      router.replace(`/artwork/${id}`);
    }
  }, [artwork, effectiveIds, id, router]);


  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!id || !userId || !artwork) return;
    setError(null);

    const yearNum = parseInt(year, 10);
    if (isNaN(yearNum) || yearNum < 1000 || yearNum > 9999) {
      setError(t("artwork.validation.invalidYear"));
      return;
    }
    if (needsArtistLink) {
      if (useExternalArtist) {
        if (!externalArtistName.trim()) {
          setError(t("artwork.validation.artistNameRequired"));
          return;
        }
      } else if (!selectedArtist) {
        setError(t("artwork.validation.artistRequired"));
        return;
      }
    }
    if (pricingMode === "fixed" && (!priceAmount || parseFloat(priceAmount) <= 0)) {
      setError(t("artwork.validation.invalidPrice"));
      return;
    }

    setSaving(true);

    let inviteSent = false;
    let inviteSendFailed = false;
    const sizeTrimmed = size.trim();
    const sizeWithUnit = sizeTrimmed ? parseSizeWithUnit(sizeTrimmed) : null;
    const payload: UpdateArtworkPayload = {
      title: title.trim() || null,
      year: yearNum,
      medium: medium.trim() || null,
      size: sizeTrimmed || null,
      size_unit: sizeWithUnit?.unit ?? null,
      story: story.trim() || null,
      ownership_status: ownershipStatus,
      pricing_mode: pricingMode,
      is_price_public: pricingMode === "fixed" ? isPricePublic : false,
      price_input_amount:
        pricingMode === "fixed" && priceAmount
          ? parseFloat(priceAmount)
          : null,
      price_input_currency: pricingMode === "fixed" ? priceCurrency : null,
    };

    // CREATED branch routes the artist_id to whichever profile the form
    // is operating on behalf of (principal under acting-as, otherwise
    // the operator). RLS still gates the actual write through
    // `has_active_account_delegate_perm(artist_id, 'manage_artworks')`.
    const createdArtistId = actingAsProfileId ?? userId;
    if (!useExternalArtist && selectedArtist && needsArtistLink) {
      payload.artist_id = selectedArtist.id;
    } else if (claimType === "CREATED") {
      payload.artist_id = createdArtistId;
    }
    payload.provenance_visible = provenanceVisible;

    const { error: updateErr } = await updateArtwork(id, payload, {
      actingSubjectProfileId: actingAsProfileId ?? null,
      auditAction: "artwork.update",
    });
    if (updateErr) {
      setError(formatSupabaseError(updateErr, t, "artwork.errors.failedSave"));
      setSaving(false);
      return;
    }

    if (claimType === "CREATED") {
      const artistProfileId = createdArtistId;
      if (myClaim?.id) {
        const { error: claimErr } = await updateClaim(myClaim.id, {
          claim_type: claimType,
          artist_profile_id: artistProfileId,
          external_artist_id: null,
        });
        if (claimErr) {
          setError(formatSupabaseError(claimErr, t, "artwork.errors.failedUpdateProvenance"));
          setSaving(false);
          return;
        }
      } else {
        const { error: claimErr } = await createClaimForExistingArtist({
          artistProfileId,
          claimType,
          workId: id,
          visibility: "public",
          subjectProfileId: claimSubjectOverride,
        });
        if (claimErr) {
          setError(formatSupabaseError(claimErr, t, "artwork.errors.failedAddProvenance"));
          setSaving(false);
          return;
        }
      }
    } else if (useExternalArtist) {
      if (myClaim?.id) {
        const { data: extId, error: extErr } = await createExternalArtist({
          displayName: externalArtistName.trim(),
          inviteEmail: externalArtistEmail.trim() || null,
        });
        if (extErr || !extId) {
          setError(formatSupabaseError(extErr, t, "artwork.errors.failedAddArtist"));
          setSaving(false);
          return;
        }
        const { error: claimErr } = await updateClaim(myClaim.id, {
          claim_type: claimType,
          artist_profile_id: null,
          external_artist_id: extId,
        });
        if (claimErr) {
          setError(formatSupabaseError(claimErr, t, "artwork.errors.failedUpdateProvenance"));
          setSaving(false);
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
        const { error: claimErr } = await createExternalArtistAndClaim({
          displayName: externalArtistName.trim(),
          inviteEmail: externalArtistEmail.trim() || null,
          claimType,
          workId: id,
          visibility: "public",
          subjectProfileId: claimSubjectOverride,
        });
        if (claimErr) {
          setError(formatSupabaseError(claimErr, t, "artwork.errors.failedAddProvenance"));
          setSaving(false);
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
      }
    } else {
      const artistProfileId = selectedArtist!.id;
      if (myClaim?.id) {
        const { error: claimErr } = await updateClaim(myClaim.id, {
          claim_type: claimType,
          artist_profile_id: artistProfileId,
          external_artist_id: null,
        });
        if (claimErr) {
          setError(formatSupabaseError(claimErr, t, "artwork.errors.failedUpdateProvenance"));
          setSaving(false);
          return;
        }
      } else {
        const { error: claimErr } = await createClaimForExistingArtist({
          artistProfileId,
          claimType,
          workId: id,
          visibility: "public",
          subjectProfileId: claimSubjectOverride,
        });
        if (claimErr) {
          setError(formatSupabaseError(claimErr, t, "artwork.errors.failedAddProvenance"));
          setSaving(false);
          return;
        }
      }
    }

    if (inviteSent || inviteSendFailed) {
      setInviteToast(inviteSent ? "sent" : "failed");
      setTimeout(() => router.push(`/artwork/${id}`), 2000);
    } else {
      router.push(`/artwork/${id}`);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <p className="text-zinc-600">{t("common.loading")}</p>
      </div>
    );
  }

  if (error && !artwork) {
    return (
      <div className="py-12 text-center">
        <p className="text-red-600">{error}</p>
        <Link href={`/artwork/${id}`} className="mt-4 inline-block text-sm text-zinc-600 hover:text-zinc-900">
          ← {t("artwork.backToArtwork")}
        </Link>
      </div>
    );
  }

  if (!artwork) {
    return null;
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      {inviteToast && (
        <div
          className={`fixed bottom-4 right-4 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
            inviteToast === "sent" ? "bg-zinc-900" : "bg-amber-600"
          }`}
        >
          {inviteToast === "sent" ? t("upload.inviteSent") : t("upload.inviteSentFailed")}
        </div>
      )}
      <Link
        href={`/artwork/${id}`}
        className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900"
      >
        ← {t("artwork.backToArtwork")}
      </Link>
      <h1 className="mb-6 text-xl font-semibold">{t("artwork.editTitle")}</h1>

      <ActingAsChip mode="editing" />

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("artwork.field.title")} *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder={t("artwork.field.titlePlaceholder")}
              className="w-full rounded border border-zinc-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("artwork.field.year")} *</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              required
              min={1000}
              max={9999}
              placeholder={t("artwork.field.yearPlaceholder")}
              className="w-full rounded border border-zinc-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("artwork.field.medium")} *</label>
            <input
              type="text"
              value={medium}
              onChange={(e) => setMedium(e.target.value)}
              required
              placeholder={t("artwork.field.mediumPlaceholder")}
              className="w-full rounded border border-zinc-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("artwork.field.size")} *</label>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <span className="text-xs text-zinc-500">{t("artwork.size.hosu")}</span>
              <input
                type="number"
                min={0}
                className="h-8 w-16 rounded border border-zinc-300 px-2 text-xs"
                placeholder="30"
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
                className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
              >
                {t("artwork.size.apply")}
              </button>
              {hosuWarning && (
                <p className="mt-1 text-xs text-amber-700">{hosuWarning}</p>
              )}
            </div>
            <input
              type="text"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              required
              placeholder={t("artwork.field.sizePlaceholder")}
              className="w-full rounded border border-zinc-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("artwork.field.story")}</label>
            <textarea
              value={story}
              onChange={(e) => {
                const next = e.target.value;
                setStory(next.length > STORY_MAX_LEN ? next.slice(0, STORY_MAX_LEN) : next);
              }}
              placeholder={t("artwork.field.storyPlaceholder")}
              rows={4}
              maxLength={STORY_MAX_LEN}
              className="w-full rounded border border-zinc-300 px-3 py-2"
            />
            <p className="mt-1 text-right text-xs text-zinc-500">
              {t("artwork.story.charCount").replace("{count}", String(story.length))}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("artwork.field.ownership")} *</label>
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
          <div>
            <label className="mb-1 block text-sm font-medium">{t("artwork.field.pricingMode")} *</label>
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
                  <label className="mb-1 block text-sm font-medium">{t("artwork.field.currency")}</label>
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
                  <label className="mb-1 block text-sm font-medium">{t("artwork.field.amount")} *</label>
                  <input
                    type="number"
                    value={priceAmount}
                    onChange={(e) => setPriceAmount(e.target.value)}
                    required={pricingMode === "fixed"}
                    min={0}
                    step="any"
                    placeholder={t("artwork.field.amountPlaceholder")}
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
                  {t("artwork.field.showPricePublicly")}
                </label>
              </div>
            </>
          )}
        </div>

        <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-4">
          <h2 className="mb-2 font-medium text-zinc-900">{t("artwork.provenanceTitle")}</h2>
          <p className="mb-4 text-sm text-zinc-600">{t("artwork.provenanceHint")}</p>
          <div className="mb-4 flex items-center gap-2">
            <input
              type="checkbox"
              id="provenanceVisible"
              checked={provenanceVisible}
              onChange={(e) => setProvenanceVisible(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="provenanceVisible" className="text-sm text-zinc-700">
              {t("artwork.provenanceVisibleLabel")}
            </label>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">{t("artwork.claimType")}</label>
              <div className="grid gap-2">
                {INTENTS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setClaimType(opt.value)}
                    className={`w-full rounded-lg border px-4 py-2 text-left text-sm font-medium ${
                      claimType === opt.value
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300"
                    }`}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
            </div>
            {needsArtistLink && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-sm font-medium">{t("artwork.linkArtist")}</label>
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
                    {useExternalArtist
                      ? t("artwork.searchArtist")
                      : t("artwork.artistNotOnPlatform")}
                  </button>
                </div>
                {useExternalArtist ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={externalArtistName}
                      onChange={(e) => setExternalArtistName(e.target.value)}
                      placeholder={t("artwork.externalArtistNamePlaceholder")}
                      className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                    />
                    <input
                      type="email"
                      value={externalArtistEmail}
                      onChange={(e) => setExternalArtistEmail(e.target.value)}
                      placeholder={t("artwork.externalArtistEmailPlaceholder")}
                      className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-zinc-500">
                      {t("artwork.externalArtistEmailHint")}
                    </p>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={artistSearch}
                      onChange={(e) => setArtistSearch(e.target.value)}
                      placeholder={t("artwork.field.artistSearchPlaceholder")}
                      className="mb-2 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                    />
                    {searching && (
                      <p className="text-sm text-zinc-500">
                        {t("artwork.field.artistSearching")}
                      </p>
                    )}
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
                      <p className="mt-2 text-sm text-zinc-600">
                        {t("artwork.field.artistSelected").replace(
                          "{name}",
                          formatDisplayName(selectedArtist)
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        <div className="flex gap-3">
          <Link
            href={`/artwork/${id}`}
            className="rounded border border-zinc-300 px-4 py-2 text-sm"
          >
            {t("common.cancel")}
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? t("common.loading") : t("common.save")}
          </button>
        </div>
      </form>

      {artwork && userId && artwork.artist_id === userId && (
        <ArtworkFieldVisibilityPanel
          ownerProfileId={userId}
          artworkId={artwork.id}
        />
      )}
    </main>
  );
}

export default function EditArtworkPage() {
  return (
    <AuthGate>
      <EditArtworkContent />
    </AuthGate>
  );
}
