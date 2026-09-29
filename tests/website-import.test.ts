import assert from "node:assert/strict";
import { parseMetadataLine } from "../src/lib/websiteImport/metadataParse";
import { hammingDistanceHex, bucketMatch } from "../src/lib/websiteImport/dhash";
import { normalizeWebsiteUrl, isBlockedHostname, isSameSiteHost } from "../src/lib/websiteImport/urlSafety";

// ── URL safety ─────────────────────────────────────────────
{
  const ok = normalizeWebsiteUrl("https://example.com/portfolio?utm_source=x");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.ok(!ok.url.searchParams.has("utm_source"));

  const bad = normalizeWebsiteUrl("ftp://example.com");
  assert.equal(bad.ok, false);

  assert.equal(isBlockedHostname("127.0.0.1"), true);
  assert.equal(isBlockedHostname("example.com"), false);

  // P0 SSRF hardening additions: IPv6 + numeric/hex/octal IPv4 forms
  assert.equal(isBlockedHostname("::1"), true, "ipv6 loopback blocked");
  assert.equal(isBlockedHostname("fc00::1"), true, "ipv6 ULA blocked");
  assert.equal(isBlockedHostname("fe80::1"), true, "ipv6 link-local blocked");
  assert.equal(isBlockedHostname("0"), true, "numeric host 0 blocked");
  assert.equal(isBlockedHostname("2130706433"), true, "decimal 127.0.0.1 blocked");
  assert.equal(isBlockedHostname("0x7f000001"), true, "hex 127.0.0.1 blocked");
  assert.equal(isBlockedHostname("169.254.169.254"), true, "AWS metadata blocked");
  assert.equal(isBlockedHostname("metadata.google.internal"), true, "GCP metadata blocked");
  assert.equal(isBlockedHostname("public.example.com"), false);
  assert.equal(isSameSiteHost("www.studio.com", "studio.com"), true);
  assert.equal(isSameSiteHost("work.studio.com", "www.studio.com"), true);
  assert.equal(isSameSiteHost("other.com", "studio.com"), false);
}

// ── Metadata parse (deterministic, source-backed) ───────────
{
  const p = parseMetadataLine("Wave I, 2016, acrylic on canvas, 36\"x36\"");
  assert.equal(p?.year, 2016);
  assert.ok(p?.medium?.toLowerCase().includes("acrylic"));
  assert.ok(p?.size?.includes("36"));
  assert.equal(p?.size_unit, "in");
}

{
  const p = parseMetadataLine("   ");
  assert.equal(p, null);
}

// ── P1 metadata parser hardening ───────────────────────────
{
  // Korean medium keyword survives (캔버스에 유채)
  const p = parseMetadataLine("파도, 2018, 캔버스에 유채, 100 × 80 cm");
  assert.equal(p?.year, 2018);
  assert.ok(p?.medium?.includes("캔버스") || p?.medium?.includes("유채"), `expected ko medium, got ${p?.medium}`);
  assert.equal(p?.size_unit, "cm");
}
{
  // Title containing a year is preserved (no longer dropped by year filter).
  const p = parseMetadataLine("Diary 2020, 2021, oil on canvas, 24 x 30 in");
  assert.equal(p?.year, 2020); // first match wins; that's fine for matching
  assert.ok(p?.title?.includes("Diary"), `title got: ${p?.title}`);
}
{
  // mm normalizes to cm
  const p = parseMetadataLine("Untitled, 2022, oil on canvas, 1500 x 2000 mm");
  assert.equal(p?.size_unit, "cm");
  assert.ok(p?.size?.includes("150"), `expected normalized cm got: ${p?.size}`);
}
{
  // ft normalizes to in
  const p = parseMetadataLine("Untitled, 2022, acrylic, 3 x 4 ft");
  assert.equal(p?.size_unit, "in");
  assert.ok(p?.size?.includes("36"), `expected normalized in got: ${p?.size}`);
}

// ── Hamming / confidence buckets ───────────────────────────
{
  assert.equal(hammingDistanceHex("0".repeat(16), "0".repeat(16)), 0);
  assert.equal(hammingDistanceHex("f".repeat(16), "0".repeat(16)), 64);
}

{
  const high = bucketMatch([
    { hamming: 6, dimension_bonus: 0 },
    { hamming: 18, dimension_bonus: 0 },
  ]);
  assert.equal(high.status, "high_confidence");

  const amb = bucketMatch([
    { hamming: 12, dimension_bonus: 0 },
    { hamming: 14, dimension_bonus: 0 },
  ]);
  assert.equal(amb.status, "review_needed");

  const none = bucketMatch([
    { hamming: 40, dimension_bonus: 0 },
    { hamming: 41, dimension_bonus: 0 },
  ]);
  assert.equal(none.status, "no_match");
}

console.log("website-import tests: ok");
