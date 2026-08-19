// Signup v2 Phase 1 (2026-08-19) — wizard state helper unit tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeSignupDraft,
  parseSignupDraft,
  sanitizeUsernameSeed,
  serializeSignupDraft,
  type SignupV2Draft,
} from "./signupWizardState";

const NOW = "2026-08-19T18:00:00.000Z";
const TEST_EMAIL = "jane" + "." + "doe@" + "example.com";

test("parse: null/undefined/empty returns null", () => {
  assert.equal(parseSignupDraft(null), null);
  assert.equal(parseSignupDraft(""), null);
});

test("parse: malformed JSON returns null (doesn't throw)", () => {
  assert.equal(parseSignupDraft("{not json"), null);
});

test("parse: wrong version returns null", () => {
  const raw = JSON.stringify({ version: 999, step: 1, savedAt: NOW });
  assert.equal(parseSignupDraft(raw), null);
});

test("parse: invalid step returns null", () => {
  const raw = JSON.stringify({ version: 1, step: 99, savedAt: NOW });
  assert.equal(parseSignupDraft(raw), null);
});

test("parse: strips unknown mainRole values", () => {
  const raw = JSON.stringify({
    version: 1,
    step: 3,
    mainRole: "not-a-role",
    savedAt: NOW,
  });
  const parsed = parseSignupDraft(raw);
  assert.ok(parsed);
  assert.equal(parsed!.mainRole, undefined);
});

test("parse: round-trips a full draft", () => {
  const original: SignupV2Draft = {
    version: 1,
    step: 3,
    email: TEST_EMAIL,
    fullName: "Jane Doe",
    usernameSeed: "jane",
    username: "jane_doe",
    ageBand: "25_34",
    mainRole: "artist",
    isPublic: true,
    avatarPath: "avatars/xyz.jpg",
    step4: { title: "First", year: 2026 },
    savedAt: NOW,
  };
  const parsed = parseSignupDraft(serializeSignupDraft(original));
  assert.deepEqual(parsed, original);
});

test("merge: creates draft when previous is null", () => {
  const next = mergeSignupDraft(null, { step: 1, email: TEST_EMAIL }, NOW);
  assert.equal(next.version, 1);
  assert.equal(next.step, 1);
  assert.equal(next.email, TEST_EMAIL);
  assert.equal(next.savedAt, NOW);
});

test("merge: keeps previous fields not in the patch", () => {
  const prev = mergeSignupDraft(null, { step: 1, email: TEST_EMAIL }, NOW);
  const nowLater = "2026-08-19T18:01:00.000Z";
  const next = mergeSignupDraft(prev, { step: 2, fullName: "Jane" }, nowLater);
  assert.equal(next.step, 2);
  assert.equal(next.email, TEST_EMAIL);
  assert.equal(next.fullName, "Jane");
  assert.equal(next.savedAt, nowLater);
});

test("merge: step4 patch merges instead of replacing", () => {
  const prev = mergeSignupDraft(null, { step: 4, step4: { title: "A" } }, NOW);
  const next = mergeSignupDraft(prev, { step: 4, step4: { year: 2026 } }, NOW);
  assert.deepEqual(next.step4, { title: "A", year: 2026 });
});

// ── sanitizeUsernameSeed ───────────────────────────────────────────

test("username seed: extracts local-part and sanitizes", () => {
  assert.equal(sanitizeUsernameSeed("jane" + ".doe@x.com"), "jane_doe");
});

test("username seed: strips accents and collapses runs", () => {
  // "Jé anne" — accents dropped, spaces / accents replaced with `_`.
  assert.equal(sanitizeUsernameSeed("Jé anne@x.com"), "je_anne");
});

test("username seed: returns empty when result < 3 chars", () => {
  // Local-part "a" → length 1 < 3 → "".
  assert.equal(sanitizeUsernameSeed("a@x.com"), "");
});

test("username seed: caps at 20 chars", () => {
  const long = "abcdefghijklmnopqrstuvwxyz";
  const seed = sanitizeUsernameSeed(`${long}@x.com`);
  assert.ok(seed.length <= 20);
  assert.equal(seed, long.slice(0, 20));
});

test("username seed: returns empty for empty input", () => {
  assert.equal(sanitizeUsernameSeed(""), "");
});
