// QA hardening — Auth password recovery + duplicate-email handling.
//
// Static checks for the two QA tickets:
//
//   #1 (suggestion)  Password recovery surface.
//        a) /auth/forgot page exists, accepts ?email=, and calls
//           sendPasswordReset.
//        b) /login surfaces a "비밀번호를 잊으셨나요?" link that
//           routes to /auth/forgot.
//        c) /auth/reset uses i18n keys (no hardcoded "Set new
//           password" string) and offers an expired-link fallback
//           CTA that points back to /auth/forgot.
//
//   #2 (bug)  Duplicate-email at signup.
//        Supabase anti-enumeration default returns a synthetic user
//        with `identities: []` and sends no email. Without a guard,
//        the onboarding flow falsely shows "we sent you a confirmation
//        email". This regression test enforces:
//          - /onboarding inspects `data.user.identities.length === 0`
//            (or equivalent) before routing to the email-sent state.
//          - /onboarding renders a duplicate-email branch with sign-in
//            and reset-link CTAs.
//          - i18n keys for the duplicate state exist in EN + KO.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

(async () => {
  // ============================================================
  // #1a — /auth/forgot page exists and is wired correctly.
  // ============================================================
  const forgotPath = "src/app/auth/forgot/page.tsx";
  assert.ok(
    existsSync(path.join(ROOT, forgotPath)),
    `${forgotPath} must exist (QA #1 suggestion: password recovery surface)`
  );
  const forgot = read(forgotPath);
  assert.match(
    forgot,
    /sendPasswordReset/,
    "forgot page must call sendPasswordReset"
  );
  assert.match(
    forgot,
    /searchParams\.get\(\s*["']email["']\s*\)/,
    "forgot page must accept ?email= query for pre-fill (used by duplicate-email branch)"
  );
  assert.match(
    forgot,
    /forgotPassword\.title/,
    "forgot page must use forgotPassword.* i18n keys"
  );
  // Anti-enumeration: success path must NOT branch on whether the
  // email was registered. The page should show the same confirmation
  // unless the call is rate-limited.
  assert.match(
    forgot,
    /isRateLimitError/,
    "forgot page must collapse non-rate-limit errors to the standard confirmation (anti-enumeration)"
  );

  // ============================================================
  // #1b — /login surfaces the forgot link.
  // ============================================================
  const login = read("src/app/login/page.tsx");
  assert.match(
    login,
    /login\.forgotPasswordCta/,
    "/login must render the forgot-password CTA via the login.forgotPasswordCta i18n key"
  );
  assert.match(
    login,
    /["']\/auth\/forgot/,
    "/login must link to /auth/forgot"
  );
  // The link should pass the typed email along when present so the
  // user does not retype on the forgot page.
  assert.match(
    login,
    /\/auth\/forgot\?email=\$\{encodeURIComponent\(email\.trim\(\)\)\}/,
    "/login forgot CTA should pre-fill ?email= when the user has typed an address"
  );

  // ============================================================
  // #1c — /auth/reset is i18n + has expired-link fallback.
  // ============================================================
  const reset = read("src/app/auth/reset/page.tsx");
  assert.match(
    reset,
    /resetPassword\.title/,
    "/auth/reset must use resetPassword.* i18n keys (no more hardcoded English title)"
  );
  // No-session branch must show the expired CTA pointing at /auth/forgot.
  assert.match(
    reset,
    /resetPassword\.expiredTitle/,
    "/auth/reset must render an expired-link fallback"
  );
  assert.match(
    reset,
    /href="\/auth\/forgot"/,
    "/auth/reset expired-link fallback must link back to /auth/forgot"
  );
  // Hardcoded English strings from the previous implementation must be gone.
  for (const banned of [
    "Set new password",
    "Reset link invalid or expired",
    "Password must be at least",
    "Passwords do not match",
  ]) {
    assert.ok(
      !reset.includes(banned),
      `/auth/reset must not contain the hardcoded English string "${banned}"`
    );
  }

  // ============================================================
  // #2 — Duplicate-email guard at /onboarding.
  // ============================================================
  const onboarding = read("src/app/onboarding/page.tsx");
  assert.match(
    onboarding,
    /identities/,
    "/onboarding must inspect data.user.identities to detect duplicate-email signups"
  );
  assert.match(
    onboarding,
    /Array\.isArray\([^)]*identities[^)]*\)\s*&&\s*[^;]*identities[^;]*\.length\s*===\s*0/,
    "/onboarding must guard on `Array.isArray(identities) && identities.length === 0`"
  );
  // The duplicate state must short-circuit BEFORE the email-sent
  // state, otherwise the false confirmation still renders.
  const dupIdx = onboarding.indexOf("isDuplicateEmail");
  const sentIdx = onboarding.indexOf("setSignupEmailSent(true)");
  assert.ok(
    dupIdx !== -1 && sentIdx !== -1 && dupIdx < sentIdx,
    "/onboarding duplicate guard must run before the email-sent branch"
  );
  // Duplicate UI must offer both the sign-in and reset CTAs.
  assert.match(
    onboarding,
    /onboarding\.duplicateEmailSignInCta/,
    "/onboarding duplicate state must render the sign-in CTA"
  );
  assert.match(
    onboarding,
    /onboarding\.duplicateEmailResetCta/,
    "/onboarding duplicate state must render the reset-link CTA"
  );
  assert.match(
    onboarding,
    /\/auth\/forgot\?email=\$\{encodeURIComponent\(duplicateEmailFor\)\}/,
    "/onboarding duplicate state must pre-fill the email when linking to /auth/forgot"
  );

  // ============================================================
  // i18n parity — every new key exists in BOTH locales.
  // ============================================================
  const messages = read("src/lib/i18n/messages.ts");
  const newKeys = [
    "login.forgotPasswordCta",
    "forgotPassword.title",
    "forgotPassword.subtitle",
    "forgotPassword.labelEmail",
    "forgotPassword.sendCta",
    "forgotPassword.sentTitle",
    "forgotPassword.sentBody",
    "forgotPassword.sentHint",
    "forgotPassword.resend",
    "forgotPassword.resendCooldown",
    "forgotPassword.rateLimit",
    "resetPassword.title",
    "resetPassword.subtitle",
    "resetPassword.expiredTitle",
    "resetPassword.expiredBody",
    "resetPassword.expiredCta",
    "resetPassword.placeholderNew",
    "resetPassword.placeholderConfirm",
    "resetPassword.errorMin",
    "resetPassword.errorMismatch",
    "resetPassword.submit",
    "resetPassword.submitting",
    "onboarding.duplicateEmailTitle",
    "onboarding.duplicateEmailBody",
    "onboarding.duplicateEmailSignInCta",
    "onboarding.duplicateEmailResetCta",
    "onboarding.duplicateEmailUseDifferent",
  ];
  for (const key of newKeys) {
    const occurrences = messages.split(`"${key}"`).length - 1;
    assert.ok(
      occurrences >= 2,
      `i18n key "${key}" must be defined in both EN and KO (found ${occurrences})`
    );
  }

  console.log("auth-password-recovery.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
