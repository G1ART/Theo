"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  getArtworkImageUrl,
  validatePublish,
  type ArtworkWithLikes,
  type UpdateArtworkPayload,
} from "@/lib/supabase/artworks";
import type { ExhibitionWithCredits } from "@/lib/supabase/exhibitions";
import { useT } from "@/lib/i18n/useT";
import { pickLocalizedTitle } from "@/lib/i18n/pickLocalized";
import { TAXONOMY } from "@/lib/profile/taxonomy";
import { UPLOAD_MAX_IMAGE_MB_LABEL } from "@/lib/upload/limits";

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

/** Existing `size` strings are width × height × depth. */
function readDims(size: string | null | undefined): { w: string; h: string; d: string } {
  const nums = (size ?? "").match(/\d+(?:\.\d+)?/g) ?? [];
  return { w: nums[0] ?? "", h: nums[1] ?? "", d: nums[2] ?? "" };
}

function writeSize(w: string, h: string, d: string): string | null {
  const parts = [w, h, d].map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts.join(" × ") : null;
}

function viewLabelKey(view: string): string {
  if (view === "angle") return "bulk.view.angle";
  if (view === "in_situ") return "bulk.view.inSitu";
  if (view === "other") return "bulk.view.other";
  return "bulk.view.detail";
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

type Props = {
  draft: ArtworkWithLikes;
  bulkVersion: number;
  selected: boolean;
  dropActive: boolean;
  exhibitions: ExhibitionWithCredits[];
  exhibitionId: string;
  onToggle: () => void;
  onEnhance: () => void;
  onAddFiles: (files: FileList | null) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onSave: (patch: UpdateArtworkPayload) => void;
  onLinkExhibition: (exhibitionId: string) => void;
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
  onSave,
  onLinkExhibition,
}: Props) {
  const { t, locale } = useT();
  const images = [...(draft.artwork_images ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const cover = images[0];
  const details = images.slice(1);
  const thumb = cover ? getArtworkImageUrl(cover.storage_path, "thumb") : null;
  const publishState = validatePublish(draft);
  const ready = publishState.ok;
  const dims = readDims(draft.size);
  const [width, setWidth] = useState(dims.w);
  const [height, setHeight] = useState(dims.h);
  const [depth, setDepth] = useState(dims.d);
  const [sizeNa, setSizeNa] = useState(!draft.size?.trim());
  const [mediums, setMediums] = useState<string[]>(() => splitMedium(draft.medium));
  const [mediumQuery, setMediumQuery] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [priceAmount, setPriceAmount] = useState(
    draft.price_input_amount != null ? String(draft.price_input_amount) : "",
  );
  const [priceCurrency, setPriceCurrency] = useState(draft.price_input_currency || "USD");

  useEffect(() => {
    const next = readDims(draft.size);
    setWidth(next.w);
    setHeight(next.h);
    setDepth(next.d);
    setSizeNa(!draft.size?.trim());
    setMediums(splitMedium(draft.medium));
    setPriceAmount(draft.price_input_amount != null ? String(draft.price_input_amount) : "");
    setPriceCurrency(draft.price_input_currency || "USD");
  }, [draft.id, bulkVersion, draft.size, draft.medium, draft.price_input_amount, draft.price_input_currency]);

  const field = "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900";
  const label = "block text-[11px] text-zinc-500";
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
    onSave({ size: writeSize(w, h, d), size_unit: nextUnit });
  }

  function commitMedium(next: string[]) {
    setMediums(next);
    const medium = next.join(", ");
    const patch: UpdateArtworkPayload = { medium };
    if (locale === "ko") patch.medium_ko = medium || null;
    else patch.medium_en = medium || null;
    onSave(patch);
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
    <article className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1 h-4 w-4 accent-zinc-900"
          aria-label={draft.title?.trim() || t("bulk.group.untitled")}
        />
        <div className="w-[92px] shrink-0">
          <div
            className={`relative h-[92px] w-[92px] overflow-hidden rounded-md bg-zinc-100 ${
              dropActive ? "ring-2 ring-zinc-900" : ""
            }`}
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
              <Image
                src={thumb}
                alt=""
                width={92}
                height={92}
                sizes="92px"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-zinc-300">
                <UploadCloudMark className="h-8 w-8" />
              </div>
            )}
            {cover?.storage_path && (
              <button
                type="button"
                onClick={onEnhance}
                className="absolute bottom-1 left-1 right-1 rounded-full bg-white/95 py-0.5 text-[10px] font-medium text-zinc-800 shadow-sm hover:bg-white"
              >
                {t("bulk.enhance.row")}
              </button>
            )}
          </div>
          <p
            className={`mt-1.5 flex items-center justify-center gap-1 text-[11px] font-medium ${
              ready ? "text-emerald-600" : "text-red-600"
            }`}
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
            {ready ? t("bulk.statusReady") : t("bulk.statusBlocked")}
          </p>
          <input
            id={fileId}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onAddFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => document.getElementById(fileId)?.click()}
            className="mt-1 flex w-full items-center justify-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-900"
          >
            <UploadCloudMark className="h-3.5 w-3.5" />
            {t("bulk.cardUpload")}
          </button>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1.3fr)]">
            <label className={label}>
              {t("bulk.tableTitle")}
              <input
                type="text"
                defaultValue={draft.title ?? ""}
                key={`title-${draft.id}-${bulkVersion}`}
                className={`${field} mt-0.5`}
                onBlur={(e) => {
                  const title = e.target.value;
                  const patch: UpdateArtworkPayload = { title };
                  if (locale === "ko") patch.title_ko = title || null;
                  else patch.title_en = title || null;
                  onSave(patch);
                }}
              />
            </label>
            <label className={label}>
              {t("bulk.year")}
              <select
                defaultValue={draft.year != null ? String(draft.year) : ""}
                key={`year-${draft.id}-${bulkVersion}`}
                className={`${field} mt-0.5`}
                onChange={(e) =>
                  onSave({ year: e.target.value ? parseInt(e.target.value, 10) : null })
                }
              >
                <option value="">—</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <div className={label}>
              <span className="flex flex-wrap items-center gap-2">
                {t("bulk.size")}
                <span className="inline-flex overflow-hidden rounded-md border border-zinc-200 text-[10px] font-medium">
                  {(["cm", "in"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => {
                        setSizeNa(false);
                        commitSize({ unit: u, na: false });
                      }}
                      className={`px-1.5 py-0.5 ${
                        !sizeNa && unit === u ? "bg-zinc-900 text-white" : "bg-white text-zinc-500"
                      }`}
                    >
                      {u.toUpperCase()}
                    </button>
                  ))}
                </span>
                <label className="inline-flex items-center gap-1 font-normal text-zinc-500">
                  <input
                    type="checkbox"
                    checked={sizeNa}
                    onChange={(e) => {
                      const na = e.target.checked;
                      setSizeNa(na);
                      commitSize({ na });
                    }}
                    className="h-3 w-3 accent-zinc-900"
                  />
                  {t("bulk.sizeNotApplicable")}
                </label>
              </span>
              <div className="mt-0.5 flex items-center gap-1">
                <input
                  value={height}
                  disabled={sizeNa}
                  inputMode="decimal"
                  placeholder={t("bulk.dimHeight")}
                  aria-label={t("bulk.dimHeight")}
                  onChange={(e) => setHeight(e.target.value)}
                  onBlur={() => commitSize({ h: height })}
                  className={`${field} w-14 disabled:bg-zinc-50`}
                />
                <span className="text-zinc-300">×</span>
                <input
                  value={width}
                  disabled={sizeNa}
                  inputMode="decimal"
                  placeholder={t("bulk.dimWidth")}
                  aria-label={t("bulk.dimWidth")}
                  onChange={(e) => setWidth(e.target.value)}
                  onBlur={() => commitSize({ w: width })}
                  className={`${field} w-14 disabled:bg-zinc-50`}
                />
                <span className="text-zinc-300">×</span>
                <input
                  value={depth}
                  disabled={sizeNa}
                  inputMode="decimal"
                  placeholder={t("bulk.dimDepth")}
                  aria-label={t("bulk.dimDepth")}
                  onChange={(e) => setDepth(e.target.value)}
                  onBlur={() => commitSize({ d: depth })}
                  className={`${field} w-14 disabled:bg-zinc-50`}
                />
              </div>
            </div>
          </div>

          <div>
            <p className={label}>{t("bulk.medium")} *</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {mediums.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-800"
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
                className="min-w-[8rem] flex-1 rounded-md border border-zinc-200 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => addMedium(mediumQuery)}
                className="rounded-full border border-zinc-300 px-2 py-0.5 text-sm text-zinc-700 hover:bg-zinc-50"
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
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <label className={label}>
              {t("upload.tabExhibitionShort")}
              <select
                value={exhibitionId}
                onChange={(e) => onLinkExhibition(e.target.value)}
                className={`${field} mt-0.5`}
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
                defaultValue={draft.ownership_status ?? ""}
                key={`own-${draft.id}-${bulkVersion}`}
                className={`${field} mt-0.5`}
                onChange={(e) => onSave({ ownership_status: e.target.value || null })}
              >
                <option value="">—</option>
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
                defaultValue={draft.pricing_mode ?? ""}
                key={`price-${draft.id}-${bulkVersion}`}
                className={`${field} mt-0.5`}
                onChange={(e) => {
                  const mode = e.target.value;
                  if (mode === "inquire" || mode === "fixed") onSave({ pricing_mode: mode });
                  else onSave({ pricing_mode: null });
                }}
              >
                <option value="">—</option>
                <option value="inquire">{t("bulk.inquire")}</option>
                <option value="fixed">{t("bulk.fixed")}</option>
              </select>
            </label>
          </div>
          {draft.pricing_mode === "fixed" && (
            <div className="flex flex-wrap gap-2">
              <input
                value={priceAmount}
                onChange={(e) => setPriceAmount(e.target.value)}
                onBlur={() => commitPrice(priceAmount, priceCurrency)}
                inputMode="decimal"
                placeholder={t("bulk.fixedPrice")}
                className="w-28 rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
              />
              <select
                value={priceCurrency}
                onChange={(e) => {
                  setPriceCurrency(e.target.value);
                  commitPrice(priceAmount, e.target.value);
                }}
                className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
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

      <div className="mt-3 border-t border-zinc-100 pt-2">
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800"
          aria-expanded={detailsOpen}
        >
          <span aria-hidden>{detailsOpen ? "▴" : "▾"}</span>
          {t("bulk.details")}
        </button>
        {detailsOpen && (
          <div className="mt-2">
            {details.length === 0 ? (
              <button
                type="button"
                onClick={() => document.getElementById(fileId)?.click()}
                className="flex w-full flex-col items-center rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-center hover:bg-zinc-50"
              >
                <UploadCloudMark className="h-7 w-7 text-zinc-400" />
                <p className="mt-2 max-w-md text-xs leading-relaxed text-zinc-500">
                  {t("bulk.detailsEmpty").replace("{maxMb}", String(UPLOAD_MAX_IMAGE_MB_LABEL))}
                </p>
              </button>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                {details.map((detail, index) => {
                  const detailThumb = getArtworkImageUrl(detail.storage_path, "thumb");
                  const viewKey = viewLabelKey(String(detail.view_type ?? "detail"));
                  return (
                    <div key={detail.storage_path || `${draft.id}-d-${index}`} className="w-16">
                      <div className="h-16 overflow-hidden rounded border border-zinc-200 bg-zinc-100">
                        <Image
                          src={detailThumb}
                          alt=""
                          width={64}
                          height={64}
                          sizes="64px"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <p className="mt-0.5 truncate text-center text-[10px] text-zinc-500">{t(viewKey)}</p>
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => document.getElementById(fileId)?.click()}
                  className="flex w-16 flex-col items-center gap-1 pb-4 text-zinc-400 hover:text-zinc-700"
                >
                  <UploadCloudMark className="h-8 w-8" />
                  <span className="text-[10px]">{t("bulk.detailsMore")}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
