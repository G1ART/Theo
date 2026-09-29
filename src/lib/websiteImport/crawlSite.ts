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

const MAX_PAGES = 40;
const MAX_QUEUE = 160;
const MAX_CANDIDATES = 120;
const PAGE_TIMEOUT_MS = 6000;
const IMAGE_TIMEOUT_MS = 5000;
const CRAWL_BUDGET_MS = 42_000;
const HASH_BUDGET_MS = 22_000;
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
  kind: "page" | "image" | "xml",
): Promise<Buffer> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    if (kind === "page") assertFetchablePageUrl(current, originHostname);
    else if (kind === "xml") assertFetchablePageUrl(current, originHostname);
    else assertFetchableImageUrl(current, originHostname);

    await assertResolvedHostSafe(current.hostname);

    const ctrl = new AbortController();
    const timeout = setTimeout(
      () => ctrl.abort(),
      kind === "image" ? IMAGE_TIMEOUT_MS : PAGE_TIMEOUT_MS,
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
      if (kind === "page" || kind === "xml") {
        const ct = res.headers.get("content-type") ?? "";
        const okType =
          kind === "xml"
            ? !ct || /xml|text\/plain|text\/html/i.test(ct)
            : HTML_CONTENT_TYPE_RE.test(ct);
        if (ct && !okType) throw new Error("page_non_html");
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

function pageKey(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function linkScore(raw: string): number {
  try {
    const p = new URL(raw).pathname;
    let s = 0;
    if (GALLERY_PATH_HINTS.test(p)) s += 4;
    const depth = p.split("/").filter(Boolean).length;
    if (depth >= 1 && depth <= 3) s += 2;
    if (depth > 4) s -= 1;
    return s;
  } catch {
    return -99;
  }
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

function looksLikeJsShell(html: string): boolean {
  const imgCount = (html.match(/<img[\s>]/gi) ?? []).length;
  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  const wix = /wixstatic|wix-warmup|_wixCIDX|wix-thunderbolt|data-wix/i.test(html);
  const spa = /__NEXT_DATA__|id="__next"|id="root"|data-reactroot/i.test(html);
  const textLen = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim().length;
  return imgCount === 0 && (scriptCount >= 8 || wix || spa || textLen < 200);
}

function collectStructuredImageUrls(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  originHostname: string,
): string[] {
  const urls: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw || raw.startsWith("data:")) return;
    const abs = resolveUrl(pageUrl, firstUrlToken(raw));
    if (!abs) return;
    try {
      assertFetchableImageUrl(abs, originHostname);
    } catch {
      return;
    }
    urls.push(abs.toString());
  };

  $(
    'meta[property="og:image"], meta[property="og:image:url"], meta[name="og:image"], meta[name="twitter:image"]',
  ).each((_, el) => {
    push($(el).attr("content"));
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      walkJsonLdImages(parsed, push);
    } catch {
      /* ignore malformed json-ld */
    }
  });

  return [...new Set(urls)];
}

function walkJsonLdImages(node: unknown, push: (raw: string | undefined) => void): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLdImages(item, push);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const types = Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];
  if (types.some((t) => /imageobject/i.test(t))) {
    const url = obj.url ?? obj.contentUrl;
    if (typeof url === "string") push(url);
  }
  const image = obj.image;
  if (typeof image === "string") push(image);
  else if (image) walkJsonLdImages(image, push);
  if (obj["@graph"]) walkJsonLdImages(obj["@graph"], push);
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
): Promise<{
  found: Omit<WebsiteImportCandidate, "id" | "dhash_hex">[];
  rawImageCount: number;
  skippedCount: number;
  jsShell: boolean;
}> {
  const $ = cheerio.load(html);
  const found: Omit<WebsiteImportCandidate, "id" | "dhash_hex">[] = [];
  let rawImageCount = 0;
  let skippedCount = 0;

  $("img").each((_, el) => {
    const $el = $(el);
    const wAttr = parseInt($el.attr("width") || "", 10);
    const hAttr = parseInt($el.attr("height") || "", 10);
    const alt = ($el.attr("alt") || "").trim() || null;
    const urls = collectImgUrls($, el, pageUrl, originHostname);
    rawImageCount += 1;
    const absStr = pickDisplayUrl(urls, alt ?? "", wAttr, hAttr);
    if (!absStr) {
      skippedCount += 1;
      return;
    }

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

  const structured = collectStructuredImageUrls($, pageUrl, originHostname);
  for (const image_url of structured) {
    rawImageCount += 1;
    if (found.some((c) => c.image_url === image_url)) continue;
    try {
      if (shouldSkipImageUrl(new URL(image_url), "", 0, 0)) {
        skippedCount += 1;
        continue;
      }
    } catch {
      skippedCount += 1;
      continue;
    }
    found.push({
      page_url: pageUrl,
      image_url,
      alt_text: null,
      caption_blob: null,
      parsed: parseMetadataLine(null),
    });
  }

  return {
    found,
    rawImageCount,
    skippedCount,
    jsShell: looksLikeJsShell(html),
  };
}

async function hashCandidateImage(
  c: Omit<WebsiteImportCandidate, "id" | "dhash_hex">,
  originHostname: string,
  deadlineMs: number,
): Promise<WebsiteImportCandidate | null> {
  if (Date.now() > deadlineMs) return null;
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

async function loadSitemapLocs(startUrl: URL, originHostname: string): Promise<string[]> {
  const bare = startUrl.hostname.replace(/^www\./, "");
  const origins = [
    `${startUrl.protocol}//${bare}`,
    `${startUrl.protocol}//www.${bare}`,
  ];
  const xmlQueue = origins.flatMap((origin) => [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ]);
  const locs: string[] = [];
  const seenXml = new Set<string>();
  let fetched = 0;
  while (xmlQueue.length > 0 && fetched < 4 && locs.length < MAX_QUEUE) {
    const xmlUrl = xmlQueue.shift()!;
    if (seenXml.has(xmlUrl)) continue;
    seenXml.add(xmlUrl);
    fetched += 1;
    try {
      const buf = await safeFetchBuffer(new URL(xmlUrl), originHostname, "xml");
      const text = buf.toString("utf8");
      for (const match of text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        const loc = match[1];
        if (!loc) continue;
        if (/\.xml(\?|$)/i.test(loc)) {
          if (xmlQueue.length < 8) xmlQueue.push(loc);
        } else {
          locs.push(loc);
        }
      }
    } catch {
      /* a missing sitemap is normal */
    }
  }
  return locs;
}

export async function crawlPortfolioSite(startUrl: URL): Promise<CrawlSiteResult> {
  const originHostname = startUrl.hostname;
  const seenPages = new Set<string>();
  const queue: string[] = [];
  const candidatesMap = new Map<string, Omit<WebsiteImportCandidate, "id" | "dhash_hex">>();
  let pagesFetched = 0;
  let fetchFailures = 0;
  let rawImageCount = 0;
  let jsShellHits = 0;
  const started = Date.now();

  const enqueue = (raw: string) => {
    let key: string;
    try {
      key = pageKey(raw);
      assertFetchablePageUrl(new URL(raw), originHostname);
    } catch {
      return;
    }
    if (seenPages.has(key)) return;
    if (queue.some((u) => pageKey(u) === key)) return;
    if (queue.length + seenPages.size >= MAX_QUEUE) return;
    queue.push(raw);
  };

  enqueue(startUrl.toString());
  for (const loc of await loadSitemapLocs(startUrl, originHostname)) enqueue(loc);

  try {
    while (queue.length > 0 && pagesFetched < MAX_PAGES && Date.now() - started < CRAWL_BUDGET_MS) {
      queue.sort((a, b) => linkScore(b) - linkScore(a));
      const batch = queue.splice(0, MAX_CONCURRENT_PAGE_FETCH);
      await Promise.all(
        batch.map(async (pageUrlStr) => {
          const key = pageKey(pageUrlStr);
          if (seenPages.has(key)) return;
          seenPages.add(key);
          const pageUrl = new URL(pageUrlStr);
          try {
            const buf = await safeFetchBuffer(pageUrl, originHostname, "page");
            const html = buf.toString("utf8");
            pagesFetched += 1;
            for (const u of extractLinks(html, pageUrlStr, originHostname)) enqueue(u);
            const extracted = await extractCandidatesFromPage(html, pageUrlStr, originHostname);
            rawImageCount += extracted.rawImageCount;
            if (extracted.jsShell) jsShellHits += 1;
            for (const c of extracted.found) {
              if (!candidatesMap.has(c.image_url)) candidatesMap.set(c.image_url, c);
            }
          } catch {
            fetchFailures += 1;
          }
        }),
      );
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "crawl_failed" };
  }

  const rawList = [...candidatesMap.values()].sort((a, b) => {
    const areaA = (a.width ?? 0) * (a.height ?? 0);
    const areaB = (b.width ?? 0) * (b.height ?? 0);
    const capA = a.caption_blob ? 1 : 0;
    const capB = b.caption_blob ? 1 : 0;
    return capB - capA || areaB - areaA;
  });

  const hashDeadline = Date.now() + HASH_BUDGET_MS;
  const slice = rawList.slice(0, MAX_CANDIDATES + 20);
  const hashedAll = await runWithLimit(slice, MAX_CONCURRENT_IMAGE_HASH, (c) =>
    hashCandidateImage(c, originHostname, hashDeadline),
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
  if (candidatesMap.size >= MAX_CANDIDATES) warnings.push("near_candidate_cap");
  if (Date.now() - started >= CRAWL_BUDGET_MS || Date.now() >= hashDeadline) {
    warnings.push("time_budget");
  }

  let empty_reason: WebsiteImportScanMeta["empty_reason"];
  if (hashed.length === 0) {
    if (pagesFetched === 0 && fetchFailures > 0) empty_reason = "fetch_blocked";
    else if (jsShellHits > 0 && rawImageCount === 0) empty_reason = "js_shell";
    else if (rawImageCount === 0) empty_reason = "no_html_images";
    else empty_reason = "all_filtered";
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
      empty_reason,
    },
  };
}

// Reference sharp at the module level so the top-of-file `import` is not
// flagged as unused even though the actual usage is via dhash.ts. This keeps
// the dynamic import / cold-start cost out of the hot loop.
export const __sharpVersion = sharp.versions.sharp;
