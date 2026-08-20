"use client";

/**
 * Signup v2 · Step 2 (Password) — Phase 1 + Phase 5, 2026-08-19.
 *
 * - 12-char minimum (spec §5 #8 / §11.2), enforced client-side.
 * - Strength meter via `computePasswordStrength` (zxcvbn 4). Rendered
 *   through the shared `PasswordStrengthMeter` component (Phase 5).
 * - HIBP k-anonymity check runs on debounced blur / pause typing
 *   (800 ms) via `checkHibpPwned`. Only 5 hex chars of the SHA-1
 *   prefix leave the client. Network failure → fail-open (never
 *   blocks). Confirmed pwned → hard block on submit until the
 *   password changes.
 * - Show / hide toggle inline.
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
  const [password, setPassword] = useState(api.state.password);
  const [reveal, setReveal] = useState(false);
  const [pwned, setPwned] = useState<null | { pwned: boolean; count: number }>(null);
  const [checkingHibp, setCheckingHibp] = useState(false);
  const [touched, setTouched] = useState(password.length > 0);
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
    // Invalidate any prior HIBP verdict for the stale password.
    setPwned(null);
  }

  const pwnedError = pwned?.pwned === true;
  const canContinue = shape.ok && !pwnedError;

  const inlineError =
    touched && isTooShort
      ? t("auth.signupV2.step2.errorTooShort").replace("{min}", String(MIN_PASSWORD_LENGTH))
      : pwnedError
      ? t("auth.password.hibp.pwned")
      : undefined;

  const inlineHint = touched
    ? undefined
    : t("auth.signupV2.step2.passwordHint").replace("{min}", String(MIN_PASSWORD_LENGTH));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canContinue) return;
    api.updateState({ password });
    // Password is never persisted (§11.6). Only step advance is drafted.
    api.persistDraft({ step: 3 });
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
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="space-y-3">
        <OvalInput
          label={t("auth.signupV2.step2.passwordLabel")}
          type={reveal ? "text" : "password"}
          value={password}
          onChange={handlePasswordChange}
          onBlur={() => setTouched(true)}
          autoComplete="new-password"
          autoFocus
          minLength={MIN_PASSWORD_LENGTH}
          hint={inlineHint}
          error={inlineError}
          loading={checkingHibp}
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
          <PasswordStrengthMeter
            password={password}
            userInputs={[api.state.email]}
            minLength={MIN_PASSWORD_LENGTH}
          />
        )}

        {checkingHibp && !pwnedError && (
          <p
            role="status"
            aria-live="polite"
            className="text-[11px] text-zinc-500"
          >
            {t("auth.password.hibp.checking")}
          </p>
        )}
      </div>

      <PillButton
        type="submit"
        variant="primary"
        fullWidth
        disabled={!canContinue}
      >
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
