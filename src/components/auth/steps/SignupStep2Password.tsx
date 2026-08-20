"use client";

/**
 * Signup v2 · Step 2 (Name + Password) — wireframe pixel-fidelity pass
 * (2026-08-20). Phase 1 + Phase 5 behavior preserved verbatim.
 *
 * Fields (per wireframe + product decisions):
 *   - Name        (required, single OvalInput — user chose to keep the
 *                  legacy `full_name` slot instead of splitting into
 *                  First / Last / Display; see docs/HANDOFF entry).
 *   - Password    (12-char minimum · zxcvbn strength meter · HIBP
 *                  k-anonymity probe — all preserved from Phase 5).
 *   - Confirm     (must match `password` exactly; inline
 *     Password       `auth.signupV2.step2.passwordMismatch` error).
 *
 * The extra Name capture used to live on Step 3; moving it here matches
 * the wireframe's field order and lets Step 3 focus on the profile
 * card. Step 3's `saveProfileUnified` payload still writes `full_name`
 * verbatim — we just push the state a step earlier.
 *
 * All the Phase 5 password affordances (12-char min via
 * `MIN_PASSWORD_LENGTH`, strength meter via zxcvbn, HIBP debounce with
 * `hibpSeqRef` stale-race guard) stay identical. Only the render order
 * changed.
 */

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OvalInput } from "@/components/auth/primitives/OvalInput";
import { PillButton } from "@/components/auth/primitives/PillButton";
import { PasswordStrengthMeter } from "@/components/auth/PasswordStrengthMeter";
import { useT } from "@/lib/i18n/useT";
import {
  MIN_PASSWORD_LENGTH,
  checkHibpPwned,
  validatePasswordShape,
} from "@/lib/auth/passwordPolicy";
import type { SignupStepApi } from "../SignupWizardShell";

// Phase 5 (2026-08-19): bumped from 500 → 800ms per parent task —
// enough dwell time that we don't hammer HIBP while the user is still
// typing a passphrase, but short enough to feel snappy on blur.
const HIBP_DEBOUNCE_MS = 800;

export function SignupStep2Password({ api }: { api: SignupStepApi }) {
  const { t } = useT();
  const [fullName, setFullName] = useState(api.state.fullName);
  const [password, setPassword] = useState(api.state.password);
  const [confirmPassword, setConfirmPassword] = useState(api.state.password);
  const [reveal, setReveal] = useState(false);
  const [pwned, setPwned] = useState<null | { pwned: boolean; count: number }>(null);
  const [checkingHibp, setCheckingHibp] = useState(false);
  const [touched, setTouched] = useState(password.length > 0);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const hibpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sequence counter so a late HIBP response for a stale password
  // can't overwrite a fresh state (fast typers can outrun the network).
  const hibpSeqRef = useRef(0);

  const shape = useMemo(() => validatePasswordShape(password), [password]);
  const isTooShort = !shape.ok && shape.issue === "tooShort";

  const runHibp = useCallback(async (candidate: string, seq: number) => {
    if (!candidate) return;
    setCheckingHibp(true);
    const res = await checkHibpPwned(candidate);
    // Drop stale responses so an in-flight request for a previous
    // password can't clobber the current verdict.
    if (seq !== hibpSeqRef.current) {
      // Only clear the spinner if this was the last-scheduled request.
      return;
    }
    setCheckingHibp(false);
    setPwned(res);
  }, []);

  // Schedule an HIBP check `HIBP_DEBOUNCE_MS` after the user stops
  // typing / blurs. Skips when the shape isn't valid yet (nothing
  // useful to check under 12 chars). `handlePasswordChange` already
  // clears the stale verdict on every keystroke, so the effect only
  // schedules a fresh async check.
  useEffect(() => {
    if (hibpTimerRef.current) clearTimeout(hibpTimerRef.current);
    if (!password || isTooShort) {
      // Nothing to check — make sure the spinner isn't left spinning.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCheckingHibp(false);
      return;
    }
    const seq = ++hibpSeqRef.current;
    hibpTimerRef.current = setTimeout(() => {
      void runHibp(password, seq);
    }, HIBP_DEBOUNCE_MS);
    return () => {
      if (hibpTimerRef.current) clearTimeout(hibpTimerRef.current);
    };
  }, [password, isTooShort, runHibp]);

  function handlePasswordChange(next: string) {
    setPassword(next);
    setTouched(true);
    setPwned(null);
  }

  const pwnedError = pwned?.pwned === true;
  const trimmedName = fullName.trim();
  const passwordsMismatch =
    confirmTouched &&
    confirmPassword.length > 0 &&
    confirmPassword !== password;
  const canContinue =
    !!trimmedName &&
    shape.ok &&
    !pwnedError &&
    confirmPassword === password &&
    confirmPassword.length > 0;

  const inlineError =
    touched && isTooShort
      ? t("auth.signupV2.step2.errorTooShort").replace("{min}", String(MIN_PASSWORD_LENGTH))
      : pwnedError
      ? t("auth.password.hibp.pwned")
      : undefined;

  const inlineHint = touched
    ? undefined
    : t("auth.signupV2.step2.passwordHint").replace("{min}", String(MIN_PASSWORD_LENGTH));

  const confirmError = passwordsMismatch
    ? t("auth.signupV2.step2.passwordMismatch")
    : undefined;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setConfirmTouched(true);
    if (!canContinue) return;
    api.updateState({ password, fullName: trimmedName });
    // Password is never persisted (§11.6). Name is persisted so the
    // user can refresh at Step 3 without retyping.
    api.persistDraft({ step: 3, fullName: trimmedName });
    api.goToStep(3);
  }

  // Legal footer uses a token template so KO/EN copies can share the
  // same anchor rendering. The i18n string must contain literal
  // `{terms}` and `{privacy}` tokens.
  const legalTemplate = t("auth.signupV2.step2.legalTemplate");
  const termsLabel = t("auth.signupV2.step2.termsLabel");
  const privacyLabel = t("auth.signupV2.step2.privacyLabel");
  const termsHref = "/legal/terms";
  const privacyHref = "/legal/privacy";

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <OvalInput
        labelStyle="outer"
        label={t("auth.signupV2.step2.fullNameLabel")}
        value={fullName}
        onChange={(v) => {
          setFullName(v);
          api.updateState({ fullName: v });
        }}
        onBlur={() => {
          if (fullName.trim()) {
            api.persistDraft({ fullName: fullName.trim() });
          }
        }}
        autoComplete="name"
        autoFocus
        required
      />

      <div>
        <OvalInput
          labelStyle="outer"
          label={t("auth.signupV2.step2.passwordLabel")}
          type={reveal ? "text" : "password"}
          value={password}
          onChange={handlePasswordChange}
          onBlur={() => setTouched(true)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          hint={inlineHint}
          error={inlineError}
          loading={checkingHibp}
          required
          trailingAdornment={
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-label={
                reveal
                  ? t("auth.signupV2.step2.hidePassword")
                  : t("auth.signupV2.step2.showPassword")
              }
              className="rounded-full px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
            >
              {reveal
                ? t("auth.signupV2.step2.hidePassword")
                : t("auth.signupV2.step2.showPassword")}
            </button>
          }
        />

        {password && (
          <div className="mt-3">
            <PasswordStrengthMeter
              password={password}
              userInputs={[api.state.email, fullName]}
              minLength={MIN_PASSWORD_LENGTH}
            />
          </div>
        )}

        {checkingHibp && !pwnedError && (
          <p
            role="status"
            aria-live="polite"
            className="mt-2 text-[11px] text-zinc-500"
          >
            {t("auth.password.hibp.checking")}
          </p>
        )}
      </div>

      <OvalInput
        labelStyle="outer"
        label={t("auth.signupV2.step2.confirmPasswordLabel")}
        type={reveal ? "text" : "password"}
        value={confirmPassword}
        onChange={setConfirmPassword}
        onBlur={() => setConfirmTouched(true)}
        autoComplete="new-password"
        required
        error={confirmError}
      />

      <PillButton type="submit" variant="primary" fullWidth>
        {t("auth.signupV2.step2.continueCta")}
      </PillButton>

      <p className="text-center text-[11px] leading-relaxed text-zinc-500">
        {renderLegalTemplate(legalTemplate, {
          termsHref,
          termsLabel,
          privacyHref,
          privacyLabel,
        })}
      </p>
    </form>
  );
}

/**
 * Render the passive-consent line by replacing `{terms}` / `{privacy}`
 * tokens with anchor tags. Message copy uses curly-brace tokens so
 * translators can't accidentally break markup.
 */
function renderLegalTemplate(
  template: string,
  opts: {
    termsHref: string;
    termsLabel: string;
    privacyHref: string;
    privacyLabel: string;
  },
) {
  const parts = template
    .split(/(\{terms\}|\{privacy\})/)
    .filter((p) => p.length > 0);
  return parts.map((part, i) => {
    if (part === "{terms}") {
      return (
        <a
          key={i}
          href={opts.termsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900"
        >
          {opts.termsLabel}
        </a>
      );
    }
    if (part === "{privacy}") {
      return (
        <a
          key={i}
          href={opts.privacyHref}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900"
        >
          {opts.privacyLabel}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
