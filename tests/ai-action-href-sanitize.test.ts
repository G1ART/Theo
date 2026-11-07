import assert from "node:assert/strict";
import { sanitizeActionHref } from "../src/lib/ai/sanitizeActionHref";

/**
 * QA 2026-05-28 — the profile copilot rendered AI-supplied `actionHref`
 * values straight into a <Link>, so hallucinated paths produced a 404.
 * `sanitizeActionHref` must accept only real internal routes and reject
 * everything else, so callers can fall back to a known-good route.
 */

// ── Valid static routes pass through unchanged ───────────────────────
for (const ok of [
  "/settings",
  "/settings/",
  "/settings/billing",
  "/my/exhibitions/new",
  "/upload/bulk",
  "/my/network",
  "/feed",
  "/",
]) {
  assert.equal(
    sanitizeActionHref(ok),
    ok,
    `valid static route should pass: ${ok}`
  );
}

// ── Valid dynamic routes pass ────────────────────────────────────────
assert.equal(sanitizeActionHref("/u/thegreen_oc"), "/u/thegreen_oc");
assert.equal(
  sanitizeActionHref("/artwork/abc-123/edit"),
  "/artwork/abc-123/edit"
);
assert.equal(sanitizeActionHref("/my/exhibitions/xyz/edit"), "/my/exhibitions/xyz/edit");

// ── Query / hash preserved when the pathname is valid ────────────────
assert.equal(
  sanitizeActionHref("/u/jane?mode=reorder"),
  "/u/jane?mode=reorder"
);
assert.equal(sanitizeActionHref("/settings#bio"), "/settings#bio");

// ── Hallucinated / unknown paths are rejected ────────────────────────
for (const bad of [
  "/settings/bio",
  "/settings/location",
  "/profile/edit",
  "/profile",
  "/u", // missing dynamic segment
  "/artwork", // missing id
  "/my/exhibitions/xyz/delete",
  "/random/made/up",
]) {
  assert.equal(
    sanitizeActionHref(bad),
    null,
    `unknown route should be rejected: ${bad}`
  );
}

// ── External / unsafe values are rejected ────────────────────────────
for (const bad of [
  "https://evil.example.com/settings",
  "http://abstract.app/settings",
  "//evil.example.com",
  "mailto:hi@example.com",
  "javascript:alert(1)",
  "settings", // not absolute
  "",
  "   ",
]) {
  assert.equal(
    sanitizeActionHref(bad),
    null,
    `unsafe value should be rejected: ${JSON.stringify(bad)}`
  );
}

// ── Nullish input ────────────────────────────────────────────────────
assert.equal(sanitizeActionHref(null), null);
assert.equal(sanitizeActionHref(undefined), null);

console.log("OK sanitizeActionHref — static, dynamic, query, reject paths");
