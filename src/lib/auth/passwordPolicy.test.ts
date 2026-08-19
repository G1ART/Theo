// Signup v2 Phase 1 (2026-08-19) — passwordPolicy unit tests.
//
// Runs via `tsx --test src/lib/auth/passwordPolicy.test.ts`. Covers:
//   - Shape (empty / short / ok).
//   - Strength buckets (weak / strong).
//   - HIBP: (a) suffix match with count > 0 → pwned, (b) suffix match
//     with count = 0 (padded row) → not pwned, (c) 404 → fail-open,
//     (d) network throw → fail-open.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_PASSWORD_LENGTH,
  validatePasswordShape,
  computePasswordStrength,
  checkHibpPwned,
} from "./passwordPolicy";

// ── validatePasswordShape ──────────────────────────────────────────

test("shape: empty string is reported as 'empty'", () => {
  const r = validatePasswordShape("");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.issue, "empty");
});

test(`shape: short (< ${MIN_PASSWORD_LENGTH}) is reported as 'tooShort'`, () => {
  const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
  const r = validatePasswordShape(short);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.issue, "tooShort");
});

test(`shape: exactly ${MIN_PASSWORD_LENGTH} chars is ok`, () => {
  const ok = "a".repeat(MIN_PASSWORD_LENGTH);
  const r = validatePasswordShape(ok);
  assert.equal(r.ok, true);
});

test("shape: does NOT force digits or symbols (NIST-style)", () => {
  const alphaOnly = "abcdefghijklmnop"; // 16 chars, no digits/symbols
  const r = validatePasswordShape(alphaOnly);
  assert.equal(r.ok, true);
});

// ── computePasswordStrength ────────────────────────────────────────

test("strength: obvious weak sequence scores 0/1 (veryWeak or weak)", () => {
  const r = computePasswordStrength("12345678901");
  assert.ok(r.score <= 1, `expected weak, got score=${r.score}`);
  assert.ok(
    r.label === "veryWeak" || r.label === "weak",
    `expected veryWeak|weak, got label=${r.label}`,
  );
});

test("strength: long random-looking password scores >= 3", () => {
  // Long, high-entropy, no common patterns. zxcvbn typically scores 4.
  const r = computePasswordStrength("m8Kx!qz#Ap2Vr9Ln");
  assert.ok(r.score >= 3, `expected score>=3, got score=${r.score}`);
  assert.ok(
    r.label === "strong" || r.label === "veryStrong",
    `expected strong|veryStrong, got label=${r.label}`,
  );
});

test("strength: empty password is score 0 with no suggestions", () => {
  const r = computePasswordStrength("");
  assert.equal(r.score, 0);
  assert.equal(r.label, "veryWeak");
  assert.deepEqual(r.suggestions, []);
});

test("strength: user inputs penalize predictable derivatives", () => {
  // Baseline: "danielsmith" alone might score 1.
  // With userInputs=['[email protected]'] the password should stay weak.
  const r = computePasswordStrength("danielsmith", ["[email protected]"]);
  assert.ok(r.score <= 1, `expected weak with email hint, got ${r.score}`);
});

// ── checkHibpPwned ─────────────────────────────────────────────────

function mockFetchOnce(body: string, status = 200): typeof fetch {
  const mock = (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return body;
      },
    })) as unknown as typeof fetch;
  return mock;
}

test("hibp: suffix match with count > 0 flags password as pwned", async () => {
  // Deterministic SHA-1 stub so the range call reads the mocked body.
  // "abcdef..." full hex: prefix=ABCDE suffix=F0123456789ABCDEF0123456789ABCDEF01234
  const hex = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
  const body = [
    "0000000000000000000000000000000000000:1",
    // Match the suffix (chars 5..40) — count > 0 means pwned.
    `${hex.slice(5)}:42`,
    "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:99",
  ].join("\n");
  const r = await checkHibpPwned("whatever", {
    fetchImpl: mockFetchOnce(body),
    sha1Impl: async () => hex,
  });
  assert.equal(r.pwned, true);
  assert.equal(r.count, 42);
});

test("hibp: padded row (count = 0) is NOT reported as pwned", async () => {
  const hex = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
  const body = `${hex.slice(5)}:0`;
  const r = await checkHibpPwned("whatever", {
    fetchImpl: mockFetchOnce(body),
    sha1Impl: async () => hex,
  });
  assert.equal(r.pwned, false);
  assert.equal(r.count, 0);
});

test("hibp: non-ok response degrades to fail-open", async () => {
  const r = await checkHibpPwned("whatever", {
    fetchImpl: mockFetchOnce("", 503),
    sha1Impl: async () => "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
  });
  assert.deepEqual(r, { pwned: false, count: 0 });
});

test("hibp: thrown fetch degrades to fail-open (no user-facing block)", async () => {
  const throwing = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const r = await checkHibpPwned("whatever", {
    fetchImpl: throwing,
    sha1Impl: async () => "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
  });
  assert.deepEqual(r, { pwned: false, count: 0 });
});

test("hibp: empty password short-circuits without a network call", async () => {
  let called = false;
  const spy = (async () => {
    called = true;
    return { ok: true, status: 200, async text() { return ""; } } as Response;
  }) as unknown as typeof fetch;
  const r = await checkHibpPwned("", { fetchImpl: spy });
  assert.equal(called, false);
  assert.deepEqual(r, { pwned: false, count: 0 });
});
