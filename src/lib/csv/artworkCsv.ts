import { fieldForHeader, type CsvField } from "./columns";
import { parseCsv } from "./parse";
import { parseSizeToDimensionsCm, type ArtworkDimensionsCm } from "@/lib/size/format";

export type OwnershipStatus = "available" | "owned" | "sold" | "not_for_sale";

export type PriceKind = "empty" | "inquire" | "fixed" | "unmatched";

export type ArtworkCsvRow = {
  title: string;
  year: number | null;
  medium: string | null;
  size: string | null;
  sizeUnit: "cm" | "in" | null;
  /** Numeric amount only when `priceKind` is `fixed`. Never a stripped guess. */
  price: number | null;
  priceKind: PriceKind;
  priceRaw: string | null;
  currency: string | null;
  currencyUnmatched: boolean;
  filename: string | null;
  ownership: OwnershipStatus | null;
  /** Set when the cell is non-empty and not one of the app's ownership labels. */
  ownershipRaw: string | null;
  story: string | null;
  /** Explicit pricing_mode column, when the cell is exactly fixed or inquire. */
  pricingMode: "fixed" | "inquire" | null;
  rowNumber: number;
};

export type CaptionPatch = {
  title?: string;
  title_ko?: string | null;
  title_en?: string | null;
  year?: number;
  medium?: string;
  medium_ko?: string | null;
  medium_en?: string | null;
  size?: string;
  size_unit?: "cm" | "in" | null;
  story?: string;
  story_ko?: string | null;
  story_en?: string | null;
  ownership_status?: OwnershipStatus;
  pricing_mode?: "fixed" | "inquire";
  price_input_amount?: number;
  price_input_currency?: string;
};

const OWNERSHIP_BY_KEY: Record<string, OwnershipStatus> = {
  available: "available",
  판매가능: "available",
  owned: "owned",
  소장중: "owned",
  sold: "sold",
  판매완료: "sold",
  notforsale: "not_for_sale",
  privatecollection: "not_for_sale",
  비공개소장: "not_for_sale",
};

function ownershipKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_\-]+/g, "");
}

export function parseOwnershipCell(raw: string): OwnershipStatus | null {
  const text = raw.trim();
  if (!text) return null;
  return OWNERSHIP_BY_KEY[ownershipKey(text)] ?? null;
}

function parseYear(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1000 && n <= 9999 ? n : null;
}

const INQUIRE_KEYS = new Set([
  "문의",
  "가격문의",
  "inquire",
  "tbd",
  "t.b.d.",
  "t.b.d",
  "uponrequest",
  "priceuponrequest",
  "priceonrequest",
  "n/a",
  "na",
  "미정",
]);

/**
 * Plain digits and thousands separators become that amount.
 * "120만원" becomes 1,200,000. "문의" / TBD stay inquire.
 * Anything we cannot read safely is unmatched — never a stripped leftover like 120.
 */
export function parsePriceCell(raw: string): { kind: PriceKind; amount: number | null } {
  const text = raw.trim();
  if (!text) return { kind: "empty", amount: null };
  const folded = text.replace(/\s+/g, " ").trim();
  const compact = folded.replace(/\s+/g, "").toLowerCase();
  if (
    INQUIRE_KEYS.has(compact) ||
    (!/\d/.test(folded) && /문의|inquire|\btbd\b|upon request|price on request/i.test(folded))
  ) {
    return { kind: "inquire", amount: null };
  }
  if (/\d\s*[-~～]\s*\d/.test(folded)) return { kind: "unmatched", amount: null };

  const noComma = folded.replace(/,/g, "").replace(/\s+/g, "");
  const man = noComma.match(/^([0-9]+(?:\.[0-9]+)?)만(?:원)?$/);
  if (man) {
    const n = Number(man[1]) * 10_000;
    if (Number.isFinite(n) && n > 0) return { kind: "fixed", amount: Math.round(n) };
    return { kind: "unmatched", amount: null };
  }
  const eok = noComma.match(/^([0-9]+(?:\.[0-9]+)?)억(?:원)?$/);
  if (eok) {
    const n = Number(eok[1]) * 100_000_000;
    if (Number.isFinite(n) && n > 0) return { kind: "fixed", amount: Math.round(n) };
    return { kind: "unmatched", amount: null };
  }
  if (/만|억/.test(noComma)) return { kind: "unmatched", amount: null };

  let plain = noComma;
  plain = plain.replace(/^(?:usd|krw|eur|gbp|jpy|₩|\$|€|£|¥)/i, "");
  plain = plain.replace(/(?:usd|krw|eur|gbp|jpy|원|won)$/i, "");
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(plain)) {
    const n = Number(plain);
    if (Number.isFinite(n) && n > 0) return { kind: "fixed", amount: n };
  }
  return { kind: "unmatched", amount: null };
}

function parseCurrency(raw: string): { code: string | null; unmatched: boolean } {
  const text = raw.trim();
  if (!text) return { code: null, unmatched: false };
  const compact = text.replace(/\s+/g, "").toUpperCase();
  if (compact === "KRW" || compact === "원" || text === "₩" || compact === "WON") {
    return { code: "KRW", unmatched: false };
  }
  if (compact === "USD" || text === "$" || compact === "US$") {
    return { code: "USD", unmatched: false };
  }
  if (/^[A-Z]{3}$/.test(compact)) return { code: compact, unmatched: false };
  return { code: null, unmatched: true };
}

function parsePricingMode(raw: string): "fixed" | "inquire" | null {
  const key = raw.trim().toLowerCase().replace(/[\s_]+/g, "");
  if (!key) return null;
  if (key === "fixed" || key === "고정") return "fixed";
  if (key === "inquire" || key === "문의") return "inquire";
  return null;
}

function sizeUnitFrom(size: string | null, explicit: string | null): "cm" | "in" | null {
  const hint = `${explicit ?? ""} ${size ?? ""}`.toLowerCase();
  if (/\b(in|inch|inches)\b|인치/.test(hint)) return "in";
  if (/\bcm\b|센티/.test(hint)) return "cm";
  return null;
}

type ColKey =
  | "title"
  | "year"
  | "medium"
  | "size"
  | "sizeUnit"
  | "price"
  | "currency"
  | "filename"
  | "ownership"
  | "story"
  | "pricingMode";

function isDirectField(field: CsvField): field is "title" | "year" | "medium" | "size" | "price" | "currency" | "filename" | "story" {
  return (
    field === "title" ||
    field === "year" ||
    field === "medium" ||
    field === "size" ||
    field === "price" ||
    field === "currency" ||
    field === "filename" ||
    field === "story"
  );
}

export function parseArtworkCsv(text: string): { rows: ArtworkCsvRow[]; hasFilename: boolean } {
  const { headers, rows } = parseCsv(text);
  const index: Partial<Record<ColKey, number>> = {};
  headers.forEach((h, i) => {
    const field = fieldForHeader(h);
    if (!field) return;
    if (field === "size_unit") {
      if (index.sizeUnit == null) index.sizeUnit = i;
      return;
    }
    if (field === "ownership_status") {
      if (index.ownership == null) index.ownership = i;
      return;
    }
    if (field === "pricing_mode") {
      if (index.pricingMode == null) index.pricingMode = i;
      return;
    }
    if (!isDirectField(field) || index[field] != null) return;
    index[field] = i;
  });
  if (index.title == null) return { rows: [], hasFilename: false };

  const parsed = rows
    .map((cells, sourceIndex) => {
      const cell = (key: ColKey) => {
        const i = index[key];
        return i == null ? "" : (cells[i] ?? "").trim();
      };
      const size = cell("size") || null;
      const filename = cell("filename") || null;
      const priceCell = parsePriceCell(cell("price"));
      const currencyCell = parseCurrency(cell("currency"));
      const ownershipText = cell("ownership");
      const ownership = parseOwnershipCell(ownershipText);
      const story = cell("story") || null;
      return {
        title: cell("title") || "Untitled",
        year: parseYear(cell("year")),
        medium: cell("medium") || null,
        size,
        sizeUnit: sizeUnitFrom(size, cell("sizeUnit") || null),
        price: priceCell.amount,
        priceKind: priceCell.kind,
        priceRaw: cell("price") || null,
        currency: currencyCell.code,
        currencyUnmatched: currencyCell.unmatched,
        filename,
        ownership,
        ownershipRaw: ownershipText && !ownership ? ownershipText : null,
        story,
        pricingMode: parsePricingMode(cell("pricingMode")),
        rowNumber: sourceIndex + 1,
      } satisfies ArtworkCsvRow;
    })
    .filter(
      (row) =>
        row.title !== "Untitled" ||
        row.filename ||
        row.year ||
        row.medium ||
        row.size ||
        row.priceKind !== "empty" ||
        row.ownership ||
        row.ownershipRaw ||
        row.story ||
        row.currency ||
        row.pricingMode,
    );

  return { rows: parsed, hasFilename: index.filename != null };
}

export function fileStem(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  return base.replace(/\.[a-z0-9]{2,5}$/i, "").trim().toLowerCase();
}

/** Strip extension, then treat spaces, underscores, and hyphens as the same. */
export function filenameKey(name: string): string {
  return fileStem(name).replace(/[\s_\-]+/g, "");
}

export function filenamesMatch(a: string, b: string): boolean {
  const left = filenameKey(a);
  const right = filenameKey(b);
  return left.length > 0 && left === right;
}

export function csvFilenameMatchesDraft(
  filename: string,
  draft: { title: string | null; storagePaths: string[]; originalName?: string | null },
): boolean {
  if (draft.originalName && filenamesMatch(filename, draft.originalName)) return true;
  if (draft.title && filenamesMatch(filename, draft.title)) return true;
  const stem = fileStem(filename);
  if (!stem) return false;
  const ascii = stem.replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "");
  if (!ascii) return false;
  return draft.storagePaths.some((path) => {
    const base = (path.split("/").pop() ?? "").toLowerCase();
    const stored = base.replace(/\.[a-z0-9]+$/, "");
    return stored === ascii || stored.endsWith(`-${ascii}`);
  });
}

export function isCaptionCsvFile(file: { name: string; type?: string | null }): boolean {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".tsv")) return true;
  const type = (file.type || "").toLowerCase();
  return type === "text/csv" || type === "text/tab-separated-values";
}

export function captionRowLabel(row: ArtworkCsvRow, index: number): string {
  if (row.title && row.title !== "Untitled") return row.title;
  if (row.filename) return row.filename;
  return String(row.rowNumber || index + 1);
}

export function buildCaptionPatch(
  row: ArtworkCsvRow,
  locale: "ko" | "en",
): { patch: CaptionPatch; dims: ArtworkDimensionsCm | null; issues: string[] } {
  const patch: CaptionPatch = {};
  const issues: string[] = [];
  const label = captionRowLabel(row, row.rowNumber - 1);
  const ko = locale === "ko";

  if (row.title && row.title !== "Untitled") {
    patch.title = row.title;
    if (ko) patch.title_ko = row.title;
    else patch.title_en = row.title;
  }
  if (row.year) patch.year = row.year;
  if (row.medium) {
    patch.medium = row.medium;
    if (ko) patch.medium_ko = row.medium;
    else patch.medium_en = row.medium;
  }
  if (row.size) {
    patch.size = row.size;
    if (row.sizeUnit) patch.size_unit = row.sizeUnit;
  }
  if (row.story) {
    patch.story = row.story;
    if (ko) patch.story_ko = row.story;
    else patch.story_en = row.story;
  }
  if (row.ownership) patch.ownership_status = row.ownership;
  else if (row.ownershipRaw) issues.push(`${label} (${row.ownershipRaw})`);

  if (row.priceKind === "fixed" && row.price != null && row.price > 0) {
    patch.pricing_mode = "fixed";
    patch.price_input_amount = row.price;
    if (row.currency) patch.price_input_currency = row.currency;
  } else if (row.priceKind === "inquire") {
    patch.pricing_mode = "inquire";
  } else if (row.priceKind === "unmatched") {
    issues.push(row.priceRaw ? `${label} (${row.priceRaw})` : label);
  } else if (row.pricingMode) {
    patch.pricing_mode = row.pricingMode;
    if (row.currency) patch.price_input_currency = row.currency;
  } else if (row.currency) {
    patch.price_input_currency = row.currency;
  }

  if (row.currencyUnmatched && row.priceKind !== "unmatched") {
    issues.push(label);
  }

  let dims: ArtworkDimensionsCm | null = null;
  if (row.size) {
    const parsed = parseSizeToDimensionsCm(row.size, row.sizeUnit);
    if (parsed && parsed.widthCm > 0 && parsed.heightCm > 0) dims = parsed;
  }

  return { patch, dims, issues };
}

export type CaptionImageRef = {
  key: string;
  originalName: string;
  draftId: string | null;
};

export type CaptionDraftRef = {
  id: string;
  title: string | null;
  hasPhoto: boolean;
  storagePaths: string[];
  originalName?: string | null;
};

export type CaptionFill = {
  rowIndex: number;
  imageKey: string | null;
  draftId: string | null;
};

export type CaptionPlan = {
  fills: CaptionFill[];
  /** Row indexes that may become photo-less drafts. Only when nothing on screen has a photo. */
  photoLess: number[];
  unmatched: { rowIndex: number; label: string }[];
};

/**
 * Match CSV rows to this batch.
 * Filename column: original file name, then a draft whose title still equals that name.
 * No filename column: only when the row count equals this batch, in the order images were added.
 * Photo-less drafts are not planned while a photo is already in the batch or on screen.
 */
export function planBulkCaptions(input: {
  rows: ArtworkCsvRow[];
  hasFilename: boolean;
  images: CaptionImageRef[];
  drafts: CaptionDraftRef[];
}): CaptionPlan {
  const { rows, hasFilename, images, drafts } = input;
  const photosOnScreen = images.length > 0 || drafts.some((d) => d.hasPhoto);

  if (!hasFilename) {
    if (images.length > 0 && images.length === rows.length) {
      return {
        fills: rows.map((_, rowIndex) => ({
          rowIndex,
          imageKey: images[rowIndex]!.key,
          draftId: images[rowIndex]!.draftId,
        })),
        photoLess: [],
        unmatched: [],
      };
    }
    if (!photosOnScreen) {
      return { fills: [], photoLess: rows.map((_, i) => i), unmatched: [] };
    }
    return {
      fills: [],
      photoLess: [],
      unmatched: rows.map((row, rowIndex) => ({ rowIndex, label: captionRowLabel(row, rowIndex) })),
    };
  }

  const fills: CaptionFill[] = [];
  const missed: { rowIndex: number; label: string }[] = [];
  const usedImages = new Set<string>();
  const usedDrafts = new Set<string>();

  rows.forEach((row, rowIndex) => {
    const name = row.filename?.trim() ?? "";
    if (!name) {
      missed.push({ rowIndex, label: captionRowLabel(row, rowIndex) });
      return;
    }
    const image = images.find((img) => !usedImages.has(img.key) && filenamesMatch(img.originalName, name));
    if (image) {
      usedImages.add(image.key);
      if (image.draftId) usedDrafts.add(image.draftId);
      fills.push({ rowIndex, imageKey: image.key, draftId: image.draftId });
      return;
    }
    const draft = drafts.find(
      (d) => !usedDrafts.has(d.id) && csvFilenameMatchesDraft(name, d),
    );
    if (draft) {
      usedDrafts.add(draft.id);
      fills.push({ rowIndex, imageKey: null, draftId: draft.id });
      return;
    }
    missed.push({ rowIndex, label: captionRowLabel(row, rowIndex) });
  });

  if (!photosOnScreen) {
    return { fills, photoLess: missed.map((u) => u.rowIndex), unmatched: [] };
  }
  return { fills, photoLess: [], unmatched: missed };
}

export function pairImagesWithHeldRows(input: {
  rows: ArtworkCsvRow[];
  hasFilename: boolean;
  images: { key: string; originalName: string }[];
  held: { draftId: string; rowIndex: number }[];
}): {
  attachments: { imageKey: string; draftId: string; rowIndex: number }[];
  unmatched: { rowIndex: number; label: string; draftId: string }[];
  leftoverImageKeys: string[];
} {
  const held = [...input.held].sort((a, b) => a.rowIndex - b.rowIndex);
  const usedImages = new Set<string>();
  const attachments: { imageKey: string; draftId: string; rowIndex: number }[] = [];
  const unmatched: { rowIndex: number; label: string; draftId: string }[] = [];

  if (input.hasFilename) {
    for (const item of held) {
      const row = input.rows[item.rowIndex];
      const name = row?.filename?.trim() ?? "";
      const image = name
        ? input.images.find((img) => !usedImages.has(img.key) && filenamesMatch(img.originalName, name))
        : undefined;
      if (image) {
        usedImages.add(image.key);
        attachments.push({ imageKey: image.key, draftId: item.draftId, rowIndex: item.rowIndex });
      } else {
        unmatched.push({
          rowIndex: item.rowIndex,
          draftId: item.draftId,
          label: row ? captionRowLabel(row, item.rowIndex) : String(item.rowIndex + 1),
        });
      }
    }
  } else if (input.images.length > 0 && input.images.length === held.length) {
    held.forEach((item, i) => {
      const image = input.images[i]!;
      usedImages.add(image.key);
      attachments.push({ imageKey: image.key, draftId: item.draftId, rowIndex: item.rowIndex });
    });
  } else {
    for (const item of held) {
      const row = input.rows[item.rowIndex];
      unmatched.push({
        rowIndex: item.rowIndex,
        draftId: item.draftId,
        label: row ? captionRowLabel(row, item.rowIndex) : String(item.rowIndex + 1),
      });
    }
  }

  return {
    attachments,
    unmatched,
    leftoverImageKeys: input.images.filter((img) => !usedImages.has(img.key)).map((img) => img.key),
  };
}

export function summarizeUnmatchedLabels(labels: string[], limit = 4): string {
  const unique: string[] = [];
  for (const label of labels) {
    const text = label.trim();
    if (!text || unique.includes(text)) continue;
    unique.push(text);
  }
  const shown = unique.slice(0, limit);
  const extra = unique.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} +${extra}` : shown.join(", ");
}
