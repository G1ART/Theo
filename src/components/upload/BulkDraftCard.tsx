"use client";

import { useEffect, useRef, useState } from "react";
import {
  getArtworkImageUrl,
  validatePublish,
  type ArtworkImageViewType,
  type ArtworkWithLikes,
  type UpdateArtworkPayload,
} from "@/lib/supabase/artworks";
import type { ExhibitionWithCredits } from "@/lib/supabase/exhibitions";
import { useT } from "@/lib/i18n/useT";
import { BilingualFieldPair } from "@/components/i18n/BilingualFieldPair";
import { ExtraViewRolePicker } from "@/components/upload/ExtraViewRolePicker";
import { registrationViewLabelKey } from "@/lib/upload/extraViewRoles";
import { pickLocalizedTitle } from "@/lib/i18n/pickLocalized";
import { registrationBilingualFields, withPendingLocaleMedium } from "@/lib/upload/registrationCopy";
import { TAXONOMY } from "@/lib/profile/taxonomy";
import { isUploadGap, uploadGapLabelKey } from "@/lib/upload/readiness";

const OWNERSHIP_OPTIONS = [
  { value: "available", labelKey: "upload.ownershipAvailable" },
  { value: "owned", labelKey: "upload.ownershipOwned" },
  { value: "sold", labelKey: "upload.ownershipSold" },
  { value: "not_for_sale", labelKey: "upload.ownershipNotForSale" },
] as const;

const PRICE_CURRENCIES = ["USD", "KRW"] as const;

function splitMedium(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Width × height × depth when the string actually has two dimensions. "30호" stays a size label. */
function readDims(size: string | null | undefined): { w: string; h: string; d: string } {
  const raw = (size ?? "").trim();
  const dim = raw.match(
    /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?/i,
  );
  if (!dim) return { w: "", h: "", d: "" };
  return { w: dim[1] ?? "", h: dim[2] ?? "", d: dim[3] ?? "" };
}

function writeSize(w: string, h: string, d: string): string | null {
  const parts = [w, h, d].map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts.join(" × ") : null;
}

export function UploadCloudMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5-1.5A3.5 3.5 0 0 0 7 18z"
        strokeLinejoin="round"
      />
      <path d="M12 16V10m0 0-2.2 2.2M12 10l2.2 2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8.2 1.2 9 3.6l2.4.8-2.4.8L8.2 7.6 7.4 5.2 5 4.4l2.4-.8.8-2.4zM3.2 8.4l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5.5-1.4zM12.4 9.2l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1z" />
    </svg>
  );
}

const field =
  "w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400";
const label = "mb-1 block text-xs text-zinc-800";

type Props = {
  draft: ArtworkWithLikes;
  bulkVersion: number;
  selected: boolean;
  dropActive: boolean;
  exhibitions: ExhibitionWithCredits[];
  exhibitionId: string;
  onToggle: () => void;
  onEnhance: (storagePath: string) => void;
  onAddFiles: (files: FileList | null) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  sizeNotApplicable: boolean;
  onSizeNotApplicable: (na: boolean) => void;
  onSave: (patch: UpdateArtworkPayload) => void | Promise<void>;
  onLinkExhibition: (exhibitionId: string) => void;
  onSetViewType: (storagePath: string, viewType: ArtworkImageViewType) => void;
  onRemoveDetail: (storagePath: string) => void;
  onPublish: () => void;
  publishing: boolean;
  tabChoices?: { id: string; label: string }[] | null;
  tabId?: string | null;
  onTabId?: (id: string) => void;
};

export function BulkDraftCard({
  draft,
  bulkVersion,
  selected,
  dropActive,
  exhibitions,
  exhibitionId,
  onToggle,
  onEnhance,
  onAddFiles,
  onDragOver,
  onDragLeave,
  sizeNotApplicable,
  onSizeNotApplicable,
  onSave,
  onLinkExhibition,
  onSetViewType,
  onRemoveDetail,
  onPublish,
  publishing,
  tabChoices = null,
  tabId = null,
  onTabId,
}: Props) {
  const { t, locale } = useT();
  const images = [...(draft.artwork_images ?? [])]
    .filter((img) => {
      const view = img.view_type ?? "";
      return view !== "cutout" && view !== "cutout_alpha";
    })
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const cover = images[0];
  const details = images.slice(1);
  const thumb = cover ? getArtworkImageUrl(cover.storage_path, "thumb") : null;
  const publishState = validatePublish(draft, { sizeNotApplicable });
  const ready = publishState.ok;
  const gapText = publishState.missing
    .filter(isUploadGap)
    .map((gap) => t(uploadGapLabelKey(gap)))
    .join(", ");
  const dims = readDims(draft.size);
  const [width, setWidth] = useState(dims.w);
  const [height, setHeight] = useState(dims.h);
  const [depth, setDepth] = useState(dims.d);
  const sizeNa = sizeNotApplicable;
  const [mediums, setMediums] = useState<string[]>(() =>
    splitMedium(locale === "ko" ? draft.medium_ko || draft.medium : draft.medium_en || draft.medium),
  );
  const [mediumQuery, setMediumQuery] = useState("");
  const [mediumAltOpen, setMediumAltOpen] = useState(
    () => Boolean((locale === "ko" ? draft.medium_en : draft.medium_ko)?.trim()),
  );
  const [mediumAlt, setMediumAlt] = useState(
    () => (locale === "ko" ? draft.medium_en ?? "" : draft.medium_ko ?? ""),
  );
  const mediumAltDirty = useRef(false);
  const [titleKo, setTitleKo] = useState(draft.title_ko ?? (locale === "ko" ? draft.title ?? "" : ""));
  const [titleEn, setTitleEn] = useState(draft.title_en ?? (locale === "ko" ? "" : draft.title ?? ""));
  const [storyKo, setStoryKo] = useState(draft.story_ko ?? (locale === "ko" ? draft.story ?? "" : ""));
  const [storyEn, setStoryEn] = useState(draft.story_en ?? (locale === "ko" ? "" : draft.story ?? ""));
  const [storyOpen, setStoryOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(details.length > 0);
  const [priceAmount, setPriceAmount] = useState(
    draft.price_input_amount != null ? String(draft.price_input_amount) : "",
  );
  const [priceCurrency, setPriceCurrency] = useState(draft.price_input_currency || "USD");

  useEffect(() => {
    const next = readDims(draft.size);
    setWidth(next.w);
    setHeight(next.h);
    setDepth(next.d);
    if (!mediumQuery.trim()) {
      setMediums(splitMedium(locale === "ko" ? draft.medium_ko || draft.medium : draft.medium_en || draft.medium));
    }
    if (!mediumAltDirty.current) {
      setMediumAlt(locale === "ko" ? draft.medium_en ?? "" : draft.medium_ko ?? "");
    }
    setTitleKo(draft.title_ko ?? (locale === "ko" ? draft.title ?? "" : ""));
    setTitleEn(draft.title_en ?? (locale === "ko" ? "" : draft.title ?? ""));
    setStoryKo(draft.story_ko ?? (locale === "ko" ? draft.story ?? "" : ""));
    setStoryEn(draft.story_en ?? (locale === "ko" ? "" : draft.story ?? ""));
    setPriceAmount(draft.price_input_amount != null ? String(draft.price_input_amount) : "");
    setPriceCurrency(draft.price_input_currency || "USD");
  }, [draft.id, bulkVersion, draft.size, draft.medium, draft.medium_ko, draft.medium_en, draft.title, draft.title_ko, draft.title_en, draft.story, draft.story_ko, draft.story_en, draft.price_input_amount, draft.price_input_currency, locale]);

  useEffect(() => {
    const patch: UpdateArtworkPayload = {};
    if (!draft.ownership_status) patch.ownership_status = "available";
    if (!draft.pricing_mode) patch.pricing_mode = "inquire";
    if (Object.keys(patch).length === 0) return;
    onSave(patch);
    // Heal drafts created before the single-upload defaults. One write per id.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSave identity changes every render
  }, [draft.id, draft.ownership_status, draft.pricing_mode]);

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 81 }, (_, i) => String(thisYear - i));
  if (draft.year && !years.includes(String(draft.year))) {
    years.unshift(String(draft.year));
  }
  const unit = draft.size_unit === "in" ? "in" : "cm";
  const suggestions = TAXONOMY.mediumOptions
    .map((opt) => t(opt.labelKey))
    .filter((name) => {
      const q = mediumQuery.trim().toLowerCase();
      if (!q) return false;
      return name.toLowerCase().includes(q) && !mediums.some((m) => m.toLowerCase() === name.toLowerCase());
    })
    .slice(0, 6);

  function commitSize(next: { w?: string; h?: string; d?: string; na?: boolean; unit?: "cm" | "in" }) {
    const w = next.w ?? width;
    const h = next.h ?? height;
    const d = next.d ?? depth;
    const na = next.na ?? sizeNa;
    const nextUnit = next.unit ?? (draft.size_unit === "in" ? "in" : "cm");
    if (na) {
      onSave({ size: null, size_unit: null });
      return;
    }
    const written = writeSize(w, h, d);
    if (!written) {
      const existing = (draft.size ?? "").trim();
      if (existing && !readDims(existing).w) return;
    }
    onSave({ size: written, size_unit: nextUnit });
  }

  function commitCopy(
    next: {
      titleKo?: string;
      titleEn?: string;
      mediumKo?: string;
      mediumEn?: string;
      storyKo?: string;
      storyEn?: string;
    },
    part: "title" | "medium" | "story",
  ) {
    const localeKey = locale === "ko" ? "ko" : "en";
    const mergedMedium = withPendingLocaleMedium({
      locale: localeKey,
      mediumKo: next.mediumKo ?? (locale === "ko" ? mediums.join(", ") : mediumAlt || draft.medium_ko || ""),
      mediumEn: next.mediumEn ?? (locale === "ko" ? mediumAlt || draft.medium_en || "" : mediums.join(", ")),
      pending: part === "medium" ? mediumQuery : "",
    });
    const fields = registrationBilingualFields({
      titleKo: next.titleKo ?? titleKo,
      titleEn: next.titleEn ?? titleEn,
      mediumKo: mergedMedium.mediumKo,
      mediumEn: mergedMedium.mediumEn,
      storyKo: next.storyKo ?? storyKo,
      storyEn: next.storyEn ?? storyEn,
      title: draft.title ?? "",
      medium: draft.medium ?? "",
      story: draft.story ?? "",
    });
    if (part === "title") {
      onSave({ title: fields.title, title_ko: fields.title_ko, title_en: fields.title_en });
      return;
    }
    if (part === "medium") {
      mediumAltDirty.current = false;
      setMediums(splitMedium(locale === "ko" ? mergedMedium.mediumKo : mergedMedium.mediumEn));
      setMediumAlt(locale === "ko" ? mergedMedium.mediumEn : mergedMedium.mediumKo);
      setMediumQuery("");
      return onSave({ medium: fields.medium, medium_ko: fields.medium_ko, medium_en: fields.medium_en });
    }
    onSave({ story: fields.story, story_ko: fields.story_ko, story_en: fields.story_en });
  }

  function commitMedium(next: string[]) {
    setMediums(next);
    const joined = next.join(", ");
    if (locale === "ko") commitCopy({ mediumKo: joined, mediumEn: mediumAlt }, "medium");
    else commitCopy({ mediumEn: joined, mediumKo: mediumAlt }, "medium");
  }

  function addMedium(raw: string) {
    const value = raw.trim();
    if (!value) return;
    if (mediums.some((m) => m.toLowerCase() === value.toLowerCase())) {
      setMediumQuery("");
      return;
    }
    setMediumQuery("");
    commitMedium([...mediums, value]);
  }

  function commitPrice(amount: string, currency: string) {
    const n = parseFloat(amount);
    onSave({
      pricing_mode: "fixed",
      price_input_amount: Number.isFinite(n) ? n : null,
      price_input_currency: currency || null,
    });
  }

  const fileId = `bulk-add-${draft.id}`;

  return (
    <article
      className={`rounded-md border bg-white p-3 ${
        selected ? "border-zinc-400" : "border-zinc-300"
      }`}
    >
      {tabChoices && onTabId && (
        <label className="mb-3 block text-xs text-zinc-700">
          {t("profile.tabs.uploadPick")}
          <select
            value={tabId ?? ""}
            onChange={(e) => onTabId(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">{t("profile.tabs.uploadNone")}</option>
            {tabChoices.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="flex shrink-0 gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          onClick={onToggle}
          aria-label={draft.title?.trim() || t("bulk.group.untitled")}
          className={`mt-8 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            selected ? "border-blue-600 bg-blue-600" : "border-zinc-400 bg-white"
          }`}
        >
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </button>

        <div className="w-28 shrink-0">
          <div
            className={`relative bg-zinc-100 ${dropActive ? "ring-2 ring-zinc-900" : ""}`}
            onDragOver={(e) => {
              if (![...e.dataTransfer.types].includes("Files")) return;
              e.preventDefault();
              onDragOver();
            }}
            onDragLeave={onDragLeave}
            onDrop={(e) => {
              e.preventDefault();
              onAddFiles(e.dataTransfer.files);
            }}
          >
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumb}
                alt=""
                className="block h-auto max-h-40 w-full object-contain"
              />
            ) : (
              <div className="flex h-28 items-center justify-center text-zinc-400">
                <span className="text-3xl font-light leading-none">×</span>
              </div>
            )}
          </div>
          {cover?.storage_path && (
            <button
              type="button"
              onClick={() => onEnhance(cover.storage_path)}
              className="mt-1 flex w-full items-center justify-center gap-0.5 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              <WandMark className="h-3 w-3" />
              {t("bulk.enhance.row")}
            </button>
          )}
          <button
            type="button"
            onClick={() => document.getElementById(fileId)?.click()}
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-1 py-1 text-[10px] leading-tight text-zinc-800 hover:bg-zinc-50"
          >
            {t("bulk.cardUpload")}
          </button>
          <p className="mt-4 flex justify-center">
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${
                ready ? "border-emerald-500 text-emerald-600" : "border-red-400 text-red-500"
              }`}
            >
              {ready ? t("bulk.statusReady") : t("bulk.statusBlocked")}
            </span>
            {!ready && gapText ? (
              <span className="mt-1 block text-center text-[10px] leading-snug text-red-600">
                {gapText}
              </span>
            ) : null}
          </p>
          <input
            id={fileId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              onAddFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (!mediumQuery.trim() && !mediumAltDirty.current) {
                onPublish();
                return;
              }
              void Promise.resolve(commitCopy({}, "medium")).then(() => onPublish());
            }}
            disabled={!ready || publishing}
            className="mt-2 w-full rounded-full bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
          >
            {t("bulk.cardPublish")}
          </button>
        </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_5.25rem_minmax(0,1.35fr)]">
            <BilingualFieldPair
              label={t("bulk.tableTitle")}
              addKoKey="bilingual.addKoTitle"
              addEnKey="bilingual.addEnTitle"
              placeholderKo={t("bulk.tableTitle")}
              placeholderEn={t("bulk.tableTitle")}
              valueKo={titleKo}
              valueEn={titleEn}
              onChangeKo={(v) => setTitleKo(v)}
              onChangeEn={(v) => setTitleEn(v)}
              onBlur={() => commitCopy({ titleKo, titleEn }, "title")}
            />
            <label className={label}>
              {t("bulk.year")}
              <select
                defaultValue={draft.year != null ? String(draft.year) : ""}
                key={`year-${draft.id}-${bulkVersion}`}
                className={`${field} mt-1`}
                onChange={(e) =>
                  onSave({ year: e.target.value ? parseInt(e.target.value, 10) : null })
                }
              >
                <option value=""> </option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-800">
                <span>
                  {t("bulk.size")} <span className="text-zinc-900">*</span>
                </span>
                <span className="inline-flex overflow-hidden rounded border border-zinc-300 text-[10px] leading-none">
                  {(["cm", "in"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => {
                        onSizeNotApplicable(false);
                        commitSize({ unit: u, na: false });
                      }}
                      className={`px-1.5 py-1 ${
                        !sizeNa && unit === u ? "bg-zinc-800 text-white" : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </span>
                <button
                  type="button"
                  role="radio"
                  aria-checked={sizeNa}
                  onClick={() => {
                    const na = !sizeNa;
                    onSizeNotApplicable(na);
                    commitSize({ na });
                  }}
                  className="inline-flex items-center gap-1 font-normal text-zinc-600"
                >
                  <span
                    className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
                      sizeNa ? "border-zinc-800" : "border-zinc-400"
                    }`}
                  >
                    {sizeNa && <span className="h-1.5 w-1.5 rounded-full bg-zinc-800" />}
                  </span>
                  {t("bulk.sizeNotApplicable")}
                </button>
              </div>
              <div className="flex min-w-0 items-center gap-1">
                <input
                  value={height}
                  disabled={sizeNa}
                  inputMode="decimal"
                  placeholder={t("bulk.dimHeight")}
                  aria-label={t("bulk.dimHeight")}
                  onChange={(e) => setHeight(e.target.value)}
                  onBlur={() => commitSize({ h: height })}
                  className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:bg-zinc-50 md:w-[4.5rem] md:flex-none"
                />
                <span className="text-xs text-zinc-400">×</span>
                <input
                  value={width}
                  disabled={sizeNa}
                  inputMode="decimal"
                  placeholder={t("bulk.dimWidth")}
                  aria-label={t("bulk.dimWidth")}
                  onChange={(e) => setWidth(e.target.value)}
                  onBlur={() => commitSize({ w: width })}
                  className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:bg-zinc-50 md:w-[4.5rem] md:flex-none"
                />
                <span className="text-xs text-zinc-400">×</span>
                <input
                  value={depth}
                  disabled={sizeNa}
                  inputMode="decimal"
                  placeholder={t("bulk.dimDepth")}
                  aria-label={t("bulk.dimDepth")}
                  onChange={(e) => setDepth(e.target.value)}
                  onBlur={() => commitSize({ d: depth })}
                  className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:bg-zinc-50 md:w-[4.5rem] md:flex-none"
                />
              </div>
              {draft.size && !readDims(draft.size).w && (
                <p className="mt-1 text-[11px] text-zinc-500">{draft.size}</p>
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.35fr)]">
            <div>
              <p className={label}>
                {t("bulk.medium")} <span>*</span>
                <span className="ml-2 font-normal text-zinc-400">{t("bulk.mediumSearch")}</span>
              </p>
              <div className="flex items-center rounded border border-zinc-300 bg-white">
                <input
                  value={mediumQuery}
                  onChange={(e) => setMediumQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addMedium(mediumQuery);
                    }
                  }}
                  placeholder={t("bulk.mediumSearch")}
                  className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-zinc-400"
                />
                <button
                  type="button"
                  onClick={() => addMedium(mediumQuery)}
                  className="px-2 text-lg leading-none text-zinc-500 hover:text-zinc-900"
                  aria-label={t("bulk.mediumAdd")}
                >
                  +
                </button>
              </div>
              {suggestions.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {suggestions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => addMedium(name)}
                      className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-50"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
              {mediums.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {mediums.map((chip) => (
                    <span
                      key={chip}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-800"
                    >
                      {chip}
                      <button
                        type="button"
                        className="text-zinc-400 hover:text-zinc-800"
                        aria-label={chip}
                        onClick={() => commitMedium(mediums.filter((m) => m !== chip))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setMediumAltOpen((open) => !open)}
                className="mt-2 text-[11px] text-zinc-600 underline underline-offset-2"
              >
                {locale === "ko" ? t("bilingual.addEnMedium") : t("bilingual.addKoMedium")}
              </button>
              {mediumAltOpen && (
                <input
                  value={mediumAlt}
                  onChange={(e) => {
                    mediumAltDirty.current = true;
                    setMediumAlt(e.target.value);
                  }}
                  onBlur={(e) => {
                    const v = e.currentTarget.value;
                    setMediumAlt(v);
                    if (locale === "ko") commitCopy({ mediumEn: v }, "medium");
                    else commitCopy({ mediumKo: v }, "medium");
                  }}
                  placeholder={t("artwork.field.mediumPlaceholder")}
                  className={`${field} mt-1`}
                />
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className={label}>
                {t("upload.tabExhibitionShort")}
                <select
                  value={exhibitionId}
                  onChange={(e) => onLinkExhibition(e.target.value)}
                  className={`${field} mt-1`}
                >
                  <option value="">{t("bulk.exhibitionSelectorPlaceholder")}</option>
                  {exhibitions.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {pickLocalizedTitle(ex, locale) || ex.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                {t("bulk.ownershipStatus")}
                <select
                  defaultValue={draft.ownership_status || "available"}
                  key={`own-${draft.id}-${bulkVersion}`}
                  className={`${field} mt-1`}
                  onChange={(e) => onSave({ ownership_status: e.target.value || null })}
                >
                  <option value=""> </option>
                  {OWNERSHIP_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                {t("bulk.pricingMode")}
                <select
                  defaultValue={draft.pricing_mode || "inquire"}
                  key={`price-${draft.id}-${bulkVersion}`}
                  className={`${field} mt-1`}
                  onChange={(e) => {
                    const mode = e.target.value;
                    if (mode === "inquire" || mode === "fixed") onSave({ pricing_mode: mode });
                    else onSave({ pricing_mode: null });
                  }}
                >
                  <option value=""> </option>
                  <option value="inquire">{t("bulk.inquire")}</option>
                  <option value="fixed">{t("bulk.fixed")}</option>
                </select>
              </label>
            </div>
          </div>
          {draft.pricing_mode === "fixed" && (
            <div className="mt-2 flex justify-end gap-2">
              <input
                value={priceAmount}
                onChange={(e) => setPriceAmount(e.target.value)}
                onBlur={() => commitPrice(priceAmount, priceCurrency)}
                inputMode="decimal"
                placeholder={t("bulk.amount")}
                aria-label={t("bulk.amount")}
                className="w-28 rounded border border-zinc-300 px-2 py-1.5 text-sm"
              />
              <select
                value={priceCurrency}
                onChange={(e) => {
                  setPriceCurrency(e.target.value);
                  commitPrice(priceAmount, e.target.value);
                }}
                aria-label={t("bulk.currency")}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              >
                {PRICE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setDetailsOpen((open) => !open)}
        aria-expanded={detailsOpen}
        className="mt-3 flex w-full items-start justify-between gap-3 rounded border border-zinc-300 px-3 py-2 text-left hover:bg-zinc-50"
      >
        <span>
          <span className="flex items-center gap-1 text-xs font-medium text-zinc-900">
            <UploadCloudMark className="h-3.5 w-3.5" />
            {t("bulk.extraImages")}
          </span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-500">
            {t("bulk.extraImagesHint")}
          </span>
        </span>
        <span aria-hidden className="text-zinc-500">{detailsOpen ? "▴" : "▾"}</span>
      </button>

      {detailsOpen && (
        <div className="mt-4">
          {details.length === 0 ? (
            <button
              type="button"
              onClick={() => document.getElementById(fileId)?.click()}
              className="flex w-full flex-col items-center rounded border border-zinc-300 px-4 py-8 text-center hover:bg-zinc-50"
            >
              <UploadCloudMark className="h-8 w-8 text-zinc-500" />
              <p className="mt-2 text-xs font-medium text-zinc-800">{t("bulk.cardUpload")}</p>
              <p className="mt-1 text-xs text-zinc-500">{t("bulk.extraImagesHint")}</p>
              <p className="text-xs text-zinc-500">
                {t("bulk.dropLine2")}
              </p>
            </button>
          ) : (
            <div className="flex items-end gap-3 rounded border border-zinc-300 px-3 py-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
                {details.map((detail, index) => {
                  const detailThumb = getArtworkImageUrl(detail.storage_path, "thumb");
                  return (
                    <div key={detail.storage_path || `${draft.id}-d-${index}`} className="w-36">
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => onRemoveDetail(detail.storage_path)}
                          className="absolute -right-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 bg-white text-[10px] leading-none text-zinc-600 hover:text-zinc-900"
                          aria-label={t("upload.imageRemove")}
                        >
                          ×
                        </button>
                        <div className="h-16 w-16 overflow-hidden border border-zinc-200 bg-zinc-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={detailThumb} alt="" className="h-full w-full object-contain" />
                        </div>
                        <div className={`h-1 ${ready ? "bg-emerald-500" : "bg-red-500"}`} />
                      </div>
                      <button
                        type="button"
                        onClick={() => onEnhance(detail.storage_path)}
                        aria-label={`${t("bulk.enhance.row")} ${t(registrationViewLabelKey(detail.view_type))}`}
                        className="mt-1 flex w-16 items-center justify-center gap-0.5 rounded border border-zinc-300 bg-white px-1 py-0.5 text-[10px] text-zinc-800 shadow-sm hover:bg-zinc-50"
                      >
                        <WandMark className="h-3 w-3" />
                        {t("bulk.enhance.row")}
                      </button>
                      <ExtraViewRolePicker
                        value={detail.view_type}
                        onChange={(viewType) => onSetViewType(detail.storage_path, viewType)}
                      />
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => document.getElementById(fileId)?.click()}
                className="mb-5 flex shrink-0 flex-col items-center gap-1 text-zinc-500 hover:text-zinc-800"
              >
                <UploadCloudMark className="h-8 w-8" />
                <span className="text-[11px]">{t("bulk.cardUpload")}</span>
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 rounded-md border border-zinc-200">
        <button
          type="button"
          onClick={() => setStoryOpen((open) => !open)}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-zinc-700"
          aria-expanded={storyOpen}
        >
          {t("artwork.field.story")}
          <span aria-hidden>{storyOpen ? "▴" : "▾"}</span>
        </button>
        {storyOpen && (
          <div className="border-t border-zinc-200 px-3 py-3">
            <BilingualFieldPair
              label={null}
              addKoKey="bilingual.addKoStory"
              addEnKey="bilingual.addEnStory"
              placeholderKo={t("artwork.field.storyPlaceholder")}
              placeholderEn={t("artwork.field.storyPlaceholder")}
              valueKo={storyKo}
              valueEn={storyEn}
              onChangeKo={(v) => setStoryKo(v.length > 2000 ? v.slice(0, 2000) : v)}
              onChangeEn={(v) => setStoryEn(v.length > 2000 ? v.slice(0, 2000) : v)}
              onBlur={() => commitCopy({ storyKo, storyEn }, "story")}
              as="textarea"
              rows={4}
              maxLength={2000}
            />
          </div>
        )}
      </div>
    </article>
  );
}
