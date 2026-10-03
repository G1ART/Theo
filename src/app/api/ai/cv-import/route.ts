import { NextResponse } from "next/server";
import { handleAiRoute } from "@/lib/ai/route";
import { buildCvImportContext, buildCvImportVisionContext } from "@/lib/ai/contexts";
import { CV_IMPORT_SCHEMA, CV_IMPORT_SYSTEM } from "@/lib/ai/prompts";
import type {
  CvImportCategory,
  CvImportEntry,
  CvImportResult,
} from "@/lib/ai/types";
import { parseCvImportBody, type CvImportBody } from "@/lib/ai/validation";
import {
  extractFromDocxBase64,
  extractFromPdfBase64,
  extractFromUrl,
  type CvExtractFailure,
  type CvExtractResult,
} from "@/lib/cv/extract";
import { normalizeEducationType } from "@/lib/cv/normalize";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * P6.2 — CV Import route.
 *
 * Two-stage pipeline:
 *   1. Server-side extraction (URL fetch / PDF parse / DOCX parse) →
 *      raw text. Hard caps + timeouts live in `src/lib/cv/extract.ts`.
 *      Failures here short-circuit with `degraded: true` + a stable
 *      `reason` so the wizard can render a friendly fallback.
 *   2. LLM normalization via the standard `handleAiRoute` SSOT —
 *      auth / soft-cap / metering / event logging all reuse the
 *      shared pattern. The model returns 4-category typed entries the
 *      editor drops into the existing CRUD UI.
 *
 * Image / scan-PDF support uses vision LLMs and is intentionally
 * deferred to a later cycle (P6.3) to keep this PR bounded.
 */

const EXTRACT_FAILURE_HTTP: Record<CvExtractFailure, number> = {
  url_fetch_failed: 502,
  url_unsupported_content: 415,
  url_too_large: 413,
  url_empty: 422,
  pdf_parse_failed: 422,
  pdf_empty: 422,
  pdf_too_large: 413,
  docx_parse_failed: 422,
  docx_empty: 422,
  docx_too_large: 413,
  decode_failed: 400,
};

function fallbackResult(): CvImportResult {
  return { entries: [], confidence: 0, note: null };
}

const ALLOWED_CATEGORIES: readonly CvImportCategory[] = [
  "education",
  "exhibitions",
  "awards",
  "residencies",
] as const;

/**
 * Defensive normalizer applied after `generateJSON`. We trust the
 * schema hint but the model occasionally returns an unknown category
 * label or a non-string field value — we drop those quietly so the
 * editor never sees a malformed entry.
 */
function normalizeResult(raw: unknown): CvImportResult {
  if (!raw || typeof raw !== "object") return fallbackResult();
  const r = raw as Record<string, unknown>;
  const entriesIn = Array.isArray(r.entries) ? r.entries : [];
  const entries: CvImportEntry[] = [];
  for (const e of entriesIn) {
    if (!e || typeof e !== "object") continue;
    const eo = e as Record<string, unknown>;
    const cat = String(eo.category ?? "");
    if (!ALLOWED_CATEGORIES.includes(cat as CvImportCategory)) continue;
    const fieldsIn = eo.fields;
    if (!fieldsIn || typeof fieldsIn !== "object" || Array.isArray(fieldsIn)) continue;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(fieldsIn as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) {
        fields[k] = v.trim();
      } else if (typeof v === "number" && Number.isFinite(v)) {
        fields[k] = String(v);
      }
    }
    // Education type enum: model often emits "Bachelor of Fine Arts"
    // or "BFA" instead of the slug. We snap to the canonical slug
    // here so the manual editor's <select> renders the right label
    // without a follow-up edit. Unknown values drop out so the field
    // doesn't carry a junk display string.
    if (cat === "education" && typeof fields.type === "string") {
      const slug = normalizeEducationType(fields.type);
      if (slug) fields.type = slug;
      else delete fields.type;
    }
    if (Object.keys(fields).length === 0) continue;
    entries.push({ category: cat as CvImportCategory, fields });
  }

  let confidence: number | undefined;
  if (typeof r.confidence === "number" && Number.isFinite(r.confidence)) {
    confidence = Math.max(0, Math.min(1, r.confidence));
  }

  let note: string | null = null;
  if (typeof r.note === "string" && r.note.trim()) {
    note = r.note.trim().slice(0, 500);
  }

  return {
    entries,
    confidence,
    note,
    degraded: r.degraded === true ? true : undefined,
    reason: typeof r.reason === "string" ? (r.reason as CvImportResult["reason"]) : undefined,
  };
}

async function runExtract(body: CvImportBody): Promise<CvExtractResult> {
  if (body.file) {
    if (body.file.kind === "pdf") {
      return extractFromPdfBase64(body.file.base64, body.file.name);
    }
    if (body.file.kind === "docx") {
      return extractFromDocxBase64(body.file.base64, body.file.name);
    }
  }
  if (body.url) {
    return extractFromUrl(body.url);
  }
  return { ok: false, reason: "decode_failed" };
}

/**
 * Treat a PDF that yielded only whitespace / a handful of letters as a
 * scanned PDF. The client wizard catches the `vision_fallback` hint
 * below and re-submits the same file as page bitmaps.
 */
function looksLikeScannedPdfFailure(
  body: CvImportBody,
  reason: CvExtractFailure,
): boolean {
  if (!body.file) return false;
  if (body.file.kind !== "pdf") return false;
  return reason === "pdf_empty";
}

export async function POST(req: Request) {
  return handleAiRoute<CvImportBody, CvImportResult>(req, {
    feature: "cv_import",
    validateBody: (raw) => {
      const r = parseCvImportBody(raw);
      return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
    },
    async buildPromptInput({ body }) {
      // ── Vision branch (image inputs) ──
      // Photographed resume or client-rendered scanned-PDF page bitmaps.
      // We skip the text extractor entirely and hand images straight
      // to the multimodal call.
      if (body.images && body.images.length > 0) {
        const sourceKind: "image" | "scanned_pdf" =
          body.images.length > 1 ? "scanned_pdf" : "image";
        return {
          system: CV_IMPORT_SYSTEM,
          user: buildCvImportVisionContext({
            locale: body.locale,
            sourceKind,
            sourceLabel: body.imageSourceLabel,
            imageCount: body.images.length,
          }),
          schemaHint: CV_IMPORT_SCHEMA,
          fallback: fallbackResult,
          imageInputs: body.images.map((img) => ({
            mime: img.mime,
            base64: img.base64,
            // High detail so Sol actually reads small type on a CV page.
            // Multi-page scans cost more; the model is the one doing
            // the extraction, so a blurry page is a wasted call.
            detail: "high" as const,
          })),
        };
      }

      // ── Text branch (URL / PDF / DOCX) ──
      const extracted = await runExtract(body);
      if (!extracted.ok) {
        const isScanFallback = looksLikeScannedPdfFailure(body, extracted.reason);
        return NextResponse.json(
          {
            degraded: true,
            reason: "invalid_input",
            extractError: extracted.reason,
            // The wizard checks `visionFallback === true` and, when
            // set, re-renders the same PDF as page bitmaps client-side
            // and POSTs again with `images[]` instead of `file`.
            visionFallback: isScanFallback,
            entries: [],
            confidence: 0,
            note: null,
          } satisfies CvImportResult & {
            extractError: CvExtractFailure;
            visionFallback?: boolean;
          },
          { status: EXTRACT_FAILURE_HTTP[extracted.reason] ?? 422 },
        );
      }

      const sourceKind = body.file
        ? body.file.kind
        : body.url
          ? "url"
          : "text";

      return {
        system: CV_IMPORT_SYSTEM,
        user: buildCvImportContext({
          locale: body.locale,
          sourceKind,
          sourceLabel: extracted.sourceLabel,
          text: extracted.text,
        }),
        schemaHint: CV_IMPORT_SCHEMA,
        // The fallback ships an empty result rather than guessing —
        // there's nothing we can usefully invent without the LLM.
        fallback: fallbackResult,
      };
    },
  }).then(async (res) => {
    // Re-shape the model output through `normalizeResult` for safety.
    // We only do this for 200 responses — everything else is already
    // a structured `degraded` envelope from `handleAiRoute`.
    if (res.status !== 200) return res;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return res;
    }
    const normalized = normalizeResult(body);
    // Preserve the `aiEventId` echoed by handleAiRoute so the client
    // can mark acceptance later.
    const aiEventId = (body as { aiEventId?: string } | null)?.aiEventId;
    return NextResponse.json(
      { ...normalized, ...(aiEventId ? { aiEventId } : {}) },
      { status: 200 },
    );
  });
}
