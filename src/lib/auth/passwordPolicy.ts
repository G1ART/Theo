/**
 * Password policy helpers for Signup v2 (Phase 1, 2026-08-19).
 *
 * See `docs/SIGNUP_REDESIGN_SPEC.md` §5 #8 and §11.2 for the full spec.
 * Summary:
 *   1. `MIN_PASSWORD_LENGTH = 12` (NIST-style: length over character-
 *      class rules — do NOT force digits / symbols).
 *   2. `computePasswordStrength()` wraps zxcvbn 4 to produce a 0–4 score
 *      with a labeled bucket for the strength meter (5 buckets so a
 *      score-3 password still shows a visible "strong" bar).
 *   3. `checkHibpPwned()` calls Have-I-Been-Pwned's k-anonymity range
 *      API. Only the first 5 chars of the SHA-1 hex prefix are sent so
 *      the plaintext password is never transmitted. The `Add-Padding:
 *      true` header is sent so response length cannot leak the number
 *      of matches. Network failure degrades to `{ pwned: false }` (fail-
 *      open) so a flaky connection can't block signup.
 *
 * All helpers are pure and side-effect-free (the HIBP one hits the
 * network, obviously) so they can be reused from server RPCs later if
 * we want to enforce policy at the DB boundary.
 */

import zxcvbn from "zxcvbn";

export const MIN_PASSWORD_LENGTH = 12;

/** Labels align with the i18n key namespace `auth.password.strength.*`. */
export type PasswordStrengthLabel =
  | "veryWeak"
  | "weak"
  | "fair"
  | "strong"
  | "veryStrong";

export type PasswordShapeIssue = "tooShort" | "empty";

export type PasswordShapeResult =
  | { ok: true }
  | { ok: false; issue: PasswordShapeIssue };

/**
 * Minimum shape gate — length only. We deliberately do NOT enforce
 * character-class rules (digits / uppercase / symbols); modern guidance
 * (NIST 800-63B §5.1.1.2) prefers long passphrases over composition
 * rules. Strength gating happens via zxcvbn in
 * `computePasswordStrength`.
 */
export function validatePasswordShape(password: string): PasswordShapeResult {
  if (!password || password.length === 0) {
    return { ok: false, issue: "empty" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, issue: "tooShort" };
  }
  return { ok: true };
}

export type PasswordStrength = {
  /** zxcvbn 0–4 score. */
  score: 0 | 1 | 2 | 3 | 4;
  label: PasswordStrengthLabel;
  /** Free-form suggestions from zxcvbn (already localized by zxcvbn 4 —
   *  we surface them verbatim as English hints; the UI can suppress
   *  them if the current locale is not English). */
  suggestions: string[];
  /** Optional warning from zxcvbn (single line). */
  warning: string | null;
};

const LABELS: readonly PasswordStrengthLabel[] = [
  "veryWeak",
  "weak",
  "fair",
  "strong",
  "veryStrong",
];

/**
 * Compute a strength score for the given password.
 *
 * Empty password is reported as `score=0 / label=veryWeak` so the meter
 * still renders sensibly (0 bars filled). We pass `user_inputs` when
 * provided so predictable email-derived passwords ("dan@x.com" →
 * "dandan") are penalized.
 */
export function computePasswordStrength(
  password: string,
  userInputs: readonly string[] = []
): PasswordStrength {
  if (!password) {
    return { score: 0, label: "veryWeak", suggestions: [], warning: null };
  }
  const inputs = userInputs.filter((v) => typeof v === "string" && v.length > 0);
  const result = zxcvbn(password, inputs.length ? inputs.slice() : undefined);
  const score = (result.score ?? 0) as 0 | 1 | 2 | 3 | 4;
  const label = LABELS[score] ?? "veryWeak";
  const suggestions = Array.isArray(result.feedback?.suggestions)
    ? result.feedback.suggestions.filter((s): s is string => typeof s === "string")
    : [];
  const warning =
    typeof result.feedback?.warning === "string" && result.feedback.warning.length > 0
      ? result.feedback.warning
      : null;
  return { score, label, suggestions, warning };
}

export type HibpResult = {
  /** `true` when the password appears in HIBP's breach corpus. */
  pwned: boolean;
  /** Count of times the password appears in HIBP's breach corpus.
   *  `0` when the password is not pwned or when the check failed. */
  count: number;
};

// SHA-1 is only used here as a k-anonymity prefix (never as a hash for
// the password itself) — this is exactly the HIBP contract, not a
// security regression. We hand-roll SHA-1 through WebCrypto so we don't
// pull a Node polyfill into the client bundle.
async function sha1HexUpper(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== "function") {
    throw new Error("WebCrypto SHA-1 unavailable");
  }
  const buf = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-1", buf);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const hex = bytes[i].toString(16).padStart(2, "0");
    out += hex;
  }
  return out.toUpperCase();
}

/** Public overrides for tests. Not for production use. */
export type HibpOverrides = {
  /** Replaces `globalThis.fetch` for the range call. Useful for tests. */
  fetchImpl?: typeof fetch;
  /** Replaces the SHA-1 hex computation. Useful for tests that don't
   *  want to depend on WebCrypto availability under `tsx --test`. */
  sha1Impl?: (input: string) => Promise<string>;
};

/**
 * HIBP k-anonymity check. The password's SHA-1 hex is split into a
 * 5-char prefix (sent to the API) and a 35-char suffix (compared
 * locally against the response body).
 *
 * Returns `{ pwned: false, count: 0 }` on any network / parsing error —
 * we treat HIBP as a soft gate so we never block a user because the
 * range endpoint is down (fail-open, per §11.2 of the spec).
 */
export async function checkHibpPwned(
  password: string,
  overrides: HibpOverrides = {}
): Promise<HibpResult> {
  const failOpen: HibpResult = { pwned: false, count: 0 };
  if (!password) return failOpen;
  try {
    const hex = overrides.sha1Impl
      ? await overrides.sha1Impl(password)
      : await sha1HexUpper(password);
    if (!/^[0-9A-F]{40}$/.test(hex)) return failOpen;
    const prefix = hex.slice(0, 5);
    const suffix = hex.slice(5);
    const doFetch = overrides.fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== "function") return failOpen;
    const res = await doFetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: "GET",
      headers: { "Add-Padding": "true" },
    });
    if (!res || !res.ok) return failOpen;
    const body = await res.text();
    if (!body) return failOpen;
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const hashSuffix = line.slice(0, idx).trim().toUpperCase();
      if (hashSuffix !== suffix) continue;
      const rawCount = line.slice(idx + 1).trim();
      const parsed = Number.parseInt(rawCount, 10);
      const count = Number.isFinite(parsed) ? parsed : 0;
      // Padded rows are inserted with `count = 0` (see HIBP's Add-
      // Padding: true spec). Only counts > 0 mean the password is
      // actually pwned.
      if (count > 0) {
        return { pwned: true, count };
      }
      return failOpen;
    }
    return failOpen;
  } catch {
    return failOpen;
  }
}
