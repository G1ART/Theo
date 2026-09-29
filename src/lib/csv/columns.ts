/**
 * Header matching for artwork CSV/TSV.
 *
 * Known field names and the aliases already used by the bulk caption
 * importer resolve here with no model call. A header that matches nothing
 * is unrecognized; the library import asks the user to assign it.
 */

export type CsvField =
  | "title"
  | "year"
  | "medium"
  | "size"
  | "size_unit"
  | "ownership_status"
  | "pricing_mode"
  | "price"
  | "currency"
  | "filename";

export const LIBRARY_IMPORT_FIELDS = [
  "title",
  "year",
  "medium",
  "size",
  "size_unit",
  "ownership_status",
  "pricing_mode",
] as const;

export type LibraryImportField = (typeof LIBRARY_IMPORT_FIELDS)[number];

const LIBRARY_FIELDS = new Set<string>(LIBRARY_IMPORT_FIELDS);

/** Collapse case, spaces, and underscores so "size_unit" and "Size Unit" match. */
export function normalizeCsvHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[\s_\-./]+/g, "");
}

const ALIASES: Record<string, CsvField> = {
  title: "title",
  name: "title",
  제목: "title",
  작품명: "title",
  year: "year",
  연도: "year",
  medium: "medium",
  재료: "medium",
  매체: "medium",
  size: "size",
  크기: "size",
  사이즈: "size",
  sizeunit: "size_unit",
  크기단위: "size_unit",
  단위: "size_unit",
  ownershipstatus: "ownership_status",
  ownership: "ownership_status",
  소유상태: "ownership_status",
  소유: "ownership_status",
  pricingmode: "pricing_mode",
  가격방식: "pricing_mode",
  price: "price",
  가격: "price",
  currency: "currency",
  통화: "currency",
  file: "filename",
  filename: "filename",
  image: "filename",
  파일: "filename",
  파일명: "filename",
  이미지: "filename",
};

export function fieldForHeader(raw: string): CsvField | null {
  if (!raw.trim()) return null;
  return ALIASES[normalizeCsvHeader(raw)] ?? null;
}

export function mapLibraryColumns(headers: string[]): {
  mapping: Partial<Record<LibraryImportField, string>>;
  unrecognized: string[];
  ignored: string[];
} {
  const mapping: Partial<Record<LibraryImportField, string>> = {};
  const unrecognized: string[] = [];
  const ignored: string[] = [];

  for (const header of headers) {
    if (!header.trim()) continue;
    const field = fieldForHeader(header);
    if (!field) {
      unrecognized.push(header);
      continue;
    }
    if (!LIBRARY_FIELDS.has(field)) {
      ignored.push(header);
      continue;
    }
    const libraryField = field as LibraryImportField;
    if (mapping[libraryField]) {
      unrecognized.push(header);
      continue;
    }
    mapping[libraryField] = header;
  }

  return { mapping, unrecognized, ignored };
}
