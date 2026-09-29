/**
 * Normalize user-provided website URL and enforce safe fetch targets.
 *
 * Defense layers (because a single layer is not enough for SSRF):
 *
 *  1. Hostname syntax filter — block obvious private literals, the lo-only
 *     names ("localhost", "*.internal"), and the metadata service.
 *  2. Numeric-host normalization — `URL` parses 0/2130706433/0177.x.x.x
 *     into hostnames that can still resolve to private space; reject if a
 *     literal IP form (decimal or hex) is private.
 *  3. DNS resolution check — `assertResolvedHostSafe` does a best-effort
 *     `dns.lookup({ all: true })` and rejects if any returned address is
 *     private/loopback/link-local. This blocks DNS-rebinding attempts that
 *     return a public address at validation time and a private one at
 *     fetch time, _provided_ both happen quickly enough that the cached
 *     answer is reused. We pair this with `redirect: "manual"` in the
 *     crawler so that follow-ups also get re-validated.
 *
 * The crawler is also expected to:
 *   - Use `redirect: "manual"` and re-validate every Location.
 *   - Cap response size before/while reading the body.
 *   - Refuse non-HTML payloads for the page kind.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
]);

const PRIVATE_IPV4 = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

const PRIVATE_IPV6_PREFIXES = [
  "::1", // loopback
  "::ffff:", // IPv4-mapped — defer to v4 check
  "fc", // unique local fc00::/7
  "fd", // unique local
  "fe80:", // link-local
  "fe90:", // link-local (rare)
  "fea0:", // link-local (rare)
  "feb0:", // link-local (rare)
];

export function stripTrackingParams(url: URL): void {
  for (const k of [...url.searchParams.keys()]) {
    const low = k.toLowerCase();
    if (TRACKING_PARAMS.has(low)) url.searchParams.delete(k);
  }
}

export function normalizeWebsiteUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "unsupported_scheme" };
  }
  if (!parsed.hostname || parsed.hostname === "localhost") {
    return { ok: false, reason: "blocked_host" };
  }
  if (isBlockedHostname(parsed.hostname)) {
    return { ok: false, reason: "blocked_host" };
  }
  stripTrackingParams(parsed);
  parsed.hash = "";
  return { ok: true, url: parsed };
}

/**
 * IPv4 in numeric / decimal / hex / octal forms can slip past textual filters
 * because `URL` accepts e.g. `http://0/`, `http://2130706433/`, `http://0x7f.1/`.
 * We try to detect "looks numeric" hostnames and reject when the resulting
 * 32-bit integer falls into private space.
 */
function looksNumericHost(host: string): boolean {
  if (host === "" || host === "0") return true;
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  if (/^\d+$/.test(host)) return true;
  return false;
}

function numericHostToIPv4(host: string): string | null {
  let n: number | null = null;
  if (host === "0") return "0.0.0.0";
  if (/^0x[0-9a-f]+$/i.test(host)) {
    const v = parseInt(host, 16);
    if (Number.isFinite(v) && v >= 0 && v <= 0xffffffff) n = v;
  } else if (/^\d+$/.test(host)) {
    const v = parseInt(host, 10);
    if (Number.isFinite(v) && v >= 0 && v <= 0xffffffff) n = v;
  }
  if (n == null) return null;
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
}

function isPrivateIpAddress(addr: string): boolean {
  const family = isIP(addr);
  if (family === 4) {
    return PRIVATE_IPV4.test(addr);
  }
  if (family === 6) {
    const lower = addr.toLowerCase();
    if (PRIVATE_IPV6_PREFIXES.some((p) => lower === p || lower.startsWith(p))) return true;
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice("::ffff:".length);
      if (isIP(v4) === 4 && PRIVATE_IPV4.test(v4)) return true;
    }
    return false;
  }
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  if (h === "metadata.google.internal" || h.endsWith(".internal")) return true;

  if (isIP(h) === 4 && PRIVATE_IPV4.test(h)) return true;
  if (isIP(h) === 6 && isPrivateIpAddress(h)) return true;

  if (looksNumericHost(h)) {
    const v4 = numericHostToIPv4(h);
    if (v4 && isPrivateIpAddress(v4)) return true;
  }
  return false;
}

/** Known CDN / asset hosts we allow for <img> bytes when the HTML page is on the origin host. */
const IMAGE_HOST_SUFFIX_ALLOW = [
  "squarespace-cdn.com",
  "squarespace.com",
  "wixstatic.com",
  "cloudinary.com",
  "imgix.net",
  "wp.com",
  "files.wordpress.com",
  "supabase.co",
  "cloudfront.net",
  "akamaized.net",
  "cargo.site",
  "format.com",
  "shopifycdn.com",
  "shopify.com",
  "wsimg.com",
  "cdn.sanity.io",
  "graphassets.com",
];

export function isSameSiteHost(host: string, originHostname: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const o = originHostname.toLowerCase().replace(/^www\./, "");
  return h === o || h.endsWith("." + o);
}

export function assertFetchablePageUrl(pageUrl: URL, originHostname: string): void {
  const host = pageUrl.hostname.toLowerCase();
  if (isBlockedHostname(host)) throw new Error("blocked_target");
  if (!isSameSiteHost(host, originHostname)) throw new Error("cross_origin_page");
  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") throw new Error("unsupported_scheme");
}

export function assertFetchableImageUrl(imageUrl: URL, originHostname: string): void {
  const host = imageUrl.hostname.toLowerCase();
  if (isBlockedHostname(host)) throw new Error("blocked_target");
  if (imageUrl.protocol !== "https:" && imageUrl.protocol !== "http:") throw new Error("unsupported_scheme");
  const origin = originHostname.toLowerCase();
  if (isSameSiteHost(host, origin)) return;
  const allowedCdn = IMAGE_HOST_SUFFIX_ALLOW.some((suffix) => host === suffix || host.endsWith("." + suffix));
  if (!allowedCdn) throw new Error("image_host_not_allowed");
}

/**
 * Resolve `host` and reject if any returned IP is private/loopback/link-local.
 * Best-effort: if DNS itself fails we let the caller surface a fetch-level
 * error rather than swallowing it here.
 */
export async function assertResolvedHostSafe(host: string): Promise<void> {
  // Literal IPs already get checked by `isBlockedHostname`; running lookup
  // on them returns the same IP, so this is a redundancy-as-defense pass.
  let addresses: { address: string; family: number }[] = [];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new Error("dns_unresolved");
  }
  if (addresses.length === 0) throw new Error("dns_unresolved");
  for (const a of addresses) {
    if (isPrivateIpAddress(a.address)) {
      throw new Error("blocked_resolved_ip");
    }
  }
}

export function resolveUrl(base: string, href: string): URL | null {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}
