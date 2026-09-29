import { fieldForHeader, type CsvField } from "./columns";
import { parseCsv } from "./parse";

export type ArtworkCsvRow = {
  title: string;
  year: number | null;
  medium: string | null;
  size: string | null;
  sizeUnit: "cm" | "in" | null;
  price: number | null;
  currency: string | null;
  filename: string | null;
};

function isRowField(field: CsvField): field is keyof Omit<ArtworkCsvRow, "sizeUnit"> {
  return (
    field === "title" ||
    field === "year" ||
    field === "medium" ||
    field === "size" ||
    field === "price" ||
    field === "currency" ||
    field === "filename"
  );
}

function parseYear(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1000 && n <= 9999 ? n : null;
}

function parsePrice(raw: string): number | null {
  const n = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sizeUnitFrom(size: string | null, explicit: string | null): "cm" | "in" | null {
  const hint = `${explicit ?? ""} ${size ?? ""}`.toLowerCase();
  if (/\b(in|inch|inches)\b|인치/.test(hint)) return "in";
  if (/\bcm\b|센티/.test(hint)) return "cm";
  return null;
}

export function parseArtworkCsv(text: string): { rows: ArtworkCsvRow[]; hasFilename: boolean } {
  const { headers, rows } = parseCsv(text);
  const index: Partial<Record<keyof ArtworkCsvRow | "sizeUnit", number>> = {};
  headers.forEach((h, i) => {
    const field = fieldForHeader(h);
    if (!field) return;
    if (field === "size_unit") {
      if (index.sizeUnit == null) index.sizeUnit = i;
      return;
    }
    if (!isRowField(field) || index[field] != null) return;
    index[field] = i;
  });
  if (index.title == null) return { rows: [], hasFilename: false };

  const parsed = rows
    .map((cells) => {
      const cell = (key: keyof ArtworkCsvRow | "sizeUnit") => {
        const i = index[key];
        return i == null ? "" : (cells[i] ?? "").trim();
      };
      const size = cell("size") || null;
      const filename = cell("filename") || null;
      return {
        title: cell("title") || "Untitled",
        year: parseYear(cell("year")),
        medium: cell("medium") || null,
        size,
        sizeUnit: sizeUnitFrom(size, cell("sizeUnit") || null),
        price: parsePrice(cell("price")),
        currency: (cell("currency") || "").toUpperCase() || null,
        filename,
      };
    })
    .filter((row) => row.title !== "Untitled" || row.filename || row.year || row.medium || row.size || row.price);

  return { rows: parsed, hasFilename: parsed.some((r) => !!r.filename) };
}

export function fileStem(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  return base.replace(/\.[a-z0-9]{2,5}$/i, "").trim().toLowerCase();
}

export function csvFilenameMatchesDraft(
  filename: string,
  draft: { title: string | null; storagePaths: string[] },
): boolean {
  const stem = fileStem(filename);
  if (!stem) return false;
  const title = (draft.title ?? "").trim().toLowerCase();
  const spaced = stem.replace(/[-_]+/g, " ");
  if (title && (title === stem || title === spaced)) return true;
  const ascii = stem.replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "");
  if (!ascii) return false;
  return draft.storagePaths.some((path) => {
    const base = (path.split("/").pop() ?? "").toLowerCase();
    const stored = base.replace(/\.[a-z0-9]+$/, "");
    return stored === ascii || stored.endsWith(`-${ascii}`);
  });
}
