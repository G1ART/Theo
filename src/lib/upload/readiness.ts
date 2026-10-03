import type { MessageKey } from "@/lib/i18n/messages";

/**
 * What single upload and bulk publish both require before the next step.
 * Ownership and pricing are not gaps when blank: both flows use the
 * single-upload defaults (판매 가능 / 문의). Size is required unless the
 * artist marked it not applicable. No extra column stores that mark.
 */
export const DEFAULT_OWNERSHIP_STATUS = "available";
export const DEFAULT_PRICING_MODE = "inquire" as const;

export type UploadGap = "title" | "year" | "medium" | "size" | "image" | "price";

const GAP_LABEL: Record<UploadGap, MessageKey> = {
  title: "bulk.tableTitle",
  year: "bulk.year",
  medium: "bulk.medium",
  size: "bulk.size",
  image: "upload.gap.image",
  price: "bulk.amount",
};

export function uploadGapLabelKey(gap: UploadGap): MessageKey {
  return GAP_LABEL[gap];
}

export function isUploadGap(value: string): value is UploadGap {
  return (
    value === "title" ||
    value === "year" ||
    value === "medium" ||
    value === "size" ||
    value === "image" ||
    value === "price"
  );
}

export function uploadGaps(input: {
  title?: string | null;
  year?: number | string | null;
  medium?: string | null;
  size?: string | null;
  sizeNotApplicable?: boolean;
  pricingMode?: string | null;
  priceAmount?: number | string | null;
  imageCount: number;
}): UploadGap[] {
  const missing: UploadGap[] = [];
  if (!input.title?.trim()) missing.push("title");
  const yearRaw = input.year;
  const yearNum =
    typeof yearRaw === "number"
      ? yearRaw
      : Number.parseInt(String(yearRaw ?? "").trim(), 10);
  if (!Number.isFinite(yearNum) || yearNum < 1000 || yearNum > 9999) {
    missing.push("year");
  }
  if (!input.medium?.trim()) missing.push("medium");
  if (!input.sizeNotApplicable && !input.size?.trim()) missing.push("size");
  if (input.imageCount < 1) missing.push("image");
  const pricing = input.pricingMode?.trim() || DEFAULT_PRICING_MODE;
  if (pricing === "fixed") {
    const amount =
      typeof input.priceAmount === "number"
        ? input.priceAmount
        : Number.parseFloat(String(input.priceAmount ?? "").trim());
    if (!Number.isFinite(amount) || amount <= 0) missing.push("price");
  }
  return missing;
}
