/**
 * Lightweight CSV parser for client-side import/export.
 * No external dependency — handles quoted fields, newlines in quotes, and BOM.
 * The delimiter is chosen from the header row: comma, tab, or semicolon.
 */

export type CsvDelimiter = "," | "\t" | ";";

const DELIMITERS: readonly CsvDelimiter[] = [",", "\t", ";"];

function countDelimiters(line: string): Record<CsvDelimiter, number> {
  const counts: Record<CsvDelimiter, number> = { ",": 0, "\t": 0, ";": 0 };
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === "," || ch === "\t" || ch === ";")) {
      counts[ch] += 1;
    }
  }
  return counts;
}

/** First non-empty record, ignoring quotes, so a title row picks the delimiter. */
function headerLine(text: string): string {
  let line = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        line += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      line += ch;
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (line.trim()) return line;
      line = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
      continue;
    }
    line += ch;
  }
  return line;
}

export function detectCsvDelimiter(text: string): CsvDelimiter {
  const counts = countDelimiters(headerLine(text.replace(/^\uFEFF/, "")));
  let best: CsvDelimiter = ",";
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    if (counts[delimiter] > bestCount) {
      best = delimiter;
      bestCount = counts[delimiter];
    }
  }
  return best;
}

export function parseCsv(text: string): { headers: string[]; rows: string[][]; delimiter: CsvDelimiter } {
  const cleaned = text.replace(/^\uFEFF/, "");
  const delimiter = detectCsvDelimiter(cleaned);
  const lines: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      row.push(field.trim());
      if (row.some((f) => f !== "")) lines.push(row);
      row = [];
      field = "";
      if (ch === "\r" && next === "\n") i++;
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some((f) => f !== "")) lines.push(row);

  const headers = lines[0] ?? [];
  const rows = lines.slice(1);
  return { headers, rows, delimiter };
}

export type CsvValidationError = {
  row: number;
  column: string;
  message: string;
};

export function validateCsvRows(
  headers: string[],
  rows: string[][],
  requiredColumns: string[]
): CsvValidationError[] {
  const errors: CsvValidationError[] = [];
  const headerLower = headers.map((h) => h.toLowerCase().trim());
  for (const req of requiredColumns) {
    if (!headerLower.includes(req.toLowerCase())) {
      errors.push({ row: 0, column: req, message: `Missing required column: ${req}` });
    }
  }
  if (errors.length > 0) return errors;
  for (let i = 0; i < rows.length; i++) {
    for (const req of requiredColumns) {
      const idx = headerLower.indexOf(req.toLowerCase());
      if (idx >= 0 && (!rows[i][idx] || rows[i][idx].trim() === "")) {
        errors.push({ row: i + 1, column: req, message: `Empty required field` });
      }
    }
  }
  return errors;
}

export function generateCsv(headers: string[], rows: string[][]): string {
  const escape = (val: string) => {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) {
    lines.push(row.map((v) => escape(v ?? "")).join(","));
  }
  return lines.join("\n");
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
