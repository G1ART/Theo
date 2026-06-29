/**
 * CV text extractors (server-side only).
 *
 * Three sources are supported in P6.2:
 *   - URL  → fetch HTML, strip noise tags via cheerio, return plain text.
 *   - PDF  → pdf-parse on the binary buffer.
 *   - DOCX → mammoth on the binary buffer.
 *
 * Image / scan-PDF support (vision LLM) is intentionally deferred to a
 * later cycle so this PR stays bounded.
 *
 * Every function returns `{ text, sourceLabel }` (or `{ error }`). The
 * caller (the `/api/ai/cv-import` route) decides how to surface
 * extractor errors; the route's `degraded` contract from `handleAiRoute`
 * stays the same.
 *
 * Hard caps:
 *   - URL fetch timeout: 8s.
 *   - URL response size: 2 MB (anything past that is truncated).
 *   - File buffer max:   5 MB raw (~6.7 MB base64). The validator
 *                        already enforces ~6 MB on the encoded payload,
 *                        so this is just a defense-in-depth gate.
 */

import { load as cheerioLoad } from "cheerio";

export type CvExtractResult =
  | { ok: true; text: string; sourceLabel: string }
  | { ok: false; reason: CvExtractFailure };

export type CvExtractFailure =
  | "url_fetch_failed"
  | "url_unsupported_content"
  | "url_too_large"
  | "url_empty"
  | "pdf_parse_failed"
  | "pdf_empty"
  | "pdf_too_large"
  | "docx_parse_failed"
  | "docx_empty"
  | "docx_too_large"
  | "decode_failed";

const URL_FETCH_TIMEOUT_MS = 8000;
const URL_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const FILE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const TEXT_TRIM_NEWLINES = /\n{3,}/g;
const TEXT_TRIM_SPACES = /[ \t]{2,}/g;

/* --------------------------------- URL ---------------------------------- */

/**
 * Fetch a public URL and return its main text content. The extractor is
 * intentionally simple — we strip script/style/nav/header/footer/aside
 * tags and pull `body` text. JS-rendered single-page sites often
 * surface very little this way; in those cases the model receives
 * nearly empty text and the route returns a `note` telling the user
 * to upload a resume file instead.
 */
export async function extractFromUrl(url: string): Promise<CvExtractResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Polite, identifiable UA. Some hosts (Cloudflare) reject the
        // default node fetch UA.
        "user-agent":
          "TheoCVImport/1.0 (+https://theo.art; cv-import bot for the profile owner)",
        accept: "text/html,application/xhtml+xml",
      },
    });
  } catch {
    clearTimeout(timeout);
    return { ok: false, reason: "url_fetch_failed" };
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    return { ok: false, reason: "url_fetch_failed" };
  }

  const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ctype.includes("html") && !ctype.includes("text/plain") && ctype !== "") {
    return { ok: false, reason: "url_unsupported_content" };
  }

  // Bound the body size before we hand the buffer to cheerio. We
  // collect chunks until URL_MAX_BYTES, then bail.
  const reader = res.body?.getReader();
  if (!reader) return { ok: false, reason: "url_fetch_failed" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > URL_MAX_BYTES) {
      truncated = true;
      break;
    }
    chunks.push(value);
  }
  if (truncated) {
    // Soft-truncate rather than failing — the head of the page often
    // contains the CV section already.
  }
  const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");

  let text = "";
  try {
    const $ = cheerioLoad(html);
    $("script, style, noscript, nav, header, footer, aside, form, iframe").remove();
    // `body` should always exist on a real HTML document but fall back
    // to root for fragments.
    const bodyText = ($("body").text() || $.root().text() || "").trim();
    text = sanitizeText(bodyText);
  } catch {
    return { ok: false, reason: "url_fetch_failed" };
  }

  if (!text) return { ok: false, reason: "url_empty" };

  let sourceLabel = url;
  try {
    const u = new URL(url);
    sourceLabel = `${u.hostname}${u.pathname}`;
  } catch {
    /* keep raw url */
  }

  return { ok: true, text, sourceLabel };
}

/* --------------------------------- PDF ---------------------------------- */

export async function extractFromPdfBase64(
  base64: string,
  fileName: string,
): Promise<CvExtractResult> {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, reason: "decode_failed" };
  }
  if (!buf.length) return { ok: false, reason: "decode_failed" };
  if (buf.length > FILE_MAX_BYTES) return { ok: false, reason: "pdf_too_large" };

  let parsed: { text?: string };
  try {
    // pdf-parse exposes a CommonJS function. The dynamic import keeps
    // the dependency out of the edge bundle (this file runs only in
    // node-runtime routes).
    const pdfParse = (await import("pdf-parse")).default as (
      data: Buffer,
    ) => Promise<{ text?: string }>;
    parsed = await pdfParse(buf);
  } catch {
    return { ok: false, reason: "pdf_parse_failed" };
  }

  const text = sanitizeText(parsed.text ?? "");
  if (!text) return { ok: false, reason: "pdf_empty" };
  return { ok: true, text, sourceLabel: fileName };
}

/* --------------------------------- DOCX --------------------------------- */

export async function extractFromDocxBase64(
  base64: string,
  fileName: string,
): Promise<CvExtractResult> {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, reason: "decode_failed" };
  }
  if (!buf.length) return { ok: false, reason: "decode_failed" };
  if (buf.length > FILE_MAX_BYTES) return { ok: false, reason: "docx_too_large" };

  let value = "";
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: buf });
    value = result?.value ?? "";
  } catch {
    return { ok: false, reason: "docx_parse_failed" };
  }

  const text = sanitizeText(value);
  if (!text) return { ok: false, reason: "docx_empty" };
  return { ok: true, text, sourceLabel: fileName };
}

/* ------------------------------ shared utils ---------------------------- */

function sanitizeText(raw: string): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(TEXT_TRIM_SPACES, " ")
    .replace(TEXT_TRIM_NEWLINES, "\n\n")
    .trim();
}
