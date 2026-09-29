"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { PageHeader } from "@/components/ds/PageHeader";
import { PageShell } from "@/components/ds/PageShell";
import { chipButton, chipButtonPrimary } from "@/components/ds/buttonStyles";
import { useT } from "@/lib/i18n/useT";
import {
  LIBRARY_IMPORT_FIELDS,
  mapLibraryColumns,
  type LibraryImportField,
} from "@/lib/csv/columns";
import { parseCsv, validateCsvRows, type CsvDelimiter, type CsvValidationError } from "@/lib/csv/parse";
import { createDraftArtwork, updateArtwork } from "@/lib/supabase/artworks";
import { generateCsv, downloadCsv } from "@/lib/csv/parse";
import { supabase } from "@/lib/supabase/client";

const REQUIRED_COLUMNS = ["title"];
const SUPPORTED_COLUMNS: LibraryImportField[] = [...LIBRARY_IMPORT_FIELDS];
const PREVIEW_ROWS = 8;

function delimiterKey(delimiter: CsvDelimiter): "comma" | "tab" | "semicolon" {
  if (delimiter === "\t") return "tab";
  if (delimiter === ";") return "semicolon";
  return "comma";
}

type ImportRow = {
  idx: number;
  fields: Record<string, string>;
  status: "pending" | "success" | "error" | "skipped";
  error?: string;
  duplicate?: boolean;
};

function ImportContent() {
  const { t } = useT();
  const [pasteText, setPasteText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [autoMapping, setAutoMapping] = useState<Partial<Record<LibraryImportField, string>>>({});
  const [unrecognized, setUnrecognized] = useState<string[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [choices, setChoices] = useState<Partial<Record<string, LibraryImportField>>>({});
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(",");
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [validationErrors, setValidationErrors] = useState<CsvValidationError[]>([]);
  const [step, setStep] = useState<"input" | "review" | "preview" | "importing" | "done">("input");
  const [progress, setProgress] = useState(0);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const mapping = useMemo(() => {
    const next: Record<string, string> = {};
    for (const field of SUPPORTED_COLUMNS) {
      const header = autoMapping[field];
      if (header) next[field] = header;
    }
    for (const header of unrecognized) {
      const field = choices[header];
      if (!field || next[field]) continue;
      next[field] = header;
    }
    return next;
  }, [autoMapping, choices, unrecognized]);

  const ingest = useCallback((text: string) => {
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setParseError(t("library.import.parseEmpty"));
      return;
    }
    const mapped = mapLibraryColumns(parsed.headers);
    const importRows: ImportRow[] = parsed.rows.map((cells, i) => {
      const fields: Record<string, string> = {};
      parsed.headers.forEach((header, ci) => { fields[header] = cells[ci] ?? ""; });
      return { idx: i + 1, fields, status: "pending" as const };
    });
    setDelimiter(parsed.delimiter);
    setAutoMapping(mapped.mapping);
    setUnrecognized(mapped.unrecognized);
    setIgnored(mapped.ignored);
    setChoices({});
    setRows(importRows);
    setValidationErrors([]);
    setParseError(null);
    setProgress(0);
    setStep("review");
  }, [t]);

  const assignUnrecognized = useCallback((header: string, field: LibraryImportField | "") => {
    setChoices((prev) => {
      const next = { ...prev };
      if (!field) delete next[header];
      else next[header] = field;
      return next;
    });
  }, []);

  const handleValidate = useCallback(async () => {
    if (!mapping.title) {
      setValidationErrors([{ row: 0, column: "title", message: t("library.import.needTitle") }]);
      return;
    }
    const mappedFields = Object.keys(mapping).filter((k) => mapping[k]);
    const errs = validateCsvRows(
      mappedFields,
      rows.map((r) => mappedFields.map((k) => {
        const srcCol = mapping[k];
        return srcCol ? (r.fields[srcCol] ?? "") : "";
      })),
      REQUIRED_COLUMNS.filter((r) => mapping[r])
    );
    setValidationErrors(errs);
    if (errs.filter((e) => e.row === 0).length > 0) return;

    // Duplicate detection: check title + year against existing artworks
    const titleCol = mapping["title"];
    const yearCol = mapping["year"];
    if (titleCol) {
      const titles = rows.map((r) => r.fields[titleCol]?.trim().toLowerCase()).filter(Boolean);
      if (titles.length > 0) {
        const { data: existing } = await supabase
          .from("artworks")
          .select("title, year")
          .in("title", [...new Set(titles.map((t) => rows.find((r) => r.fields[titleCol]?.trim().toLowerCase() === t)?.fields[titleCol]?.trim() ?? ""))]);

        const existingSet = new Set(
          (existing ?? []).map((e: { title: string; year: string | number | null }) =>
            `${(e.title ?? "").toLowerCase()}|${e.year ?? ""}`
          )
        );

        setRows((prev) =>
          prev.map((r) => {
            const title = r.fields[titleCol]?.trim().toLowerCase() ?? "";
            const year = yearCol ? (r.fields[mapping["year"]] ?? "").trim() : "";
            const key = `${title}|${year}`;
            return { ...r, duplicate: existingSet.has(key) };
          })
        );
      }
    }

    setStep("preview");
  }, [mapping, rows, t]);

  const handleImport = useCallback(async () => {
    setStep("importing");
    let done = 0;
    for (const row of rows) {
      if (skipDuplicates && row.duplicate) {
        row.status = "skipped";
        row.error = t("library.import.err.duplicate");
        done++;
        setProgress(done);
        continue;
      }

      const titleCol = mapping["title"];
      const title = titleCol ? row.fields[titleCol]?.trim() : "";
      if (!title) { row.status = "error"; row.error = t("library.import.err.noTitle"); done++; setProgress(done); continue; }

      const { data: artworkId, error } = await createDraftArtwork({ title });
      if (error || !artworkId) { row.status = "error"; row.error = t("library.import.err.createFailed"); done++; setProgress(done); continue; }

      const updates: Record<string, unknown> = {};
      const mapField = (field: string) => {
        const col = mapping[field];
        return col ? (row.fields[col] ?? "").trim() : "";
      };

      if (mapField("year")) updates.year = mapField("year");
      if (mapField("medium")) updates.medium = mapField("medium");
      if (mapField("size")) updates.size = mapField("size");
      if (mapField("size_unit")) updates.size_unit = mapField("size_unit");
      if (mapField("ownership_status")) updates.ownership_status = mapField("ownership_status");
      if (mapField("pricing_mode")) updates.pricing_mode = mapField("pricing_mode");

      if (Object.keys(updates).length > 0) {
        await updateArtwork(artworkId, updates);
      }

      row.status = "success";
      done++;
      setProgress(done);
    }
    setRows([...rows]);
    setStep("done");
  }, [rows, mapping, skipDuplicates, t]);

  const dupCount = rows.filter((r) => r.duplicate).length;
  const successCount = rows.filter((r) => r.status === "success").length;
  const errCount = rows.filter((r) => r.status === "error").length;
  const skipCount = rows.filter((r) => r.status === "skipped").length;

  const fieldLabel = (col: string) => t(`library.import.field.${col}`);

  return (
    <PageShell variant="library">
      <Link href="/my/library" className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900">
        ← {t("library.title")}
      </Link>
      <PageHeader variant="plain" title={t("library.import.title")} />

      {step === "input" && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">
            {t("library.import.pasteHint")}
          </p>
          <div>
            <label htmlFor="library-csv-file" className="block text-sm font-medium text-zinc-900">
              {t("library.import.chooseFile")}
            </label>
            <input
              id="library-csv-file"
              type="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              className="mt-2 block w-full text-sm text-zinc-700 file:mr-4 file:rounded-full file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-zinc-800"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setFileName(file.name);
                void file.text().then((text) => ingest(text));
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              const tmpl = generateCsv(
                SUPPORTED_COLUMNS,
                [SUPPORTED_COLUMNS.map((c) => REQUIRED_COLUMNS.includes(c) ? t("library.import.templateRequired") : t("library.import.templateOptional"))]
              );
              downloadCsv("import_template.csv", tmpl);
            }}
            className="text-sm text-zinc-500 underline hover:text-zinc-700"
          >
            {t("library.import.downloadTemplate")}
          </button>
          {parseError && <p className="text-sm text-red-600">{parseError}</p>}
          <div className="space-y-2 border-t border-zinc-200 pt-4">
            <p className="text-sm text-zinc-500">{t("library.import.pasteSecondary")}</p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-sm"
              placeholder={"title\tyear\tmedium\nUntitled\t2024\tOil on canvas"}
            />
            <button
              type="button"
              disabled={!pasteText.trim()}
              onClick={() => {
                setFileName(null);
                ingest(pasteText);
              }}
              className={`${chipButtonPrimary} disabled:opacity-50`}
            >
              {t("common.next")}
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-700">
            {t("library.import.willImport").replace("{n}", String(rows.length))}
          </p>
          <p className="text-sm text-zinc-500">
            {fileName ? `${fileName} · ` : ""}
            {t("library.import.detectedDelimiter").replace("{kind}", t(`library.import.delimiter.${delimiterKey(delimiter)}`))}
          </p>
          <ul className="space-y-1 text-sm text-zinc-700">
            {SUPPORTED_COLUMNS.filter((col) => autoMapping[col]).map((col) => (
              <li key={col}>
                {fieldLabel(col)}
                {REQUIRED_COLUMNS.includes(col) ? <span className="text-red-500"> *</span> : ""}
                {" · "}
                {autoMapping[col]}
              </li>
            ))}
          </ul>
          {ignored.length > 0 && (
            <p className="text-sm text-zinc-500">
              {t("library.import.skippedColumns").replace("{cols}", ignored.join(", "))}
            </p>
          )}
          {unrecognized.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-zinc-600">{t("library.import.unrecognized")}</p>
              {unrecognized.map((header) => {
                const taken = new Set<string>();
                for (const field of SUPPORTED_COLUMNS) {
                  if (autoMapping[field]) taken.add(field);
                }
                for (const [other, field] of Object.entries(choices)) {
                  if (other !== header && field) taken.add(field);
                }
                return (
                  <div key={header} className="flex items-center gap-2">
                    <span className="w-40 truncate text-sm text-zinc-700">{header}</span>
                    <select
                      value={choices[header] ?? ""}
                      onChange={(e) => assignUnrecognized(header, e.target.value as LibraryImportField | "")}
                      className="flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">{t("library.import.skipColumn")}</option>
                      {SUPPORTED_COLUMNS.filter((field) => !taken.has(field)).map((field) => (
                        <option key={field} value={field}>
                          {fieldLabel(field)}{REQUIRED_COLUMNS.includes(field) ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
          <div className="max-h-72 overflow-x-auto overflow-y-auto rounded border border-zinc-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  {SUPPORTED_COLUMNS.filter((c) => mapping[c]).map((c) => (
                    <th key={c} className="px-3 py-2">{fieldLabel(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.slice(0, PREVIEW_ROWS).map((r) => (
                  <tr key={r.idx}>
                    <td className="px-3 py-1.5 text-zinc-400">{r.idx}</td>
                    {SUPPORTED_COLUMNS.filter((c) => mapping[c]).map((c) => (
                      <td key={c} className="max-w-[150px] truncate px-3 py-1.5 text-zinc-700">{r.fields[mapping[c] ?? ""] ?? ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > PREVIEW_ROWS && (
            <p className="text-xs text-zinc-400">
              {t("library.import.previewFirst").replace("{n}", String(PREVIEW_ROWS))}
            </p>
          )}
          {validationErrors.filter((e) => e.row === 0).map((e, i) => (
            <p key={i} className="text-sm text-red-600">{e.message}</p>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!mapping.title} onClick={() => void handleValidate()} className={`${chipButtonPrimary} disabled:opacity-50`}>{t("library.import.validateAndPreview")}</button>
            <button type="button" onClick={() => setStep("input")} className={chipButton}>{t("common.back")}</button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-zinc-700">{t("library.import.rowsCount").replace("{n}", String(rows.length))}</span>
            {dupCount > 0 && (
              <span className="text-amber-700">{t("library.import.possibleDuplicates").replace("{n}", String(dupCount))}</span>
            )}
            {dupCount > 0 && (
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} className="h-3.5 w-3.5 rounded border-zinc-300" />
                {t("library.import.skipDuplicates")}
              </label>
            )}
          </div>
          <div className="max-h-72 overflow-x-auto overflow-y-auto rounded border border-zinc-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  {SUPPORTED_COLUMNS.filter((c) => mapping[c]).map((c) => (
                    <th key={c} className="px-3 py-2">{fieldLabel(c)}</th>
                  ))}
                  <th className="px-3 py-2">{t("library.import.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.slice(0, 100).map((r) => (
                  <tr key={r.idx} className={r.duplicate ? "bg-amber-50" : ""}>
                    <td className="px-3 py-1.5 text-zinc-400">{r.idx}</td>
                    {SUPPORTED_COLUMNS.filter((c) => mapping[c]).map((c) => (
                      <td key={c} className="max-w-[150px] truncate px-3 py-1.5 text-zinc-700">{r.fields[mapping[c]] ?? ""}</td>
                    ))}
                    <td className="px-3 py-1.5">{r.duplicate ? <span className="text-xs text-amber-700">{t("library.import.dup")}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 100 && (
            <p className="text-xs text-zinc-400">
              {t("library.import.showingFirst").replace("{n}", String(rows.length))}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void handleImport()} className={chipButtonPrimary}>
              {t("library.import.importRows").replace("{n}", String(skipDuplicates ? rows.length - dupCount : rows.length))}
            </button>
            <button type="button" onClick={() => setStep("review")} className={chipButton}>{t("common.back")}</button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600">
            {t("library.import.importing")
              .replace("{done}", String(progress))
              .replace("{total}", String(rows.length))}
          </p>
          <div className="h-2 w-full rounded-full bg-zinc-200">
            <div className="h-2 rounded-full bg-zinc-800 transition-all" style={{ width: `${(progress / Math.max(rows.length, 1)) * 100}%` }} />
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3">
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-medium text-green-800">{t("library.import.done")}</p>
            <p className="mt-1 text-sm text-green-700">
              {t("library.import.addedDrafts").replace("{n}", String(successCount))}
              {skipCount > 0 ? ` ${t("library.import.skipped").replace("{n}", String(skipCount))}` : ""}
              {errCount > 0 ? ` ${t("library.import.hadIssues").replace("{n}", String(errCount))}` : ""}
            </p>
          </div>
          {errCount > 0 && (
            <ul className="max-h-32 space-y-1 overflow-y-auto">
              {rows.filter((r) => r.status === "error").map((r) => (
                <li key={r.idx} className="text-sm text-red-600">
                  {t("library.import.rowError").replace("{n}", String(r.idx)).replace("{error}", r.error ?? "")}
                </li>
              ))}
            </ul>
          )}
          <Link href="/my/library" className={chipButtonPrimary}>
            {t("library.import.goToLibrary")}
          </Link>
        </div>
      )}
    </PageShell>
  );
}

export default function ImportPage() {
  return (
    <AuthGate>
      <ImportContent />
    </AuthGate>
  );
}
