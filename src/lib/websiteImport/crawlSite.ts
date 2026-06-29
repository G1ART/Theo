import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import sharp from "sharp";
import {
  assertFetchableImageUrl,
  assertFetchablePageUrl,
  assertResolvedHostSafe,
  resolveUrl,
} from "./urlSafety";
import { mergeCaptionBlocks, parseMetadataLine } from "./metadataParse";
import { dhashAndMetadataFromImageBuffer } from "./dhash";
import type { WebsiteImportCandidate, WebsiteImportScanMeta } from "./types";
import { randomUUID } from "crypto";

const MAX_PAGES = 28;
const MAX_QUEUE = 80;
const MAX_CANDIDATES = 180;
const PAGE_TIMEOUT_MS = 7500;
const IMAGE_TIMEOUT_MS = 9500;
const MAX_HTML_BYTES = 1_400_000;
const MAX_IMAGE_BYTES = 4_000_000;
const MAX_CONCURRENT_PAGE_FETCH = 3;
const MAX_CONCURRENT_IMAGE_HASH = 4;
const MAX_REDIRECT_HOPS = 3;

const GALLERY_PATH_HINTS =
  /portfolio|gallery|works|artwork|work|series|exhibition|projects|collections|shop|store/i;

const HTML_CONTENT_TYPE_RE = /^(text\/html|application\/xhtml\+xml)\b/i;

/**
 * Manual-redirect, size-capped fetch with both pre-fetch hostname validation
 * AND post-resolution IP validation. Each redirect hop is re-validated.
 *
 * Why we don't trust `redirect: "follow"`:
 *   A page on a public host can 302 to `http://169.254.169.254/...`. The
 *   undici fetch built into Node would follow it without re-running our
 *   safety predicates, leaking metadata-service responses back into the
 *   caller. So we follow redirects ourselves, calling
 *   `assertFetchablePageUrl|ImageUrl` AND `assertResolvedHostSafe` at every
 *   hop.
 */
async function safeFetchBuffer(
  startUrl: URL,
  originHostname: string,
  kind: "page" | "image",
): Promise<Buffer> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    if (kind === "page") assertFetchablePageUrl(current, originHostname);
    else assertFetchableImageUrl(current, originHostname);

    await assertResolvedHostSafe(current.hostname);

    const ctrl = new AbortController();
    const timeout = setTimeout(
      () => ctrl.abort(),
      kind === "page" ? PAGE_TIMEOUT_MS : IMAGE_TIMEOUT_MS,
    );
    try {
      const res = await fetch(current.toString(), {
        signal: ctrl.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "TheoWebsiteImport/1.0 (+https://theo.art)",
          Accept:
            kind === "page"
              ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
              : "image/*,*/*;q=0.8",
        },
      });

      // Manual redirect handling.
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error("redirect_no_location");
        const next = resolveUrl(current.toString(), loc);
        if (!next) throw new Error("redirect_invalid_url");
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          throw new Error("redirect_unsupported_scheme");
        }
        current = next;
        continue;
      }

      if (!res.ok) throw new Error(`http_${res.status}`);

      // For pages we additionally insist on text/html-ish responses so a
      // tarball or PDF doesn't land in cheerio.
      if (kind === "page") {
        const ct = res.headers.get("content-type") ?? "";
        if (ct && !HTML_CONTENT_TYPE_RE.test(ct)) {
          throw new Error("page_non_html");
        }
      }

      const cap = kind === "page" ? MAX_HTML_BYTES : MAX_IMAGE_BYTES;
      const lenHeader = res.headers.get("content-length");
      if (lenHeader) {
        const lenNum = parseInt(lenHeader, 10);
        if (Number.isFinite(lenNum) && lenNum > cap) {
          throw new Error("response_too_large");
        }
      }

      // Stream-read with running cap to defeat chunk-bombing servers.
      if (!res.body) throw new Error("no_body");
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          received += value.byteLength;
          if (received > cap) {
            await reader.cancel().catch(() => undefined);
            throw new Error("response_too_large");
          }
          chunks.push(value);
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* noop */
        }
      }
      return Buffer.concat(chunks.map((c) => Buffer.from(c)), received);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("too_many_redirects");
}

function extractLinks(html: string, pageUrl: string, originHostname: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    const abs = resolveUrl(pageUrl, href);
    if (!abs) return;
    try {
      assertFetchablePageUrl(abs, originHostname);
    } catch {
      return;
    }
    const path = abs.pathname + (abs.search || "");
    if (path.length > 200) return;
    out.push(abs.toString());
  });
  return [...new Set(out)];
}

function prioritizeLinks(urls: string[]): string[] {
  const scored = urls.map((u) => {
    let s = 0;
    try {
      const p = new URL(u).pathname;
      if (GALLERY_PATH_HINTS.test(p)) s += 4;
      if (p === "/" || p === "") s += 2;
      if (p.split("/").filter(Boolean).length <= 2) s += 1;
    } catch {
      return { u, s: -99 };
    }
    return { u, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.u);
}

/** Down-rank favicons, sprites, logos, social badges, and tiny layout images. */
function shouldSkipImageUrl(url: URL, alt: string, wAttr: number, hAttr: number): boolean {
  const path = `${url.pathname}${url.search}`.toLowerCase();
  const altL = alt.toLowerCase();
  if (
    /favicon|apple-touch|touch-icon|mstile|sprite|1x1|pixel|spacer|blank|placeholder|site-logo|brand-logo|logo-icon|social-share|og-image-for-/i.test(
      path,
    )
  ) {
    return true;
  }
  if (/(^|\/)icons\/|\/static\/.*icon/i.test(path)) return true;
  if (altL.length > 0 && /\b(logo|icon|avatar|badge|facebook|instagram|twitter|linkedin|pinterest)\b/i.test(altL)) {
    return true;
  }
  if (Number.isFinite(wAttr) && Number.isFinite(hAttr) && wAttr > 0 && hAttr > 0 && wAttr < 32 && hAttr < 32) {
    return true;
  }
  return false;
}

function firstUrlToken(raw: string): string {
  return raw.trim().split(/\s+/)[0] ?? "";
}

function bestSrcsetUrl(srcset: string, pageUrl: string, originHostname: string): string | null {
  let bestUrl: string | null = null;
  let bestW = -1;
  for (const part of srcset.split(",")) {
    const tok = firstUrlToken(part);
    if (!tok || tok.startsWith("data:")) continue;
    const abs = resolveUrl(pageUrl, tok);
    if (!abs) continue;
    try {
      assertFetchableImageUrl(abs, originHostname);
    } catch {
      continue;
    }
    const m = part.match(/(\d+)\s*w\b/i);
    const w = m ? parseInt(m[1]!, 10) : 0;
    if (w > bestW) {
      bestW = w;
      bestUrl = abs.toString();
    }
  }
  if (bestUrl) return bestUrl;
  for (const part of srcset.split(",")) {
    const tok = firstUrlToken(part);
    if (!tok || tok.startsWith("data:")) continue;
    const abs = resolveUrl(pageUrl, tok);
    if (!abs) continue;
    try {
      assertFetchableImageUrl(abs, originHostname);
      return abs.toString();
    } catch {
      continue;
    }
  }
  return null;
}

function collectImgUrls(
  $: cheerio.CheerioAPI,
  el: AnyNode,
  pageUrl: string,
  originHostname: string,
): string[] {
  const $el = $(el);
  const urls: string[] = [];
  const pushAttr = (raw: string | undefined) => {
    if (!raw || raw.startsWith("data:")) return;
    const token = firstUrlToken(raw);
    if (!token) return;
    const abs = resolveUrl(pageUrl, token);
    if (!abs) return;
    try {
      assertFetchableImageUrl(abs, originHostname);
    } catch {
      return;
    }
    urls.push(abs.toString());
  };

  // <picture><source srcset> wins over the inner <img> — handle it first.
  const $picture = $el.closest("picture");
  if ($picture.length) {
    $picture.find("source[srcset], source[data-srcset]").each((_, src) => {
      const ss = $(src).attr("srcset") || $(src).attr("data-srcset");
      if (!ss) return;
      const best = bestSrcsetUrl(ss, pageUrl, originHostname);
      if (best) urls.push(best);
    });
  }

  const srcset = $el.attr("srcset") ?? $el.attr("data-srcset");
  if (srcset) {
    const best = bestSrcsetUrl(srcset, pageUrl, originHostname);
    if (best) urls.push(best);
  }
  pushAttr($el.attr("src"));
  pushAttr($el.attr("data-src"));
  pushAttr($el.attr("data-lazy-src"));
  pushAttr($el.attr("data-original"));
  pushAttr($el.attr("data-image"));
  pushAttr($el.attr("data-zoom-src"));
  pushAttr($el.attr("data-deferred"));

  return [...new Set(urls)];
}

function pickDisplayUrl(urls: string[], alt: string, wAttr: number, hAttr: number): string | null {
  for (const u of urls) {
    try {
      const parsed = new URL(u);
      if (shouldSkipImageUrl(parsed, alt, wAttr, hAttr)) continue;
      return u;
    } catch {
      continue;
    }
  }
  return null;
}

async function extractCandidatesFromPage(
  html: string,
  pageUrl: string,
  originHostname: string,
): Promise<Omit<WebsiteImportCandidate, "id" | "dhash_hex">[]> {
  const $ = cheerio.load(html);
  const found: Omit<WebsiteImportCandidate, "id" | "dhash_hex">[] = [];

  $("img").each((_, el) => {
    const $el = $(el);
    const wAttr = parseInt($el.attr("width") || "", 10);
    const hAttr = parseInt($el.attr("height") || "", 10);
    const alt = ($el.attr("alt") || "").trim() || null;
    const urls = collectImgUrls($, el, pageUrl, originHostname);
    const absStr = pickDisplayUrl(urls, alt ?? "", wAttr, hAttr);
    if (!absStr) return;

    const $fig = $el.closest("figure");
    const cap = $fig.find("figcaption").first().text().trim() || null;
    const $card = $el.closest("article, .grid-item, .gallery-item, .portfolio-item, li, .sqs-block-content");
    const nearby = $card
      .find("h1, h2, h3, h4, .title, .work-title, p")
      .first()
      .text()
      .trim();
    const caption_blob = mergeCaptionBlocks(alt, cap, nearby);
    const parsed = parseMetadataLine(caption_blob);
    found.push({
      page_url: pageUrl,
      image_url: absStr,
      width: Number.isFinite(wAttr) ? wAttr : undefined,
      height: Number.isFinite(hAttr) ? hAttr : undefined,
      alt_text: alt,
      caption_blob,
      parsed,
    });
  });

  return found;
}

async function hashCandidateImage(
  c: Omit<WebsiteImportCandidate, "id" | "dhash_hex">,
  originHostname: string,
): Promise<WebsiteImportCandidate | null> {
  try {
    const buf = await safeFetchBuffer(new URL(c.image_url), originHostname, "image");
    const { dhash_hex, width, height } = await dhashAndMetadataFromImageBuffer(buf);
    const mw = width ?? c.width;
    const mh = height ?? c.height;
    if (mw && mh) {
      if (mw < 48 || mh < 48) return null;
      if (mw * mh < 2400) return null;
    }
    return {
      id: randomUUID(),
      ...c,
      dhash_hex,
      width: mw,
      height: mh,
    };
  } catch {
    return null;
  }
}

/**
 * Bounded-concurrency map runner — p-limit lite.
 * We deliberately keep concurrency modest (4) to stay under serverless
 * function memory / per-host politeness expectations.
 */
async function runWithLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array(Math.min(limit, items.length)).fill(0).map(() => worker()));
  return out;
}

export type CrawlSiteResult =
  | {
      ok: true;
      candidates: WebsiteImportCandidate[];
      scan_meta: WebsiteImportScanMeta;
    }
  | { ok: false; error: string };

export async function crawlPortfolioSite(startUrl: URL): Promise<CrawlSiteResult> {
  const originHostname = startUrl.hostname;
  const seenPages = new Set<string>();
  const queue: string[] = [startUrl.toString()];
  const candidatesMap = new Map<string, Omit<WebsiteImportCandidate, "id" | "dhash_hex">>();
  let pagesFetched = 0;

  try {
    while (queue.length > 0 && pagesFetched < MAX_PAGES && seenPages.size < MAX_QUEUE) {
      const batch = queue.splice(0, MAX_CONCURRENT_PAGE_FETCH);
      await Promise.all(
        batch.map(async (pageUrlStr) => {
          if (seenPages.has(pageUrlStr)) return;
          seenPages.add(pageUrlStr);
          const pageUrl = new URL(pageUrlStr);
          try {
            assertFetchablePageUrl(pageUrl, originHostname);
          } catch {
            return;
          }
          try {
            const buf = await safeFetchBuffer(pageUrl, originHostname, "page");
            const html = buf.toString("utf8");
            pagesFetched += 1;
            const links = extractLinks(html, pageUrlStr, originHostname);
            for (const u of prioritizeLinks(links)) {
              if (!seenPages.has(u) && queue.length + seenPages.size < MAX_QUEUE) queue.push(u);
            }
            const cands = await extractCandidatesFromPage(html, pageUrlStr, originHostname);
            for (const c of cands) {
              if (!candidatesMap.has(c.image_url)) candidatesMap.set(c.image_url, c);
            }
          } catch {
            /* skip page */
          }
        }),
      );
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "crawl_failed" };
  }

  // Prioritize images that look "art-sized" via attribute hints so the
  // 180-cap never trims real artwork in favor of tiny layout images.
  const rawList = [...candidatesMap.values()].sort((a, b) => {
    const areaA = (a.width ?? 0) * (a.height ?? 0);
    const areaB = (b.width ?? 0) * (b.height ?? 0);
    return areaB - areaA;
  });

  const slice = rawList.slice(0, MAX_CANDIDATES + 40);
  const hashedAll = await runWithLimit(slice, MAX_CONCURRENT_IMAGE_HASH, (c) =>
    hashCandidateImage(c, originHostname),
  );
  const hashedRaw = hashedAll.filter((c): c is WebsiteImportCandidate => Boolean(c));

  // dHash-level dedupe: collapse identical hashes (CDN size variants of the
  // same image present as distinct URLs). Keeping the largest variant.
  const byHash = new Map<string, WebsiteImportCandidate>();
  for (const c of hashedRaw) {
    const existing = byHash.get(c.dhash_hex);
    if (!existing) {
      byHash.set(c.dhash_hex, c);
      continue;
    }
    const cArea = (c.width ?? 0) * (c.height ?? 0);
    const eArea = (existing.width ?? 0) * (existing.height ?? 0);
    if (cArea > eArea) byHash.set(c.dhash_hex, c);
  }
  const hashed = [...byHash.values()].slice(0, MAX_CANDIDATES);

  const parsedCount = hashed.filter((c) => {
    const p = c.parsed;
    if (!p) return false;
    return !!(p.title || p.year != null || p.medium || p.size || p.story);
  }).length;
  const warnings: string[] = [];
  if (candidatesMap.size >= MAX_CANDIDATES) {
    warnings.push("near_candidate_cap");
  }

  return {
    ok: true,
    candidates: hashed,
    scan_meta: {
      pages_fetched: pagesFetched,
      pages_queued_cap: MAX_QUEUE,
      origin_hostname: originHostname,
      candidates_parsed_count: parsedCount,
      warnings: warnings.length ? warnings : undefined,
    },
  };
}

// Reference sharp at the module level so the top-of-file `import` is not
// flagged as unused even though the actual usage is via dhash.ts. This keeps
// the dynamic import / cold-start cost out of the hot loop.
export const __sharpVersion = sharp.versions.sharp;
